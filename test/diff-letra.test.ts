/**
 * `&S` letter after `&P` and after `&M B` (docs/DECISIONS.md §28): the 2.7.2 shows the new letter only
 * on a later tick of a ~100 ms timer with a free phase (measured under Wine: 4–107 ms after the frame),
 * so a read right after the frame races that timer. The scripts wait for the letter (L1) instead of
 * masking it; `&M S` → C is at once on the 2.7.2 and keeps its immediate read.
 */
import { describe, expect, it } from 'vitest';
import { type Passo, TICK_ESTADO_MS, TICK_VAZAO_MS, roteiro } from '../src/index.js';

/** The steps from the `enviar` of `quadro` up to the next `(&S)` read. */
function ateOProximoS(id: string, quadro: string): Passo[] {
  const passos = roteiro(id)!.passos;
  const i = passos.findIndex((p) => 'enviar' in p && p.enviar === quadro);
  expect(i, `${id} ${quadro}`).toBeGreaterThanOrEqual(0);
  const j = passos.findIndex((p, k) => k > i && 'enviar' in p && p.enviar === '(&S)');
  return passos.slice(i + 1, j);
}

describe('&S lido depois da letra do 2.7.2 assentar (§28 L1)', () => {
  it('EQUIV-COMANDOS #35: entre o &P e o &S há só a espera de 2 ticks de vazão + 100 ms', () => {
    expect(ateOProximoS('EQUIV-COMANDOS', '(&P04000500FF)')).toEqual([{ aguardar: 2 * TICK_VAZAO_MS + 100 }]);
  });

  it('EQUIV-MOTOR #26: entre o &M04B e o &S há só a mesma espera', () => {
    expect(ateOProximoS('EQUIV-MOTOR', '(&M04B19)')).toEqual([{ aguardar: 2 * TICK_VAZAO_MS + 100 }]);
  });

  it('a espera cobre o maior atraso medido (107 ms) e fica bem abaixo de um tick de estado', () => {
    const espera = 2 * TICK_VAZAO_MS + 100;
    expect(espera).toBeGreaterThan(107);
    expect(espera).toBeLessThan(TICK_ESTADO_MS / 2);
  });

  it('#27 &M S → C segue lido logo depois do quadro (imediato no 2.7.2)', () => {
    expect(ateOProximoS('EQUIV-MOTOR', '(&M04S2A)')).toEqual([]);
  });
});
