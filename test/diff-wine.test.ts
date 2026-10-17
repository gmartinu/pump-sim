/**
 * Wine free-flow tolerance (docs/DECISIONS.md §26): with side A = the real 2.7.2 under Wine
 * (`--alvo-a wine`), the volume/amount/totalizer/duration fields of the `vazao-livre` steps compare
 * within ±10% (§30; §26 had 4%); every other byte stays exact, each side's KK must check, and nothing changes for a
 * Windows run or for the recorded oracle.
 */
import { describe, expect, it } from 'vitest';
import { TOLERANCIA_WINE, compararComToleranciaWine, executarDiff, executarOraculo, formatarRelatorio, lerOraculo } from '../src/index.js';
import type { AlvoDiff, CasoDiff, ConexaoTroca, OpcoesDiff } from '../src/index.js';
import { comKK, kkValido } from '../src/protocols/companytec/checksum.js';

/** EQUIV-MOTOR #26 record of the r8 bench (A, the 2.7.2 on Windows) and its core fields. */
const A26 = '(00033500029911233A00060417173510000500000006550072)';
/** Record body: T6 L6 P4 V2 C4 B2 DD HH MM NN R4 E10 SS. */
const registro = (t6: string, l6: string, c4: string, e10: string, r4 = '0005') => comKK(`${t6}${l6}11233A${c4}0417173510${r4}${e10}00`);

describe('compararComToleranciaWine', () => {
  it('A26 is a valid record of this layout (the fixture the cases below derive from)', () => {
    expect(registro('000335', '000299', '0006', '0000000655')).toBe(A26);
    expect(TOLERANCIA_WINE).toBe(0.1);
  });

  it('&A within 10%: volume, amount and totalizer differ, the rest is exact → the fields are listed', () => {
    // +2,0% volume (305 × 1,123 = 342,5 → 342), totalizer + 6 cL.
    const b = registro('000342', '000305', '0006', '0000000661');
    expect(kkValido(b)).toBe(true);
    expect(compararComToleranciaWine('(&A)', A26, b, A26, b)).toEqual([
      { campo: 'T6', a: 335, b: 342, desvio: 0.021 },
      { campo: 'L6', a: 299, b: 305, desvio: 0.02 },
      { campo: 'E10', a: 655, b: 661, desvio: 0.009 },
    ]);
  });

  it('&A at the Wine period ratio (EQUIV-MOTOR #26 fields of the r9 Wine run: 2,99 × 3,25 L, +8,7%; §29/§30) → tolerated', () => {
    // Outside the old 4% (§26); the 10% bound covers 1 − 100 / 109.375 = 8.6%. E10 +26 cL = 260 mL
    // against 10% × 3250 mL + 10 = 335 mL.
    const b = registro('000364', '000325', '0006', '0000000681');
    expect(compararComToleranciaWine('(&A)', A26, b, A26, b)).toEqual([
      { campo: 'T6', a: 335, b: 364, desvio: 0.087 },
      { campo: 'L6', a: 299, b: 325, desvio: 0.087 },
      { campo: 'E10', a: 655, b: 681, desvio: 0.04 },
    ]);
  });

  it('&A outside 10% → not equal (volume +12%, or only the amount out of its bound)', () => {
    expect(compararComToleranciaWine('(&A)', A26, registro('000376', '000335', '0006', '0000000691'), A26, registro('000376', '000335', '0006', '0000000691'))).toBeNull();
    // L6 and E10 within, T6 +39 against 10% × 374 + 1 = 38,4.
    const t = registro('000374', '000325', '0006', '0000000681');
    expect(compararComToleranciaWine('(&A)', A26, t, A26, t)).toBeNull();
  });

  it('&A whose non-field bytes differ (the raw r8 replay record of #26: C4 and the time differ) → not equal', () => {
    const b = '(00036400032511233A00050417173010000500000006810063)';
    expect(compararComToleranciaWine('(&A)', A26, b, A26, b)).toBeNull();
  });

  it('a byte outside the fields (R4) differs → not equal, even with the fields within 10%', () => {
    const b = registro('000342', '000305', '0006', '0000000661', '0006');
    expect(compararComToleranciaWine('(&A)', A26, b, A26, b)).toBeNull();
  });

  it('a KK that does not check on one side → not equal', () => {
    const b = registro('000342', '000305', '0006', '0000000661').replace(/..\)$/, '00)');
    expect(compararComToleranciaWine('(&A)', A26, b, A26, b)).toBeNull();
  });

  it('the totalizer may differ only by the volume: 10% of the record volume, not of the totalizer', () => {
    // Volume 3,05 L (+2%): the E10 bound is 10% × 3050 mL + 10 mL = 315 mL. +31 cL is within, +35 cL is
    // not, and a 2 L move (within 10% of the 6,55 L totalizer itself) is far outside.
    const e = registro('000342', '000305', '0006', '0000000686');
    expect(compararComToleranciaWine('(&A)', A26, e, A26, e)?.map((x) => x.campo)).toEqual(['T6', 'L6', 'E10']);
    const f = registro('000342', '000305', '0006', '0000000690');
    expect(compararComToleranciaWine('(&A)', A26, f, A26, f)).toBeNull();
    const b = registro('000342', '000305', '0006', '0000000855');
    expect(compararComToleranciaWine('(&A)', A26, b, A26, b)).toBeNull();
  });

  it('&V: each nozzle volume within 10% of the larger value; a nozzle code that differs is not tolerated', () => {
    expect(compararComToleranciaWine('(&V)', '(04000500)', '(04000555)', '(04000500)', '(04000555)')).toEqual([{ campo: 'L6 bico 04', a: 500, b: 555, desvio: 0.11 }]);
    expect(compararComToleranciaWine('(&V)', '(04000500)', '(04000556)', '(04000500)', '(04000556)')).toBeNull();
    expect(compararComToleranciaWine('(&V)', '(04000500)', '(08000500)', '(04000500)', '(08000500)')).toBeNull();
    expect(compararComToleranciaWine('(&V)', '(0)', '(04000010)', '(0)', '(04000010)')).toBeNull();
  });

  it('a reply with no known field map (e.g. &S) is never tolerated', () => {
    expect(compararComToleranciaWine('(&S)', '(SAL)', '(SBL)', '(SAL)', '(SBL)')).toBeNull();
  });
});

/** Target whose connection answers each frame from `respostas`, in order. */
function alvoFixo(nome: string, respostas: string[], extra: Partial<AlvoDiff> = {}): AlvoDiff {
  return {
    nome,
    alvo: { host: nome.toLowerCase(), porta: 2001 },
    relogioManual: true,
    conectar: async (): Promise<ConexaoTroca> => {
      let i = 0;
      return {
        caiu: false,
        trocar: async () => ({ bytes: Buffer.from(respostas[i++] ?? '', 'latin1'), latenciaMs: 0, caiu: false }),
        fechar: () => {},
        fecharRst: () => {},
      };
    },
    ...extra,
  };
}

const B_DENTRO = registro('000342', '000305', '0006', '0000000661');
const op: OpcoesDiff = { chamarDriver: async () => ({ ok: true }), chamarControle: async () => ({ ok: true }) };
const caso = (preset: boolean): CasoDiff =>
  ({
    id: 'WINE',
    titulo: 'WINE',
    resolve: 'teste',
    passos: [...(preset ? [{ enviar: '(&P0400100F2)' }] : []), { acao: 'retirar', params: { bico: '04' } }, { enviar: '(&A)' }],
  }) as CasoDiff;
const alvos = (preset: boolean): [AlvoDiff, AlvoDiff] => {
  const pre = preset ? ['(0)'] : [];
  return [alvoFixo('A', [...pre, A26], { driver: 'http://driver' }), alvoFixo('B', [...pre, B_DENTRO], { controle: 'http://b' })];
};

describe('executarDiff com plataformaA', () => {
  it('wine: the free-flow &A within 10% is "igual (tolerância wine)" and counts as equal', async () => {
    const rel = await executarDiff([caso(false)], ...alvos(false), { ...op, plataformaA: 'wine' });
    const p = rel.casos[0]!.passos.at(-1)!;
    expect(p.igual).toBe(true);
    expect(p.tolerancia?.alvo).toBe('wine');
    expect(p.tolerancia?.campos.map((c) => c.campo)).toEqual(['T6', 'L6', 'E10']);
    expect(p.byte).toBe(5);
    expect(rel.casos[0]!.divergencias).toBe(0);
    expect(rel.total).toMatchObject({ iguais: 1, divergencias: 0, toleradosWine: 1 });
    expect(rel.plataformaA).toBe('wine');
    const txt = formatarRelatorio(rel);
    expect(txt).toContain('≈ "(&A)" [igual (tolerância wine): T6 335→342 +2.1%, L6 299→305 +2.0%, E10 655→661 +0.9%]');
    expect(txt).toContain('WINE WINE — IGUAL');
    expect(txt).toContain('(1 pela tolerância wine)');
  });

  it('windows (default): the same replies are a divergence, byte-exact', async () => {
    const rel = await executarDiff([caso(false)], ...alvos(false), op);
    const p = rel.casos[0]!.passos.at(-1)!;
    expect(p.igual).toBe(false);
    expect(p.tolerancia).toBeUndefined();
    expect(rel.casos[0]!.divergencias).toBe(1);
    expect(rel.plataformaA).toBeUndefined();
    expect(rel.total.toleradosWine).toBeUndefined();
  });

  it('wine: a read after a preset fueling (not `vazao-livre`) stays byte-exact', async () => {
    const rel = await executarDiff([caso(true)], ...alvos(true), { ...op, plataformaA: 'wine' });
    const p = rel.casos[0]!.passos.at(-1)!;
    expect(p.igual).toBe(false);
    expect(p.tolerancia).toBeUndefined();
    expect(rel.casos[0]!.divergencias).toBe(1);
  });
});

it('the recorded oracle never applies the Wine tolerance (a #26 record within 10% stays a divergence)', async () => {
  // Since §29 the r10 oracle replays EQUIV-MOTOR #26 equal, so the witness is planted: the recorded A
  // record is moved by ~2% (0,305 L, R$ 3,42, E10 661), inside the Wine bounds, with a valid KK.
  const oraculo = lerOraculo('test/fixtures/oracle-2.7.2');
  const caso = structuredClone(oraculo.casos.get('EQUIV-MOTOR')!);
  const passo = caso.passos.find((x) => x.indice === 32)!;
  expect(passo.quadro).toBe('(&A)');
  const a = passo.a!;
  expect(a.slice(7, 13)).toBe('000299');
  const perto = comKK(`000342000305${a.slice(13, 37)}0000000661${a.slice(47, 49)}`);
  expect(kkValido(perto)).toBe(true);
  expect(compararComToleranciaWine('(&A)', perto, a, perto, a)?.length).toBeGreaterThan(0); // within the Wine bounds
  passo.a = perto;
  const r = await executarOraculo({ manifesto: oraculo.manifesto, casos: new Map([...oraculo.casos, ['EQUIV-MOTOR', caso]]) });
  expect(r.falhas).toEqual(['EQUIV-MOTOR']);
  expect(r.total.passos).toBeGreaterThan(1000);
  expect(r.relatorios.every((x) => x.plataformaA === undefined && !x.total.toleradosWine)).toBe(true);
  expect(r.relatorios.flatMap((x) => x.casos.flatMap((c) => c.passos)).some((p) => p.tolerancia)).toBe(false);
}, 60_000);
