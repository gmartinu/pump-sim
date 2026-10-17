/**
 * Fixes from the diff r5 run 1 against the real 2.7.2 started fresh (17/10; docs/DECISIONS.md §21).
 * - Behavior: the 2.7.2 Horustech `02` reads the grid cell at the read pointer with no "empty"
 *   test (M1 of DECISIONS §20, DIFF-16 steps 0/1/6). Quirk HORUSTECH_272; real profiles unchanged.
 * - State: DIFF-11/12/16 now set their own state; A is pre-dirtied here the way c:\simcnf.ini
 *   (Q8) left the bench 2.7.2 (totalizers, `&C` grid rows, stale buffer rows) and the case must
 *   still give zero divergences against a clean B.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Hub, ManualClock, type PerfilId, executarComando, executarDiff, quadroH, selecionarRoteiros } from '../src/index.js';
import { abastecer, kk, novo } from './util.js';

const HOST = '127.0.0.1';
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

/** `>!006B02 00 R4 …` of the col10 layout: chars 6..20 = `0200` + R4 + `010000`. */
const r4 = (r: string | null) => (r ?? '').slice(10, 14);

describe('Horustech 02 sem teste de vazio (HORUSTECH_272; diff r5 DIFF-16, M1)', () => {
  it('2.7.2: com leitura = escrita, o 02 serve o registro velho da célula do ponteiro', () => {
    const { sim, clock } = novo();
    // Bench r5 shape: rows 1..3 written, the "Carregar configuração padrão" rewind, two more
    // fuelings (rows 1..2) and a drain → read = write = 3, row 3 still holds the old record.
    for (let i = 0; i < 3; i++) abastecer(sim, clock, 0x04, 2000);
    sim.conc.carregarConfigPadrao();
    for (let i = 0; i < 2; i++) abastecer(sim, clock, 0x04, 2000);
    for (let i = 0; i < 2; i++) {
      expect(sim.pedir('(&A)')).not.toBe('(0)');
      sim.pedir('(&I)');
    }
    expect(sim.pedir('(&A)')).toBe('(0)');
    const r = sim.pedir('>?00020263')!;
    expect(r.slice(0, 6)).toBe('>!006B');
    expect(r4(r)).toBe('0003');
    expect(r).toHaveLength(8 + 107);
    // It does not pop: the same record again, with LF and with a wrong KK (steps 1 and 6).
    expect(sim.pedir('>?00020263\n')).toBe(r);
    expect(sim.pedir('>?00020200')).toBe(r);
    // Steps 2/3 of the bench, byte for byte: 06 with read = write does not advance.
    expect(sim.pedir('>?00020667')).toBe('>!000E06000003000003A2');
    expect(sim.pedir('>?00020667\n')).toBe('>!000E06000003000003A2');
  });

  it('2.7.2: célula nunca gravada continua vazia (bancada 17/10: >!00020245)', () => {
    const { sim, clock } = novo();
    expect(sim.pedir('>?00020263')).toBe('>!00020245');
    abastecer(sim, clock, 0x04, 2000);
    expect(r4(sim.pedir('>?00020263'))).toBe('0001');
    sim.pedir('(&I)');
    expect(sim.pedir('>?00020263')).toBe('>!00020245');
  });

  it('2.7.2: depois do rewind do botão, o 02 lê a linha 1 velha', () => {
    const { sim, clock } = novo();
    abastecer(sim, clock, 0x04, 2000);
    sim.pedir('(&I)');
    sim.conc.carregarConfigPadrao();
    expect(sim.pedir('(&A)')).toBe('(0)');
    expect(r4(sim.pedir('>?00020263'))).toBe('0001');
  });

  it.each(['horustech-48', 'horustech-cbc-36', 'concept-48'] as const)('%s (perfil real): lido o registro, o 02 segue vazio', (p) => {
    const { sim, clock } = novo(p);
    abastecer(sim, clock, sim.conc.bicoPorNumero(1)!.codigo, 2000);
    expect(sim.pedir('>?00020263')).not.toBe(quadroH('02'));
    sim.pedir('>?00020667');
    expect(sim.pedir('>?00020263')).toBe(quadroH('02'));
  });
});

async function hubCom(perfil: PerfilId) {
  const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
  const hub = new Hub({ clock, host: HOST, mapa: { 2001: 0, 1771: 0, 857: 0, 7002: 0 } });
  fechar.push(() => hub.fechar());
  const rt = await hub.criar('default', perfil);
  return { hub, rt, clock };
}

/**
 * What c:\simcnf.ini (Q8) and the earlier cases left on the bench 2.7.2 in diff r5: totalizers
 * (04 1243,19, 08 286,00, 44 non-zero, 0C 7,93), `(C0xF0A0y0000)` grid rows for addresses 3–4 and
 * stale buffer rows past the pointers.
 */
function sujarComoBancada(t: Awaited<ReturnType<typeof hubCom>>) {
  const { sim } = t.rt;
  for (let i = 0; i < 3; i++) abastecer(sim, t.clock, 0x0c, 2000);
  sim.conc.carregarConfigPadrao();
  for (const [bb, l] of [['04', '00001243'], ['08', '00000286'], ['44', '00000012'], ['0C', '00000007']] as const) sim.pedir(`(&E${bb}${l})`);
  while (sim.pedir('(&A)') !== '(0)') sim.pedir('(&I)');
  for (const c of [1, 2, 3, 4, 6, 7, 8]) for (const a of [3, 4]) sim.pedir(kk(`&CF0${c}0A0${a}0000`));
}

describe('casos que montam o próprio estado (diff r5: DIFF-11/12/16)', () => {
  it('A sujo como a bancada × B limpo: zero divergências', async () => {
    const a = await hubCom('simulador-2.7.2');
    const b = await hubCom('simulador-2.7.2');
    sujarComoBancada(a);
    expect(a.rt.sim.pedir('(&R)')).toContain('(C01F0A040000)');
    const hubs: Record<string, Hub> = { 'ctl-a': a.hub, 'ctl-b': b.hub };
    const rel = await executarDiff(
      selecionarRoteiros('DIFF-11,DIFF-12,DIFF-16'),
      { nome: 'A', alvo: { host: HOST, porta: a.rt.servidor!.fisica(2001)! }, controle: 'ctl-a' },
      { nome: 'B', alvo: { host: HOST, porta: b.rt.servidor!.fisica(2001)! }, controle: 'ctl-b' },
      {
        timeoutMs: 120,
        ociosoMs: 30,
        chamarControle: (url, c, args) => executarComando(hubs[url]!, c, args),
        esperar: async (ms, x) => {
          const t = x.nome === 'A' ? a : b;
          t.clock.advance(ms);
          t.rt.tick();
        },
      },
    );
    const dif = rel.casos.flatMap((c) => c.passos.filter((p) => !p.igual).map((p) => `${c.id} ${p.quadro}: ${p.a.texto} × ${p.b.texto}`));
    expect(dif).toEqual([]);
    expect(rel.casos.flatMap((c) => c.acoes.filter((x) => !x.ok))).toEqual([]);

    const d11 = rel.casos.find((c) => c.id === 'DIFF-11')!;
    expect(d11.passos.find((p) => p.quadro.startsWith('(&T0AL'))!.a.texto).toBe(kk('TG0A00000000'));
    const d12 = rel.casos.find((c) => c.id === 'DIFF-12')!;
    const rr = d12.passos.at(-1)!.a.texto;
    expect(rr).not.toContain('F0A');
    for (let c = 1; c <= 8; c++) for (const e of [3, 4]) expect(rr).toContain(`(C0${c}W3A0${e}0000)`);
    const d16 = rel.casos.find((c) => c.id === 'DIFF-16')!;
    const h02 = d16.passos.filter((p) => p.quadro.startsWith('>?000202'));
    // 1st: read 1 × write 2 → row 1; then, after the drain, the stale row 2 (R4 0002), not empty.
    expect(h02.map((p) => r4(p.a.texto))).toEqual(['0001', '0002', '0002', '0002']);
    expect(d16.passos.find((p) => p.quadro === '>?00020667')!.a.texto).toBe(quadroH('06000002000002'));
  }, 60_000);
});
