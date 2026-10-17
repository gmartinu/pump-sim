/**
 * 2.7.2 × pump-sim equivalence, slice 1 (reads): the DIFERENTE / SÓ NO 2.7.2 rows
 * of the behavioral-equivalence verdict fixed on the `simulador-2.7.2` profile (#2, #17, #19,
 * #20, #22, #23), plus the 74/82 &LR by Modelo measured on the bench (driver test log, 2026-10-17).
 * Real profiles follow the manual: none of these quirks applies to them.
 */
import { describe, expect, it } from 'vitest';
import { criar, injetar, kk } from './golden-util.js';
import { precoFloatToStr4 } from '../src/protocols/companytec/handlers.js';
import { strToIntDelphi } from '../src/core/numeros.js';

/** The bench fueling record (nozzle 04, 7.02 L at 5.899, R 1, 16 23:53 month 10). */
const REG_BANCADA = {
  posicao: 1,
  codigoBico: 0x04,
  totalMil: 41410,
  volumeMl: 7020,
  precoUnit: 5899,
  virgula: 0x3a,
  duracaoS: 7,
  data: { ano: 2026, mes: 10, dia: 16, hora: 23, minuto: 53, segundo: 0, diaSemana: 6 },
  numero: 1,
  encFimMl: 7020,
};

describe('#2: verbos sem KK atendidos sem `)` (Q1)', () => {
  it('&V, &R, &S, &E e &KW respondem a um pedaço sem `)`; os verbos com KK e o (&A ficam mudos', () => {
    const { sim } = criar('simulador-2.7.2');
    expect(sim.pedir('(&V')).toBe('(0)');
    expect(sim.pedir('(&R')).toMatch(/^\(REL /);
    expect(sim.pedir('(&S79')).toMatch(/^\(S[LF]{32}/);
    expect(sim.pedir('(&S\r\n')).toMatch(/^\(S/);
    expect(sim.pedir('(&E0400001234')).not.toBeNull();
    expect(sim.pedir('(&KW126101606143000B8')).toMatch(/^\(KW1261016061430/);
    expect(sim.pedir('(&T04L')).toBeNull();
    expect(sim.pedir('(&T08L2E')).toBeNull();
    expect(sim.pedir('(&A')).toBeNull();
    expect(sim.pedir(')')).toBeNull();
  });

  it('o (&I partido avança o ponteiro de leitura', () => {
    const { sim } = criar('simulador-2.7.2');
    injetar(sim, REG_BANCADA);
    expect(sim.pedir('(&T99P3C)')).toBe(kk('TG9900010000'));
    expect(sim.pedir('(&I')).toBeNull();
    expect(sim.pedir('(&T99P3C)')).toBe(kk('TG9900010001'));
  });

  it('nos perfis reais um quadro sem `)` não é atendido', () => {
    const { sim } = criar('cbc-32');
    for (const q of ['(&V', '(&S', '(&R', '(&I']) expect(sim.processarQuadro(q).resposta).toBeNull();
  });
});

describe('#17: &T sem teste de tamanho (só o KK; modo = 6º char)', () => {
  it('2.7.2: (&T04LX82) responde TL e (&T04DE) responde TG', () => {
    const { sim } = criar('simulador-2.7.2');
    expect(sim.pedir('(&T04LX82)')).toBe(kk('TL0400000000'));
    expect(sim.pedir('(&T04DE)')).toBe(kk('TG0400000000'));
  });

  it('cbc-32: segue o manual (9 chars)', () => {
    const { sim } = criar('cbc-32');
    expect(sim.pedir('(&T04LX82)')).toBeNull();
    expect(sim.pedir('(&T04DE)')).toBeNull();
  });
});

describe('#19: &T C com o índice do bico no 5º campo', () => {
  it('2.7.2: (&T09C26) → 01 e (&T48C29) → 02; o (&T08C25) da bancada continua igual', () => {
    const { sim } = criar('simulador-2.7.2');
    expect(sim.pedir('(&T09C26)')).toBe('(Ts09023A0102C9)');
    expect(sim.pedir('(&T48C29)')).toBe('(Ts48023A0202CD)');
    expect(sim.pedir('(&T08C25)')).toBe('(Ts08023A0102C8)');
  });

  it('cbc-32: o 5º campo é o endereço (DT435 p.24-25)', () => {
    const { sim } = criar('cbc-32');
    expect(sim.pedir('(&T09C26)')!.slice(9, 11)).toBe('02');
    expect(sim.pedir('(&T48C29)')!.slice(9, 11)).toBe('01');
  });
});

describe('#20: &T U com FloatToStr e zeros à direita', () => {
  it('a conversão', () => {
    expect(precoFloatToStr4(549, 2)).toBe('5490');
    expect(precoFloatToStr4(500, 2)).toBe('5000');
    expect(precoFloatToStr4(1050, 2)).toBe('1050');
    expect(precoFloatToStr4(1123, 3)).toBe('1123');
    expect(precoFloatToStr4(12345, 3)).toBe('1234');
    expect(precoFloatToStr4(0, 3)).toBe('0000');
  });

  it('2.7.2: vírgula 2A e preço 5,49 → 5490; cbc-32 → 0549', () => {
    for (const [perfil, esperado] of [
      ['simulador-2.7.2', '5490'],
      ['cbc-32', '0549'],
    ] as const) {
      const { sim } = criar(perfil);
      sim.pedir('(&CW012A010200B7)');
      expect(sim.pedir(kk('&U04000549'))).toBe('(U04)');
      expect(sim.pedir(kk('&T04U'))!.slice(9, 13)).toBe(esperado);
    }
  });

  it('2.7.2 com 3 casas (DIFF-10 da bancada) não muda', () => {
    const { sim } = criar('simulador-2.7.2');
    expect(sim.pedir('(&T08U37)')).toBe('(TU080000112398)');
  });
});

describe('#22: &LR/&LC sem tamanho e com StrToInt', () => {
  it('StrToInt do Delphi', () => {
    expect(strToIntDelphi('0001')).toBe(1);
    expect(strToIntDelphi('$001')).toBe(1);
    expect(strToIntDelphi('  12')).toBe(12);
    expect(strToIntDelphi('$00A')).toBe(10);
    expect(strToIntDelphi('12 ')).toBeNull();
    expect(strToIntDelphi('ZZZZ')).toBeNull();
    expect(strToIntDelphi('')).toBeNull();
  });

  it('2.7.2: (&LR00010B5) e (&LR$00179) leem a posição 1; não numérico abre o modal E9', () => {
    const { sim } = criar('simulador-2.7.2');
    sim.conc.setModelo('CBC-06');
    injetar(sim, REG_BANCADA);
    const pos1 = sim.pedir('(&LR000185)');
    expect(pos1).toHaveLength(74);
    expect(sim.pedir('(&LR00010B5)')).toBe(pos1);
    expect(sim.pedir('(&LR$00179)')).toBe(pos1);
    expect(sim.pedir('(&LC000176)')).toHaveLength(123);
    const r = sim.processarQuadro(kk('&LRZZZZ'));
    expect(r.resposta).toBeNull();
    expect(r.travar).toBe("''ZZZZ'' is not a valid integer value.");
  });

  it('cbc-32: segue o manual (11 chars, decimal)', () => {
    const { sim } = criar('cbc-32');
    injetar(sim, REG_BANCADA);
    expect(sim.pedir('(&LR000185)')).toHaveLength(74);
    expect(sim.pedir('(&LR00010B5)')).toBeNull();
    expect(sim.pedir('(&LR$00179)')).toBeNull();
  });
});

describe('&LR de 74/82 pelo Modelo (bancada, log de testes do driver)', () => {
  it('2.7.2: os bytes do 2.7.2 real em CBC-06 e em Horustech', () => {
    const { sim } = criar('simulador-2.7.2');
    injetar(sim, REG_BANCADA);
    sim.conc.setModelo('CBC-06');
    expect(sim.pedir('(&LR000185)')).toBe('(00414100070258993A000704162353100001000000070200000000000000000000010091)');
    sim.conc.setModelo('Horustech');
    expect(sim.pedir('(&LR000185)')).toBe(
      '(00414100070258993A00070416235310000100000007020000000000000000000000000000000010)',
    );
    sim.conc.setModelo('CBC-06');
    expect(sim.pedir('(&LR000185)')).toHaveLength(74);
  });
});

describe('#23: &LE pelo 7º char em hex', () => {
  it('2.7.2: n ≠ 0 → `(` + 4 células de 8 + `)` (célula sem evento = 00000000, bancada diff r4b); n = 0 → mudo; não hex → E9', () => {
    const { sim, clock } = criar('simulador-2.7.2');
    // Row 1 = the opening event, DDMMhhmm of the PC clock at start (bench diff r6 `17101322`, r4b
    // `16101956`; docs/DECISIONS.md §21 "r6 bench run"). Was 32 zeros (§18 F5) before r6.
    const d = new Date(clock.now() + sim.conc.rtc.offsetMinutos * 60_000);
    const ddmmhhmm = [d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCHours(), d.getUTCMinutes()].map((n) => String(n).padStart(2, '0')).join('');
    clock.advance(3 * 60_000);
    expect(sim.pedir('(&LE00148)')).toBe('(' + ddmmhhmm + '0'.repeat(24) + ')');
    // Bench diff r4b: `(&LE00C5A)` → 32 zeros (row 16 included).
    expect(sim.pedir(kk('&LE00C'))).toBe('(' + '0'.repeat(32) + ')');
    expect(sim.pedir(kk('&LE000'))).toBeNull();
    const r = sim.processarQuadro(kk('&LE00Z'));
    expect(r.resposta).toBeNull();
    expect(r.travar).toBe("''$Z'' is not a valid integer value.");
  });

  it('cbc-32: layout não recuperado, mudo', () => {
    expect(criar('cbc-32').sim.pedir('(&LE00148)')).toBeNull();
  });
});
