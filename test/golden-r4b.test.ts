/**
 * Goldens of the (a) fixes of the diff r4b triage (DECISIONS §18 and §20).
 * Every expected value is a frame measured on the real SimuladorCBC 2.7.2 (side A of
 * bench capture, 2026-10-17), copied byte for byte. Fields the clock writes (duration C4,
 * hh:mm, the KK that covers them) and the dynamic battery byte of `&S` are masked, like the
 * script does. Each block also pins the mirror on `cbc-32` (a real profile, which must not move).
 */
import { describe, expect, it } from 'vitest';
import { kk, novo, passo, abastecer } from './util.js';

/** Replaces the char ranges `[from, to)` (and the KK, when `kkFim`) by `x`. */
function mascara(r: string | null, faixas: readonly (readonly [number, number])[], kkFim = true): string {
  const s = (r ?? '').split('');
  for (const [a, b] of faixas) for (let i = a; i < b && i < s.length; i++) s[i] = 'x';
  if (kkFim) for (let i = s.length - 3; i < s.length - 1; i++) s[i] = 'x';
  return s.join('');
}
/** `&S` without the voltage byte (`G81`, dynamic on the 2.7.2). */
const semTensao = (r: string | null) => (r ?? '').slice(0, -3) + ')';
/** The clock fields of an `&A`/`&LR` reply: duration C4 and hh:mm. */
const RELOGIO_A = [[19, 23], [27, 31]] as const;

/** `(&S)` reply: first group `g` (2 letters), the 7 other groups at rest. */
const S_A = (g: string) => `(S${g}FF${'LLFF'.repeat(7)}FFDD6V3.7M1.0G00)`;

describe('F1 PADRAO_272: "Carregar configuração padrão" reinicia os bicos ativos (bancada r4b)', () => {
  it('DIFF-05 passo 0/2/4: L logo após o clique, P no tick seguinte, e o endereço 3 entra e sai', () => {
    const { sim, clock } = novo();
    expect(sim.pedir('(&P05000500030)')).toBe('(P05)');
    passo(sim, clock, 1000);
    sim.conc.carregarConfigPadrao();
    // A step 0: `(SLLFF…)` — the pre-authorized 05 shows L until the state timer runs again.
    expect(semTensao(sim.pedir('(&S)'))).toBe(semTensao(S_A('LL')));
    passo(sim, clock, 1000);
    // A step 2: after `(&CW013A030200BA)` address 3 is L and address 2 is P.
    expect(sim.pedir('(&CW013A030200BA)')).toBeNull();
    expect(semTensao(sim.pedir('(&S)'))).toBe(semTensao(`(SLPLF${'LLFF'.repeat(6)}LLFFFFDD6V3.7M1.0G00)`));
    // A step 4: `(&CW013A030000B8)` takes address 3 away again.
    expect(sim.pedir('(&CW013A030000B8)')).toBeNull();
    expect(semTensao(sim.pedir('(&S)'))).toBe(semTensao(S_A('LP')));
  });

  it('DIFF-10: o preço do &U se perde — TU nível 1 e nível 0 voltam ao 11,23 inicial', () => {
    const { sim } = novo();
    expect(sim.pedir('(&U08000012346D)')).toBe('(U08)');
    sim.conc.carregarConfigPadrao();
    expect(sim.pedir('(&T08u57)')).toBe('(TU0800001123000058)');
    expect(sim.pedir('(&T08U37)')).toBe('(TU080000112398)');
  });

  it('DIFF-07/EQUIV-LEITURA: o registro seguinte sai com o preço 11,23 e vírgula 3A, não o do &U', () => {
    const { sim, clock } = novo();
    sim.pedir('(&U08000012346D)');
    sim.pedir(kk('&U04001234'));
    sim.conc.carregarConfigPadrao();
    abastecer(sim, clock, 0x04, 3000);
    // A (&A): `(00013100011711233A00060417…` → T6 V6 P4 V2.
    expect(sim.pedir('(&A)')!.slice(13, 19)).toBe('11233A');
    expect(sim.pedir('(&LR000185)')!.slice(13, 19)).toBe('11233A');
  });

  // OPEN FINDING (reported, not fixed: tests only). The bench A shows a record stored AFTER the last
  // click (TG99 0001/0000: write pointer reset by "Carregar configuração padrão", then +1). pump-sim drops the record of a
  // nozzle that is still "Concluindo.." at the click (`corrente = null`, "B, not measured" in
  // §18), so it answers 0000/0000 in every ordering. `it.fails` flips to red the day it is fixed
  // (or the A timing is shown to be different) — then turn it into a plain `it`.
  it.fails('EQUIV-LEITURA #2/#4/#17: ponteiros do TG com o registro gravado depois do clique — 0001/0000, o &I partido avança, o 04 vê 0001/0001', () => {
    const { sim, clock } = novo();
    // The case's last action clicks the button while the fueling is still "Concluindo..": the
    // record is stored after the click (write pointer back at the 1st position, then +1).
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 3000);
    sim.conc.recolocarBico(0x04);
    sim.conc.carregarConfigPadrao();
    passo(sim, clock, 2000);
    expect(sim.pedir('(&T99P3C)')).toBe('(TG99000100008E)');
    expect(sim.pedir('(&I')).toBeNull();
    expect(sim.pedir('(&T99P3C)')).toBe('(TG99000100018F)');
    expect(sim.pedir('(&T04DE)')).toBe('(TG040001000181)');
  });

  it('espelho cbc-32: o botão não mexe nos bicos ativos — o TU antes e depois do clique é o mesmo (12,34 segue)', () => {
    const { sim } = novo('cbc-32');
    expect(sim.pedir('(&U08000012346D)')).toBe('(U08)');
    const antes = ['(&T08U37)', '(&T08u57)'].map((q) => sim.pedir(q));
    expect(antes[0]).toContain('1234');
    sim.conc.carregarConfigPadrao();
    expect(['(&T08U37)', '(&T08u57)'].map((q) => sim.pedir(q))).toEqual(antes);
  });
});

describe('F2 C_272: o &c entra no PAF como 113322 (EQUIV-COMANDOS #44)', () => {
  const A34 =
    '(a2G9999999900000000000011233A002C041710421026000001000012340000003725801133220000000000000000000000000000000000000000005E)';
  it('(&c00411223349) → o PAF1 traz 113322 na mesma posição da bancada', () => {
    const { sim, clock } = novo();
    sim.pedir('(&CW013A010200B8)');
    sim.pedir('(&c00411223349)');
    abastecer(sim, clock, 0x04, 3000);
    const r = sim.pedir('(&A299)')!;
    expect(r).toHaveLength(A34.length);
    expect(r.indexOf('113322')).toBe(A34.indexOf('113322'));
    // price 11,23 and comma 3A right before the duration, like the bench frame
    expect(r.slice(11 + 13, 11 + 19)).toBe(A34.slice(11 + 13, 11 + 19));
  });
  it('espelho cbc-32: o &c não vira 113322 no PAF de um perfil real', () => {
    const { sim, clock } = novo('cbc-32');
    sim.pedir('(&c00411223349)');
    abastecer(sim, clock, 0x04, 3000);
    expect(sim.pedir('(&A299)')).not.toContain('113322');
  });
});

describe('F3 A36: o layout do &A é o da DIP3 na gravação (DIFF-07 passo 6)', () => {
  it('2.7.2: gravado com a DIP3 ligada, o (&A) segue com os 52 chars do frame da bancada', () => {
    const { sim, clock } = novo();
    abastecer(sim, clock, 0x04, 3000);
    sim.conc.dips[2] = false;
    sim.conc.dips[2] = true;
    const r = sim.pedir('(&A)')!;
    expect(r).toHaveLength(52);
    // A: `(00013100011711233A00060417103810000400003721250060)`
    expect(r.slice(13, 19)).toBe('11233A');
    expect(r.slice(23, 25)).toBe('04');
  });
  it('2.7.2: desligar a DIP3 depois da gravação não muda o layout já gravado', () => {
    const { sim, clock } = novo();
    abastecer(sim, clock, 0x04, 3000);
    sim.conc.dips[2] = false;
    expect(sim.pedir('(&A)')).toHaveLength(52);
  });
  it('espelho cbc05-dip3: continua pela DIP3 da leitura (34)', () => {
    const { sim, clock } = novo('cbc05-dip3');
    sim.conc.dips[2] = true;
    abastecer(sim, clock, 0x04, 3000);
    sim.conc.dips[2] = false;
    expect(sim.pedir('(&A)')).toHaveLength(34);
  });
});

describe('F4 IDF_272: M6 do ?F G = cadastro antes da gravação (frames da bancada)', () => {
  it('DIFF-14 passos 0, 1, 2, 5: 0/0, depois do ?F A e do ?F00L o 1122… volta a 0/0', () => {
    const { sim } = novo();
    expect(sim.pedir('(?F27GABCDEF01234567890000235900002359FD)')).toBe('(FG000000000000ABCDEF0123456789000023590000235927FE)');
    expect(sim.pedir('(?LF000000F1)')).toBe('(LF000000000001ABCDEF012345678900002359000023592704)');
    expect(sim.pedir('(?F00AABCDEF01234567890000000000000000C8)')).toBe('(FA000000000000000000000000000000000000000000000027)');
    expect(sim.pedir('(?F00L0000000000000000000000000000000031)')).toBeNull();
    expect(sim.pedir('(?F27G11223344556677880000235900002359A3)')).toBe('(FG0000000000001122334455667788000023590000235927A4)');
  });
  it('DIFF-15 passos 3 e 4: com um cartão no cadastro, 1/1 e depois 2/2', () => {
    const { sim } = novo();
    sim.pedir('(?F27G11223344556677880000235900002359A3)');
    expect(sim.pedir('(?F27G0000000000000027000000010000000140)')).toBe('(FG000001000001000000000000002700000001000000012743)');
    expect(sim.pedir('(?F67G0000000000000067000000010000000148)')).toBe('(FG00000200000200000000000000670000000100000001674D)');
  });
  it('EQUIV-COMANDOS passo 14: com 3 cartões no cadastro, 3/3', () => {
    const { sim } = novo();
    for (const c of ['11', '22', '33']) sim.pedir(kk(`?F27G${c}00000000000000${'0'.repeat(16)}`));
    expect(sim.pedir('(?F01G1234567890ABCDEF0000000000000000CF)')).toBe('(FG0000030000031234567890ABCDEF000000000000000001D6)');
  });
  it('espelho cbc-32: M6 = quantidade depois (DT435)', () => {
    const { sim } = novo('cbc-32');
    expect(sim.pedir('(?F27GABCDEF01234567890000235900002359FD)')).toBe('(FG000000000001ABCDEF0123456789000023590000235927FF)');
    expect(sim.pedir('(?F27G11223344556677880000235900002359A3)')).toBe('(FG0000010000021122334455667788000023590000235927A7)');
  });
});

describe('F5 L_272: célula do &LE sem evento é 00000000', () => {
  it('(&LE00C5A) → 32 zeros (EQUIV-LEITURA #23, coluna 2, linhas 13-16)', () => {
    const { sim } = novo();
    expect(sim.pedir('(&LE00C5A)')).toBe('(00000000000000000000000000000000)');
  });
  it('espelho cbc-32: perfil real sem o &LE do 2.7.2 segue mudo', () => {
    const { sim } = novo('cbc-32');
    expect(sim.pedir('(&LE00C5A)')).toBeNull();
  });
});

describe('F6 E_272: o registro do &E traz o encerrante antigo, o preço configurado e a duração', () => {
  it('EQUIV-COMANDOS #35-#37: ack, TL em litros inteiros e o registro R0001 (duração, dia e hora mascarados)', () => {
    const { sim, clock } = novo();
    expect(sim.pedir('(&CW013A010000B6)')).toBeNull();
    expect(sim.pedir('(&CW013A010200B8)')).toBeNull();
    passo(sim, clock, 5000);
    expect(sim.pedir('(&E0400001234)')).toBe('((TL0400001234B6)');
    expect(sim.pedir('(&T04L2A)')).toBe('(TL04001234008E)');
    const A37 = '(00000000000011233A002C041710421000010000123400004F)';
    const r = sim.pedir('(&A)')!;
    expect(r).toHaveLength(A37.length);
    const faixas = [...RELOGIO_A, [25, 27]] as const;
    expect(mascara(r, faixas)).toBe(mascara(A37, faixas));
  });
  it('a duração do registro conta do último início do bico: depois de um abastecimento não é zero (A: 0x2C)', () => {
    const { sim, clock } = novo();
    abastecer(sim, clock, 0x04, 3000);
    sim.pedir('(&I)');
    passo(sim, clock, 30_000);
    sim.pedir('(&E0400001234)');
    expect(sim.pedir('(&A)')!.slice(19, 23)).not.toBe('0000');
  });
  it('EQUIV-COMANDOS #38: &E em bico inexistente responde sem registro', () => {
    const { sim } = novo();
    expect(sim.pedir('(&E7700001234)')).toBe('((TL7700001234C0)');
  });
  it('espelho cbc-32: o &E não grava o registro do 2.7.2 (sem registro no buffer)', () => {
    const { sim } = novo('cbc-32');
    sim.pedir('(&E0400001234)');
    expect(sim.conc.buffer.todos()).toHaveLength(0);
  });
});

describe('F7 BICO_272: a letra do &S é A enquanto um bico do endereço abastece (EQUIV-MOTOR #68/#26)', () => {
  it('#68: 05 pré-autorizado em P e o 04 abastecendo → (SAPFF…)', () => {
    const { sim, clock } = novo();
    sim.pedir('(&P05000500030)');
    sim.pedir('(&P04000100FB)');
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 1000);
    expect(semTensao(sim.pedir('(&S)'))).toBe(semTensao(S_A('AP')));
  });
  // Refuted by bench diff r6 and r7g (DECISIONS §23 B2): with the one fueling frozen by `&M B` the
  // letter is B, right after the frame and a state tick later. The r4b `(SAP…)` was the outlier.
  it('#26: com o 04 congelado por (&M04B19) a letra vai a B (bancada r6/r7g)', () => {
    const { sim, clock } = novo();
    sim.pedir('(&P05000500030)');
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 2000);
    expect(sim.pedir('(&M04B19)')).toBe('(M04)');
    expect(semTensao(sim.pedir('(&S)'))).toBe(semTensao(S_A('BP')));
    passo(sim, clock, 1000);
    expect(semTensao(sim.pedir('(&S)'))).toBe(semTensao(S_A('BP')));
    expect(sim.pedir('(&M04L23)')).toBe('(M04)');
  });
  it('espelho cbc-32: sem o quirk, um bico abastecendo com status B (o do veredito) mostra B na letra', () => {
    const { sim, clock } = novo('cbc-32');
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 2000);
    sim.conc.bico(0x04)!.status = 'B';
    expect(sim.pedir('(&S)')!.slice(0, 3)).toBe('(SB');
  });
});
