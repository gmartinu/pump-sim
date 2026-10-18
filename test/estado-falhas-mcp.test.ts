/**
 * State machine + tick with a fake clock, quirks per profile, faults via the control
 * API, recorder + replay round trip and the MCP against a server on an ephemeral port.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CATALOGO,
  ClienteTcp,
  Hub,
  IDS_PERFIS,
  ManualClock,
  PERFIS,
  PumpSim,
  type PerfilId,
  ServidorReplay,
  TIPOS_FALHA,
  abrirServidorControle,
  criarServidorMcp,
  executarComando,
  kkValido,
  lerGravacao,
  replayCliente,
  serializar,
  trocas,
} from '../src/index.js';
import { T0, criar, kk } from './golden-util.js';

const HOST = '127.0.0.1';
const EFEMERAS = { 2001: 0, 1771: 0, 857: 0, 7002: 0 };
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

const tick = (sim: PumpSim, clock: ManualClock, ms: number) => {
  clock.advance(ms);
  sim.atualizar();
};
const letras = (sim: PumpSim) => sim.pedir('(&S)')!.slice(2, 6);

/** Full fueling on the fake clock: lift, let it flow, hang up, and let C turn into L. */
function ciclo(sim: PumpSim, clock: ManualClock, bico: number, vazaoMs: number) {
  sim.conc.retirarBico(bico);
  tick(sim, clock, 1000);
  tick(sim, clock, vazaoMs);
  sim.conc.recolocarBico(bico);
  tick(sim, clock, 1000);
}

// ───────────────────────── state machine and tick ─────────────────────────
describe('máquina de estados: abastecimento completo, relógio fake', () => {
  it.each(['simulador-2.7.2', 'cbc-32', 'horustech-48'] as PerfilId[])(
    '%s: L → A (bico retirado) → C (recolocado) → L, e um registro no buffer',
    (p) => {
      const { sim, clock } = criar(p, T0);
      const c = sim.conc;
      const antes = c.buffer.escrita;
      expect(letras(sim)).toBe('LLFF');
      c.retirarBico(0x04);
      expect(letras(sim)[0]).toBe('L'); // the state tick has not passed yet
      tick(sim, clock, 1000);
      expect(letras(sim)[0]).toBe('A');
      let vol = 0;
      for (let i = 0; i < 20; i++) {
        tick(sim, clock, 400);
        const v = c.bico(0x04)!.corrente!.volumeMl;
        expect(v).toBeGreaterThanOrEqual(vol); // the flow is monotonic (Q6 blinks 888888 before flowing)
        vol = v;
      }
      expect(vol).toBeGreaterThan(0);
      expect(c.buffer.escrita).toBe(antes); // nothing stored while fueling
      c.recolocarBico(0x04);
      expect(letras(sim)[0]).toBe('C');
      tick(sim, clock, 1000);
      if (c.quirks.CONCLUINDO_272) {
        // 2.7.2 (behavioral equivalence + fueling probe on the bench, 17/10): the record is already stored and the status stays C one more tick.
        expect(letras(sim)[0]).toBe('C');
        expect(c.buffer.escrita).toBe(c.buffer.proxima(antes));
        tick(sim, clock, 1000);
      }
      expect(letras(sim)[0]).toBe('L');
      expect(c.buffer.escrita).toBe(c.buffer.proxima(antes));
      const reg = c.buffer.ler(antes)!;
      expect(reg.codigoBico).toBe(0x04);
      expect(reg.volumeMl).toBeGreaterThanOrEqual(vol);
      expect(reg.posicao).toBe(antes);
      expect(reg.totalMil).toBe(c.totalMil(reg.volumeMl, reg.precoUnit, 3));
      expect(kkValido(sim.pedir('(&A)')!)).toBe(true);
    },
  );

  it('o relógio fake é determinístico: duas execuções iguais dão o mesmo registro', () => {
    const run = () => {
      const { sim, clock } = criar('cbc-32', T0);
      ciclo(sim, clock, 0x04, 3000);
      return sim.pedir('(&A)');
    };
    expect(run()).toBe(run());
    expect(run()).not.toBeNull();
  });

  it('preset por valor (&P) corta no valor e grava exatamente esse total', () => {
    const { sim, clock } = criar('cbc-32', T0);
    expect(sim.pedir('(&P04000500XX)')).toBeNull(); // wrong KK: ignored
    sim.pedir(kk('&P04000500'));
    sim.conc.retirarBico(0x04);
    tick(sim, clock, 1000);
    for (let i = 0; i < 400; i++) tick(sim, clock, 300);
    tick(sim, clock, 1000);
    const reg = sim.conc.buffer.ler(0)!;
    expect(reg.totalMil).toBe(5000);
  });

  it('&M B bloqueia: o bico retirado fica em E e só abastece depois do &M A', () => {
    const { sim, clock } = criar('cbc-32', T0);
    sim.pedir(kk('&M04B'));
    expect(letras(sim)[0]).toBe('B');
    sim.conc.retirarBico(0x04);
    tick(sim, clock, 1000);
    expect(letras(sim)[0]).toBe('E');
    expect(sim.pedir(kk('&M04A'))).toBe('(M04)');
    tick(sim, clock, 1000);
    expect(letras(sim)[0]).toBe('A');
  });

  it('falha do endereço: lado vira F no &S e o &M responde (M?t) nos reais', () => {
    const { sim } = criar('cbc-32', T0);
    sim.conc.setFalhaEndereco(1, 1, true);
    expect(letras(sim)).toBe('FLFF');
    expect(sim.pedir(kk('&M04B'))).toBe('(M?t)');
    sim.conc.setFalhaEndereco(1, 1, false);
    expect(letras(sim)).toBe('LLFF');
  });
});

describe('ponteiros: &A/&I por porta nos reais, único no 2.7.2', () => {
  it.each(['cbc-32', 'horustech-48', 'concept-48'] as PerfilId[])('%s: cada porta lê e avança o seu', (p) => {
    const { sim, clock } = criar(p, T0);
    ciclo(sim, clock, 0x04, 1500);
    ciclo(sim, clock, 0x05, 1500);
    expect(sim.conc.buffer.escrita).toBe(2);
    const a1 = sim.pedir('(&A)', 'tcp:2001')!;
    const a2 = sim.pedir('(&A)', 'tcp:1771')!;
    expect(a1).toBe(a2); // both ports start at the same record
    sim.pedir('(&I)', 'tcp:2001');
    expect(sim.pedir('(&A)', 'tcp:2001')).not.toBe(a1);
    expect(sim.pedir('(&A)', 'tcp:1771')).toBe(a1); // 1771 did not move
    expect(sim.pedir('(&T99P3C)', 'tcp:2001')).toBe(kk('TP990002' + '0001'));
    expect(sim.pedir('(&T99P3C)', 'tcp:1771')).toBe(kk('TP990002' + '0000'));
    sim.pedir('(&I)', 'tcp:2001');
    expect(sim.pedir('(&A)', 'tcp:2001')).toBe('(0)');
    sim.pedir('(&I)', 'tcp:2001'); // &I with an empty queue does not go past the write pointer
    expect(sim.conc.ponteiroLeitura('tcp:2001')).toBe(2);
    expect(sim.pedir('(&A)', 'tcp:857')).toBe(a1);
  });

  it('2.7.2: um só ponteiro; o &I numa porta vale para todas', () => {
    const { sim, clock } = criar('simulador-2.7.2', T0);
    ciclo(sim, clock, 0x04, 1500);
    ciclo(sim, clock, 0x05, 1500);
    const a1 = sim.pedir('(&A)', 'tcp:2001')!;
    expect(sim.pedir('(&A)', 'tcp:7002')).toBe(a1);
    sim.pedir('(&I)', 'tcp:2001');
    expect(sim.pedir('(&A)', 'tcp:7002')).not.toBe(a1);
    expect(sim.pedir('(&A)', 'tcp:1771')).toBe(sim.pedir('(&A)', 'tcp:2001'));
  });
});

// ───────────────────────── quirks only on their own profile ─────────────────────────
describe('quirks do 2.7.2: ligados só nele', () => {
  it('nos 6 perfis reais nenhum quirk está ligado; no 2.7.2 estão todos', () => {
    for (const id of IDS_PERFIS) {
      const ligados = Object.entries(PERFIS[id].quirks).filter(([, v]) => v).map(([k]) => k);
      if (id === 'simulador-2.7.2') expect(ligados).toHaveLength(Object.keys(PERFIS[id].quirks).length);
      else expect(ligados, id).toEqual([]);
    }
  });

  it('Q1: o 2.7.2 só atende o 1º de dois quadros colados; o real atende os dois', () => {
    expect(criar('simulador-2.7.2').sim.enviar('(&S)(&V)')).toHaveLength(1);
    expect(criar('cbc-32').sim.enviar('(&S)(&V)')).toHaveLength(2);
    const sem = new PumpSim({ perfil: 'simulador-2.7.2', clock: new ManualClock(T0), configPadrao: true, quirks: { Q1: false } });
    expect(sem.enviar('(&S)(&V)')).toHaveLength(2);
  });

  it('Q2: o MessageBox não cala o socket; a resposta do ShowMessage sai no OK (0 = já, N ms, null = até liberar)', async () => {
    const ruim = kk('&U04200123');
    const mk = (travamentoMs: number | null) => {
      const clock = new ManualClock(T0);
      return { clock, sim: new PumpSim({ perfil: 'simulador-2.7.2', clock, configPadrao: true, travamentoMs }) };
    };
    const tick = () => new Promise<void>((r) => setImmediate(r));
    // 0 = the OK is immediate: (U04) goes out at once (bench error notes, E3).
    const a = mk(0);
    expect(a.sim.pedir(ruim)).toBe('(U04)');
    expect(a.sim.pedir('(&S)')).not.toBeNull();
    const b = mk(500);
    const rb = b.sim.processarQuadro(ruim);
    expect(rb.resposta).toBeNull();
    let sb: string | null = null;
    void rb.adiada?.then((t) => (sb = t));
    expect(b.sim.pedir('(&S)')).not.toBeNull();
    b.clock.advance(499);
    b.sim.atualizar();
    await tick();
    expect(sb).toBeNull();
    b.clock.advance(2);
    b.sim.atualizar();
    await tick();
    expect(sb).toBe('(U04)');
    const c = mk(null);
    const rc = c.sim.processarQuadro(ruim);
    let sc: string | null = null;
    void rc.adiada?.then((t) => (sc = t));
    c.clock.advance(3_600_000);
    expect(c.sim.pedir('(&S)')).not.toBeNull();
    await tick();
    expect(sc).toBeNull();
    c.sim.conc.liberarTravamento();
    await tick();
    expect(sc).toBe('(U04)');
    // the same frame on a real profile does not freeze and stays silent without a MessageBox
    const r = criar('cbc-32').sim;
    expect(r.pedir(ruim)).toBeNull();
    expect(r.pedir('(&S)')).not.toBeNull();
  });

  it('Q3/TG: &T99P no 2.7.2 = (TG99 escrita-1 leitura-1); nos reais = (TP99 escrita leitura)', () => {
    expect(criar('simulador-2.7.2').sim.pedir('(&T99P3C)')).toBe(kk('TG99' + '0000' + '0000'));
    expect(criar('cbc-32').sim.pedir('(&T99P3C)')).toBe(kk('TP99' + '0000' + '0000'));
  });

  it('Q4/BUFFER_1000: posições 1..999, o contador volta a 1 em 1000 e o descarte vira BEEP', async () => {
    const hub = new Hub({ clock: new ManualClock(T0), host: HOST, mapa: EFEMERAS, semTcp: true });
    fechar.push(() => hub.fechar());
    const rt = await hub.criar('default', 'simulador-2.7.2');
    const c = rt.sim.conc;
    await executarComando(hub, 'gerar_abastecimentos', { bico: '04', quantidade: 999, volume: 1000 });
    expect(c.buffer.escrita).toBe(1); // 999 stored: write pointer back to 1
    expect(c.buffer.ler(999)).toBeDefined();
    expect(c.eventos.filter((e) => e.tipo === 'BEEP').length).toBeGreaterThan(0);
    await executarComando(hub, 'gerar_abastecimentos', { bico: '04', quantidade: 1, volume: 1000 });
    expect(c.buffer.ler(1)!.numero).toBe(1);
    expect(c.buffer.todos().every((r) => r.posicao >= 1 && r.posicao <= 999)).toBe(true);
  });

  it('Q4 desligado (reais): 0..9999 e sem descarte nem BEEP até a 10000ª gravação', async () => {
    const hub = new Hub({ clock: new ManualClock(T0), host: HOST, mapa: EFEMERAS, semTcp: true });
    fechar.push(() => hub.fechar());
    const rt = await hub.criar('default', 'cbc-32');
    await executarComando(hub, 'gerar_abastecimentos', { bico: '04', quantidade: 1000, volume: 1000 });
    expect(rt.sim.conc.buffer.escrita).toBe(1000);
    expect(rt.sim.conc.eventos.filter((e) => e.tipo === 'BEEP')).toEqual([]);
  });

  it('Q5: a data do registro é a do PC no 2.7.2 e a do RTC simulado nos reais', () => {
    for (const [p, esperado] of [
      ['simulador-2.7.2', '12'],
      ['cbc-32', '15'],
    ] as const) {
      const { sim, clock } = criar(p, T0);
      sim.conc.dips[2] = true;
      sim.pedir('(&H150956)'); // RTC = day 15, 09:56
      ciclo(sim, clock, 0x04, 1500);
      const a = sim.pedir('(&A)')!;
      expect(a.slice(25, 27), p).toBe(esperado); // record DD
    }
  });

  it('Q6: trunca no 2.7.2, arredonda nos reais', () => {
    const t = (p: PerfilId) => criar(p).sim.conc.totalMil(1555, 1005, 3);
    expect(t('simulador-2.7.2')).toBe(1562);
    expect(t('cbc-32')).toBe(1563);
  });

  it('Q7: sem Automação ligada o 2.7.2 não simula; os reais ignoram o gate', () => {
    for (const [p, simula] of [
      ['simulador-2.7.2', false],
      ['cbc-32', true],
    ] as const) {
      const { sim, clock } = criar(p, T0);
      sim.conc.automacao = false;
      sim.conc.retirarBico(0x04);
      tick(sim, clock, 1500);
      expect(sim.conc.bico(0x04)!.status === 'A', p).toBe(simula);
    }
  });

  it('Q8 (simcnf.ini) é no-op: nada é escrito em disco pelo perfil', () => {
    expect(PERFIS['simulador-2.7.2'].quirks.Q8).toBe(true);
  });

  it('os quirks nomeados da equivalência comportamental: &LR vazio mudo, A36, PAF G9, R_EXTRAS só no 2.7.2', () => {
    const q = PERFIS['simulador-2.7.2'].quirks;
    for (const k of ['L_VAZIO_SILENCIO', 'A36', 'PAF_G9', 'R_EXTRAS', 'TG', 'ERROS_272', 'A67_M_IGUAL_R', 'V_INCLUI_E', 'BUFFER_1000', 'IDF_CC_BYTE', 'CARTAO_VAZIO_ZEROS', 'LIBERACAO_IMEDIATA', 'IDF_272', 'HORUSTECH_272'] as const)
      expect(q[k], k).toBe(true);
  });
});

// ───────────────────────── faults via the control API ─────────────────────────
async function hubCom(perfil: PerfilId, gravar?: string) {
  const clock = new ManualClock(T0);
  const hub = new Hub({ clock, host: HOST, mapa: EFEMERAS });
  fechar.push(() => hub.fechar());
  const rt = await hub.criar('default', perfil, undefined, { gravar });
  const cmd = <T = Record<string, unknown>>(nome: string, args: Record<string, unknown> = {}) => executarComando(hub, nome, args) as Promise<T>;
  const conectar = async (logica = rt.servidor!.portas()[0]!.logica) => {
    const c = await ClienteTcp.conectar({ host: HOST, porta: rt.servidor!.fisica(logica)! });
    fechar.push(() => c.fechar());
    return c;
  };
  const txt = async (c: ClienteTcp, q: string, timeoutMs = 200) => (await c.trocar([q], { timeoutMs, ociosoMs: 40 })).bytes.toString('latin1');
  return { hub, rt, cmd, conectar, txt, clock };
}

describe('injeção de falhas pela API: um caso por tipo (cbc-32 e 2.7.2)', () => {
  const BASE = '(TL040000000084)';
  const Q = '(&T04L2A)';

  it('o catálogo expõe os 10 tipos e cada um tem efeito observável', () => {
    expect([...TIPOS_FALHA].sort()).toEqual(['atraso', 'checksum_errado', 'desconectar', 'erro', 'fragmentar', 'frame_corrompido', 'resposta_dupla', 'sem_resposta', 'travamento', 'truncado']);
  });

  it.each(['simulador-2.7.2', 'cbc-32'] as PerfilId[])('%s: efeito de cada tipo e retorno ao normal depois de `vezes`', async (p) => {
    const { cmd, conectar, txt } = await hubCom(p);
    const c = await conectar();
    expect(await txt(c, Q)).toBe(BASE);

    await cmd('injetar_falha', { tipo: 'sem_resposta', verbo: '&T', vezes: 2 });
    expect(await txt(c, Q)).toBe('');
    expect(await txt(c, Q)).toBe('');
    expect(await txt(c, Q)).toBe(BASE);

    await cmd('injetar_falha', { tipo: 'checksum_errado', verbo: '&T' });
    const ck = await txt(c, Q);
    expect(ck).not.toBe(BASE);
    expect(kkValido(ck)).toBe(false);
    expect(ck.slice(0, -3)).toBe(BASE.slice(0, -3));

    await cmd('injetar_falha', { tipo: 'truncado', verbo: '&T', param: { bytes: 4 } });
    expect(await txt(c, Q)).toBe(BASE.slice(0, -4));

    await cmd('injetar_falha', { tipo: 'resposta_dupla', verbo: '&T' });
    expect(await txt(c, Q)).toBe(BASE + BASE);

    await cmd('injetar_falha', { tipo: 'erro', verbo: '&T', param: { codigo: '?t' } });
    // DECISIONS §36: the erro frame carries the verb letter, like the codec's own errors.
    expect(await txt(c, Q)).toBe('(T?t)');

    await cmd('injetar_falha', { tipo: 'frame_corrompido', verbo: '&T', param: { bytes: 3 } });
    const fc = await txt(c, Q);
    expect(fc).toHaveLength(BASE.length);
    expect(fc).not.toBe(BASE);

    await cmd('injetar_falha', { tipo: 'atraso', verbo: '&T', param: { ms: 150 } });
    const t0 = performance.now(); // real socket latency (not domain)
    const r = await c.trocar([Q], { timeoutMs: 600, ociosoMs: 40 });
    expect(r.bytes.toString('latin1')).toBe(BASE);
    expect(performance.now() - t0).toBeGreaterThanOrEqual(120);

    expect(await txt(c, Q)).toBe(BASE);
    expect((await cmd<{ falhas: unknown[] }>('list_falhas')).falhas).toEqual([]);
  });

  it('desconectar derruba o socket; falha por porta só atinge essa porta; aplicar:false não aplica o comando', async () => {
    const { cmd, conectar, txt, rt } = await hubCom('cbc-32');
    const a = await conectar(2001);
    const b = await conectar(1771);
    await cmd('injetar_falha', { tipo: 'sem_resposta', verbo: '&M', porta: 2001, param: { aplicar: false } });
    expect(await txt(a, kk('&M04B'))).toBe('');
    expect(rt.sim.conc.lado(1, 1)!.bloqueado).toBe(false); // the frame never arrived
    expect(await txt(b, kk('&M04B'))).toBe('(M04)');
    expect(rt.sim.conc.lado(1, 1)!.bloqueado).toBe(true);
    await cmd('injetar_falha', { tipo: 'desconectar', verbo: '&V' });
    const r = await a.trocar(['(&V)'], { timeoutMs: 300 });
    expect(r.caiu).toBe(true);
  });

  it('fragmentar: a resposta chega em partes e remonta idêntica', async () => {
    const { cmd, conectar, txt } = await hubCom('cbc-32');
    const c = await conectar();
    const normal = await txt(c, '(&S)');
    await cmd('injetar_falha', { tipo: 'fragmentar', verbo: '&S', param: { partes: 4, ms: 15 } });
    expect(await txt(c, '(&S)', 400)).toBe(normal);
  });

  it('travamento por falha: congela um perfil real até liberar_travamento; no 2.7.2 o socket segue', async () => {
    const { cmd, conectar, txt } = await hubCom('cbc-32');
    const c = await conectar();
    await cmd('injetar_falha', { tipo: 'travamento', verbo: '&V' });
    expect(await txt(c, '(&V)')).toBe('');
    expect(await txt(c, '(&S)')).toBe('');
    await cmd('liberar_travamento');
    expect(await txt(c, '(&S)')).toMatch(/^\(S/);
    // 2.7.2 (verdict #8): the frame that opened the modal gets no reply, the others do.
    const q = await hubCom('simulador-2.7.2');
    const c2 = await q.conectar();
    await q.cmd('injetar_falha', { tipo: 'travamento', verbo: '&V' });
    expect(await q.txt(c2, '(&V)')).toBe('');
    expect(await q.txt(c2, '(&S)')).toMatch(/^\(S/);
  });

  it('set_falha_endereco pela API põe o lado em F e limpar_falhas remove as regras', async () => {
    const { cmd, conectar, txt } = await hubCom('cbc-32');
    const c = await conectar();
    await cmd('set_falha_endereco', { canal: 1, endereco: 1, ativo: true });
    expect((await txt(c, '(&S)')).slice(2, 6)).toBe('FLFF');
    await cmd('set_falha_endereco', { canal: 1, endereco: 1, ativo: false });
    expect((await txt(c, '(&S)')).slice(2, 6)).toBe('LLFF');
    await cmd('injetar_falha', { tipo: 'sem_resposta', vezes: 'sempre' });
    expect(await txt(c, '(&S)')).toBe('');
    await cmd('limpar_falhas');
    expect(await txt(c, '(&S)')).toMatch(/^\(S/);
  });
});

// ───────────────────────── recorder + replay round trip ─────────────────────────
describe('recorder + replay: ida e volta', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-sim-golden-'));
  const SESSAO = [
    '(&S)',
    '(&A)',
    '(&T04L2A)',
    '(&T08l4E)',
    kk('&U04000012'),
    kk('&P04000300'),
    kk('&M04B'),
    kk('&M04L'),
    '(&I)',
    '(&T99P3C)',
    '(&R)',
    '(&T04L00)',
    '(&V)',
    '>?00020263',
  ];

  async function gravar(perfil: PerfilId, arq: string) {
    const { rt, conectar, txt } = await hubCom(perfil, arq);
    const c = await conectar();
    const respostas: string[] = [];
    for (const q of SESSAO) respostas.push(await txt(c, q));
    c.fechar();
    await new Promise((r) => setTimeout(r, 40));
    rt.gravarFim();
    return respostas;
  }

  it.each(['simulador-2.7.2', 'cbc-32', 'horustech-48'] as PerfilId[])('%s: grava, o JSONL faz round-trip e o replay contra um simulador novo não diverge', async (p) => {
    const arq = path.join(dir, `${p}.jsonl`);
    const respostas = await gravar(p, arq);
    const texto = fs.readFileSync(arq, 'utf8');
    const linhas = lerGravacao(texto);
    // the JSONL is stable: reading and serializing again gives the same text
    expect(linhas.map(serializar).join('\n') + '\n').toBe(texto);
    const tr = trocas(linhas);
    expect(tr).toHaveLength(SESSAO.length);
    expect(tr.map((t) => t.rx.toString('latin1'))).toEqual(SESSAO);
    // the recorded replies are the ones the client saw
    expect(tr.map((t) => t.tx.toString('latin1'))).toEqual(respostas);

    // replay (client) against a fresh simulator with the same profile and clock: 0 divergences
    const novo = await hubCom(p);
    const alvo = { host: HOST, porta: novo.rt.servidor!.fisica(novo.rt.servidor!.portas()[0]!.logica)! };
    const logica = String(novo.rt.servidor!.portas()[0]!.logica);
    const r = await replayCliente(linhas, { alvos: { [logica]: alvo }, timeoutMs: 250 });
    expect(r.divergencias).toEqual([]);
    expect(r.iguais).toBe(r.trocas);
    expect(r.trocas).toBe(SESSAO.length);
  });

  it('o servidor de replay devolve, quadro a quadro, as respostas gravadas', async () => {
    const arq = path.join(dir, 'srv.jsonl');
    const respostas = await gravar('cbc-32', arq);
    const linhas = lerGravacao(fs.readFileSync(arq, 'utf8'));
    const logica = String(linhas.find((l) => l.dir === 'abre')!.porta);
    const srv = await ServidorReplay.abrir(linhas, { host: HOST, mapa: { [logica]: 0 } });
    fechar.push(() => srv.fechar());
    const c = await ClienteTcp.conectar({ host: HOST, porta: srv.portas()[0]!.fisica });
    fechar.push(() => c.fechar());
    const got: string[] = [];
    for (const q of SESSAO) got.push((await c.trocar([q], { timeoutMs: 200, ociosoMs: 40 })).bytes.toString('latin1'));
    expect(got).toEqual(respostas);
    expect(srv.naoEncontrados).toEqual([]);
  });

  it('um estado diferente é apontado pelo replay (1º byte divergente)', async () => {
    const arq = path.join(dir, 'div.jsonl');
    await gravar('cbc-32', arq);
    const linhas = lerGravacao(fs.readFileSync(arq, 'utf8'));
    const novo = await hubCom('cbc-32');
    await novo.cmd('gravar_encerrante', { bico: '04', valor: 99_999 });
    const logica = String(novo.rt.servidor!.portas()[0]!.logica);
    const r = await replayCliente(linhas, { alvos: { [logica]: { host: HOST, porta: novo.rt.servidor!.fisica(Number(logica))! } }, timeoutMs: 250 });
    expect(r.divergencias.length).toBeGreaterThan(0);
    expect(r.divergencias.map((d) => d.rx)).toContain('(&T04L2A)');
  });
});

// ───────────────────────── MCP against a server on an ephemeral port ─────────────────────────
describe('MCP: tools do catálogo, chamadas contra a API em porta efêmera', () => {
  async function mcp(perfil: PerfilId) {
    const { hub, rt } = await hubCom(perfil);
    const s = await abrirServidorControle(hub, 0);
    fechar.push(() => s.fechar());
    expect(new URL(s.url).port).not.toBe('0');
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = criarServidorMcp(s.url);
    await server.connect(st);
    const client = new Client({ name: 'golden', version: '1.0.0' });
    await client.connect(ct);
    fechar.push(() => client.close());
    const chamar = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
      const texto = r.content[0]!.text;
      let json: Record<string, unknown> & { quadro?: string };
      try {
        json = JSON.parse(texto) as typeof json;
      } catch {
        json = { texto };
      }
      return { erro: !!r.isError, json };
    };
    return { hub, rt, s, client, chamar };
  }

  it('lista as tools do catálogo, com nomes únicos e schema de objeto com sim_id', async () => {
    const { client } = await mcp('cbc-32');
    const { tools } = await client.listTools();
    const nomes = tools.map((t) => t.name);
    expect(nomes).toHaveLength(CATALOGO.length);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect(nomes).toEqual(expect.arrayContaining(['get_status', 'abastecer', 'avancar_tempo', 'get_ponteiros', 'get_abastecimento', 'injetar_falha', 'set_preco']));
    for (const t of tools) {
      expect(t.inputSchema.type, t.name).toBe('object');
      expect(t.inputSchema.properties, t.name).toHaveProperty('sim_id');
      expect(t.description?.length ?? 0, t.name).toBeGreaterThan(5);
    }
  });

  it('chama 3 tools: get_status, abastecer + avancar_tempo, get_abastecimento/get_ponteiros', async () => {
    const { chamar } = await mcp('cbc-32');
    // 1) get_status: the frame comes from the profile's codec
    const st = await chamar('get_status');
    expect(st.erro).toBe(false);
    expect(st.json.quadro).toMatch(/^\(SLLFF/);
    // 2) abastecer + avancar_tempo: the fueling runs on the manual clock
    const ab = await chamar('abastecer', { bico: '04', duracao_s: 3 });
    expect(ab.erro).toBe(false);
    expect(ab.json.bico).toBe('04');
    await chamar('avancar_tempo', { ms: 8000 });
    // 3) the record shows up, through the pointers and the requested layout
    const pt = await chamar('get_ponteiros', { porta: 2001 });
    expect(pt.json.escrita).toBe(1);
    expect(pt.json.leitura).toBe(0);
    const ra = await chamar('get_abastecimento', { formato: 'a52' });
    expect(ra.erro).toBe(false);
    expect(ra.json.quadro).toHaveLength(52);
    expect(kkValido(ra.json.quadro!)).toBe(true);
  });

  it('erros viram isError com a mensagem; sim_id inexistente também', async () => {
    const { chamar } = await mcp('simulador-2.7.2');
    const e1 = await chamar('set_preco', { preco: 1 });
    expect(e1.erro).toBe(true);
    const e2 = await chamar('get_status', { sim_id: 'nao-existe' });
    expect(e2.erro).toBe(true);
    expect(JSON.stringify(e2.json)).toMatch(/inexistente/);
    expect(JSON.stringify(e1.json)).toMatch(/bico/);
  });

  it('injetar_falha pelo MCP vale para o TCP real do simulador', async () => {
    const { chamar, rt } = await mcp('cbc-32');
    await chamar('injetar_falha', { tipo: 'sem_resposta', verbo: '&S' });
    const c = await ClienteTcp.conectar({ host: HOST, porta: rt.servidor!.fisica(2001)! });
    fechar.push(() => c.fechar());
    const t = async () => (await c.trocar(['(&S)'], { timeoutMs: 150, ociosoMs: 40 })).bytes.toString('latin1');
    expect(await t()).toBe('');
    expect(await t()).toMatch(/^\(S/);
  });
});
