import { describe, expect, it } from 'vitest';
import { kkValido } from '../src/index.js';
import { kk, novo, passo } from './util.js';

/**
 * The 17/10 diff: real SimuladorCBC 2.7.2 (A) × simulador-2.7.2 profile (B), on the Windows
 * bench. The literals below are A's replies. State divergences (totalizer,
 * pointers) and the &S battery T byte are left out (docs/DECISIONS.md §9).
 */
const letra0 = (s: string | null) => s?.[2];

describe('bancada 17/10 — comportamento do 2.7.2 real', () => {
  it('DIFF-02: &M com bico inexistente ecoa o BB; &M99 b/c → (M?f) já no 1º', () => {
    const { sim } = novo();
    expect(sim.pedir('(&M04Z31)')).toBeNull();
    expect(sim.pedir('(&M3FA2D)')).toBe('(M3F)');
    expect(sim.pedir('(&M99b000000000000000148)')).toBe('(M?f)');
    expect(sim.pedir('(&M99c000000000000000048)')).toBe('(M?f)');
    expect(sim.conc.listaNegra).toEqual([]);
  });

  it('DIFF-02 não vaza para os reais: cbc-32 segue o DT435', () => {
    const { sim } = novo('cbc-32');
    expect(sim.pedir('(&M3FA2D)')).toBe('(M?b)');
    expect(sim.pedir('(&M99b000000000000000148)')).toBe('(M99)');
    expect(sim.pedir('(&M99c000000000000000048)')).toBe('(M99)');
  });

  it('DIFF-10: níveis de preço 1 e 2 começam em 0000', () => {
    const { sim } = novo();
    expect(sim.pedir('(&T08C25)')).toBe('(Ts08023A0102C8)');
    expect(sim.pedir('(&T08u57)')).toBe('(TU0800001123000058)');
    expect(sim.pedir('(&T08U37)')).toBe('(TU080000112398)');
    expect(novo('cbc-32').sim.pedir('(&T08U37)')).toBe(kk('TU08' + '1120' + '1123'));
  });

  it('DIFF-12: WW = 00, &KW1 com mês 13 aceito, &R com a data crua e as linhas (C…) do &C', () => {
    const { sim } = novo();
    expect(sim.pedir('(&KR1F4)')).toBe(kk('KR1' + '261016' + '00' + '143000'));
    expect(sim.pedir('(&KW126101606143000B7)')).toBe('(KW12610160614300091)');
    expect(sim.pedir('(&KR1F4)')).toBe(kk('KR1' + '261016' + '06' + '143000'));
    expect(sim.pedir('(&KW126131606143000BA)')).toBe('(KW12613160614300094)');
    let linhas = '';
    for (let c = 1; c <= 8; c++) for (let e = 1; e <= 2; e++) linhas += `(C0${c}W3A0${e}0200)`;
    expect(sim.pedir('(&R)')).toBe(
      '(REL 14:30:00 16/13/26)(DHA SIM02 V2.7.2)(SOFT MONITOR V:1.0)' + '(M 00000000)'.repeat(5) + linhas,
    );
    // A valid date goes back to the calendar.
    sim.pedir('(&KW126101606143000B7)');
    expect(sim.pedir('(&R)')).toMatch(/^\(REL 14:30:00 16\/10\/26\)/);
  });

  it('DIFF-12 não vaza para os reais: cbc-32 calcula o WW e recusa o mês 13', () => {
    const { sim } = novo('cbc-32');
    expect(sim.pedir('(&KR1F4)')).toBe(kk('KR1' + '261016' + '06' + '143000'));
    expect(sim.pedir('(&KW126131606143000BA)')).toBe(kk('KW1' + '261016' + '06' + '143000'));
  });

  it('DIFF-13: ?S com tipo de CBC 0', () => {
    expect(novo().sim.pedir('(?S92)')?.slice(0, -3)).toBe('(SFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFDD0v3.7M1.0G');
  });

  it('DIFF-16: >?32 com valor não numérico abre o modal do StrToFloat e o socket segue atendendo', () => {
    const { sim } = novo();
    for (const q of ['>?000A3202000111FA', '>?000A3202000111FA\n']) {
      expect(sim.pedir(q)).toBeNull();
      expect(sim.conc.eventos.at(-1)?.texto).toBe("Error: '1,11F' is not a valid floating point value.");
    }
    expect(sim.pedir('>?00020200')).toBe('>!00020245');
  });

  it('sonda de abastecimento da bancada: &S L→A→C→L, &V de 0,13 L por tick de vazão, &A 52, &A67 75, &I, &T', () => {
    const { sim, clock } = novo();
    expect(sim.pedir('(&U040058991E)')).toBe('(U04)');
    sim.conc.retirarBico(0x04);
    let ms = 0;
    while (letra0(sim.pedir('(&S)')) !== 'A') {
      passo(sim, clock, 100);
      expect((ms += 100)).toBeLessThanOrEqual(1000);
    }
    const vols: number[] = [];
    // One step = one flow tick (109.375 ms on simulador-2.7.2, §29): one &V per tick.
    while (vols.length === 0 || vols.at(-1)! < 702) {
      passo(sim, clock, sim.conc.tickVazaoMs);
      const v = sim.pedir('(&V)')!;
      expect(v).toMatch(/^\(04\d{6}\)$/); // 2 decimals, no KK
      if (v !== '(04000000)') vols.push(Number(v.slice(3, 9)));
      expect(vols.length).toBeLessThan(80);
    }
    vols.forEach((v, i) => expect(v).toBe(13 * (i + 1)));
    expect(vols.length).toBe(54); // 54 × 0.13 = 7.02 L
    sim.conc.recolocarBico(0x04);
    expect(letra0(sim.pedir('(&S)'))).toBe('C');
    passo(sim, clock, 1000);
    expect(letra0(sim.pedir('(&S)'))).toBe('C'); // "Concluindo..": the record is already stored
    const a = sim.pedir('(&A)')!;
    expect(a).toHaveLength(52);
    expect(a.slice(0, 19)).toBe('(00414100070258993A');
    const a67 = sim.pedir('(&A67)')!;
    expect(a67).toHaveLength(75);
    expect(a67.slice(0, 20)).toBe('(A00414100070258993A');
    expect(kkValido(a67)).toBe(true);
    expect(sim.pedir('(&I6F)')).toBeNull();
    expect(sim.pedir('(&A67)')).toBe('(0)');
    expect(sim.pedir('(&T04L2A)')).toBe('(TL04000007028D)');
    expect(sim.pedir('(&T04l4A)')).toBe('(Tl0400000007020D)');
    passo(sim, clock, 1000);
    expect(letra0(sim.pedir('(&S)'))).toBe('L');
  });
});
