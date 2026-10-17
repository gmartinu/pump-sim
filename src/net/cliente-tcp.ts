import net from 'node:net';
import { performance } from 'node:perf_hooks';

export interface Alvo {
  host: string;
  porta: number;
}

/** "127.0.0.1:2001" → { host, porta }. No host = 127.0.0.1. */
export function lerAlvo(s: string): Alvo {
  const i = s.lastIndexOf(':');
  const host = i > 0 ? s.slice(0, i) : '127.0.0.1';
  const porta = Number(i >= 0 ? s.slice(i + 1) : s);
  if (!Number.isInteger(porta) || porta <= 0 || porta > 65535) throw new Error(`alvo inválido: ${s} (use host:porta)`);
  return { host, porta };
}

export interface OpcoesTroca {
  /** Interval between the chunks of one send (fragmentation, DIFF-04). */
  intervaloMs?: number;
  /** No byte within `timeoutMs` = silence. Default 1000. */
  timeoutMs?: number;
  /** After the 1st byte, the reply ends after `ociosoMs` with no new bytes. Default 150. */
  ociosoMs?: number;
  /**
   * Ends the reply as soon as the last byte received is this char (e.g. `)` for a one-frame
   * reply), without waiting `ociosoMs` of silence. For long protocol-only loops (DIFF-17R/13R).
   */
  terminador?: string;
  /**
   * Ends the reply as soon as this returns true for the bytes received so far (a complete
   * protocol frame), without waiting `ociosoMs` of silence. Checked on every chunk; when it never
   * returns true the reply ends on the idle silence as before. The client itself does not
   * interpret the protocol: the caller supplies the rule (`src/diff/resposta.ts`).
   */
  completo?: (rx: Buffer) => boolean;
}

export interface ResultadoTroca {
  bytes: Buffer;
  /** ms from the last chunk sent to the 1st byte received; null = silence. */
  latenciaMs: number | null;
  /** The connection dropped during the exchange. */
  caiu: boolean;
  /**
   * Bytes that arrived after the previous exchange on this connection ended and before this one
   * sent anything: the late tail of an earlier reply. They are not part of `bytes`. Absent = none.
   */
  atrasados?: Buffer;
}

/** What the diff executor needs from a client connection ({@link ClienteTcp}, or an in-memory one). */
export interface ConexaoTroca {
  readonly caiu: boolean;
  trocar(pedacos: (string | Buffer)[], op?: OpcoesTroca): Promise<ResultadoTroca>;
  fechar(): void;
  fecharRst(): void;
}

const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Test TCP client: sends raw chunks and gathers what comes back until silence.
 * Used by the diff and by the replay client. Does not interpret the protocol.
 */
export class ClienteTcp implements ConexaoTroca {
  private rx: Buffer[] = [];
  private ultimoByte = 0;
  private primeiroByte: number | null = null;
  private fechado = false;
  private avisar: (() => void) | null = null;

  private constructor(private readonly sock: net.Socket) {
    sock.setNoDelay(true);
    sock.on('data', (b) => {
      const t = performance.now();
      if (this.primeiroByte === null) this.primeiroByte = t;
      this.ultimoByte = t;
      this.rx.push(b);
      this.avisar?.();
    });
    sock.on('close', () => {
      this.fechado = true;
      this.avisar?.();
    });
    sock.on('error', () => undefined);
  }

  static conectar(alvo: Alvo, timeoutMs = 3000): Promise<ClienteTcp> {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: alvo.host, port: alvo.porta });
      const t = setTimeout(() => {
        sock.destroy();
        reject(new Error(`timeout conectando em ${alvo.host}:${alvo.porta}`));
      }, timeoutMs);
      sock.once('connect', () => {
        clearTimeout(t);
        resolve(new ClienteTcp(sock));
      });
      sock.once('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
  }

  get caiu(): boolean {
    return this.fechado;
  }

  /** Sends the chunks (each in one write) and waits for the reply. */
  async trocar(pedacos: (string | Buffer)[], op: OpcoesTroca = {}): Promise<ResultadoTroca> {
    const timeoutMs = op.timeoutMs ?? 1000;
    const ociosoMs = op.ociosoMs ?? 150;
    const atrasados = this.rx.length ? Buffer.concat(this.rx) : null;
    this.rx = [];
    this.primeiroByte = null;
    for (let i = 0; i < pedacos.length; i++) {
      if (this.fechado) break;
      const p = pedacos[i]!;
      this.sock.write(typeof p === 'string' ? Buffer.from(p, 'latin1') : p);
      if (i < pedacos.length - 1 && op.intervaloMs) await espera(op.intervaloMs);
    }
    const enviadoEm = performance.now();
    const fim = op.terminador ? op.terminador.charCodeAt(0) : null;
    for (;;) {
      if (this.fechado) break;
      if (fim !== null && this.primeiroByte !== null) {
        const ult = this.rx[this.rx.length - 1]!;
        if (ult.length > 0 && ult[ult.length - 1] === fim) break;
      }
      if (op.completo && this.primeiroByte !== null && op.completo(Buffer.concat(this.rx))) break;
      const agora = performance.now();
      if (this.primeiroByte === null) {
        if (agora - enviadoEm >= timeoutMs) break;
      } else if (agora - this.ultimoByte >= ociosoMs) {
        break;
      }
      const limite =
        this.primeiroByte === null ? timeoutMs - (agora - enviadoEm) : ociosoMs - (agora - this.ultimoByte);
      await new Promise<void>((r) => {
        const t = setTimeout(r, Math.max(1, limite));
        this.avisar = () => {
          clearTimeout(t);
          r();
        };
      });
      this.avisar = null;
    }
    const bytes = Buffer.concat(this.rx);
    // What arrives from now on belongs to no exchange yet (reported by the next one as `atrasados`).
    this.rx = [];
    return {
      bytes,
      latenciaMs: this.primeiroByte === null ? null : Math.max(0, Math.round(this.primeiroByte - enviadoEm)),
      caiu: this.fechado,
      ...(atrasados && atrasados.length ? { atrasados } : {}),
    };
  }

  fechar(): void {
    this.sock.destroy();
  }

  /** Abrupt drop: closes with RST (on the 2.7.2 it opens the "Asynchronous socket error 10053." modal). */
  fecharRst(): void {
    this.sock.resetAndDestroy();
  }
}
