/**
 * Traffic recording format: JSONL, one line per socket event.
 *
 * ```json
 * {"ts":1760630400000,"porta":2001,"conexao":1,"dir":"rx","bytes":"28265329","texto":"(&S)"}
 * ```
 *
 * - `ts`: ms since the Unix epoch, from the simulator clock (injectable).
 * - `porta`: console logical port (2001, 1771, 857, 7002), or the id of another port.
 * - `conexao`: connection id, unique in the process; links rx/tx/abre/fecha of the same connection.
 * - `dir`: `rx` (client → simulator), `tx` (simulator → client), `abre`, `fecha`,
 *   or `meta` (1st line: profile, version; `porta` and `conexao` are 0).
 * - `bytes`: the raw bytes in lowercase hex, exactly as they went through the socket
 *   (an `rx` is one socket read, not a frame; a `tx` is one `write`).
 * - `texto`: the same bytes in latin1, for human reading only (optional, ignored in replay).
 */
export type DirecaoGravacao = 'rx' | 'tx' | 'abre' | 'fecha' | 'meta';

export interface LinhaGravacao {
  ts: number;
  porta: number | string;
  conexao: number;
  dir: DirecaoGravacao;
  bytes: string;
  texto?: string;
  meta?: Record<string, unknown>;
}

export function linha(ts: number, porta: number | string, conexao: number, dir: DirecaoGravacao, bytes: Buffer): LinhaGravacao {
  const l: LinhaGravacao = { ts, porta, conexao, dir, bytes: bytes.toString('hex') };
  if (bytes.length > 0) l.texto = bytes.toString('latin1');
  return l;
}

export function serializar(l: LinhaGravacao): string {
  return JSON.stringify(l);
}

/** Reads a recording JSONL. Empty lines are ignored; invalid lines raise an error with the line number. */
export function lerGravacao(conteudo: string): LinhaGravacao[] {
  const out: LinhaGravacao[] = [];
  conteudo.split(/\r?\n/).forEach((s, i) => {
    if (s.trim() === '') return;
    let o: unknown;
    try {
      o = JSON.parse(s);
    } catch {
      throw new Error(`gravação: linha ${i + 1} não é JSON`);
    }
    const l = o as Partial<LinhaGravacao>;
    if (
      typeof l.ts !== 'number' ||
      (typeof l.porta !== 'number' && typeof l.porta !== 'string') ||
      typeof l.conexao !== 'number' ||
      !['rx', 'tx', 'abre', 'fecha', 'meta'].includes(String(l.dir)) ||
      typeof l.bytes !== 'string' ||
      !/^([0-9a-fA-F]{2})*$/.test(l.bytes)
    ) {
      throw new Error(`gravação: linha ${i + 1} fora do formato {ts, porta, conexao, dir, bytes}`);
    }
    out.push(l as LinhaGravacao);
  });
  return out;
}

export const bytesDe = (l: LinhaGravacao): Buffer => Buffer.from(l.bytes, 'hex');

/** A recorded exchange: what the client sent in one read and what came back until the next. */
export interface TrocaGravada {
  porta: number | string;
  conexao: number;
  ts: number;
  rx: Buffer;
  tx: Buffer;
  /** ms between the rx and the 1st tx (null = silence). */
  latenciaMs: number | null;
}

/** Groups the lines into exchanges per connection, in recorded order. */
export function trocas(linhas: LinhaGravacao[]): TrocaGravada[] {
  const out: TrocaGravada[] = [];
  const aberta = new Map<number, TrocaGravada>();
  for (const l of linhas) {
    if (l.dir === 'rx') {
      const t: TrocaGravada = { porta: l.porta, conexao: l.conexao, ts: l.ts, rx: bytesDe(l), tx: Buffer.alloc(0), latenciaMs: null };
      out.push(t);
      aberta.set(l.conexao, t);
    } else if (l.dir === 'tx') {
      const t = aberta.get(l.conexao);
      if (!t) continue;
      if (t.latenciaMs === null) t.latenciaMs = l.ts - t.ts;
      t.tx = Buffer.concat([t.tx, bytesDe(l)]);
    } else if (l.dir === 'fecha') {
      aberta.delete(l.conexao);
    }
  }
  return out;
}
