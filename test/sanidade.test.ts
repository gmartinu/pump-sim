import { describe, expect, it } from 'vitest';
import {
  Framer,
  ManualClock,
  PumpSim,
  checksum,
  codigoBico,
  decodificarBico,
  kkValido,
  IDS_PERFIS,
  PERFIS,
} from '../src/index.js';

const novo = (perfil: (typeof IDS_PERFIS)[number] = 'simulador-2.7.2') => {
  const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
  const sim = new PumpSim({ perfil, clock, configPadrao: true });
  return { sim, clock };
};

/** Lifts the nozzle, lets it flow for `ms`, hangs up and stores the record. */
function abastecer(sim: PumpSim, clock: ManualClock, codigo: number, ms: number) {
  sim.conc.retirarBico(codigo);
  clock.advance(1000);
  sim.atualizar();
  clock.advance(ms);
  sim.atualizar();
  sim.conc.recolocarBico(codigo);
  clock.advance(1000);
  sim.atualizar();
}

describe('checksum (DT435 p.3, p.36)', () => {
  it.each([
    ['&A', '67'],
    ['&@', '66'],
    ['&A2', '99'],
    ['&A3', '9A'],
    ['&A4', '9B'],
    ['&I', '6F'],
    ['&KR1', 'F4'],
    ['&T99P', '3C'],
    ['&T99N', '3A'],
    ['&T08L', '2E'],
  ])('%s → %s', (corpo, kk) => expect(checksum(corpo)).toBe(kk));

  it.each([
    '(TP9907000683AE)',
    '(T$080000405069)',
    '(TL080000405596)',
    '(Tl08000000405516)',
    '(Ts19063E0202D3)',
    '(TU082000100094)',
    '(TU0822221111333369)',
    '(KR12002180309570194)',
    '(KW12002130109000085)',
    '(00038600386010003E001C0812164002068300000807890098)',
  ])('exemplo do manual confere: %s', (q) => expect(kkValido(q)).toBe(true));

  it('kk minúsculo é inválido', () => expect(kkValido('(&T08L2e)')).toBe(false));
});

describe('código de bico (DT360)', () => {
  it('04 = canal 1 end 1 pos 0; 0x19 = canal 6 end 2', () => {
    expect(codigoBico(1, 1, 0)).toBe(0x04);
    expect(codigoBico(1, 1, 1)).toBe(0x44);
    expect(decodificarBico(0x19)).toMatchObject({ canal: 6, endereco: 2, posicao: 0 });
    expect(codigoBico(12, 4, 3)).toBe(0xf3);
  });
});

describe('perfis', () => {
  it('existem os 7 perfis', () => {
    expect(IDS_PERFIS).toHaveLength(7);
    expect(PERFIS['simulador-2.7.2'].quirks.Q1).toBe(true);
    expect(PERFIS['cbc-32'].quirks.Q1).toBe(false);
  });
});

describe('simulador-2.7.2 — confirmação da bancada (auditoria, 17/10)', () => {
  it('&S com a configuração padrão', () => {
    const { sim } = novo();
    expect(sim.pedir('(&S)')).toBe('(S' + 'LLFF'.repeat(8) + 'FFDD6V3.7M1.0G7A)');
  });

  it('&U responde (U04)', () => expect(novo().sim.pedir('(&U040058991E)')).toBe('(U04)'));

  it('&T em bico inexistente → TG; nos bicos reais, l e L', () => {
    const { sim } = novo();
    expect(sim.pedir('(&T01l47)')).toBe('(TG01000000007C)');
    expect(sim.pedir('(&T01L27)')).toBe('(TG01000000007C)');
    expect(sim.pedir('(&T04l4A)')).toBe('(Tl04000000000004)');
    expect(sim.pedir('(&T08l4E)')).toBe('(Tl08000000000008)');
    expect(sim.pedir('(&T04L2A)')).toBe('(TL040000000084)');
    expect(sim.pedir('(&T08L2E)')).toBe('(TL080000000088)');
  });

  it('KK errado → silêncio', () => expect(novo().sim.pedir('(&T04L00)')).toBeNull());

  it('memória vazia: (&A) e (&A67) → (0)', () => {
    const { sim } = novo();
    expect(sim.pedir('(&A)')).toBe('(0)');
    expect(sim.pedir('(&A67)')).toBe('(0)');
  });
});

describe('abastecimento ponta a ponta (2.7.2)', () => {
  it('grava, lê por &A (52), avança por &I e o ponteiro sai em TG99', () => {
    const { sim, clock } = novo();
    abastecer(sim, clock, 0x04, 3000);
    const a = sim.pedir('(&A)');
    expect(a).not.toBeNull();
    expect(a).toHaveLength(52);
    expect(kkValido(a!)).toBe(true);
    expect(a!.slice(23, 25)).toBe('04'); // B2
    expect(sim.pedir('(&T99P3C)')).toBe('(TG9900010000' + checksum('TG9900010000') + ')');
    expect(sim.pedir('(&I)')).toBeNull();
    expect(sim.pedir('(&A)')).toBe('(0)');
  });

  it('&V mostra o volume em andamento', () => {
    const { sim, clock } = novo();
    sim.conc.retirarBico(0x04);
    clock.advance(1000);
    sim.atualizar();
    expect(sim.conc.bico(0x04)?.status).toBe('A');
    clock.advance(300 * 10);
    sim.atualizar();
    expect(sim.pedir('(&V)')).toMatch(/^\(04\d{6}\)$/);
  });

  it('&U com nível inválido abre o MessageBox (Q2) e responde (U04) depois do OK, sem mudar o preço', () => {
    const { sim } = novo();
    const c = '&U04200123';
    const antes = sim.conc.bico(0x04)!.precosPendentes.slice();
    expect(sim.pedir(`(${c}${checksum(c)})`)).toBe('(U04)');
    expect(sim.conc.bico(0x04)!.precosPendentes).toEqual(antes);
    expect(sim.conc.eventos.at(-1)?.texto).toBe('Nível de preço incorreto.');
  });
});

describe('perfis reais', () => {
  it('cbc-32: TP99, bico inexistente silencioso, &M com ?b', () => {
    const { sim } = novo('cbc-32');
    expect(sim.pedir('(&T99P3C)')).toBe('(TP9900000000' + checksum('TP9900000000') + ')');
    expect(sim.pedir('(&T01l47)')).toBeNull();
    const m = '&M3FA';
    expect(sim.pedir(`(${m}${checksum(m)})`)).toBe('(M?b)');
  });

  it('ponteiro de leitura por porta', () => {
    const { sim, clock } = novo('cbc-32');
    abastecer(sim, clock, 0x04, 2000);
    expect(sim.pedir('(&A)', 'tcp:2001')).toHaveLength(52);
    sim.pedir('(&I)', 'tcp:2001');
    expect(sim.pedir('(&A)', 'tcp:2001')).toBe('(0)');
    expect(sim.pedir('(&A)', 'tcp:1771')).toHaveLength(52);
  });

  it('horustech-48: &S com 48 posições sem trailer', () => {
    const r = novo('horustech-48').sim.pedir('(&S)');
    expect(r).toHaveLength(51);
    expect(r).toBe('(S' + 'LLFF'.repeat(8) + 'FFFF'.repeat(4) + ')');
  });

  it('cbc01: &A sai com 34', () => {
    const { sim, clock } = novo('cbc01');
    abastecer(sim, clock, 0x04, 2000);
    expect(sim.pedir('(&A)')).toHaveLength(34);
  });
});

describe('framer', () => {
  it('leitura única (Q1): 2 quadros no mesmo segmento → só o 1º', () => {
    const f = new Framer('leituraUnica');
    expect(f.receber('(&S)(&V)')).toEqual(['(&S)']);
  });

  it('leitura única (Q1, DIFF-04): o pedaço sem `)` vai inteiro ao parser (quem atende o `(&S` é o codec)', () => {
    const f = new Framer('leituraUnica');
    expect(f.receber('(&S')).toEqual(['(&S']);
    expect(f.receber(')')).toEqual([')']);
    expect(f.receber('(&T04L')).toEqual(['(&T04L']);
    expect(f.receber('(&T08L2E')).toEqual(['(&T08L2E']);
    expect(f.receber('L2E)')).toEqual(['L2E)']);
    expect(f.receber('>?0002')).toEqual(['>?0002']);
  });

  it('fluxo: junta fragmentos e atende os dois quadros', () => {
    const f = new Framer('fluxo');
    expect(f.receber('xx(&S')).toEqual([]);
    expect(f.receber(')(&V)\r\n')).toEqual(['(&S)', '(&V)']);
  });
});
