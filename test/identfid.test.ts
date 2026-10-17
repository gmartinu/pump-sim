import { describe, expect, it } from 'vitest';
import { MODOS_IDENTIFICACAO, checksum, kkValido } from '../src/index.js';
import { abastecer, kk, novo, passo } from './util.js';

const T1 = 'B328000000000123';
const GRAVA_MANUAL = '(?F27GB32800000000012300000000000000005A)';

describe('Identfid — exemplos do DT435 conferem (KK)', () => {
  it.each([
    '(?V95)',
    '(?A80)',
    '(?S92)',
    '(AB3CF6CCFFF1F51E6051713450200000041)',
    GRAVA_MANUAL,
    '(FG000000000001B3280000000001230000000000000000275C)',
    '(?F27AB328000000000005000000050000000058)',
    '(FA000005000005000000000000000000000000000000000031)',
    '(FA00000000000500000000000000000000000000000000002C)',
    '(?LF000002F3)',
    '(LF000002000010B32800000000000227000000000000002768)',
    '(LF000002000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF20)',
    '(?F08PB3280000000000010S00100030$0000078)',
  ])('%s', (q) => expect(kkValido(q)).toBe(true));
});

describe('Identfid — cadastro (cbc-32)', () => {
  it('?F G devolve o quadro do manual byte a byte', () => {
    const { sim } = novo('cbc-32');
    expect(sim.pedir(GRAVA_MANUAL)).toBe('(FG000000000001B3280000000001230000000000000000275C)');
  });

  it('?LF lê a posição gravada; posição vazia = 34 F (exemplo do manual)', () => {
    const { sim } = novo('cbc-32');
    expect(sim.pedir('(?LF000002F3)')).toBe('(LF000002000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF20)');
    sim.pedir(GRAVA_MANUAL);
    expect(sim.pedir(kk('?LF000000'))).toBe(kk(`LF000000000001${T1}000000000000000027`));
  });

  it('?F A exclui (sucesso e falha conferem com o manual)', () => {
    const { sim } = novo('cbc-32');
    for (let i = 0; i <= 5; i++) sim.pedir(kk(`?F27GB32800000000000${i}0000000000000000`));
    const exclui = '(?F27AB328000000000005000000050000000058)';
    expect(sim.pedir(exclui)).toBe('(FA000005000005000000000000000000000000000000000031)');
    expect(sim.pedir(exclui)).toBe('(FA00000000000500000000000000000000000000000000002C)');
    expect(sim.conc.cartoes.quantidade).toBe(5);
  });

  it('?F00L limpa a memória sem responder', () => {
    const { sim } = novo('cbc-32');
    sim.pedir(GRAVA_MANUAL);
    expect(sim.pedir(kk('?F00L' + '00000000000000000000000100000000'))).toBeNull();
    expect(sim.conc.cartoes.quantidade).toBe(0);
  });

  it('perfis sem Identfid (cbc05-dip3, cbc01) ficam em silêncio', () => {
    expect(novo('cbc05-dip3').sim.pedir(GRAVA_MANUAL)).toBeNull();
    expect(novo('cbc01').sim.pedir('(?V95)')).toBeNull();
  });
});

describe('Identfid — fila do ?A e ponteiro por porta', () => {
  it('cartão desconhecido entra na fila; ?I avança só na porta que pediu', () => {
    const { sim } = novo('cbc-32');
    sim.pedir(kk('&M04H'));
    sim.conc.retirarBico(0x04);
    expect(sim.conc.apresentarCartao(1, 1, 'B3CF6CCFFF1F51E6')).toMatchObject({ aceito: false, motivo: 'desconhecido' });
    // 16/10/2026 14:30 UTC, time zone 0 → D=16 H=14 M=30 N=10, R=0000, S=00
    const esperado = kk('AB3CF6CCFFF1F51E6' + '04' + '16143010' + '0000' + '00');
    expect(sim.pedir('(?A80)', 'tcp:2001')).toBe(esperado);
    expect(sim.pedir('(?I88)', 'tcp:2001')).toBeNull();
    expect(sim.pedir('(?A80)', 'tcp:2001')).toBe('(0)');
    expect(sim.pedir('(?A80)', 'tcp:1771')).toBe(esperado);
  });

  it('2.7.2: ponteiro único e ?I incondicional (avança mesmo vazio)', () => {
    const { sim } = novo();
    expect(sim.pedir('(?A80)')).toBe('(0)');
    sim.pedir('(?I88)');
    sim.conc.apresentarCartao(1, 1, 'B3CF6CCFFF1F51E6');
    // The card went to position 1, but the pointer is already at 2: cell 2 is empty.
    expect(sim.pedir('(?A80)', 'tcp:7002')).toBe('(0)');
    expect(sim.conc.idsPendentes.leitura('unico')).toBe(2);
  });
});

describe('Identfid — modos 01–14 nos perfis reais (DT435 §3.10)', () => {
  const grava = (sim: ReturnType<typeof novo>['sim'], cod: string, cc: string, turnos = '0000000000000000') =>
    sim.pedir(kk(`?F${cc}G${cod}${turnos}`));
  const F1 = '0000000000000F01'; // employee n1, releases the pump (27)
  const G1 = '0000000000000D01'; // manager n1 (2D)
  const C1 = '0000000000000C11'; // customer n1 (24)
  const TG = '0000000000000A61'; // vehicle TAG (21)

  it('há 14 modos', () => expect(MODOS_IDENTIFICACAO).toHaveLength(14));

  it('modo 01: frentista libera; cliente é recusado; E → P → A e o cartão vai ao &A67', () => {
    const { sim, clock } = novo('cbc-32');
    grava(sim, F1, '27');
    grava(sim, C1, '24');
    sim.pedir(kk('&M04H'));
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 1000);
    expect(sim.conc.bico(0x04)?.status).toBe('E');
    expect(sim.conc.apresentarCartao(1, 1, C1)).toMatchObject({ aceito: false, motivo: 'classe' });
    expect(sim.conc.apresentarCartao(1, 1, F1)).toMatchObject({ aceito: true, libera: true });
    expect(sim.conc.bico(0x04)?.status).toBe('P');
    passo(sim, clock, 1000);
    expect(sim.conc.bico(0x04)?.status).toBe('A');
    passo(sim, clock, 3000);
    expect(sim.pedir('(?V95)')).toBe(`(04${F1})`);
    sim.conc.recolocarBico(0x04);
    passo(sim, clock, 1000);
    const a67 = sim.pedir('(&A67)')!;
    expect(a67.slice(50, 66)).toBe(F1);
  });

  it('modo 03: frentista + gerente (o 2º cartão completa a liberação)', () => {
    const { sim } = novo('cbc-32');
    grava(sim, F1, '27');
    grava(sim, G1, '2D');
    sim.conc.definirModoIdentificacao(1, 1, 3);
    sim.pedir(kk('&M04H'));
    expect(sim.conc.apresentarCartao(1, 1, F1)).toMatchObject({ aceito: true, libera: false, aguardaSegundo: true });
    expect(sim.conc.lado(1, 1)?.preAutorizado).toBe(false);
    expect(sim.conc.apresentarCartao(1, 1, G1)).toMatchObject({ aceito: true, campo: 'cartao2', libera: true });
    expect(sim.conc.lado(1, 1)?.preAutorizado).toBe(true);
  });

  it('modo 02: com turno, cartão "respeita turno" fora do turno é recusado', () => {
    const { sim } = novo('cbc-32');
    grava(sim, F1, '67', '0800120000000000'); // 08:00–12:00; now 14:30
    sim.conc.definirModoIdentificacao(1, 1, 2);
    expect(sim.conc.apresentarCartao(1, 1, F1)).toMatchObject({ aceito: false, motivo: 'foraDoTurno' });
    sim.conc.definirModoIdentificacao(1, 1, 1); // no shift: passes
    expect(sim.conc.apresentarCartao(1, 1, F1)).toMatchObject({ aceito: true });
  });

  it.each([
    [11, C1, '24', true],
    [12, C1, '24', false],
    [13, TG, '21', true],
    [14, TG, '21', false],
  ])('modo %i: aceita e libera=%s', (modo, cod, cc, libera) => {
    const { sim } = novo('horustech-48');
    grava(sim, cod, cc);
    sim.conc.definirModoIdentificacao(1, 1, modo);
    expect(sim.conc.apresentarCartao(1, 1, cod)).toMatchObject({ aceito: true, libera });
    expect(sim.conc.lado(1, 1)?.preAutorizado).toBe(libera);
  });

  it('lista negra e permissão sem "libera bomba" recusam', () => {
    const { sim } = novo('cbc-32');
    grava(sim, F1, '87'); // permission 8 = car wash only
    expect(sim.conc.apresentarCartao(1, 1, F1)).toMatchObject({ aceito: false, motivo: 'semPermissao' });
    grava(sim, F1, '27');
    sim.pedir(kk(`&M99b${F1}`));
    expect(sim.conc.apresentarCartao(1, 1, F1)).toMatchObject({ aceito: false, motivo: 'listaNegra' });
  });

  it('2.7.2: o modo é só rótulo — vale o byte CC inteiro', () => {
    const { sim } = novo();
    grava(sim, C1, '24'); // bit 2 (4) = shift, bit 1 (2) missing → refused on the 2.7.2
    grava(sim, F1, '2B'); // 0x2B: bit 1 on, bit 2 off → accepted in any mode
    sim.conc.definirModoIdentificacao(1, 1, 11);
    expect(sim.conc.apresentarCartao(1, 1, C1)).toMatchObject({ aceito: false });
    expect(sim.conc.apresentarCartao(1, 1, F1)).toMatchObject({ aceito: true, libera: true });
  });
});

describe('Identfid — preset identificado ?F P', () => {
  const PRESET = '(?F08PB3280000000000010S00100030$0000078)';

  it('exemplo do manual: (F08), libera o lado e corta em R$ 10,00', () => {
    const { sim, clock } = novo('cbc-32');
    expect(sim.pedir(PRESET)).toBe('(F08)');
    sim.conc.retirarBico(0x08);
    passo(sim, clock, 1000);
    expect(sim.conc.bico(0x08)?.status).toBe('A');
    for (let i = 0; i < 400; i++) passo(sim, clock, 300);
    passo(sim, clock, 1000);
    const a67 = sim.pedir('(&A67)')!;
    expect(a67.slice(2, 8)).toBe('001000'); // total = preset
    expect(a67.slice(50, 66)).toBe('B328000000000001'); // C=0 → attendant (card 1)
  });

  it('o prazo para retirar o bico expira e a autorização cai', () => {
    const { sim, clock } = novo('cbc-32');
    sim.pedir(PRESET);
    expect(sim.conc.bico(0x08)?.status).toBe('P');
    passo(sim, clock, 31_000);
    expect(sim.conc.lado(2, 1)?.preAutorizado).toBe(false);
    expect(sim.conc.bico(0x08)?.status).toBe('L');
  });

  it('erros: bico inexistente (F?b) nos reais, (F?t) no 2.7.2; abastecendo (F?t)', () => {
    const q = kk('?F3FPB3280000000000010S00100030$00000');
    expect(novo('cbc-32').sim.pedir(q)).toBe('(F?b)');
    expect(novo().sim.pedir(q)).toBe('(F?t)');
    const { sim, clock } = novo('cbc-32');
    sim.conc.retirarBico(0x08);
    passo(sim, clock, 1000);
    expect(sim.pedir(PRESET)).toBe('(F?t)');
  });
});

describe('Identfid — 2.7.2', () => {
  it('?V sai com KK e só o cartão 1', () => {
    const { sim, clock } = novo();
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 1000);
    expect(sim.pedir('(?V95)')).toBe(kk('04' + '0'.repeat(16)));
  });

  it('?S: vetor de IDF com "v" minúsculo; ?C liga o sensor; ?D mostra RI', () => {
    const { sim } = novo();
    // DIFF-13 (bench 17/10): the CBC type of ?S stays `0` on the 2.7.2.
    expect(sim.pedir('(?S92)')).toBe('(S' + 'F'.repeat(32) + 'FFDD0v3.7M1.0G7A)');
    expect(sim.pedir(kk('?CI' + '01' + '01' + '00' + '00'))).toBeNull();
    expect(sim.conc.lado(1, 1)?.sensorIdf).toBe(true);
    expect(sim.pedir('(?S92)')).toBe('(SL' + 'F'.repeat(31) + 'FFDD0v3.7M1.0G7A)');
    // Verdict #51/#52: after ?C the 2.7.2 shows RI01FF (not RI02FF).
    expect(sim.pedir('(?D)')).toBe(kk('F' + 'RI01FF' + 'N000'.repeat(31)));
  });

  it('?F com tamanho ≠ 41 trava (MessageBox) sem responder', () => {
    const { sim } = novo();
    expect(sim.pedir(kk('?F27GB3280000000001230000'))).toBeNull();
    expect(sim.conc.eventos.at(-1)?.texto).toBe('STRING Gravação de TAG - Tamanho inválido');
  });

  it('com o combo Modelo fora de CBC-06/Horustech o ramo ? não existe', () => {
    const { sim } = novo();
    sim.conc.setModelo('CBC-05');
    expect(sim.pedir('(?S92)')).toBeNull();
    sim.conc.setModelo('Horustech');
    expect(sim.pedir('(?S92)')).not.toBeNull();
  });

  it('?A80 com KK errado não casa (string exata)', () => {
    expect(novo().sim.pedir('(?A81)')).toBeNull();
    expect(checksum('?A')).toBe('80');
  });
});

describe('Identfid — registro com cartão no ?V depois de gravar', () => {
  it('abastecimento sem cartão: ?V vazio depois de concluir', () => {
    const { sim, clock } = novo('cbc-32');
    abastecer(sim, clock, 0x04, 2000);
    expect(sim.pedir('(?V95)')).toBe('(0)');
  });
});
