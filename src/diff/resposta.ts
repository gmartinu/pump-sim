/**
 * When a diff reply is complete, from the frame that was sent (protocol framing only).
 *
 * The diff used to end every reply after 150 ms with no new byte (`ociosoMs`). That idle tail is
 * pure waiting once the protocol frame is closed, so the executor ends the reply as soon as the
 * frame is complete and keeps the idle tail only where the frame is not enough:
 *
 * - Companytec `(&…)` and Identfid `(?…)`: complete when the last byte received is `)`. Every reply
 *   of these protocols is one parenthesized frame, except the ones in {@link REPLY_MULTIPLA}.
 * - Horustech `>?…`: complete when `>!` + 4 hex digits of length L + L chars + the 2-char KK
 *   have arrived (`>!00043200AA`: L = 4, 12 chars). Anything else (more bytes, a non-hex length)
 *   falls back to the idle tail.
 * - A send with more than one frame (`(&S)(&V)`, DIFF-04) can get one reply or two depending on
 *   the target (only the first on the 2.7.2, Q1), so it keeps the idle tail.
 * - A step sent in several chunks (`intervaloMs`, DIFF-04) keeps the idle tail too (the executor
 *   does not pass the rule): the reply may come before the last chunk is read, and the next frame
 *   would go out right behind that chunk.
 *
 * The rule only shortens how long the executor listens after a complete frame. A reply the rule
 * does not recognize ends on the idle tail as before, and bytes that still arrive after a reply
 * was cut show up on the next step of the same connection as `atrasados` (see `ClienteTcp`).
 */

/** Companytec verbs whose reply is several parenthesized groups: `&R` = `(REL …)(DHA …)(C…)…`. */
export const REPLY_MULTIPLA: readonly string[] = ['&R'];

const FECHA = 0x29; // ')'

/** Number of frame starts (`(` of Companytec/Identfid, `>?` of Horustech) at frame boundaries. */
function quadrosNoEnvio(q: string): number {
  let n = 0;
  for (let i = 0; i < q.length; i++) {
    if (q[i] === '(' && (q[i + 1] === '&' || q[i + 1] === '?')) n++;
    else if (q[i] === '>' && q[i + 1] === '?') n++;
  }
  return n;
}

/** Horustech reply `>!LLLL…KK`: complete at exactly 2 + 4 + L + 2 chars. */
function horustechCompleto(rx: Buffer): boolean {
  if (rx.length < 6 || rx[0] !== 0x3e || rx[1] !== 0x21) return false;
  const cab = rx.toString('latin1', 2, 6);
  if (!/^[0-9A-Fa-f]{4}$/.test(cab)) return false;
  return rx.length === 8 + parseInt(cab, 16);
}

const companytecCompleto = (rx: Buffer): boolean => rx.length > 0 && rx[rx.length - 1] === FECHA;

/**
 * The rule that ends the reply to `enviado` (all chunks of the step, joined), or `undefined` when
 * the reply must end on the idle tail (multi-frame send, multi-group reply, unknown protocol).
 */
export function fimDaResposta(enviado: string): ((rx: Buffer) => boolean) | undefined {
  const q = enviado.replace(/[\r\n]+$/, '');
  if (quadrosNoEnvio(q) !== 1) return undefined;
  if (q.startsWith('>?')) return horustechCompleto;
  if (q.startsWith('(?')) return companytecCompleto;
  if (q.startsWith('(&')) {
    const verbo = q.slice(1);
    if (REPLY_MULTIPLA.some((v) => verbo.startsWith(v))) return undefined;
    return companytecCompleto;
  }
  return undefined;
}

/** Default wait for a step whose reply is expected to be silence (see `PassoEnviar.silencio`). */
export const TIMEOUT_SILENCIO_PADRAO_MS = 400;
