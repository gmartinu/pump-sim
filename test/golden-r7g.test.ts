/**
 * Goldens of the r7g bench run (docs/DECISIONS.md §23): the EXACT frames the real 2.7.2 answered on
 * the Windows bench (side A of the 13 steps that differed), against pump-sim `simulador-2.7.2` on a
 * manual clock running the real scripts, plus mirrors proving the real profiles did not change.
 *
 * - B1 `VAZAO_272`: DIFF-17R `&LR0999/0001/0002` (E10 of the sum of unrounded preset volumes).
 * - B2 `BICO_272`: EQUIV-MOTOR `&S` after `&M04B19` and one state tick later (letter B).
 * - S1/S2/S3/S4: DIFF-20 #6 record clock, EQUIV-MOTOR #26/#74 records, EQUIV-PENDENTES `&S`.
 * - X1: a step that depends on a skipped step is reported as skipped (DIFF-14, EQUIV-MOTOR #66).
 *
 * Frames are literal bytes (checksum included); the record clock fields are masked exactly like the
 * script masks them (`relogioRegistro`), because pump-sim and the bench run at different instants.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CasoDiff,
  type PumpSim,
  type PassoComparado,
  type PassoEnviar,
  type ResultadoCaso,
  Hub,
  ManualClock,
  executarComando,
  executarDiff,
  formatarRelatorio,
  lerParcial,
  mascarar,
  roteiro,
  selecionarRoteiros,
} from '../src/index.js';
import { kk, novo, passo, type IdPerfil } from './util.js';

const HOST = '127.0.0.1';
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

async function alvo(nome: string, comControle = true) {
  // 17/10 14:30, the bench day: the record day and month are compared, only C4 and hh:mm are masked.
  const clock = new ManualClock(Date.UTC(2026, 9, 17, 14, 30, 0));
  const hub = new Hub({ clock, host: HOST, mapa: { 2001: 0, 1771: 0, 857: 0, 7002: 0 } });
  fechar.push(() => hub.fechar());
  const rt = await hub.criar('default', 'simulador-2.7.2');
  return { hub, alvo: { nome, alvo: { host: HOST, porta: rt.servidor!.fisica(2001)! }, ...(comControle ? { controle: `ctl-${nome}` } : {}) } };
}

/** Runs the real script(s) on two pump-sim `simulador-2.7.2` targets (manual clocks). */
async function rodar(ids: string, comControleA = true) {
  return rodarCasos(selecionarRoteiros(ids), comControleA);
}

async function rodarCasos(casos: CasoDiff[], comControleA = true) {
  const a = await alvo('A', comControleA);
  const b = await alvo('B');
  const hubs: Record<string, Hub> = { 'ctl-A': a.hub, 'ctl-B': b.hub };
  return executarDiff(casos, a.alvo, b.alvo, {
    timeoutMs: 120,
    ociosoMs: 30,
    chamarControle: (url, c, args) => executarComando(hubs[url]!, c, args),
  });
}

const enviarDe = (id: string) => roteiro(id)!.passos.filter((p): p is PassoEnviar => 'enviar' in p);

/** Step `indice` of case `id`, checking that it is the frame the bench reported. */
function passoDe(c: ResultadoCaso, indice: number, quadro: string): PassoComparado {
  const p = c.passos[indice]!;
  expect(p.quadro).toBe(quadro);
  return p;
}

/** Asserts `obtido` equals the bench frame `a` under the script's own mask for that step. */
function igualAoBancada(id: string, indice: number, obtido: string, a: string) {
  const s = enviarDe(id)[indice]!;
  const m = (t: string) => mascarar(Buffer.from(t, 'latin1'), s.ignorarFim ?? 0, s.mascara ?? []);
  expect(m(obtido).toString('latin1'), `${id} #${indice} ${s.enviar as string}`).toBe(m(a).toString('latin1'));
}

/** E10 of a 52-byte record reply (`(` + T6 L6 P4 V2 C4 B2 DDhhmmMM R4 E10 …). */
const e10 = (r: string) => r.slice(37, 47);
const r4 = (r: string) => r.slice(33, 37);

/** The record layout above holds for every A frame of the bench. */
describe('frames da bancada (A): o fatiamento usado pelos testes', () => {
  it('E10 e R4 do &LR0999 da r7g', () => {
    const a = '(00010000008911233A0006041714481009990000029741000000000000000000099900BE)';
    expect(r4(a)).toBe('0999');
    expect(e10(a)).toBe('0000029741');
  });
});

// ---------------------------------------------------------------------------------------------
// B1 VAZAO_272: DIFF-17R (E10 sum of unrounded volumes)
// ---------------------------------------------------------------------------------------------

describe('B1 VAZAO_272: DIFF-17R, quadros A da r7g (passos 1006, 1007, 1008)', () => {
  const A = {
    1006: '(00010000008911233A0006041714481009990000029741000000000000000000099900BE)',
    1007: '(00010000004721233A000644171448100001000001573200000000000000000000010084)',
    1008: '(00010000008911233A00060517144810000200000296520000000000000000000002008E)',
  } as const;
  let caso: ResultadoCaso;

  it('o script roda sem divergência entre dois pump-sim e sem passos pulados', async () => {
    const rel = await rodar('DIFF-17R');
    caso = rel.casos[0]!;
    expect(caso.divergencias).toBe(0);
    expect(caso.pulados).toEqual([]);
    expect(caso.passosPulados).toBeUndefined();
  }, 180_000);

  it.each([
    // E10 04: 334 records of R$ 1,00 at 1,123 = 297,41 L (B summed 334 × 890 = 0000029726).
    [1006, '(&LR09999F)'],
    // E10 44: 334 records at 2,123 = 157,32 L (B: 0000015731).
    [1007, '(&LR000185)'],
    // E10 05: 333 records at 1,123 = 296,52 L (B: 0000029637).
    [1008, '(&LR000286)'],
  ] as const)('passo %i %s: o quadro de B é o da bancada (relógio mascarado)', (indice, quadro) => {
    const p = passoDe(caso, indice, quadro);
    igualAoBancada('DIFF-17R', indice, p.b.texto, A[indice]);
    expect(e10(p.b.texto)).toBe(e10(A[indice]));
    expect(p.igual).toBe(true);
  });

  it('o volume do registro, o L6 e o &T seguem truncados (0,089 L por registro)', () => {
    for (const i of [1006, 1008] as const) expect(caso.passos[i]!.b.texto.slice(7, 13)).toBe('000089');
    expect(caso.passos[1007]!.b.texto.slice(7, 13)).toBe('000047');
  });
});

describe('B1 espelho: perfis reais somam o volume inteiro em mL (nada mudou)', () => {
  const REAIS: IdPerfil[] = ['cbc-32', 'cbc05-dip3', 'cbc01'];

  /** One R$ 1,00 preset fueling on 04 with a manual clock, 100 ms at a time. */
  function abastecer1(sim: PumpSim, clock: ManualClock) {
    expect(sim.pedir(kk('&P04000100'))).toBe('(P04)');
    sim.conc.retirarBico(0x04);
    for (let j = 0; j < 40; j++) passo(sim, clock, 100);
    sim.conc.recolocarBico(0x04);
    for (let j = 0; j < 25; j++) passo(sim, clock, 100);
  }

  it.each(REAIS)('%s: três registros somam 3 × 890 mL exatos, o &T04L é o mesmo de antes e o bico não guarda fração', (perfil) => {
    const { sim, clock } = novo(perfil);
    sim.pedir('(&E0400000000)');
    for (let i = 0; i < 3; i++) abastecer1(sim, clock);
    const bico = sim.conc.bico(0x04)!;
    expect(bico.encerranteMl).toBe(3 * 890);
    expect(bico.encerranteFracMl).toBeUndefined();
    // Same frame the pre-r7g tree answered (verified against the snapshot taken before B1).
    expect(sim.pedir(kk('&T04L'))).toBe('(TL040000026793)');
    expect(sim.conc.buffer.todos()).toHaveLength(3);
  });

  it('cbc-32: 12 registros somam 12 × 890 mL; o ghost &M S não grava registro (só o 2.7.2 grava), então o caminho do B1 não é alcançável', () => {
    const { sim, clock } = novo('cbc-32');
    sim.pedir('(&E0400000000)');
    for (let i = 0; i < 6; i++) abastecer1(sim, clock);
    for (let i = 0; i < 20; i++) {
      expect(sim.pedir(kk('&M04S'))).toBe('(M04)');
      passo(sim, clock, 1100);
    }
    for (let i = 0; i < 6; i++) abastecer1(sim, clock);
    const bico = sim.conc.bico(0x04)!;
    expect(bico.encerranteMl).toBe(12 * 890);
    expect(bico.encerranteFracMl).toBeUndefined();
    expect(sim.pedir(kk('&T04L'))).toBe(kk('TL0400001068'));
    expect(sim.conc.buffer.todos()).toHaveLength(12);
  });
});

// ---------------------------------------------------------------------------------------------
// B2 BICO_272 + S2/S3: EQUIV-MOTOR (+ S4 EQUIV-PENDENTES, which runs after it)
// ---------------------------------------------------------------------------------------------

describe('B2/S2/S3/S4: EQUIV-MOTOR e EQUIV-PENDENTES, quadros A da r7g', () => {
  let motor: ResultadoCaso;
  let pendentes: ResultadoCaso;

  // EQUIV-COMANDOS runs first, as on the bench: it leaves address 2 with the P the later cases carry.
  it('os dois casos rodam sem divergência, sem passos pulados e sem ação falha', async () => {
    const rel = await rodar('EQUIV-COMANDOS,EQUIV-MOTOR,EQUIV-PENDENTES');
    motor = rel.casos.find((c) => c.id === 'EQUIV-MOTOR')!;
    pendentes = rel.casos.find((c) => c.id === 'EQUIV-PENDENTES')!;
    for (const c of [motor, pendentes]) {
      expect(c.divergencias, c.id).toBe(0);
      expect(c.acoes.filter((x) => !x.ok), c.id).toEqual([]);
    }
  }, 180_000);

  // Indices of the current script. The r7g report numbered 31/33/35/43; S2 moved the #66 block (3 steps
  // from old 27) to the end, so those are 28/30/32/41 now. Each step is checked by its frame.
  const SB = '(SBPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G87)';

  it('B2 #31/#33: o &S depois do (&M04B19) e um tick depois é (SBP…), byte a byte', () => {
    for (const i of [28, 30]) {
      const p = passoDe(motor, i, '(&S)');
      igualAoBancada('EQUIV-MOTOR', i, p.b.texto, SB);
      expect(p.b.texto.slice(0, 4)).toBe('(SBP');
    }
  });

  // §29: with the Windows-effective 109.375 ms flow tick the #26 free-flow record is the bench's (23 ticks,
  // 0,299 L), so the whole frame now matches; it was the §23 residual (25 ticks at 100 ms).
  it('S2 #26: o registro após o &M04L é o da bancada byte a byte (R4 0005, 0,299 L = 23 ticks, E10 655)', () => {
    const A = '(00033500029911233A0006041714521000050000000655006E)';
    const p = passoDe(motor, 32, '(&A)');
    igualAoBancada('EQUIV-MOTOR', 32, p.b.texto, A);
    expect(r4(p.b.texto)).toBe(r4(A));
    expect(e10(p.b.texto)).toBe(e10(A));
    expect(p.b.texto.slice(7, 13)).toBe('000299');
  });

  it('S3 #74: com o zeramento depois do #26, o E10 do preset de R$ 3,00 é o da bancada menos o do #26 (1011 − 655 = 356)', () => {
    // The bench ran without S3, so its A frame (below) carries the #26 totalizer. S3 zeroes 04 after the
    // #26 record: the totalizer is then exactly the two later fuelings = 1011 − 655. R4 is the bench's
    // 0007 plus the zero-volume record the `&E` stores (inference from the documented `&E` rule).
    const p = passoDe(motor, 41, '(&A)');
    expect(e10(p.b.texto)).toBe('0000000356');
    expect(r4(p.b.texto)).toBe('0008');
    expect(1011 - 655).toBe(356);
  });

  // §29: the #26 record no longer differs, so without S3 the #74 frame of r7g matches byte for byte,
  // E10 included (before, the E10 carried the 0,325 × 0,299 L #26 difference: the reason for S3).
  it('S2 #74 (sem o S3, como a bancada): o quadro A da r7g bate byte a byte, E10 incluído', async () => {
    const A = '(00030000267111233E0009041714531000070000001011005F)';
    const base = roteiro('EQUIV-MOTOR')!;
    const i = base.passos.map((x, k) => ('enviar' in x && x.enviar === '(&E0400000000)' ? k : -1)).filter((k) => k > 0).at(-1)!;
    expect(base.passos[i + 1]).toEqual({ drenar: true });
    const semS3: CasoDiff = { ...base, passos: base.passos.filter((_, k) => k !== i && k !== i + 1) };
    const rel = await rodarCasos([selecionarRoteiros('EQUIV-COMANDOS')[0]!, semS3]);
    const c = rel.casos[1]!;
    expect(c.divergencias).toBe(0);
    expect(c.passos[32]!.b.texto.slice(7, 13)).toBe('000299');
    const p = passoDe(c, 40, '(&A)');
    expect(r4(p.b.texto)).toBe('0007');
    expect(e10(p.b.texto)).toBe(e10(A));
    igualAoBancada('EQUIV-MOTOR', 41, p.b.texto, A);
  }, 120_000);

  it('S2: o #66 é o último passo e fica pulado só se o painel IDF/botão faltar (aqui roda nos dois)', () => {
    const ult = motor.passos.at(-1)!;
    expect(ult.quadro).toBe('(&V)');
    expect(ult.pulado).toBeUndefined();
  });

  it('S4 EQUIV-PENDENTES #1/#3: o endereço 2 volta a P depois do botão, (SLP…) como na bancada', () => {
    const A1 = '(SLPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G7D)';
    const A3 = '(SLPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G7C)';
    for (const [i, a] of [[1, A1], [3, A3]] as const) {
      const p = passoDe(pendentes, i, '(&S)');
      igualAoBancada('EQUIV-PENDENTES', i, p.b.texto, a);
      expect(p.b.texto.slice(0, 4)).toBe('(SLP');
    }
  });
});

describe('B2 espelho: perfis reais não mudam a letra do &S com o bico congelado por &M B', () => {
  /** `(&S)` right after `&M04B19` and one state tick later, with 05 preset-armed (address 1 fueling). */
  function leituras(perfil: IdPerfil) {
    const { sim, clock } = novo(perfil);
    sim.pedir(kk('&P05000500'));
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 2000);
    expect(sim.pedir('(&M04B19)')).toBe('(M04)');
    const logo = sim.pedir('(&S)');
    passo(sim, clock, 1000);
    return { logo, depois: sim.pedir('(&S)'), status: sim.conc.bico(0x04)!.status };
  }

  it.each([
    ['cbc-32', '(SALFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V8.4M1.0G7A)'],
    ['cbc05-dip3', '(SALFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD5V8.4M1.0G7A)'],
  ] as const)('%s: a letra segue A, como antes do B2 (quadro idêntico ao do tree anterior)', (perfil, quadro) => {
    const r = leituras(perfil);
    expect(r.logo).toBe(quadro);
    expect(r.depois).toBe(quadro);
    expect(r.status).toBe('A');
  });

  it('cbc01 não responde o &S (como antes)', () => {
    const r = leituras('cbc01');
    expect(r.logo).toBeNull();
    expect(r.depois).toBeNull();
  });

  it('simulador-2.7.2: a letra é B logo depois e um tick depois, com a mesma P do endereço 2 (bancada r6/r7g)', () => {
    const r = leituras('simulador-2.7.2');
    expect(r.logo!.slice(0, 4)).toBe('(SBP');
    expect(r.depois!.slice(0, 4)).toBe('(SBP');
    expect(r.status).toBe('B');
  });
});

// ---------------------------------------------------------------------------------------------
// S1 DIFF-20 #6
// ---------------------------------------------------------------------------------------------

describe('S1 DIFF-20 #6: o 2º (&A), quadro A da r7g, só difere no relógio mascarado', () => {
  it('B é o quadro da bancada fora de C4, hh:mm e KK; sem divergência no caso', async () => {
    const rel = await rodar('DIFF-20');
    const c = rel.casos[0]!;
    expect(c.divergencias).toBe(0);
    const A = '(00010000008911233A00060517144910000200000000890066)';
    const p = passoDe(c, 6, '(&A)');
    igualAoBancada('DIFF-20', 6, p.b.texto, A);
    expect(p.igual).toBe(true);
    // The record fields outside the mask are exact: day 17, month 10, R4 0002, E10 0000000089.
    expect(p.b.texto.slice(25, 27)).toBe('17');
    expect(r4(p.b.texto)).toBe('0002');
    expect(e10(p.b.texto)).toBe('0000000089');
  }, 60_000);

  it('a máscara não esconde dia e mês: um registro com o dia diferente ainda diverge', () => {
    const s = enviarDe('DIFF-20').filter((x) => x.enviar === '(&A)')[1]!;
    const A = '(00010000008911233A00060517144910000200000000890066)';
    const dia = A.slice(0, 25) + '18' + A.slice(27);
    const m = (t: string) => mascarar(Buffer.from(t, 'latin1'), s.ignorarFim ?? 0, s.mascara ?? []).toString('latin1');
    expect(m(dia)).not.toBe(m(A));
  });
});

// ---------------------------------------------------------------------------------------------
// X1 DIFF-14 + report
// ---------------------------------------------------------------------------------------------

describe('X1 DIFF-14: ?A80 e ?V95 sem controle do painel IDF em A (como o driver da r7g)', () => {
  const A80 = '(0)';
  const V95 = '(04000000000000000064)';

  it('A responde os quadros da bancada, B responde com o cartão, e os dois passos saem pulados, não divergentes', async () => {
    const rel = await rodar('DIFF-14', false);
    const c = rel.casos[0]!;
    const p4 = passoDe(c, 4, '(?A80)');
    const p6 = passoDe(c, 6, '(?V95)');
    // A here is a pump-sim without the panel control, so it answers (0) at both; the bench A (real
    // 2.7.2, no way to inform the card) answered A80 `(0)` and V95 `(04000000000000000064)`.
    expect(p4.a.texto).toBe(A80);
    expect(p4.b.texto.startsWith('(A1122334455667788')).toBe(true);
    expect(p6.b.texto).toBe('(041122334455667788AC)');
    expect(p6.b.texto).not.toBe(V95);
    expect(p4.igual).toBe(false);
    expect(p6.igual).toBe(false);
    expect(p4.pulado).toBe('depende de "idf", pulado em A');
    expect(p6.pulado).toBe('depende de "idf", pulado em A');
    expect(c.passosPulados).toBe(2);
    expect(c.divergencias).toBe(0);
    expect(rel.total).toMatchObject({ divergencias: 0, pulados: 2, casosComDivergencia: [] });
    // Everything else in the case still compares (equal on both pump-sim).
    expect(c.passos.filter((p) => !p.pulado).every((p) => p.igual)).toBe(true);
  }, 60_000);

  it('o relatório de terminal marca ~ nos pulados, conta pulado(s) e não os lista como ≠', async () => {
    const rel = await rodar('DIFF-14', false);
    const txt = formatarRelatorio(rel);
    expect(txt).toContain('~ "(?A80)"');
    expect(txt).toContain('[pulado: depende de "idf", pulado em A]');
    expect(txt).toContain('~ "(?V95)"');
    expect(txt).toMatch(/2 pulado\(s\), 0 divergência\(s\)/);
    expect(txt).not.toContain('≠ "(?A80)"');
  }, 60_000);

  it('o parcial em JSONL preserva pulado e passosPulados (retomar uma corrida)', async () => {
    const rel = await rodar('DIFF-14', false);
    const lido = lerParcial(rel.casos.map((c) => JSON.stringify(c)).join('\n') + '\n{corte');
    expect(lido).toHaveLength(1);
    expect(lido[0]!.passosPulados).toBe(2);
    expect(lido[0]!.passos.filter((p) => p.pulado)).toHaveLength(2);
  }, 60_000);
});

describe('X1 regras do executor', () => {
  const manual = { manual: 'Apresentar o cartão', controle: [{ comando: 'apresentar_cartao', args: { canal: 1, endereco: 1, codigo: '1122334455667788' } }] };

  async function correr(caso: CasoDiff, controleA: boolean, controleB: boolean) {
    const a = await alvo('A', controleA);
    const b = await alvo('B', controleB);
    const hubs: Record<string, Hub> = { 'ctl-A': a.hub, 'ctl-B': b.hub };
    return executarDiff([caso], a.alvo, b.alvo, {
      timeoutMs: 120,
      ociosoMs: 30,
      chamarControle: (url, c, args) => executarComando(hubs[url]!, c, args),
      esperar: async () => {},
    });
  }

  it('pulado em B: o texto nomeia B e o passo não conta como divergência', async () => {
    const caso: CasoDiff = { id: 'T-B', titulo: 't', resolve: 't', passos: [{ ...manual, rotulo: 'idf' }, { enviar: '(?A80)', dependeDe: ['idf'] }] };
    const rel = await correr(caso, true, false);
    const r = rel.casos[0]!;
    expect(r.passos[0]!.pulado).toBe('depende de "idf", pulado em B');
    expect(r.divergencias).toBe(0);
    expect(rel.total).toMatchObject({ divergencias: 0, pulados: 1 });
  }, 30_000);

  it('um passo sem dependeDe que lê o efeito do passo pulado continua divergindo (o pulo não esconde o resto)', async () => {
    const caso: CasoDiff = { id: 'T-SEM', titulo: 't', resolve: 't', passos: [{ ...manual, rotulo: 'idf' }, { enviar: '(?A80)' }] };
    const rel = await correr(caso, false, true);
    const r = rel.casos[0]!;
    expect(r.passos[0]!.pulado).toBeUndefined();
    expect(r.passos[0]!.igual).toBe(false);
    expect(r.divergencias).toBe(1);
    expect(r.passosPulados).toBeUndefined();
    expect(rel.total.pulados).toBeUndefined();
    expect(rel.total.casosComDivergencia).toEqual(['T-SEM']);
  }, 30_000);

  it('dependeDe com um rótulo que nunca foi pulado não pula nada (feito nos dois lados)', async () => {
    const caso: CasoDiff = { id: 'T-OK', titulo: 't', resolve: 't', passos: [{ ...manual, rotulo: 'idf' }, { enviar: '(?A80)', dependeDe: ['outro'] }] };
    const rel = await correr(caso, true, true);
    const r = rel.casos[0]!;
    expect(r.passos[0]!.pulado).toBeUndefined();
    expect(r.passos[0]!.igual).toBe(true);
    expect(r.passosPulados).toBeUndefined();
  }, 30_000);

  it('vários passos com o mesmo rótulo: basta um pulado para marcar o passo dependente', async () => {
    const caso: CasoDiff = {
      id: 'T-N',
      titulo: 't',
      resolve: 't',
      passos: [{ ...manual, rotulo: 'idf' }, { ...manual, rotulo: 'idf' }, { enviar: '(?A80)', dependeDe: ['idf'] }, { enviar: '(?V95)', dependeDe: ['idf'] }],
    };
    const rel = await correr(caso, false, true);
    const r = rel.casos[0]!;
    expect(r.passosPulados).toBe(2);
    expect(r.divergencias).toBe(0);
    expect(rel.total).toMatchObject({ passos: 2, iguais: 0, divergencias: 0, pulados: 2 });
  }, 30_000);
});
