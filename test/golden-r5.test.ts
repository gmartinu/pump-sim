/**
 * Goldens of the (a) fix of the diff r5 triage (docs/DECISIONS.md §21, F1 / M1 of DECISIONS §20):
 * the 2.7.2 Horustech `02` has no "empty" test. Every expected frame is side A of
 * the diff r5 bench capture (real SimuladorCBC 2.7.2, 2026-10-17), copied byte for byte.
 * Fields the clock writes (duration C4, date/time) and the KK that covers them are masked, like the
 * r4b goldens. Each block pins the mirror on real profiles, which must not move.
 */
import { describe, expect, it } from 'vitest';
import { quadroH } from '../src/index.js';
import { abastecer, novo } from './util.js';

/** DIFF-16 steps 0, 1 and 6 (A): `>!006B` + 107 chars; the same frame for all three queries. */
const A02 = '>!006B0200000301000000005000004411232230009171026114600000008370000000793000000000000000000000000000000000000000075';
/** DIFF-16 steps 2/3 (A): `06` with read = write = 3. */
const A06 = '>!000E06000003000003A2';
/** DIFF-16 steps 0/1/6 (B, never-written cell) and the 1710 bench: `>!00020245`. */
const VAZIO = '>!00020245';

/** Bench shape of DIFF-06 → DIFF-15: rows 1..3 written (3rd = nozzle 0C, R$ 0,50, totalizer 7,93 → 8,37), button rewind, 2 fuelings, drain. */
function bancadaR5(perfil: Parameters<typeof novo>[0] = 'simulador-2.7.2') {
  const t = novo(perfil);
  const { sim, clock } = t;
  sim.conc.bico(0x0c)!.encerranteMl = 7930;
  sim.pedir('(&P04000050FF)');
  abastecer(sim, clock, 0x04, 3000);
  sim.pedir('(&P0800005003)');
  abastecer(sim, clock, 0x08, 3000);
  sim.pedir('(&P0C0000500E)');
  abastecer(sim, clock, 0x0c, 3000);
  while (sim.pedir('(&A)') !== '(0)') sim.pedir('(&I)');
  sim.conc.carregarConfigPadrao();
  abastecer(sim, clock, 0x04, 2000);
  abastecer(sim, clock, 0x04, 2000);
  while (sim.pedir('(&A)') !== '(0)') sim.pedir('(&I)');
  return t;
}

describe('F1 HORUSTECH_272: o 02 serve a célula do ponteiro com leitura = escrita (bancada r5, DIFF-16)', () => {
  it('passos 2/3: o 06 com leitura = escrita não avança — 3/3 no estado da bancada', () => {
    const { sim } = bancadaR5();
    expect(sim.pedir('>?00020667')).toBe(A06);
    expect(sim.pedir('>?00020667\n')).toBe(A06);
  });

  it('passos 0/1/6: o 02 devolve o registro velho da linha 3 — com LF e com KK errado, sem consumir', () => {
    const { sim } = bancadaR5();
    const r = sim.pedir('>?00020263')!;
    expect(r).toHaveLength(A02.length);
    // Whole frame but the clock fields: C4 duration (chars 39..43), date/time (43..53) and KK + ')'.
    const sem = (x: string) => x.slice(0, 39) + 'x'.repeat(14) + x.slice(53, -2);
    expect(sem(r)).toBe(sem(A02));
    expect(sim.pedir('>?00020263\n')).toBe(r);
    expect(sim.pedir('>?00020200')).toBe(r);
    expect(sim.pedir('>?00020667')).toBe(A06);
  });

  it('o 02 lê só o que nunca foi gravado como vazio: A sem nenhum abastecimento (1710) = >!00020245', () => {
    const { sim } = novo();
    expect(sim.pedir('>?00020263')).toBe(VAZIO);
    expect(sim.pedir('>?00020263\n')).toBe(VAZIO);
    expect(sim.pedir('>?00020200')).toBe(VAZIO);
    expect(VAZIO).toBe(quadroH('02'));
  });

  it.each(['horustech-48', 'horustech-cbc-36', 'concept-48'] as const)('espelho %s: perfil real não serve registro velho (vazio com leitura = escrita)', (p) => {
    const { sim, clock } = novo(p);
    abastecer(sim, clock, sim.conc.bicoPorNumero(1)!.codigo, 2000);
    sim.pedir('>?00020667');
    expect(sim.pedir('>?00020263')).toBe(quadroH('02'));
    sim.conc.carregarConfigPadrao();
    expect(sim.pedir('>?00020263')).toBe(quadroH('02'));
  });
});
