import { EventEmitter } from 'node:events';
import type { ConexaoTroca, OpcoesTroca, ResultadoTroca } from '../net/cliente-tcp.js';

/**
 * What {@link ServidorTcp} uses from a client socket. `net.Socket` satisfies it; so does the
 * server end of an in-memory pair ({@link criarParMemoria}).
 */
export interface SocketServido {
  readonly remoteAddress?: string | undefined;
  readonly remotePort?: number | string | undefined;
  readonly destroyed: boolean;
  on(evento: 'data', fn: (b: Buffer) => void): unknown;
  on(evento: 'close', fn: () => void): unknown;
  on(evento: 'error', fn: (e: NodeJS.ErrnoException) => void): unknown;
  setNoDelay(on?: boolean): unknown;
  write(b: Buffer): unknown;
  end(): unknown;
  destroy(): unknown;
  resetAndDestroy(): unknown;
}

/** One macrotask turn: lets the server's output queue (promise chain) and held replies run. */
const volta = () => new Promise<void>((r) => setImmediate(r));

/** Server end of the pair: the server writes into the client's buffer. */
class SocketServidorMemoria extends EventEmitter implements SocketServido {
  destroyed = false;
  readonly remoteAddress = 'memoria';
  constructor(
    readonly remotePort: string,
    private readonly cliente: ConexaoMemoria,
  ) {
    super();
  }
  setNoDelay(): this {
    return this;
  }
  write(b: Buffer): boolean {
    if (this.destroyed) return false;
    this.cliente.receber(b);
    return true;
  }
  end(): this {
    this.encerrar();
    return this;
  }
  destroy(): this {
    this.encerrar();
    return this;
  }
  resetAndDestroy(): this {
    this.encerrar();
    return this;
  }
  /** Closes both ends; `erro` first emits the socket error the server would see (RST = ECONNRESET). */
  encerrar(erro?: string): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cliente.marcarFechado();
    queueMicrotask(() => {
      if (erro) this.emit('error', Object.assign(new Error(erro), { code: erro }));
      this.emit('close');
    });
  }
}

/**
 * Client end of an in-memory connection. Same contract as {@link ClienteTcp} for the diff
 * executor, but deterministic and with no real wait: each chunk is one server read, and the reply
 * is everything the server wrote once its output queue settled (no `timeoutMs`/`ociosoMs`). A
 * silence costs nothing. Delays that only exist in real time (an injected fault `atrasoMs`) are
 * not waited for: their bytes are lost to this exchange, as after a timeout.
 */
export class ConexaoMemoria implements ConexaoTroca {
  private rx: Buffer[] = [];
  private fechado = false;
  servidor!: SocketServidorMemoria;

  get caiu(): boolean {
    return this.fechado;
  }

  /** @internal */
  receber(b: Buffer): void {
    this.rx.push(Buffer.from(b));
  }

  /** @internal */
  marcarFechado(): void {
    this.fechado = true;
  }

  private tamanho(): number {
    return this.rx.reduce((n, b) => n + b.length, 0);
  }

  private async assentar(): Promise<void> {
    let antes = -1;
    for (let i = 0; i < 64; i++) {
      await volta();
      const n = this.tamanho();
      if (n === antes) return;
      antes = n;
    }
  }

  async trocar(pedacos: (string | Buffer)[], _op: OpcoesTroca = {}): Promise<ResultadoTroca> {
    this.rx = [];
    for (const p of pedacos) {
      if (this.fechado) break;
      this.servidor.emit('data', typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p));
      await this.assentar();
    }
    if (pedacos.length === 0) await this.assentar();
    const bytes = Buffer.concat(this.rx);
    return { bytes, latenciaMs: bytes.length ? 0 : null, caiu: this.fechado };
  }

  /** Normal close (FIN). */
  fechar(): void {
    this.servidor.encerrar();
  }

  /** Abrupt drop (RST): the server sees ECONNRESET first. */
  fecharRst(): void {
    this.servidor.encerrar('ECONNRESET');
  }
}

/** A connected in-memory pair (server end for {@link ServidorTcp}, client end for the diff). */
export function criarParMemoria(remotePort: string): { servidor: SocketServidorMemoria; cliente: ConexaoMemoria } {
  const cliente = new ConexaoMemoria();
  const servidor = new SocketServidorMemoria(remotePort, cliente);
  cliente.servidor = servidor;
  return { servidor, cliente };
}
