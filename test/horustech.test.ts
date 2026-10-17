import { describe, expect, it } from 'vitest';
import { Framer, checksumH, quadroH, validarQuadroH } from '../src/index.js';
import { abastecer, novo } from './util.js';

const kkH = (q: string) => checksumH(q.slice(1, -2)) === q.slice(-2);

describe('Horustech — moldura e KK (DT214)', () => {
  it.each([
    '>?00020263',
    '>!00020245',
    '>?00020667',
    '>!000E06000179000181B7',
    '>!000E06000181000181B0',
    '>!00043200AA',
    '>?000402A1D7',
    '>!006B0200068403000000010600106010002330007120220164000000807890000080895B3CF6CCFFF1FD792FFFFFFFFFFFFFFFF00000000D7',
  ])('%s', (q) => expect(kkH(q)).toBe(true));

  it('quadroH monta o vazio do 02 e valida pedido', () => {
    expect(quadroH('02')).toBe('>!00020245');
    expect(validarQuadroH('>?00020263')).toBe('02');
    expect(validarQuadroH('>?00020264')).toBeNull();
    expect(validarQuadroH('>?0003026')).toBeNull();
  });

  it('o exemplo 02 do DT214 tem 107 chars de DATA', () => {
    const rx = '>!006B0200068403000000010600106010002330007120220164000000807890000080895B3CF6CCFFF1FD792FFFFFFFFFFFFFFFF00000000D7';
    expect(rx.length - 8).toBe(0x6b);
  });
});

describe('Horustech — simulador-2.7.2 (só 02/06/32, sem validar)', () => {
  it('02 vazio; depois do abastecimento, layout col10; 06 avança o ponteiro único', () => {
    const { sim, clock } = novo();
    expect(sim.pedir('>?00020263')).toBe('>!00020245');
    abastecer(sim, clock, 0x04, 3000);
    const r = sim.pedir('>?00020263')!;
    expect(r.slice(0, 6)).toBe('>!006B');
    expect(r.slice(6, 20)).toBe('02000001010000'); // 02 00 R4 + fixed nozzle/fuel/tank
    expect(r).toHaveLength(8 + 107);
    expect(kkH(r)).toBe(true);
    expect(r.slice(-10, -2)).toBe('00000000');
    expect(sim.pedir('>?00020667')).toBe(quadroH('06000002000002'));
    expect(sim.pedir('(&A)')).toBe('(0)'); // same pointer as &A
  });

  it('não confere KK nem tamanho: casa pelos chars 7-8', () => {
    expect(novo().sim.pedir('>?99990200')).toBe('>!00020245');
  });

  it('32: ack literal; bico fora de 1..48 e nível inválido travam (MessageBox)', () => {
    const { sim } = novo();
    const antes = structuredClone(sim.conc.bicosAtivos().map((b) => [b.precos, b.precosPendentes]));
    expect(sim.pedir('>?000B320210015002F')).toBe('>!00043200AA');
    // Bench diff r6 (EQUIV-PENDENTES, docs/DECISIONS.md §21 "r6 bench run"): acked, and nozzle 44
    // kept `TU440000212399` (no 15,00 on any level). Before r6 this asserted level 1 pending = 1500.
    expect(sim.conc.bicosAtivos().map((b) => [b.precos, b.precosPendentes])).toEqual(antes);
    expect(sim.pedir('>?000B324910015003A')).toBeNull();
    expect(sim.conc.eventos.at(-1)?.texto).toBe('Bico deve estar no intervalo de 1 a 48');
    // E3: the ShowMessage is inside the parser; the ack goes out after the OK (at once, with travamentoMs 0).
    expect(sim.pedir('>?000B3202200150030')).toBe('>!00043200AA');
    expect(sim.conc.eventos.at(-1)?.texto).toBe('Nível de preço incorreto.');
  });

  it('E3 (bancada diff r4b): KK não-hex → modal E9 do StrToInt(\'$\' + KK), sem resposta e sem preço', () => {
    const { sim } = novo();
    const antes = structuredClone(sim.conc.bicosAtivos().map((b) => [b.precos, b.precosPendentes]));
    for (const q of ['>?000B32022001500XX', '>?000B32021001500XX']) {
      expect(sim.pedir(q)).toBeNull();
      expect(sim.conc.eventos.at(-1)?.texto).toBe("''$XX'' is not a valid integer value.");
    }
    expect(sim.conc.bicosAtivos().map((b) => [b.precos, b.precosPendentes])).toEqual(antes);
    // The bench frame of 17/10 (KK `FA` right after the 10 data chars) still reaches StrToFloat.
    expect(sim.pedir('>?000A3202000111FA')).toBeNull();
    expect(sim.conc.eventos.at(-1)?.texto).toBe("Error: '1,11F' is not a valid floating point value.");
  });

  it('outras funções e outro modelo no combo → silêncio', () => {
    const { sim } = novo();
    expect(sim.pedir('>?00020B73')).toBeNull();
    sim.conc.setModelo('CBC-02');
    expect(sim.pedir('>?00020263')).toBeNull();
  });
});

describe('Horustech — perfis reais', () => {
  it('cbc-32 não fala Horustech', () => expect(novo('cbc-32').sim.pedir('>?00020263')).toBeNull());

  it('horustech-48: 02 no layout do DT214 (107), ponteiro por porta, 06', () => {
    const { sim, clock } = novo('horustech-48');
    abastecer(sim, clock, 0x04, 3000);
    const r = sim.pedir('>?00020263', 'tcp:2001')!;
    expect(r).toHaveLength(8 + 107);
    expect(kkH(r)).toBe(true);
    const d = r.slice(6, -2);
    expect(d.slice(0, 8)).toBe('02000000'); // N6 = 0 (memory 0..9999)
    expect(d.slice(8, 10)).toBe('01'); // lane nozzle 1
    expect(d.slice(30, 33)).toBe('223'); // total/volume/price decimals of comma 3A
    expect(d.slice(33, 37)).toBe('0004'); // duration in seconds (decimal)
    expect(d.slice(37, 47)).toBe('1610261430'); // dd mm yy hh nn
    expect(d.slice(67, 83)).toBe('F'.repeat(16)); // no attendant
    expect(sim.pedir('>?00020667', 'tcp:2001')).toBe(quadroH('06000001000001'));
    expect(sim.pedir('>?00020667', 'tcp:2001')).toBe(quadroH('06000001000001'));
    expect(sim.pedir('>?00020263', 'tcp:2001')).toBe('>!00020245');
    expect(sim.pedir('>?00020263', 'tcp:857')).toBe(r);
  });

  it('KK errado → silêncio; função fora da v1 → silêncio', () => {
    const { sim } = novo('horustech-48');
    expect(sim.pedir('>?00020200')).toBeNull();
    expect(sim.pedir('>?00020B73')).toBeNull();
  });

  it('32: ACK, bico inexistente (E7), nível inválido (EC)', () => {
    const { sim } = novo('concept-48');
    const q = (dados: string) => quadroH(dados, '?');
    expect(sim.pedir(q('32022001999'))).toBe('>!00043200AA');
    expect(sim.conc.bicoPorNumero(2)?.precosPendentes[2]).toBe(1999);
    expect(sim.pedir(q('32990001999'))).toBe(quadroH('32E7'));
    expect(sim.pedir(q('32023001999'))).toBe(quadroH('32EC'));
  });
});

describe('framer — Horustech pelo CCCC', () => {
  it('fluxo: remonta o quadro fragmentado e separa dois quadros colados', () => {
    const f = new Framer('fluxo');
    expect(f.receber('>?0002')).toEqual([]);
    expect(f.receber('02')).toEqual([]);
    expect(f.receber('63>?00020667')).toEqual(['>?00020263', '>?00020667']);
    expect(f.receber('\r\n(&S)')).toEqual(['(&S)']);
  });

  it('leitura única (Q1): o pedaço inteiro vai ao parser', () => {
    const f = new Framer('leituraUnica');
    expect(f.receber('>?0002')).toEqual(['>?0002']);
  });
});
