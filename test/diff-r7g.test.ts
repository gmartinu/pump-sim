/**
 * Fixes from the diff r7g bench run (real 2.7.2 on Windows, Go driver, 17/10; docs/DECISIONS.md §23).
 * - VAZAO_272: a volume frozen at preset/price stays unrounded and the totalizer adds it as it is
 *   (DIFF-17R `&LR0999/0001/0002`: E10 15 / 1 / 15 cL above B). Real profiles unchanged.
 * - BICO_272: with the nozzle fueling frozen by `&M B` the `&S` letter is B (EQUIV-MOTOR #26),
 *   asserted in test/golden-r4b.test.ts and test/equivalencia-motor.test.ts.
 * - Executor: a step whose reply depends on a skipped `manual`/`acao` step is reported as skipped.
 * - Script: EQUIV-MOTOR #66 last in the case, EQUIV-PENDENTES waits a state tick after the button,
 *   DIFF-20 masks the record clock fields.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Hub, ManualClock, type CasoDiff, type PumpSim, executarComando, executarDiff, roteiro } from '../src/index.js';
import { kk, novo, passo } from './util.js';

const HOST = '127.0.0.1';
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

/** R$ 1,00 preset fueling on `bb` with a manual clock, 100 ms at a time. */
function abastecerPreset(sim: PumpSim, clock: ManualClock, bb: string) {
  expect(sim.pedir(kk(`&P${bb}000100`))).toBe(`(P${bb})`);
  const codigo = parseInt(bb, 16);
  sim.conc.retirarBico(codigo);
  for (let i = 0; i < 40; i++) passo(sim, clock, 100);
  sim.conc.recolocarBico(codigo);
  for (let i = 0; i < 25; i++) passo(sim, clock, 100);
}

/** One real R$ 1,00 fueling, `fantasmas` `&M S` ghosts (one per state tick) and another real one. */
function lote(sim: PumpSim, clock: ManualClock, bb: string, fantasmas: number) {
  abastecerPreset(sim, clock, bb);
  for (let i = 0; i < fantasmas; i++) {
    expect(sim.pedir(kk(`&M${bb}S`))).toBe(`(M${bb})`);
    passo(sim, clock, 1100);
  }
  abastecerPreset(sim, clock, bb);
}

/** E10 of an `&LR`/`&A` 52 reply: chars 37..47 (counting the `(`). */
const e10 = (r: string) => r.slice(37, 47);

describe('VAZAO_272: o encerrante soma o volume do preset sem arredondar (diff r7g DIFF-17R)', () => {
  it('2.7.2: 334 registros de R$ 1,00 a 1,123 no 04 somam 297,41 L (bancada), não 334 × 0,890', () => {
    const { sim, clock } = novo();
    sim.pedir('(&E0400000000)');
    lote(sim, clock, '04', 332);
    const ultimo = sim.conc.buffer.todos().at(-1)!;
    expect(ultimo.volumeMl).toBe(890);
    // Bench A frame of r7g, `&LR0999`: `…0999 0000029741 00…` (B before the fix: 0000029726).
    expect(e10(sim.pedir(kk(`&LR${String(ultimo.posicao).padStart(4, '0')}`))!)).toBe('0000029741');
    expect(sim.pedir(kk('&T04L'))).toBe(kk('TL0400029741'));
  });

  it('2.7.2: o 44 a 2,123 (334 registros) dá 157,32 L, como o `&LR0001` da bancada', () => {
    const { sim, clock } = novo();
    sim.pedir('(&E4400000000)');
    lote(sim, clock, '44', 332);
    expect(e10(sim.pedir(kk(`&LR${String(sim.conc.buffer.todos().at(-1)!.posicao).padStart(4, '0')}`))!)).toBe('0000015732');
  });

  it('2.7.2: um registro sozinho segue 0,89 L; o &E zera também a fração', () => {
    const { sim, clock } = novo();
    sim.pedir('(&E0400000000)');
    abastecerPreset(sim, clock, '04');
    expect(sim.pedir(kk('&T04L'))).toBe(kk('TL0400000089'));
    expect(sim.conc.bico(0x04)!.encerranteFracMl).toBeGreaterThan(0);
    // `&E` to the same whole value still "changes" the unrounded totalizer: it stores a record.
    const antes = sim.conc.buffer.todos().length;
    sim.pedir('(&E0400000000)');
    expect(sim.conc.bico(0x04)!.encerranteFracMl).toBeUndefined();
    expect(sim.conc.buffer.todos().length).toBe(antes + 1);
  });

  it('espelho cbc-32: o volume do preset é inteiro em mL e o encerrante soma 3 × 890', () => {
    const { sim, clock } = novo('cbc-32');
    sim.pedir('(&E0400000000)');
    for (let i = 0; i < 3; i++) abastecerPreset(sim, clock, '04');
    expect(sim.conc.bico(0x04)!.encerranteMl).toBe(3 * 890);
    expect(sim.conc.bico(0x04)!.encerranteFracMl).toBeUndefined();
  });
});

async function hub() {
  const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
  const h = new Hub({ clock, host: HOST, mapa: { 2001: 0, 1771: 0, 857: 0, 7002: 0 } });
  fechar.push(() => h.fechar());
  const rt = await h.criar('default', 'simulador-2.7.2');
  return { hub: h, rt, clock };
}

describe('executor: passo que depende de um passo pulado sai como pulado (diff r7g DIFF-14, EQUIV-MOTOR #66)', () => {
  const caso: CasoDiff = {
    id: 'TESTE-DEP',
    titulo: 'dependência de passo pulado',
    resolve: 'teste',
    passos: [
      { manual: 'Apresentar o cartão', controle: [{ comando: 'apresentar_cartao', args: { canal: 1, endereco: 1, codigo: '1122334455667788' } }], rotulo: 'idf' },
      { enviar: '(?A80)', dependeDe: ['idf'] },
      { enviar: '(&A)' },
    ],
  };

  it('A sem controle pula o cartão: o ?A80 sai pulado, não diverge; o resto compara', async () => {
    const a = await hub();
    const b = await hub();
    const hubs: Record<string, Hub> = { 'ctl-b': b.hub };
    const rel = await executarDiff(
      [caso],
      { nome: 'A', alvo: { host: HOST, porta: a.rt.servidor!.fisica(2001)! } },
      { nome: 'B', alvo: { host: HOST, porta: b.rt.servidor!.fisica(2001)! }, controle: 'ctl-b' },
      { timeoutMs: 120, ociosoMs: 30, chamarControle: (url, c, args) => executarComando(hubs[url]!, c, args), esperar: async () => {} },
    );
    const r = rel.casos[0]!;
    expect(r.pulados.map((p) => p.alvo)).toEqual(['A']);
    expect(r.passos[0]!.a.texto).toBe('(0)');
    expect(r.passos[0]!.b.texto).not.toBe('(0)');
    expect(r.passos[0]!.pulado).toBe('depende de "idf", pulado em A');
    expect(r.passos[1]!.pulado).toBeUndefined();
    expect(r.passos[1]!.igual).toBe(true);
    expect(r.divergencias).toBe(0);
    expect(r.passosPulados).toBe(1);
    expect(rel.total).toMatchObject({ passos: 2, iguais: 1, divergencias: 0, pulados: 1 });
  }, 20_000);

  it('com o passo feito nos dois alvos, o passo dependente compara normalmente', async () => {
    const a = await hub();
    const b = await hub();
    const hubs: Record<string, Hub> = { 'ctl-a': a.hub, 'ctl-b': b.hub };
    const rel = await executarDiff(
      [caso],
      { nome: 'A', alvo: { host: HOST, porta: a.rt.servidor!.fisica(2001)! }, controle: 'ctl-a' },
      { nome: 'B', alvo: { host: HOST, porta: b.rt.servidor!.fisica(2001)! }, controle: 'ctl-b' },
      { timeoutMs: 120, ociosoMs: 30, chamarControle: (url, c, args) => executarComando(hubs[url]!, c, args), esperar: async () => {} },
    );
    const r = rel.casos[0]!;
    expect(r.pulados).toEqual([]);
    expect(r.passos.every((p) => p.pulado === undefined)).toBe(true);
    expect(r.passos[0]!.a.texto).not.toBe('(0)');
    expect(r.passos[0]!.igual).toBe(true);
    expect(rel.total).toMatchObject({ passos: 2, iguais: 2, divergencias: 0 });
    expect(rel.total.pulados).toBeUndefined();
  }, 20_000);
});

describe('roteiro (diff r7g)', () => {
  const enviar = (c: CasoDiff) => c.passos.filter((p): p is Extract<CasoDiff['passos'][number], { enviar: unknown }> => 'enviar' in p);

  it('DIFF-14: ?A80 e ?V95 dependem dos passos do painel IDF', () => {
    const c = roteiro('DIFF-14')!;
    const dep = enviar(c).filter((p) => p.dependeDe?.includes('idf')).map((p) => p.enviar);
    expect(dep).toEqual(['(?A80)', '(?V95)']);
    expect(c.passos.filter((p) => 'manual' in p && p.rotulo === 'idf')).toHaveLength(3);
  });

  it('EQUIV-MOTOR: o #66 é o último bloco, nenhum registro ou encerrante é lido depois dele', () => {
    const c = roteiro('EQUIV-MOTOR')!;
    const i66 = c.passos.findIndex((p) => 'manual' in p && p.rotulo === '#66');
    expect(i66).toBeGreaterThan(0);
    const depois = c.passos.slice(i66).filter((p) => 'enviar' in p);
    expect(depois.map((p) => (p as { enviar: string }).enviar)).toEqual(['(&V)']);
    expect((depois[0] as { dependeDe?: string[] }).dependeDe).toEqual(['#66']);
  });

  it('EQUIV-PENDENTES: espera um tick de estado depois do botão, antes do 1º (&S)', () => {
    const c = roteiro('EQUIV-PENDENTES')!;
    expect(c.passos.slice(0, 3)).toEqual([{ drenar: true }, expect.objectContaining({ acao: 'config_padrao' }), { aguardar: 1500 }]);
  });

  it('DIFF-20: o 2º (&A) mascara só C4, hh:mm e o KK', () => {
    const a = enviar(roteiro('DIFF-20')!).filter((p) => p.enviar === '(&A)');
    expect(a).toHaveLength(2);
    for (const p of a) expect(p.mascara).toEqual([[19, 23], [27, 31]]);
  });
});
