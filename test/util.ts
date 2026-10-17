import { ManualClock, PumpSim, checksum, type IDS_PERFIS } from '../src/index.js';

export type IdPerfil = (typeof IDS_PERFIS)[number];

export const novo = (perfil: IdPerfil = 'simulador-2.7.2') => {
  const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
  const sim = new PumpSim({ perfil, clock, configPadrao: true });
  return { sim, clock };
};

/** `(` + body + KK + `)` */
export const kk = (corpo: string) => `(${corpo}${checksum(corpo)})`;

export function passo(sim: PumpSim, clock: ManualClock, ms: number) {
  clock.advance(ms);
  sim.atualizar();
}

/** Lifts the nozzle, lets it flow for `ms`, hangs up and stores the record. */
export function abastecer(sim: PumpSim, clock: ManualClock, codigo: number, ms: number) {
  sim.conc.retirarBico(codigo);
  passo(sim, clock, 1000);
  passo(sim, clock, ms);
  sim.conc.recolocarBico(codigo);
  passo(sim, clock, 1000);
}
