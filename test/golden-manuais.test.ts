/**
 * Golden tests: every example with bytes from the manuals (DT435 rev.10, DT214 rev.14,
 * DT432) reproduced by the simulator, per profile. Where the PDF broke the line, the
 * parts are joined with `junta`. What the simulator cannot reproduce
 * byte by byte because of the manual (serial field `$S8`, examples marked as
 * errors) is commented in the case and covered in the "manual errors" section.
 */
import { describe, expect, it } from 'vitest';
import {
  checksumH,
  derivePerfil,
  kkValido,
  obterPerfil,
  quadroH,
  type PerfilId,
} from '../src/index.js';
import { REG_A52, T0, criar, injetar, junta, kk } from './golden-util.js';

const REAIS_52: PerfilId[] = ['cbc-32', 'horustech-cbc-36', 'horustech-48', 'concept-48'];

// ───────────────────────── DT435 examples that need the correct KK ─────────────────────────
describe('DT435: todo exemplo do manual tem KK header-inclusive (53 exemplos, 52 batem)', () => {
  it.each([
    '(00038600386010003E001C0812164002068300000807890098)',
    junta('(A00038600386010003E001C08121640020683000008078900B3CF6CCFFF1FD792', '068300F3)'),
    junta('(@00038600386010003E001C08121640020683000008078900B3CF6CCFFF1FD79', '2FFFFFFFFFFFFFFFF0081)'),
    junta('(a2FFFFFFFFF00038600386010003E001C081216400220000683000008078900000', '8040303000000000000B3CF6CCFFF1FD792FFFFFFFFFFFFFFFF003E)'),
    junta('(0000073502457202993A0016041908340400030007380542000000000000000000', '00030000000000000000B6)'),
    junta('(23429602364099113A002C11261741070001000007525600B328090961C1FEE400', '01004F)'),
    junta('(00010000081012343E000204290941019140000002864100B32812345678000100', '00B3281234007C)'),
    '(TP9907000683AE)',
    '(T$080000405069)',
    '(TL080000405596)',
    '(Tl08000000405516)',
    '(TU082000100094)',
    '(Ts19063E0202D3)',
    '(KR12002180309570194)',
    '(KW12002130109000085)',
    '(&T08$06)',
    '(&T08U37)',
    '(&T19C27)',
    '(&U0400123409)',
    '(&U08000012346D)',
    '(&P08001000FF)',
    '(&M04A18)',
    '(&M99c48)',
    '(&KW120021301090000AB)',
    '(&KR1F4)',
  ])('%s', (q) => expect(kkValido(q)).toBe(true));

  it('o &LC vazio (p.11) TAMBÉM bate com o texto do PDF (uma leitura anterior dizia 52/53): 123 chars, R6 = 00FFFF', () => {
    const q = junta('(a2FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00FFFFFFFFFFFFFFFFFFFFFFFFFF', 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF013A)');
    expect(q).toHaveLength(123);
    expect(kkValido(q)).toBe(true);
  });
});

// ───────────────────────── &A, &A67, &@66 ─────────────────────────
describe('DT435 §3.1.1 (&A) 52 chars, por perfil', () => {
  const A52 = '(00038600386010003E001C0812164002068300000807890098)';

  it.each(REAIS_52)('%s devolve o exemplo byte a byte', (p) => {
    const { sim } = criar(p);
    injetar(sim, REG_A52);
    expect(sim.pedir('(&A)')).toBe(A52);
  });

  it('simulador-2.7.2 (DIP3 ligada) devolve o mesmo quadro de 52', () => {
    const { sim } = criar('simulador-2.7.2');
    sim.conc.dips[2] = true;
    injetar(sim, REG_A52);
    expect(sim.pedir('(&A)')).toBe(A52);
  });

  it('cbc05-dip3 com DIP3 ligada devolve 52', () => {
    const { sim } = criar('cbc05-dip3');
    sim.conc.dips[2] = true;
    injetar(sim, REG_A52);
    expect(sim.pedir('(&A)')).toBe(A52);
  });

  it('memória vazia: (0) em todos os perfis', () => {
    for (const p of REAIS_52) expect(criar(p).sim.pedir('(&A)')).toBe('(0)');
  });
});

describe('DT435 §3.1.2 (&A) 34 chars (DIP3 desligada / CBC01)', () => {
  // (T6 L6 P4 V2 C4 B2 DDHHMM KK): 12.34 / 2.00 / 6.170 / 3A / 0x10 s / nozzle 04 / 16 10 14
  const A34 = '(00123400020061703A001004161014E0)';
  const reg = {
    posicao: 5,
    codigoBico: 0x04,
    totalMil: 12340,
    volumeMl: 2000, // comma 3A: volume with 2 decimals → 2.00 L = 000200
    precoUnit: 6170,
    virgula: 0x3a,
    duracaoS: 0x10,
    data: { ano: 2020, mes: 10, dia: 16, hora: 10, minuto: 14, segundo: 0, diaSemana: 6 },
  } as const;

  it('o exemplo da spec C02 tem KK válido', () => expect(kkValido(A34)).toBe(true));

  it.each(['cbc01', 'cbc05-dip3'] as PerfilId[])('%s: 34 chars no formato DDHHMM', (p) => {
    const { sim } = criar(p);
    sim.conc.dips[2] = false;
    injetar(sim, reg);
    const r = sim.pedir('(&A)')!;
    expect(r).toHaveLength(34);
    expect(r).toBe(A34);
  });
});

describe('DT435 §3.1.3 (&A67) 75 chars e §3.1.4 (&@66) 87 chars', () => {
  const I1 = 'B3CF6CCFFF1FD792';
  const A67 = junta('(A00038600386010003E001C08121640020683000008078900B3CF6CCFFF1FD792', '068300F3)');
  const A66 = junta('(@00038600386010003E001C08121640020683000008078900B3CF6CCFFF1FD79', '2FFFFFFFFFFFFFFFF0081)');

  it.each(REAIS_52)('%s: &A67 byte a byte (M4 = nº da leitura de identificação = 0683)', (p) => {
    const { sim } = criar(p);
    injetar(sim, { ...REG_A52, cartao1: I1, numeroIdentificacao: 683 });
    expect(sim.pedir('(&A67)')).toBe(A67);
    expect(A67).toHaveLength(75);
  });

  it.each(REAIS_52)('%s: &@66 byte a byte (cliente ausente = 16 F)', (p) => {
    const { sim } = criar(p);
    injetar(sim, { ...REG_A52, cartao1: I1 });
    expect(sim.pedir('(&@66)')).toBe(A66);
    expect(A66).toHaveLength(87);
  });

  it('perfis sem a família CBC06 ficam em silêncio no &A67', () => {
    for (const p of ['cbc05-dip3', 'cbc01'] as PerfilId[]) {
      const { sim } = criar(p);
      injetar(sim, { ...REG_A52, cartao1: I1 });
      expect(sim.pedir('(&A67)'), p).toBeNull();
    }
  });
});

// ───────────────────────── PAF1/PAF2/A4 ─────────────────────────
describe('DT435 §3.1.5–3.1.7 (&A299 PAF1, &A39A PAF2, &A49B estendido)', () => {
  // The manual writes `$S8` as 9 F (serial not configured); the simulator emits `$`+serial
  // (11-char header with `a2`). Everything after the header is compared and the KK is recomputed.
  const corpoManual = (q: string) => q.slice(12, -3);
  const cabecalho = (q: string) => q.slice(1, 12);
  const I1 = 'B3CF6CCFFF1FD792';
  const reg = { ...REG_A52, numero: 683, cartao1: I1, numeroPista: 3, encIniMl: 804030 };

  it.each(['horustech-cbc-36', 'horustech-48', 'concept-48', 'cbc-32'] as PerfilId[])('%s: PAF1 (123)', (p) => {
    const { sim } = criar(p);
    injetar(sim, reg);
    const manual = junta('(a2FFFFFFFFF00038600386010003E001C081216400220000683000008078900000', '8040303000000000000B3CF6CCFFF1FD792FFFFFFFFFFFFFFFF003E)');
    const r = sim.pedir('(&A299)')!;
    expect(manual).toHaveLength(123);
    expect(r).toHaveLength(123);
    expect(cabecalho(r)).toBe('a2$' + obterPerfil(p).numeroSerie);
    expect(corpoManual(r)).toBe(corpoManual(manual));
    expect(kkValido(r)).toBe(true);
  });

  it.each(['horustech-cbc-36', 'horustech-48', 'concept-48'] as PerfilId[])('%s: PAF2 (127), data AAmmDDHHMMSS', (p) => {
    const { sim } = criar(p);
    injetar(sim, reg);
    const manual = junta('(a3FFFFFFFFF00038600386010003E001C082002121640100006830000080789000', '008040303000000000000B3CF6CCFFF1FD792FFFFFFFFFFFFFFFF000000)');
    const r = sim.pedir('(&A39A)')!;
    expect(manual).toHaveLength(127);
    expect(r).toHaveLength(127);
    // everything but the header and the 2 KK chars (the manual's is 00, a placeholder)
    expect(corpoManual(r)).toBe(corpoManual(manual));
    expect(kkValido(r)).toBe(true);
  });

  it.each(['horustech-cbc-36', 'horustech-48', 'concept-48'] as PerfilId[])('%s: &A4 estendido tem 148 chars (o manual diz "até 149")', (p) => {
    const { sim } = criar(p);
    injetar(sim, {
      posicao: 327,
      codigoBico: 0x4d,
      totalMil: 0,
      volumeMl: 0,
      precoUnit: 110,
      virgula: 0x2e,
      duracaoS: 0x11,
      data: { ano: 2025, mes: 6, dia: 23, hora: 1, minuto: 27, segundo: 39, diaSemana: 2 },
      encFimMl: 23930,
      encIniMl: 2002393710,
      numeroPista: 24,
      volumeTanque: 12345678,
      cartao1: 'B328000000000001',
      cartao2: 'B328000000000002',
    });
    const manual = junta(
      '(a440002224600000000000000000001102E00114D250623012739000327000000',
      '2393020023937124000012345678B328000000000001B32800000000000212345321',
      '56001017E0085)',
    );
    const r = sim.pedir('(&A49B)')!;
    expect(manual).toHaveLength(148);
    expect(r).toHaveLength(148);
    // from T8 to the tank volume, I16 and J16 (offset 11..125): checks
    expect(r.slice(12, 126)).toBe(manual.slice(12, 126));
    // a5/r5/p5 + RR + ii (K14: the record has no such fields) come out zeroed
    expect(r.slice(126, 145)).toBe('0'.repeat(19));
    expect(kkValido(r)).toBe(true);
  });
});

// ───────────────────────── &LC / &LR ─────────────────────────
describe('DT435 §3.1.8–3.1.9 (&LC/&LR) por perfil', () => {
  it.each(['cbc-32'] as PerfilId[])('%s: &LR no formato CBC06 (74)', (p) => {
    const { sim } = criar(p);
    injetar(sim, {
      posicao: 1,
      codigoBico: 0x11,
      totalMil: 2342960,
      volumeMl: 236400,
      precoUnit: 9911,
      virgula: 0x3a,
      duracaoS: 0x2c,
      data: { ano: 2020, mes: 7, dia: 26, hora: 17, minuto: 41, segundo: 0, diaSemana: 1 },
      numero: 1,
      encFimMl: 752560,
      cartao1: 'B328090961C1FEE4',
    });
    const manual = junta('(23429602364099113A002C11261741070001000007525600B328090961C1FEE400', '01004F)');
    expect(manual).toHaveLength(74);
    expect(sim.pedir('(&LR000185)')).toBe(manual);
  });

  it.each(['horustech-48', 'horustech-cbc-36', 'concept-48'] as PerfilId[])('%s: &LR no formato Horustech (82)', (p) => {
    const { sim } = criar(p);
    injetar(sim, {
      posicao: 1,
      codigoBico: 0x04,
      totalMil: 1000,
      volumeMl: 810,
      precoUnit: 1234,
      virgula: 0x3e,
      duracaoS: 2,
      data: { ano: 2020, mes: 1, dia: 29, hora: 9, minuto: 41, segundo: 0, diaSemana: 4 },
      numero: 9140,
      encFimMl: 286410,
      cartao1: 'B328123456780001',
      cartao2: 'B328123400000000',
    });
    const manual = junta('(00010000081012343E000204290941019140000002864100B32812345678000100', '00B3281234007C)');
    expect(manual).toHaveLength(82);
    expect(sim.pedir('(&LR000185)')).toBe(manual);
  });

  it('cbc-32: &LC no formato CBC (90)', () => {
    const { sim } = criar('cbc-32');
    injetar(sim, {
      posicao: 3,
      codigoBico: 0x04,
      totalMil: 7350,
      volumeMl: 245720,
      precoUnit: 299,
      virgula: 0x3a,
      duracaoS: 0x16,
      data: { ano: 2020, mes: 4, dia: 19, hora: 8, minuto: 34, segundo: 0, diaSemana: 1 },
      numero: 3,
      encFimMl: 73805420,
      cartao1: '0'.repeat(16),
      cartao2: '0'.repeat(16),
    });
    const manual = junta('(0000073502457202993A0016041908340400030007380542000000000000000000', '00030000000000000000B6)');
    expect(manual).toHaveLength(90);
    expect(sim.pedir('(&LC000378)')).toBe(manual);
  });

  it.each(['horustech-48', 'horustech-cbc-36'] as PerfilId[])('%s: &LC no formato PAF1 a2… (123)', (p) => {
    const { sim } = criar(p);
    injetar(sim, {
      posicao: 3,
      codigoBico: 0x05,
      totalMil: 15060,
      volumeMl: 313,
      precoUnit: 8136,
      virgula: 0x3e,
      duracaoS: 0x1e,
      data: { ano: 2022, mes: 4, dia: 17, hora: 20, minuto: 14, segundo: 0, diaSemana: 1 },
      numero: 1,
      encFimMl: 579004180,
      encIniMl: 579003870,
      numeroPista: 2,
      cartao1: '0'.repeat(16),
      cartao2: '0'.repeat(16),
    });
    const manual = junta(
      '(a240002224600150600031381363E001E051720140422000001005790041800579',
      '0038702000000000000000000000000000000000000000000000052)',
    );
    const r = sim.pedir('(&LC000378)')!;
    expect(manual).toHaveLength(123);
    expect(r).toHaveLength(123);
    expect(r.slice(12, -3)).toBe(manual.slice(12, -3));
    expect(kkValido(r)).toBe(true);
  });

  it('horustech-48: &LR vazio = quadro de F do tamanho do layout (exemplo do manual, KK 29)', () => {
    const { sim } = criar('horustech-48');
    const manual = junta('(FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', 'FFF0129)');
    expect(manual).toHaveLength(82);
    expect(sim.pedir(kk('&LR1000'))).toBe(manual);
    expect(kkValido(manual)).toBe(true);
  });
});

// ───────────────────────── pointers, &V, &I ─────────────────────────
describe('DT435 §3.1.10–3.2.1 (&T99P, &V, &I)', () => {
  it.each(['cbc-32', 'horustech-48', 'horustech-cbc-36', 'concept-48'] as PerfilId[])('%s: (&T99P3C) → (TP9907000683AE)', (p) => {
    const { sim } = criar(p);
    injetar(sim, { posicao: 699, codigoBico: 0x04 }); // write = 700
    sim.conc.buffer.definirLeitura('tcp:2001', 683);
    expect(sim.pedir('(&T99P3C)')).toBe('(TP9907000683AE)');
  });

  it('o &T99P é por porta: a 1771 mantém o seu ponteiro', () => {
    const { sim } = criar('cbc-32');
    injetar(sim, { posicao: 699, codigoBico: 0x04 });
    sim.conc.buffer.definirLeitura('tcp:2001', 683);
    expect(sim.pedir('(&T99P3C)', 'tcp:1771')).toBe(kk('TP9907000000'));
  });

  it('(&I) não retorna nada', () => {
    const { sim } = criar('cbc-32');
    injetar(sim, REG_A52);
    expect(sim.pedir('(&I)')).toBeNull();
    expect(sim.pedir('(&A)')).toBe('(0)');
  });

  it('(&V) com o bico 04 abastecendo → (04000120)', () => {
    const { sim, clock } = criar('cbc-32');
    sim.conc.retirarBico(0x04);
    clock.advance(1000);
    sim.atualizar();
    expect(sim.conc.bico(0x04)?.status).toBe('A');
    sim.conc.bico(0x04)!.corrente!.volumeMl = 1200;
    expect(sim.pedir('(&V)')).toBe('(04000120)');
  });

  it('(&V) ocioso → (0)', () => expect(criar('cbc-32').sim.pedir('(&V)')).toBe('(0)'));
});

// ───────────────────────── &S ─────────────────────────
describe('DT435 §3.4 (&S) por forma', () => {
  it('CBC (32 + FF + DD + 6V8.4M1.0G84): exemplo byte a byte', () => {
    const perfil = derivePerfil('cbc-32', { status: { formato: 'cbc32', tipoCbc: '6', dips: 'FF' } });
    const { sim } = criar(perfil, T0, false);
    sim.conc.bateriaCv = 1294;
    sim.conc.configurarEndereco({ canal: 1, endereco: 1, nBicos: 2, tipoBomba: 'W', virgula: 0x3a });
    sim.conc.configurarEndereco({ canal: 1, endereco: 2, nBicos: 2, tipoBomba: 'W', virgula: 0x3a });
    sim.pedir(kk('&M04B'));
    sim.pedir(kk('&M05B'));
    const manual = '(SBBFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF6V8.4M1.0G84)';
    expect(sim.pedir('(&S)')).toBe(manual);
  });

  it('Horustech em protocolo CBC (9 canais, 36): mesmo exemplo do manual', () => {
    const { sim } = criar('horustech-cbc-36', T0, false);
    sim.conc.bateriaCv = 1294;
    sim.conc.configurarEndereco({ canal: 1, endereco: 1, nBicos: 2, tipoBomba: 'W', virgula: 0x3a });
    sim.conc.configurarEndereco({ canal: 1, endereco: 2, nBicos: 2, tipoBomba: 'W', virgula: 0x3a });
    sim.pedir(kk('&M04B'));
    sim.pedir(kk('&M05B'));
    expect(sim.pedir('(&S)')).toBe('(SBBFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF6V8.4M1.0G84)');
  });

  it.each(['horustech-48', 'concept-48'] as PerfilId[])('%s: 48 posições sem trailer (SBBFFABFFLLFF…)', (p) => {
    const { sim, clock } = criar(p, T0, false);
    const cfg = (canal: number, endereco: number) => sim.conc.configurarEndereco({ canal, endereco, nBicos: 2, tipoBomba: 'W', virgula: 0x3a });
    cfg(1, 1);
    cfg(1, 2);
    cfg(2, 1);
    cfg(2, 2);
    cfg(3, 1);
    cfg(3, 2);
    sim.pedir(kk('&M04B'));
    sim.pedir(kk('&M05B'));
    sim.pedir(kk('&M09B'));
    sim.conc.retirarBico(0x08); // channel 2 address 1
    clock.advance(1000);
    sim.atualizar();
    const manual = '(SBBFFABFFLLFF' + 'F'.repeat(36) + ')';
    expect(manual).toHaveLength(2 + 48 + 1);
    expect(sim.pedir('(&S)')).toBe(manual);
  });
});

// ───────────────────────── &T, &U, &P, &M ─────────────────────────
describe('DT435 §3.5 gerenciamento de bomba, por perfil', () => {
  const REAIS = ['cbc-32', 'horustech-48', 'horustech-cbc-36', 'concept-48'] as PerfilId[];

  it.each(REAIS)('%s: totalizadores $, L, l do bico 08 (exemplos do manual)', (p) => {
    const { sim } = criar(p);
    const b = sim.conc.bico(0x08)!;
    b.encerranteValorMil = 405_50 * 10 - 0; // 00004050 → 40500 in hundredths of a real
    b.encerranteValorMil = 40500;
    b.encerranteMl = 40550;
    expect(sim.pedir('(&T08$06)')).toBe('(T$080000405069)');
    expect(sim.pedir('(&T08L2E)')).toBe('(TL080000405596)');
    expect(sim.pedir('(&T08l4E)')).toBe('(Tl08000000405516)');
  });

  it.each(REAIS)('%s: &T U devolve nível 1 e nível 0 → (TU082000100094)', (p) => {
    const { sim } = criar(p);
    const b = sim.conc.bico(0x08)!;
    b.precosPendentes = [null, null, null];
    b.precos = [1000, 2000, 0];
    expect(sim.pedir('(&T08U37)')).toBe('(TU082000100094)');
  });

  it.each(REAIS)('%s: &T C do bico 19 → (Ts19063E0202D3) (canal 6, vírgula 3E, endereço 2, 2 posições)', (p) => {
    const { sim } = criar(p);
    sim.conc.configurarEndereco({ canal: 6, endereco: 2, nBicos: 2, tipoBomba: 'W', virgula: 0x3e });
    expect(sim.pedir('(&T19C27)')).toBe('(Ts19063E0202D3)');
  });

  it.each(REAIS)('%s: &U 4 e 6 dígitos respondem (UBB) (exemplos U04 e U08)', (p) => {
    const { sim } = criar(p);
    expect(sim.pedir('(&U0400123409)')).toBe('(U04)');
    expect(sim.pedir('(&U08000012346D)')).toBe('(U08)');
  });

  it.each(REAIS)('%s: &P preset → (P08); &M04A → (M04)', (p) => {
    const { sim } = criar(p);
    expect(sim.pedir('(&P08001000FF)')).toBe('(P08)');
    expect(sim.pedir('(&M04A18)')).toBe('(M04)');
  });

  it('&T u (3 níveis) responde com header TU, não Tu (C14 do manual)', () => {
    const { sim } = criar('cbc-32');
    const b = sim.conc.bico(0x08)!;
    b.precosPendentes = [null, null, null];
    b.precos = [1000, 2000, 3000];
    const r = sim.pedir(kk('&T08u'))!;
    expect(r.startsWith('(TU08')).toBe(true);
    expect(r.slice(5, 17)).toBe('200010003000'); // level 1, level 0, level 2
    expect(kkValido(r)).toBe(true);
  });

  it.each(['cbc-32', 'horustech-48', 'horustech-cbc-36', 'concept-48'] as PerfilId[])(
    '%s: &M99 b e l respondem (M99) (exemplos do manual p.21, C1)',
    (p) => {
      const { sim } = criar(p);
      expect(sim.pedir('(&M99bB32800000000000167)')).toBe('(M99)');
      expect(sim.pedir('(&M99lB32800000000000171)')).toBe('(M99)');
    },
  );

  // D1 (fixed in review R1, DECISIONS §7): the manual (p.20-21) clears the list with just `(&M99c48)`
  // ("neste parâmetro não é necessário colocar código do identificador") and the example replies (M99).
  // Before, the short form fell into &M of nozzle 99 and the simulator replied (M?b) on real profiles.
  it.each(['cbc-32', 'horustech-48', 'horustech-cbc-36', 'concept-48'] as PerfilId[])(
    '%s: D1 — (&M99c48) limpa a lista negra e responde (M99)',
    (p) => {
      expect(criar(p).sim.pedir('(&M99c48)')).toBe('(M99)');
    },
  );
});

// ───────────────────────── clock ─────────────────────────
describe('DT435 §3.6 relógio', () => {
  it('(&R) → (REL 09:49:06 18/02/20)', () => {
    const { sim } = criar('cbc-32', Date.UTC(2020, 1, 18, 9, 49, 6));
    expect(sim.pedir('(&R)')).toBe('(REL 09:49:06 18/02/20)');
  });

  it('(&KR1F4) → (KR12002180309570194) (terça = 03)', () => {
    const { sim } = criar('cbc-32', Date.UTC(2020, 1, 18, 9, 57, 1));
    expect(sim.pedir('(&KR1F4)')).toBe('(KR12002180309570194)');
  });

  it('(&H150956) → (&H) e o relógio passa a 15 09:56', () => {
    const { sim } = criar('cbc-32', Date.UTC(2020, 1, 18, 9, 57, 1));
    expect(sim.pedir('(&H150956)')).toBe('(&H)');
    expect(sim.pedir('(&R)')).toMatch(/^\(REL 09:56:\d\d 15\/02\/20\)$/);
  });

  it('(&KW1…AB) aceito → eco dos parâmetros; o relógio muda', () => {
    const { sim } = criar('cbc-32', Date.UTC(2020, 1, 18, 9, 57, 1));
    expect(sim.pedir('(&KW120021301090000AB)')).toBe('(KW12002130109000085)');
    expect(sim.pedir('(&R)')).toBe('(REL 09:00:00 13/02/20)');
  });

  it('(&KW1…) com mês 13 → devolve o calendário atual (DT435 p.34)', () => {
    const { sim } = criar('cbc-32', Date.UTC(2020, 1, 18, 9, 57, 1));
    expect(sim.pedir(kk('&KW1' + '20' + '13' + '13' + '01' + '09' + '00' + '00'))).toBe(kk('KW1' + '20021803095701'));
  });

  it('o 2.7.2 manda os extras depois do (REL …) (R_EXTRAS)', () => {
    const { sim } = criar('simulador-2.7.2', Date.UTC(2020, 1, 18, 9, 49, 6));
    const r = sim.pedir('(&R)')!;
    expect(r.startsWith('(REL 09:49:06 18/02/20)')).toBe(true);
    expect(r.length).toBeGreaterThan('(REL 09:49:06 18/02/20)'.length);
  });
});

// ───────────────────────── Identfid ─────────────────────────
describe('DT435 §3.3 Identfid (exemplos com bytes)', () => {
  it('(?V95) → (04B328000000000001) nos perfis reais (sem KK, p.15)', () => {
    const { sim, clock } = criar('cbc-32');
    sim.pedir(kk('?F27GB3280000000000010000000000000000'));
    sim.pedir(kk('&M04H'));
    sim.conc.retirarBico(0x04);
    clock.advance(1000);
    sim.atualizar();
    sim.conc.apresentarCartao(1, 1, 'B328000000000001');
    clock.advance(1000);
    sim.atualizar();
    clock.advance(3000);
    sim.atualizar();
    expect(sim.conc.bico(0x04)?.status).toBe('A');
    expect(sim.pedir('(?V95)')).toBe('(04B328000000000001)');
  });

  it('(?A80) → (AB3CF6CCFFF1F51E6051713450200000041): bico 05, 17/02 13:45', () => {
    const { sim } = criar('cbc-32', Date.UTC(2020, 1, 17, 13, 45, 0));
    sim.pedir(kk('&M05H'));
    sim.conc.retirarBico(0x05);
    sim.conc.apresentarCartao(1, 2, 'B3CF6CCFFF1F51E6');
    expect(sim.pedir('(?A80)')).toBe('(AB3CF6CCFFF1F51E6051713450200000041)');
  });

  it('(?I88) não responde; (?F08P…) responde (F08)', () => {
    const { sim } = criar('cbc-32');
    expect(sim.pedir('(?I88)')).toBeNull();
    expect(sim.pedir('(?F08PB3280000000000010S00100030$0000078)')).toBe('(F08)');
  });
});

// ───────────────────────── DT214 (native Horustech: 02, 06, 32) ─────────────────────────
describe('DT214 §3.1.1, §3.1.5, §3.5.3: as 3 funções nativas, por perfil', () => {
  const HORUS: PerfilId[] = ['horustech-cbc-36', 'horustech-48', 'concept-48'];
  const RX02 = junta('>!006B020006840300000001060010601000233000712022016400000080789000', '0080895B3CF6CCFFF1FD792FFFFFFFFFFFFFFFF00000000D7');

  it('os exemplos do manual têm o KK do DT214 (soma sem o `>`)', () => {
    for (const q of ['>?00020263', RX02, '>!00020245', '>?00020667', '>!000E06000179000181B7', '>!000E06000181000181B0', '>?000B320200011112C', '>!00043200AA'])
      expect(checksumH(q.slice(1, -2)), q).toBe(q.slice(-2));
  });

  it.each(HORUS)('%s: 02 devolve o exemplo de 107 chars (N 000684, bico 03, 2,2,3 casas)', (p) => {
    const { sim } = criar(p);
    injetar(sim, {
      posicao: 684,
      codigoBico: 0x08,
      totalMil: 1060,
      volumeMl: 1060,
      precoUnit: 1000,
      virgula: 0x3e,
      duracaoS: 7,
      data: { ano: 2020, mes: 2, dia: 12, hora: 16, minuto: 40, segundo: 0, diaSemana: 4 },
      encIniMl: 807890,
      encFimMl: 808950,
      numeroPista: 3,
      cartao1: 'B3CF6CCFFF1FD792',
    });
    expect(RX02).toHaveLength(8 + 107);
    expect(sim.pedir('>?00020263')).toBe(RX02);
  });

  it.each(HORUS)('%s: 02 sem abastecimento → >!00020245', (p) => {
    expect(criar(p).sim.pedir('>?00020263')).toBe('>!00020245');
  });

  it.each(HORUS)('%s: 06 devolve leitura/escrita e só avança quando há o que ler', (p) => {
    const { sim } = criar(p);
    injetar(sim, { posicao: 180, codigoBico: 0x04 }); // write 181
    sim.conc.buffer.definirLeitura('tcp:2001', 179);
    expect(sim.pedir('>?00020667')).toBe('>!000E06000180000181A1'.slice(0, 6) + '06000180000181' + checksumH('!000E06000180000181'));
    expect(sim.pedir('>?00020667')).toBe(quadroH('06000181000181'));
    expect(sim.pedir('>?00020667')).toBe('>!000E06000181000181B0');
  });

  it.each(HORUS)('%s: 32 do exemplo (bico 02, nível 0, 001111) → ack >!00043200AA', (p) => {
    const { sim } = criar(p);
    expect(sim.pedir('>?000B320200011112C')).toBe('>!00043200AA');
    expect(sim.conc.bicoPorNumero(2)?.precosPendentes[0]).toBe(1111);
  });

  it.each(['cbc-32', 'cbc05-dip3', 'cbc01'] as PerfilId[])('%s não fala Horustech nativo', (p) => {
    expect(criar(p).sim.pedir('>?00020263')).toBeNull();
    expect(criar(p).sim.pedir('>?000B320200011112C')).toBeNull();
  });

  it('simulador-2.7.2 responde as 3 funções (col10 no 02)', () => {
    const { sim } = criar('simulador-2.7.2');
    expect(sim.pedir('>?00020263')).toBe('>!00020245');
    expect(sim.pedir('>?000B320200011112C')).toBe('>!00043200AA');
    expect(sim.pedir('>?00020667')).toBe(quadroH('06000001000001').replace('000001000001', '000001000001'));
  });
});

// ───────────────────────── manual errors: the decided behavior ─────────────────────────
describe('Erros do manual: o que docs/DECISIONS.md decidiu', () => {
  it('C1: &U responde (UBB), não (MBB) (decisão §3.4); o ack dá para trocar por perfil', () => {
    expect(criar('cbc-32').sim.pedir('(&U0400123409)')).toBe('(U04)');
    const m = derivePerfil('cbc-32', { ackPreco: 'M' });
    expect(criar(m).sim.pedir('(&U0400123409)')).toBe('(M04)');
  });

  it('C1: &M99 responde (M99), não (MBB) (forma longa; a curta `(&M99c48)` é o D1 acima)', () => {
    expect(criar('cbc-32').sim.pedir('(&M99bB32800000000000167)')).toBe('(M99)');
  });

  it('C6 (decisão §3.8): &LC vazio nos reais tem 123 chars com a2, F e `01` antes do KK, KK válido', () => {
    const r = criar('horustech-48').sim.pedir(kk('&LC5000'))!;
    expect(r).toHaveLength(123);
    expect(r.startsWith('(a2F')).toBe(true);
    expect(r.slice(-5, -3)).toBe('01');
    expect(kkValido(r)).toBe(true);
  });

  // D2 (fixed in review R2, DECISIONS §7): the manual's example (p.11) for a position with no fueling has a valid KK
  // and has `00` at the start of R6 (offset 45); §3.8 produced pure F at that point.
  it('D2 — &LC vazio reproduz o exemplo do manual byte a byte (R6 = 00FFFF, KK 3A)', () => {
    const manual = junta('(a2FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00FFFFFFFFFFFFFFFFFFFFFFFFFF', 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF013A)');
    expect(criar('horustech-48').sim.pedir('(&LC50007A)')).toBe(manual);
  });

  it('C7: &A4 tem 148 chars (manual "até 149")', () => {
    const { sim } = criar('horustech-48');
    injetar(sim, REG_A52);
    expect(sim.pedir('(&A49B)')).toHaveLength(148);
  });

  it('C9: ?F preset identificado aceita o R de 5 zeros do exemplo (KK 78 confere com 5)', () => {
    const q = '(?F08PB3280000000000010S00100030$0000078)';
    expect(kkValido(q)).toBe(true);
    expect(criar('cbc-32').sim.pedir(q)).toBe('(F08)');
    // with 6 zeros (DT432 p.18) the frame has 42 chars: the decision (spec I08) is R5, so it stays silent
    expect(criar('cbc-32').sim.pedir(kk('?F08PB3280000000000010S00100030$000000'))).toBeNull();
  });

  it('C12: &A de 34 chars vale com DIP3 DESLIGADA (o manual diz ligada nos dois)', () => {
    const { sim } = criar('cbc05-dip3');
    sim.conc.dips[2] = false;
    injetar(sim, REG_A52);
    expect(sim.pedir('(&A)')).toHaveLength(34);
    sim.conc.dips[2] = true;
    expect(sim.pedir('(&A)')).toHaveLength(52);
  });

  it('C14: o modo u responde TU (já coberto acima) e o 2.7.2 trata &T modo desconhecido como TG', () => {
    expect(criar('simulador-2.7.2').sim.pedir(kk('&T08X'))).toMatch(/^\(TG08/);
  });

  it('C4: horustech-cbc-36 = 9 canais, 36 posições (DT435 p.22), não 8 canais (DT277)', () => {
    const r = criar('horustech-cbc-36').sim.pedir('(&S)')!;
    expect(r.length).toBe(1 + 1 + 36 + 12 + 1 + 0 + 0 - 0);
  });
});

// ───────────────────────── simulador-2.7.2 and cbc01 on the same examples ─────────────────────────
describe('simulador-2.7.2: os exemplos do manual com os quirks da equivalência comportamental', () => {
  const I1 = 'B3CF6CCFFF1FD792';

  it('&A com DIP3 desligada = 36 chars (A36: T L P V C B DDHHMMNN)', () => {
    const { sim } = criar('simulador-2.7.2');
    sim.conc.dips[2] = false;
    injetar(sim, { ...REG_A52, virgula: 0x3a, volumeMl: 2000 });
    const r = sim.pedir('(&A)')!;
    expect(r).toHaveLength(36);
    expect(r.slice(23, 33)).toBe('08' + '12164002'); // B2 + dd hh mm MM (behavioral equivalence)
    expect(kkValido(r)).toBe(true);
  });

  it('&A67: cartão ausente sai 16 zeros, M4 repete o R (A67_M_IGUAL_R)', () => {
    const { sim } = criar('simulador-2.7.2');
    sim.conc.dips[2] = true;
    injetar(sim, { ...REG_A52, numeroIdentificacao: 9 });
    const r = sim.pedir('(&A67)')!;
    expect(r).toHaveLength(75);
    expect(r.slice(50, 66)).toBe('0'.repeat(16));
    expect(r.slice(66, 70)).toBe('0683');
  });

  it('PAF1 e PAF2 trazem G99999999 no lugar de $+série (PAF_G9)', () => {
    const { sim } = criar('simulador-2.7.2');
    injetar(sim, { ...REG_A52, cartao1: I1 });
    expect(sim.pedir('(&A299)')!.slice(1, 12)).toBe('a2G99999999');
    expect(sim.pedir('(&A39A)')!.slice(1, 12)).toBe('a3G99999999');
  });

  it('&LR com o combo CBC-06 = layout de 74 do manual; com Horustech = 82', () => {
    const { sim } = criar('simulador-2.7.2');
    sim.conc.setModelo('CBC-06');
    injetar(sim, { posicao: 1, codigoBico: 0x04, numero: 1, cartao1: I1 });
    expect(sim.pedir('(&LR000185)')).toHaveLength(74);
    sim.conc.setModelo('Horustech');
    expect(sim.pedir('(&LR000185)')).toHaveLength(82);
  });

  it('&LR/&LC numa posição vazia ficam em silêncio (L_VAZIO_SILENCIO); os reais devolvem os F do manual', () => {
    expect(criar('simulador-2.7.2').sim.pedir('(&LR100085)')).toBeNull();
    expect(criar('horustech-48').sim.pedir('(&LR100085)')).toHaveLength(82);
  });

  it('exemplos de relógio, preço e modo valem igual no 2.7.2', () => {
    const { sim } = criar('simulador-2.7.2', Date.UTC(2020, 1, 18, 9, 57, 1));
    // DIFF-12 (bench 17/10): the 2.7.2 RTC does not compute the weekday; it starts at 00 (RTC_272).
    expect(sim.pedir('(&KR1F4)')).toBe(kk('KR1' + '200218' + '00' + '095701'));
    expect(sim.pedir('(&U0400123409)')).toBe('(U04)');
    expect(sim.pedir('(&P08001000FF)')).toBe('(P08)');
    expect(sim.pedir('(&M04A18)')).toBe('(M04)');
  });

  it('(&M99c48) limpa a lista e responde (M99) no 2.7.2 (equivalência comportamental; a bancada 17/10 só testou a forma longa)', () => {
    const { sim } = criar('simulador-2.7.2');
    sim.conc.listaNegraOp('b', '0000000000000001');
    expect(sim.pedir('(&M99c48)')).toBe('(M99)');
    expect(sim.conc.listaNegra).toEqual([]);
  });
});

describe('cbc01 segue o DT435 (decisão §3.1): T, U, P, M, R existem; &S não', () => {
  it('exemplos de totalizador, preço, preset, modo e relógio', () => {
    const { sim } = criar('cbc01', Date.UTC(2020, 1, 18, 9, 49, 6));
    const b = sim.conc.bico(0x08)!;
    b.encerranteMl = 40550;
    expect(sim.pedir('(&T08L2E)')).toBe('(TL080000405596)');
    expect(sim.pedir('(&U0400123409)')).toBe('(U04)');
    expect(sim.pedir('(&P08001000FF)')).toBe('(P08)');
    expect(sim.pedir('(&M04A18)')).toBe('(M04)');
    expect(sim.pedir('(&R)')).toBe('(REL 09:49:06 18/02/20)');
    expect(sim.pedir('(&S)')).toBeNull();
  });

  it('cbc01 não responde &A67, &T99P nem Identfid', () => {
    const { sim } = criar('cbc01');
    for (const q of ['(&A67)', '(&T99P3C)', '(?V95)', '(&A299)']) expect(sim.pedir(q), q).toBeNull();
  });
});
