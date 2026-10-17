/**
 * Windows bench golden (17/10): rx captured from the real SimuladorCBC 2.7.2
 * (bench audit 17/10, "Confirmação na bancada Windows"). Profile
 * simulador-2.7.2, with the default configuration (8 channels × 2 addresses × 2 nozzles).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ClienteTcp, Hub, ManualClock } from '../src/index.js';
import { criar } from './golden-util.js';

const BANCADA: readonly (readonly [tx: string, rx: string | null])[] = [
  ['(&A)', '(0)'],
  ['(&A67)', '(0)'],
  ['(&U040058991E)', '(U04)'],
  ['(&T01l47)', '(TG01000000007C)'],
  ['(&T04l4A)', '(Tl04000000000004)'],
  ['(&T08l4E)', '(Tl08000000000008)'],
  ['(&T01L27)', '(TG01000000007C)'],
  ['(&T04L2A)', '(TL040000000084)'],
  ['(&T08L2E)', '(TL080000000088)'],
  ['(&T04L00)', null],
];

describe('bancada 17/10: simulador-2.7.2, quadro a quadro', () => {
  it.each(BANCADA)('%s → %s', (tx, rx) => {
    const { sim } = criar('simulador-2.7.2');
    expect(sim.pedir(tx)).toBe(rx);
  });

  it('a sequência inteira, na mesma conexão e na ordem da captura, dá as mesmas respostas', () => {
    const { sim } = criar('simulador-2.7.2');
    const got = BANCADA.map(([tx]) => sim.pedir(tx));
    expect(got).toEqual(BANCADA.map(([, rx]) => rx));
  });

  it('(&S) em repouso: 49 chars fixos + 2 chars de tensão (G81 na captura)', () => {
    const { sim, clock } = criar('simulador-2.7.2');
    const fixo = '(S' + 'LLFF'.repeat(8) + 'FFDD6V3.7M1.0G';
    const vistos = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const r = sim.pedir('(&S)')!;
      expect(r).toMatch(/^\(S[LF]{32}FFDD6V3\.7M1\.0G[0-9A-F]{2}\)$/);
      expect(r.slice(0, fixo.length)).toBe(fixo);
      expect(r).toHaveLength(51);
      vistos.add(r.slice(-3, -1));
      clock.advance(150);
      sim.atualizar();
    }
    // the voltage is dynamic on the 2.7.2 (bateriaDinamica): the last byte moves, but stays within a plausible hex range
    for (const t of vistos) expect(parseInt(t, 16)).toBeGreaterThan(0x60);
  });

  it('o ponteiro do TG da bancada: TG + BB + (escrita-1) + (leitura-1), memória vazia = 0000000', () => {
    const { sim } = criar('simulador-2.7.2');
    // empty buffer: write = read = 1 → 0000 / 0000
    expect(sim.pedir('(&T01l47)')).toBe('(TG01000000007C)');
  });
});

describe('bancada 17/10 pela rede: checksum errado é silêncio e a conexão segue viva', () => {
  const fechar: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const f of fechar.splice(0).reverse()) await f();
  });

  it('(&T04L00) não responde e o próximo comando da mesma conexão é atendido', async () => {
    const hub = new Hub({ clock: new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0)), host: '127.0.0.1', mapa: { 2001: 0, 1771: 0, 857: 0, 7002: 0 } });
    fechar.push(() => hub.fechar());
    const rt = await hub.criar('default', 'simulador-2.7.2');
    const c = await ClienteTcp.conectar({ host: '127.0.0.1', porta: rt.servidor!.portas()[0]!.fisica });
    fechar.push(() => c.fechar());
    const troca = async (q: string) => (await c.trocar([q], { timeoutMs: 150, ociosoMs: 40 })).bytes.toString('latin1');
    expect(await troca('(&T04L00)')).toBe('');
    expect(await troca('(&T04L2A)')).toBe('(TL040000000084)');
    expect(await troca('(&T04L00)')).toBe('');
    expect(await troca('(&T08l4E)')).toBe('(Tl08000000000008)');
  });

  it('toda a captura, numa conexão só, pela rede', async () => {
    const hub = new Hub({ clock: new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0)), host: '127.0.0.1', mapa: { 2001: 0, 1771: 0, 857: 0, 7002: 0 } });
    fechar.push(() => hub.fechar());
    const rt = await hub.criar('default', 'simulador-2.7.2');
    const c = await ClienteTcp.conectar({ host: '127.0.0.1', porta: rt.servidor!.portas()[0]!.fisica });
    fechar.push(() => c.fechar());
    for (const [tx, rx] of BANCADA) {
      const r = await c.trocar([tx], { timeoutMs: 150, ociosoMs: 40 });
      expect(r.bytes.toString('latin1'), tx).toBe(rx ?? '');
    }
  });
});

describe('bancada r4b 17/10: E3 (Horustech 32, KK não-hex) e #55 (?F L num estado recém-aberto)', () => {
  // Bench capture (2026-10-17), EQUIV-PENDENTES: side A = the real 2.7.2.

  it('#55: (?F00L31) num estado recém-aberto não responde e o socket segue atendendo (passos 0 e 1)', () => {
    const { sim } = criar('simulador-2.7.2');
    expect(sim.pedir('(?F00L31)')).toBeNull();
    expect(sim.pedir('(&S)')).toMatch(/^\(SL[LP]FF/);
  });

  it('E3: >?000B32022001500XX — KK não-hex: sem resposta, o modal E9 e o socket vivo (passos 2 e 3)', () => {
    const { sim } = criar('simulador-2.7.2');
    sim.pedir('(&P05000500030)');
    sim.conc.setModelo('Horustech');
    const antes = sim.conc.eventos.length;
    expect(sim.pedir('>?000B32022001500XX')).toBeNull();
    expect(sim.conc.eventos.slice(antes).map((e) => e.texto)).toContain("''$XX'' is not a valid integer value.");
    sim.conc.setModelo('CBC-06');
    expect(sim.pedir('(&S)')).toMatch(/^\(SL[LP]FF/);
  });

  it('E3: >?000B32021001500XX (nível 1) idem, e nenhum nível muda de preço: TU 11,23 e TU nível 1 11,23 (passos 4 a 6)', () => {
    const { sim } = criar('simulador-2.7.2');
    sim.conc.setModelo('Horustech');
    expect(sim.pedir('>?000B32021001500XX')).toBeNull();
    sim.conc.setModelo('CBC-06');
    expect(sim.pedir('(&T04U33)')).toBe('(TU040000112394)');
    expect(sim.pedir('(&T04u53)')).toBe('(TU0400001123000054)');
  });

  it('E3: o quadro de 17/10 >?000A3202000111FA (KK = FA, hex) continua indo ao StrToFloat — não é o E9', () => {
    const { sim } = criar('simulador-2.7.2');
    sim.conc.setModelo('Horustech');
    const antes = sim.conc.eventos.length;
    expect(sim.pedir('>?000A3202000111FA')).toBeNull();
    const textos = sim.conc.eventos.slice(antes).map((e) => e.texto);
    expect(textos).toContain("Error: '1,11F' is not a valid floating point value.");
    expect(textos.some((t) => t.includes('$'))).toBe(false);
  });
});
