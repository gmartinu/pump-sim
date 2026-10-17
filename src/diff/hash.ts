import { createHash } from 'node:crypto';
import type { CasoDiff } from './roteiros.js';

/**
 * Fields that only describe a step to a person (report text, operator prompt): changing them does
 * not change what is sent, done, waited for or compared, so they stay out of the script hash.
 */
const SO_TEXTO = new Set(['nota', 'semDriver', 'titulo', 'resolve', 'opcional']);
/**
 * Fields that only tell the executor how long to listen for a reply the bench showed never comes
 * (`PassoEnviar.silencio`): what is sent, done and compared is the same, so a recording stays valid.
 * Every flagged step is checked against its recorded silence in `test/diff-tempo.test.ts`.
 */
const SO_ESCUTA = new Set(['silencio']);

function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      if (SO_TEXTO.has(k) || SO_ESCUTA.has(k) || o[k] === undefined) continue;
      // A `manual` step's text is the operator prompt; only its presence matters.
      out[k] = k === 'manual' ? true : canonico(o[k]);
    }
    return out;
  }
  return v;
}

/**
 * Stable hash of a case's script: frames, chunking, connections/ports, timeouts, waits, actions,
 * `manual` control commands, drains, masks, `esperado`, `dependeDe` and the comparison mode, with
 * keys sorted. Text-only fields (notes, operator prompts, titles) and the expected-silence listening
 * hint (`silencio`) are left out. A recorded oracle
 * case is only replayed against the script whose hash it was recorded with (`oraculo.ts`).
 */
export function hashRoteiro(caso: CasoDiff): string {
  const corpo = canonico({ id: caso.id, comparacao: caso.comparacao ?? 'bytes', passos: caso.passos });
  return 'sha256:' + createHash('sha256').update(JSON.stringify(corpo)).digest('hex').slice(0, 32);
}
