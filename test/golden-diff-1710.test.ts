import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ManualClock, PumpSim, ServidorTcp, kkValido } from '../src/index.js';
import { passo } from './util.js';

/**
 * Golden of the 17/10 diff (Windows bench): each step of diff-1/2/3.json, on the
 * simulador-2.7.2 profile, with rx_A (the REAL SimuladorCBC 2.7.2) as expected. Plus the full cycle
 * of the bench capture of 2026-10-17 (a 7.02 L fueling on nozzle 04) with a fake clock.
 *
 * A already carried the step 5 fueling (7.02 L on nozzle 04, read and with &I), price 5899
 * on nozzle 04 and the PC clock. Instead of masking the state, we reproduce A's through the API
 * (price, fueling, &A, &I): the pointers, the totalizer and &T01 match byte by byte.
 * Only the &S voltage byte (G + 2 chars) is masked: on the 2.7.2 it changes every tick.
 * Nothing here applies to real profiles (the manual rules them; see bancada-diff-1710.test.ts).
 */

type Passo = readonly [tx: string, rxA: string | null, nota?: string];

/** rx_A (real 2.7.2) of each step, in the order the bench ran them (diff-1/2/3.json). */
const CASOS: Record<string, readonly Passo[]> = {
  // BANCADA-1710 — Windows bench 17/10 (real 2.7.2, freshly opened state)
  "BANCADA-1710": [
    ["(&S)", "(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G81)", "T da bateria varia"],
    ["(&U040058991E)", "(U04)"],
    ["(&T01l47)", "(TG01000100017E)"],
    ["(&T01L27)", "(TG01000100017E)"],
    ["(&T04l4A)", "(Tl0400000007020D)"],
    ["(&T08l4E)", "(Tl08000000000008)"],
    ["(&T04L2A)", "(TL04000007028D)"],
    ["(&T08L2E)", "(TL080000000088)"],
    ["(&A)", "(0)"],
    ["(&A67)", "(0)"],
    ["(&T04L00)", null],
  ],
  // DIFF-02 — Real &M errors
  "DIFF-02": [
    ["(&M04Z31)", null, "modo inválido"],
    ["(&M3FA2D)", "(M3F)", "bico inexistente"],
    ["(&M99b000000000000000148)", "(M?f)"],
    ["(&M99b000000000000000249)", "(M?f)"],
    ["(&M99b00000000000000034A)", "(M?f)"],
    ["(&M99b00000000000000044B)", "(M?f)"],
    ["(&M99b00000000000000054C)", "(M?f)"],
    ["(&M99b00000000000000064D)", "(M?f)"],
    ["(&M99b00000000000000074E)", "(M?f)"],
    ["(&M99b00000000000000084F)", "(M?f)"],
    ["(&M99b000000000000000950)", "(M?f)"],
    ["(&M99b000000000000000A58)", "(M?f)"],
    ["(&M99b000000000000000B59)", "(M?f)"],
    ["(&M99b000000000000000C5A)", "(M?f)"],
    ["(&M99b000000000000000D5B)", "(M?f)"],
    ["(&M99b000000000000000E5C)", "(M?f)"],
    ["(&M99b000000000000000F5D)", "(M?f)"],
    ["(&M99b000000000000001048)", "(M?f)"],
    ["(&M99b000000000000001149)", "(M?f)"],
    ["(&M99b00000000000000124A)", "(M?f)"],
    ["(&M99b00000000000000134B)", "(M?f)"],
    ["(&M99b00000000000000144C)", "(M?f)"],
    ["(&M99b00000000000000154D)", "(M?f)", "21º cartão: lista negra cheia"],
    ["(&M99c000000000000000048)", "(M?f)", "limpa a lista negra"],
  ],
  // DIFF-03 — Silence × error
  "DIFF-03": [
    ["(&S)", "(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G85)"],
    ["(&S79)", "(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G85)", "&S com KK"],
    ["(&T08L2e)", null, "kk minúsculo"],
    ["(&T08L00)", null, "KK errado"],
    ["(&X)", null, "verbo inexistente"],
    ["(&T08L2E", null, "sem )"],
    ["(&T08L2E)", "(TL080000000088)", "o mesmo quadro, completo"],
  ],
  // DIFF-04 — Fragmentation and glued frames
  "DIFF-04": [
    ["(&S)", "(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G86)", "(&S) em 2 writes com 5 ms"],
    ["(&S)(&V)", "(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G86)", "dois quadros num write"],
    ["(&S)\r\n", "(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G86)", "CR LF no fim"],
  ],
  // DIFF-10 — Ts/u layouts with a 3-decimal price
  "DIFF-10": [
    ["(&T08C25)", "(Ts08023A0102C8)"],
    ["(&T08u57)", "(TU0800001123000058)"],
    ["(&T08U37)", "(TU080000112398)"],
  ],
  // DIFF-11 — &T BB echo
  "DIFF-11": [
    ["(&T0AL37)", "(TG0A000100018E)"],
    ["(&T44L2E)", "(TL440000000088)"],
    ["(&TC4L3D)", "(TGC40001000194)"],
  ],
  // DIFF-12 — Clock
  "DIFF-12": [
    ["(&KR1F4)", "(KR12610170000185693)"],
    ["(&KW126101606143000B7)", "(KW12610160614300091)", "válido (sexta = 6)"],
    ["(&KW126131606143000BA)", "(KW12613160614300094)", "mês 13"],
    ["(&R)", "(REL 14:30:00 16/13/26)(DHA SIM02 V2.7.2)(SOFT MONITOR V:1.0)(M 00000000)(M 00000000)(M 00000000)(M 00000000)(M 00000000)(C01W3A010200)(C01W3A020200)(C02W3A010200)(C02W3A020200)(C03W3A010200)(C03W3A020200)(C04W3A010200)(C04W3A020200)(C05W3A010200)(C05W3A020200)(C06W3A010200)(C06W3A020200)(C07W3A010200)(C07W3A020200)(C08W3A010200)(C08W3A020200)"],
  ],
  // DIFF-13 — Verbs outside DT435
  "DIFF-13": [
    ["(&LE000178)", null],
    ["(&c89)", null],
    ["(&F)", "(FRW61RW61N000N000RW61RW61N000N000RW61RW61N000N000RW61RW61N000N000RW61RW61N000N000RW61RW61N000N000RW61RW61N000N000RW61RW61N000N00026)"],
    ["(?D83)", "(FN000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N000N00006)"],
    ["(?S92)", "(SFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFDD0v3.7M1.0G87)"],
    ["(&CH0213)", null],
    ["(&S01DA)", "(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G87)", "K5: &S com parâmetro"],
  ],
  // DIFF-16 — Partial Horustech and terminator
  "DIFF-16": [
    [">?00020263", ">!00020245"],
    [">?00020263\n", ">!00020245"],
    [">?00020667", ">!000E06000002000002A0"],
    [">?00020667\n", ">!000E06000002000002A0"],
    [">?000A3202000111FA", null],
    [">?000A3202000111FA\n", null],
    [">?00020200", ">!00020245", "KK errado"],
  ],
};

const HOST = '127.0.0.1';
const T_PADRAO = Date.UTC(2026, 9, 16, 14, 30, 0);
/** A's clock at the 1st step of DIFF-12 (`(KR12610170000185693)`: 17/10/26 00:18:56, WW 00). */
const RELOGIO_NO_1O_PASSO: Record<string, number> = { 'DIFF-12': Date.UTC(2026, 9, 17, 0, 18, 56) };

/** &S voltage: `G` + 2 chars before the `)`. */
const mascT = (r: string | null): string | null => (r === null ? r : r.replace(/^(\(S[^)]*G)[0-9A-F]{2}\)$/, '$1**)'));

/**
 * A's state in the diff: &U 5899 on nozzle 04, a 7.02 L fueling (54 ticks of 0.13 L),
 * &A read and &I given. Returns the instant it ends, so the clock lands on `alvo`.
 */
function reproduzirEstadoA(sim: PumpSim, clock: ManualClock): void {
  expect(sim.pedir('(&U040058991E)')).toBe('(U04)');
  sim.conc.retirarBico(0x04);
  for (let n = 0; sim.pedir('(&V)') !== '(04000702)'; n++) {
    passo(sim, clock, sim.conc.tickVazaoMs);
    expect(n).toBeLessThan(200);
  }
  sim.conc.recolocarBico(0x04);
  passo(sim, clock, 1000);
  passo(sim, clock, 1000);
  expect(sim.pedir('(&A)')).toHaveLength(52);
  expect(sim.pedir('(&I6F)')).toBeNull();
}

let duracaoSetupMs: number | undefined;

/** 2.7.2 sim in A's state, with the clock at `alvo` when the script's 1st step starts. */
function simComEstadoA(alvo = T_PADRAO) {
  if (duracaoSetupMs === undefined) {
    const c = new ManualClock(0);
    reproduzirEstadoA(new PumpSim({ perfil: 'simulador-2.7.2', clock: c, configPadrao: true }), c);
    duracaoSetupMs = c.now();
  }
  const clock = new ManualClock(alvo - duracaoSetupMs);
  const sim = new PumpSim({ perfil: 'simulador-2.7.2', clock, configPadrao: true });
  reproduzirEstadoA(sim, clock);
  expect(clock.now()).toBe(alvo);
  return { sim, clock };
}

const abertos: ServidorTcp[] = [];
const sockets: net.Socket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy();
  await Promise.all(abertos.splice(0).map((s) => s.fechar()));
});

/** `(&S` + `)` in two writes 5 ms apart (DIFF-04 step 0), over real TCP. */
async function fragmentado(sim: PumpSim, pedacos: string[], intervaloMs: number): Promise<string> {
  const srv = await ServidorTcp.abrir(sim, { host: HOST, portas: [7002], mapa: { 2001: 0, 1771: 0, 857: 0, 7002: 0 } });
  abertos.push(srv);
  const rx = await new Promise<string>((resolve, reject) => {
    const sock = net.connect({ host: HOST, port: srv.fisica(7002)! }, async () => {
      sock.setNoDelay(true);
      let buf = '';
      sock.on('data', (b) => (buf += b.toString('latin1')));
      for (const p of pedacos) {
        sock.write(p, 'latin1');
        await new Promise((r) => setTimeout(r, intervaloMs));
      }
      await new Promise((r) => setTimeout(r, 120));
      resolve(buf);
    });
    sockets.push(sock);
    sock.once('error', reject);
  });
  return rx;
}

describe('estado reproduzido do A (pré-condição de todos os casos)', () => {
  it('ponteiros 0001/0001, encerrante 7,02 e preço 5899 no bico 04, como no A', () => {
    const { sim } = simComEstadoA();
    expect(sim.pedir('(&T01l47)')).toBe('(TG01000100017E)');
    expect(sim.pedir('(&T04L2A)')).toBe('(TL04000007028D)');
    expect(sim.pedir('(&T04l4A)')).toBe('(Tl0400000007020D)');
    expect(sim.pedir('(&A)')).toBe('(0)');
  });
});

it('o roteiro cobre os 69 passos das três capturas da bancada (11 + 24 + 7 + 3 + 3 + 3 + 4 + 7 + 7)', () => {
  expect(Object.fromEntries(Object.entries(CASOS).map(([id, p]) => [id, p.length]))).toEqual({
    'BANCADA-1710': 11, 'DIFF-02': 24, 'DIFF-03': 7, 'DIFF-04': 3, 'DIFF-10': 3, 'DIFF-11': 3, 'DIFF-12': 4, 'DIFF-13': 7, 'DIFF-16': 7,
  });
});

describe.each(Object.entries(CASOS))('diff 17/10 — %s (rx_A real, passo a passo)', (id, passos) => {
  it('cada passo responde os bytes do 2.7.2 real', async () => {
    const { sim } = simComEstadoA(RELOGIO_NO_1O_PASSO[id]);
    for (const [i, [tx, rxA, nota]] of passos.entries()) {
      const rotulo = `${id}[${i}] ${JSON.stringify(tx)}${nota ? ` (${nota})` : ''}`;
      let rx: string | null;
      if (id === 'DIFF-04' && i === 0) {
        rx = (await fragmentado(sim, ['(&S', ')'], 5)) || null;
      } else {
        rx = sim.pedir(tx);
      }
      expect(mascT(rx), rotulo).toBe(mascT(rxA));
      if (id === 'DIFF-16' && tx.startsWith('>?000A32')) {
        expect(sim.conc.eventos.at(-1)?.texto, rotulo).toBe("Error: '1,11F' is not a valid floating point value.");
      }
    }
  });
});

/**
 * Fueling probe of the bench capture (2026-10-17), attempt 3 (1 and 2 fell into the "Asynchronous socket error 10053" modal
 * and &V stayed at `(0)`, with no fueling). Instants in ms from the log of the click on "Retirar
 * Bico"; the click on "Recolocar" is at 7843. The real 2.7.2 flow timer runs at 109.375 ms on
 * Windows (3, 10, 18, 25, 32, 39, 46 ticks in the seven samples; DECISIONS §29). The start phase is
 * free, so the fake clock moves one flow tick at a time only until the sim's &V reaches A's volume,
 * and then the test compares the bytes. The tick rate itself is checked in the next tests.
 */
const CICLO: readonly (readonly [t: number, tx: string, rxA: string])[] = [
  [1586, "(&S)", "(SALFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G88)"],
  [1975, "(&V)", "(04000039)"],
  [2364, "(&S)", "(SALFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G88)"],
  [2752, "(&V)", "(04000130)"],
  [3143, "(&S)", "(SALFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G88)"],
  [3532, "(&V)", "(04000234)"],
  [3920, "(&S)", "(SALFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G88)"],
  [4309, "(&V)", "(04000325)"],
  [4698, "(&S)", "(SALFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G88)"],
  [5087, "(&V)", "(04000416)"],
  [5475, "(&S)", "(SALFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G89)"],
  [5864, "(&V)", "(04000507)"],
  [6253, "(&S)", "(SALFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G89)"],
  [6644, "(&V)", "(04000598)"],
  [9428, "(&S)", "(SCLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G89)"],
  [9817, "(&A)", "(00414100070258993A00070416235310000100000007020070)"],
  [10205, "(&A67)", "(A00414100070258993A0007041623531000010000000702000000000000000000000100D2)"],
  [12089, "(&I6F)", ""],
  [12478, "(&A67)", "(0)"],
  [12868, "(&T04L2A)", "(TL04000007028D)"],
  [13257, "(&T04l4A)", "(Tl0400000007020D)"],
  [13646, "(&S)", "(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G8A)"],
];
const T_RECOLOCAR = 7843;

const volumeSim = (sim: PumpSim) => Number((sim.pedir('(&V)') ?? '(04000000)').slice(3, 9));

function novoProbe(inicio = Date.UTC(2026, 9, 16, 23, 53, 0)) {
  const clock = new ManualClock(inicio);
  const sim = new PumpSim({ perfil: 'simulador-2.7.2', clock, configPadrao: true });
  expect(sim.pedir('(&U040058991E)')).toBe('(U04)'); // V2: price 5899 on nozzle 04
  return { sim, clock };
}

describe('captura da bancada 17/10 — ciclo completo do abastecimento de 7,02 L no bico 04 (A real, relógio fake)', () => {
  it('&S L→A→C→L, &V a cada 0,13 L sem KK, &A 52, &A67 75, &I mudo, &T04 7,02: bytes do A', () => {
    const { sim, clock } = novoProbe();
    expect(mascT(sim.pedir('(&S)')), 'antes').toBe('(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G**)');
    sim.conc.retirarBico(0x04);
    let recolocou = false;
    let tRef = 0;
    for (const [t, tx, rxA] of CICLO) {
      const rotulo = `t=${t} ${tx}`;
      if (t > T_RECOLOCAR && !recolocou) {
        while (volumeSim(sim) < 702) passo(sim, clock, sim.conc.tickVazaoMs); // A only closes at 54 ticks
        sim.conc.recolocarBico(0x04);
        recolocou = true;
        tRef = T_RECOLOCAR;
      }
      if (recolocou) {
        // After the click on "Recolocar" the real interval between samples applies, except that the
        // first `(SC…)` read is taken one state tick after the hang-up (DECISIONS §29). The probe's
        // hang-up is not on the flow-tick timeline: A has 54 ticks at the logged click where a 109.375 ms
        // timer gives 56–57 from the 6644 sample, so the UI click held the 2.7.2's timers back, and its
        // phase against the state timer cannot be taken from the log. C still lasts until the 2nd state
        // tick (CONCLUINDO_272); the later frames keep their real intervals.
        passo(sim, clock, rxA[2] === 'C' ? Math.min(t - tRef, 1000) : t - tRef);
        tRef = t;
      } else if (tx === '(&V)') {
        const alvo = Number(rxA.slice(3, 9));
        for (let n = 0; volumeSim(sim) < alvo; n++) {
          passo(sim, clock, sim.conc.tickVazaoMs);
          expect(n, rotulo).toBeLessThan(100);
        }
      } else if (rxA[2] === 'A') {
        for (let n = 0; sim.pedir('(&S)')![2] !== 'A'; n++) {
          passo(sim, clock, 100);
          expect(n, rotulo).toBeLessThan(15);
        }
      }
      const rx = sim.pedir(tx) || null;
      expect(mascT(rx), rotulo).toBe(mascT(rxA || null));
      if (tx === '(&A67)' && rxA.length > 3) expect(kkValido(rxA), `KK do A: ${rotulo}`).toBe(true);
    }
  });
});

describe('captura da bancada 17/10 — ritmo do tick com o perfil de produção (109,375 ms, §29)', () => {
  /** Deviation, in ticks, of the sim's `&V` from A's at the 7 probe samples, on the real timestamps. */
  function desvios(tickVazaoMs?: number): number[] {
    const { sim, clock } = novoProbe();
    if (tickVazaoMs !== undefined) sim.conc.setVelocidade(tickVazaoMs);
    sim.conc.retirarBico(0x04);
    let t = 0;
    const d: number[] = [];
    for (const [ts, tx, rxA] of CICLO) {
      if (tx !== '(&V)') continue;
      passo(sim, clock, ts - t);
      t = ts;
      d.push((volumeSim(sim) - Number(rxA.slice(3, 9))) / 13);
    }
    expect(d).toHaveLength(7);
    return d;
  }
  const deriva = (d: number[]) => Math.max(...d) - Math.min(...d);

  it('com o perfil (109,375 ms) o &V do sim segue o do A sem deriva: o desvio fica num tick só nas 7 amostras', () => {
    // Before §29 the profile ran at 100 ms and the sim drifted ahead of A (DECISIONS §9). The offset
    // itself is the start phase (state tick + blinks); only the drift says whether the period fits.
    const d = desvios();
    expect(deriva(d), JSON.stringify(d)).toBeLessThanOrEqual(1);
  });

  it('100 ms (Wine) e 104 ms (a estimativa antiga) derivam: o A não tem esses períodos no Windows', () => {
    const d100 = desvios(100);
    expect(deriva(d100), JSON.stringify(d100)).toBeGreaterThanOrEqual(3);
    expect(d100.at(-1)!).toBeGreaterThan(d100[0]!); // the sim runs ahead of A
    const d104 = desvios(104);
    expect(deriva(d104), JSON.stringify(d104)).toBeGreaterThanOrEqual(2);
  });
});
