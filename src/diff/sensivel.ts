import type { CasoDiff, PassoEnviar } from './roteiros.js';

/**
 * Timing sensitivity of a case script's `enviar` steps (DECISIONS §24 O8). Shared by the recorded
 * oracle (metadata in the fixtures) and the live diff (the Wine free-flow tolerance, §26).
 */

/** Why a step's reply depends on time and not only on behavior (metadata; the masks do the work). */
export type SensivelTempo = 'relogio' | 'bateria' | 'vazao-livre';

export interface NotaPasso {
  ignorarFim?: number;
  mascara?: PassoEnviar['mascara'];
  sensivel: SensivelTempo[];
  /** Side-A actions (driver `drenar`/`acao`) before this step. */
  acoesAntes: number;
}

const LEITURA_VOLUME = /^\(?(&A|&V|&T|&LR|&@|&L|\?A)/;

/**
 * Per `enviar` step of the script: masks, timing sensitivity, and how many side-A actions (driver
 * `drenar`/`acao`) come before it. A free-flow fueling (`retirar`/`abastecer` with no `&P` since the
 * last one) marks the volume reads after it `vazao-livre` (until an `&E` sets the totalizer).
 */
export function anotarRoteiro(c: CasoDiff): NotaPasso[] {
  const out: NotaPasso[] = [];
  let preset = false;
  let livre = false;
  let acoes = 0;
  for (const p of c.passos) {
    if ('drenar' in p) acoes++;
    else if ('acao' in p) {
      acoes++;
      if (p.acao === 'retirar' || p.acao === 'abastecer') {
        if (!preset) livre = true;
        preset = false;
      }
    } else if ('enviar' in p) {
      const q = Array.isArray(p.enviar) ? p.enviar.join('') : p.enviar;
      if (q.startsWith('(&P')) preset = true;
      if (q.startsWith('(&E')) livre = false;
      const sensivel: SensivelTempo[] = [];
      if (p.mascara?.length) sensivel.push('relogio');
      if (p.ignorarFim) sensivel.push('bateria');
      if (livre && LEITURA_VOLUME.test(q)) sensivel.push('vazao-livre');
      out.push({
        ...(p.ignorarFim ? { ignorarFim: p.ignorarFim } : {}),
        ...(p.mascara?.length ? { mascara: p.mascara } : {}),
        sensivel,
        acoesAntes: acoes,
      });
    }
  }
  return out;
}
