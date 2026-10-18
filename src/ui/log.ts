import fs from 'node:fs';
import path from 'node:path';

/**
 * Log file of the Windows executable (DECISIONS §34). The executable is a GUI-subsystem program (no
 * console), so whatever it writes to stdout/stderr is also appended to
 * `%LOCALAPPDATA%\pump-sim\logs\pump-sim.log` (UTF-8, one timestamp per line), rotated at 5 MB
 * keeping 3 old files (`pump-sim.log.1` newest .. `.3` oldest). The UI reads its tail through
 * `GET /api/logs` of the control API. Nothing here throws: a log that cannot be written is dropped.
 */

export const LOG_MAX_BYTES = 5 * 1024 * 1024;
export const LOG_MANTER = 3;
export const NOME_LOG = 'pump-sim.log';
/** Default and maximum tail returned by `/api/logs`. */
export const CAUDA_PADRAO = 64 * 1024;
export const CAUDA_MAX = 1024 * 1024;

/** Folder of the log files. */
export function dirLogs(env: NodeJS.ProcessEnv, home: string): string {
  return path.win32.join(env['LOCALAPPDATA'] ?? path.win32.join(home, 'AppData', 'Local'), 'pump-sim', 'logs');
}

export interface OpcoesLog {
  arquivo: string;
  agora: () => Date;
  maxBytes?: number;
  manter?: number;
}

/** Appending, size-rotated log file. */
export class LogArquivo {
  readonly arquivo: string;
  private readonly agora: () => Date;
  private readonly maxBytes: number;
  private readonly manter: number;
  private fd: number | null = null;
  private tamanho = 0;
  private inicioLinha = true;

  constructor(o: OpcoesLog) {
    this.arquivo = o.arquivo;
    this.agora = o.agora;
    this.maxBytes = o.maxBytes ?? LOG_MAX_BYTES;
    this.manter = o.manter ?? LOG_MANTER;
  }

  private abrir(): boolean {
    if (this.fd !== null) return true;
    try {
      fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
      this.fd = fs.openSync(this.arquivo, 'a');
      this.tamanho = fs.fstatSync(this.fd).size;
      return true;
    } catch {
      this.fd = null;
      return false;
    }
  }

  /** `pump-sim.log` → `.1`, `.1` → `.2`, ... the oldest beyond `manter` is deleted. */
  private rodar(): void {
    this.fechar();
    try {
      fs.rmSync(`${this.arquivo}.${this.manter}`, { force: true });
      for (let i = this.manter - 1; i >= 1; i--) {
        if (fs.existsSync(`${this.arquivo}.${i}`)) fs.renameSync(`${this.arquivo}.${i}`, `${this.arquivo}.${i + 1}`);
      }
      if (this.manter >= 1) fs.renameSync(this.arquivo, `${this.arquivo}.1`);
      else fs.rmSync(this.arquivo, { force: true });
    } catch {
      // Another instance holds or already moved the file: keep appending to whatever is there.
    }
  }

  /** Appends `texto`, prefixing each new line with an ISO timestamp. */
  escrever(texto: string | Uint8Array): void {
    let s = typeof texto === 'string' ? texto : Buffer.from(texto).toString('utf8');
    if (!s) return;
    const ts = `${this.agora().toISOString()} `;
    let out = '';
    for (const parte of s.split(/(?<=\n)/)) {
      out += (this.inicioLinha ? ts : '') + parte;
      this.inicioLinha = parte.endsWith('\n');
    }
    s = out;
    const bytes = Buffer.from(s, 'utf8');
    if (!this.abrir()) return;
    if (this.tamanho > 0 && this.tamanho + bytes.length > this.maxBytes) {
      this.rodar();
      if (!this.abrir()) return;
    }
    try {
      fs.writeSync(this.fd!, bytes);
      this.tamanho += bytes.length;
    } catch {
      // disk full or file gone: drop this chunk
    }
  }

  fechar(): void {
    if (this.fd === null) return;
    try {
      fs.closeSync(this.fd);
    } catch {
      // already closed
    }
    this.fd = null;
  }
}

/** The last `maxBytes` of `arquivo`, starting at a whole line; '' when it does not exist. */
export function lerCauda(arquivo: string, maxBytes = CAUDA_PADRAO): { texto: string; tamanho: number } {
  let fd: number;
  try {
    fd = fs.openSync(arquivo, 'r');
  } catch {
    return { texto: '', tamanho: 0 };
  }
  try {
    const tamanho = fs.fstatSync(fd).size;
    const n = Math.min(tamanho, Math.max(0, Math.floor(maxBytes)));
    const b = Buffer.alloc(n);
    fs.readSync(fd, b, 0, n, tamanho - n);
    let texto = b.toString('utf8');
    if (n < tamanho) {
      // Cut mid-line (and maybe mid-character): start after the first newline.
      const i = texto.indexOf('\n');
      texto = i >= 0 ? texto.slice(i + 1) : '';
    }
    return { texto, tamanho };
  } finally {
    fs.closeSync(fd);
  }
}

type Escrita = (chunk: unknown, ...resto: unknown[]) => boolean;

/**
 * Copies every write of `stream` into `log` and still passes it on (a redirected stdout of the
 * executable keeps working; without a console Node's stream is a sink). Returns the undo.
 */
export function espelhar(stream: NodeJS.WriteStream, log: LogArquivo): () => void {
  const original = stream.write as unknown as Escrita;
  const novo: Escrita = function (this: unknown, chunk, ...resto) {
    if (typeof chunk === 'string' || chunk instanceof Uint8Array) log.escrever(chunk);
    return original.call(stream, chunk, ...resto);
  };
  (stream as unknown as { write: Escrita }).write = novo;
  return () => {
    (stream as unknown as { write: Escrita }).write = original;
  };
}
