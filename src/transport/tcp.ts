import net from 'node:net';
import { Framer } from '../protocols/companytec/framer.js';
import type { PumpSim, ResultadoQuadro } from '../sim.js';
import { type ConexaoMemoria, type SocketServido, criarParMemoria } from './memoria.js';

export interface PortaEscuta {
  /** Console port (2001, 1771, 857, 7002): it decides the read pointer. */
  logica: number;
  /** Port the socket actually listens on (same as the logical one, unless `mapa`). */
  fisica: number;
}

export interface OpcoesServidorTcp {
  host?: string;
  /** Logical ports. Default: the profile's TCP ports (real ones) or the 1st radio option (2.7.2). */
  portas?: number[];
  /**
   * Logical → physical. `0` = ephemeral port (tests, or two instances on the same machine).
   * The pointer is still the logical port's.
   */
  mapa?: Record<number, number>;
  ganchos?: GanchosTcp;
}

/** A client connection (the 2.7.2 `Memo2`, K19). */
export interface InfoConexao {
  id: number;
  logica: number;
  fisica: number;
  remoto: string;
  /** Connection instant, in ms of the simulator clock. */
  desde: number;
  rxBytes: number;
  txBytes: number;
}

/** What goes out on the socket after serving a frame (the default is one `enviar`). */
export type SaidaTcp =
  | { tipo: 'enviar'; bytes: Buffer; atrasoMs?: number }
  | { tipo: 'desconectar'; modo: 'rst' | 'fin'; atrasoMs?: number };

/**
 * Transport extension points: recording (recorder), fault injection and
 * connection refusal (control API). All optional.
 */
export interface GanchosTcp {
  /** false = the connection is dropped as soon as it arrives. */
  aceitar?(info: InfoConexao): boolean;
  aoConectar?(info: InfoConexao): void;
  aoFechar?(info: InfoConexao): void;
  /** Raw bytes as they came from the socket (before framing). */
  aoReceber?(info: InfoConexao, bytes: Buffer): void;
  /** Raw bytes as written to the socket (after faults). */
  aoEnviar?(info: InfoConexao, bytes: Buffer): void;
  /**
   * Serves a frame. `processar` runs the simulator; with no hook, the output is the
   * reply in a single `write` (or nothing, on silence).
   */
  atender?(info: InfoConexao, quadro: string, processar: (op?: { logTx?: boolean }) => ResultadoQuadro): SaidaTcp[];
}

interface Ouvinte {
  logica: number;
  fisica: number;
  server: net.Server;
  sockets: Map<SocketServido, InfoConexao>;
}

const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Default output: the reply in a single write. */
export function saidaPadrao(r: ResultadoQuadro): SaidaTcp[] {
  return r.resposta ? [{ tipo: 'enviar', bytes: Buffer.from(r.resposta, 'latin1') }] : [];
}

/**
 * TCP server with no native dependency.
 *
 * - Real profiles (`escutaTcp: 'simultanea'`): 2001, 1771 and 857 at the same time, each
 *   with its own read pointer (DT432 p.5-6).
 * - `simulador-2.7.2` (`'umaPorVez'`): a single TServerSocket; the port comes from the radio
 *   2001/1771/7002 and `trocarPorta` drops the connections, like turning the socket off.
 *
 * Socket reading: the current Q1 framer, re-read on every read (Q1 = each read is one command, `(&S` without `)`
 * served at once and any other fragment lost; otherwise, frames by
 * delimiter/length). Each reply goes out in a single
 * `write` (C#/VB clients do a single `Read`) and nothing is sent unsolicited.
 * Outputs of a socket are queued: an injected delay does not reorder them.
 */
export class ServidorTcp {
  private ouvintes: Ouvinte[] = [];
  private proximoId = 1;
  ganchos: GanchosTcp;

  private constructor(
    private sim: PumpSim,
    private readonly host: string,
    private readonly mapa: Record<number, number>,
    ganchos: GanchosTcp,
  ) {
    this.ganchos = ganchos;
  }

  static async abrir(sim: PumpSim, op: OpcoesServidorTcp = {}): Promise<ServidorTcp> {
    const perfil = sim.conc.perfil;
    const s = new ServidorTcp(sim, op.host ?? '0.0.0.0', op.mapa ?? {}, op.ganchos ?? {});
    let portas = op.portas;
    if (!portas || portas.length === 0) {
      portas =
        perfil.escutaTcp === 'umaPorVez'
          ? [perfil.opcoesPortaTcp[0] ?? 2001]
          : perfil.portas.filter((p) => p.tipo === 'tcp').map((p) => Number(p.porta));
    }
    if (perfil.escutaTcp === 'umaPorVez') {
      if (portas.length !== 1) throw new Error(`${perfil.id} escuta uma porta por vez (pedidas: ${portas.join(', ')})`);
      s.validarOpcao(portas[0]!);
    }
    try {
      for (const p of new Set(portas)) await s.ouvir(p);
    } catch (e) {
      await s.fechar();
      throw e;
    }
    return s;
  }

  /**
   * A server with no port listening yet (the requested port was taken at startup, EADDRINUSE).
   * `abrirPorta` opens one later, so the simulator keeps running and the UI can retry.
   */
  static vazio(sim: PumpSim, op: OpcoesServidorTcp = {}): ServidorTcp {
    return new ServidorTcp(sim, op.host ?? '0.0.0.0', op.mapa ?? {}, op.ganchos ?? {});
  }

  /** Swaps the served simulator (profile switch without dropping the ports). */
  usarSim(sim: PumpSim): void {
    this.sim = sim;
  }

  private validarOpcao(logica: number): void {
    const opcoes = this.sim.conc.perfil.opcoesPortaTcp;
    if (opcoes.length > 0 && !opcoes.includes(logica)) {
      throw new Error(`porta ${logica} fora das opções do ${this.sim.conc.perfil.id}: ${opcoes.join(', ')}`);
    }
  }

  private ouvir(logica: number): Promise<void> {
    const sockets = new Map<SocketServido, InfoConexao>();
    const ouvinte: Ouvinte = { logica, fisica: 0, server: undefined as unknown as net.Server, sockets };
    const server = net.createServer((sock) => this.atender(ouvinte, sock));
    ouvinte.server = server;
    const pedida = this.mapa[logica] ?? logica;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(pedida, this.host, () => {
        server.off('error', reject);
        const addr = server.address();
        ouvinte.fisica = typeof addr === 'object' && addr ? addr.port : pedida;
        this.ouvintes.push(ouvinte);
        resolve();
      });
    });
  }

  /**
   * Serves one client connection: a TCP socket, or an in-memory one ({@link ServidorTcp.conectarMemoria}).
   * Both go through this same path (framing, hooks, output queue, the Q2 10053 modal).
   */
  private atender(ouvinte: Ouvinte, sock: SocketServido): void {
    const { logica, sockets } = ouvinte;
    const id = `tcp:${logica}`;
    const info: InfoConexao = {
      id: this.proximoId++,
      logica,
      fisica: ouvinte.fisica,
      remoto: `${sock.remoteAddress ?? '?'}:${sock.remotePort ?? '?'}`,
      desde: this.sim.clock.now(),
      rxBytes: 0,
      txBytes: 0,
    };
    if (this.ganchos.aceitar && !this.ganchos.aceitar(info)) {
      this.sim.conc.registrarLog(id, 'INFO', `recusou ${info.remoto}`);
      sock.resetAndDestroy();
      return;
    }
    sockets.set(sock, info);
    sock.setNoDelay(true);
    let framer: Framer | null = null;
    let fila: Promise<void> = Promise.resolve();
    this.sim.conc.registrarLog(id, 'INFO', `conectou ${info.remoto}`);
    this.ganchos.aoConectar?.(info);
    const escrever = (bytes: Buffer) => {
      if (sock.destroyed) return;
      info.txBytes += bytes.length;
      this.ganchos.aoEnviar?.(info, bytes);
      sock.write(bytes);
    };
    sock.on('data', (buf: Buffer) => {
      info.rxBytes += buf.length;
      this.ganchos.aoReceber?.(info, buf);
      // The mode is read from the current state on every read (DECISIONS §11): set_quirk Q1,
      // set_perfil and snapshot_carregar change Q1 with the connection open. Only a new
      // mode rebuilds the framer; swapping the sim without changing the mode keeps the partial frame.
      const modo = this.sim.modoFramer();
      if (!framer || framer.modo !== modo) framer = new Framer(modo);
      const quadros = framer.receber(buf.toString('latin1'));
      for (const quadro of quadros) {
        const processar = (op?: { logTx?: boolean }) => {
          const r = this.sim.processarQuadro(quadro, id, op);
          // Reply held behind the modal (E3): goes out when it closes, outside the queue order.
          void r.adiada?.then((t) => escrever(Buffer.from(t, 'latin1')));
          return r;
        };
        const saidas = this.ganchos.atender ? this.ganchos.atender(info, quadro, processar) : saidaPadrao(processar());
        for (const s of saidas) {
          const executar = () => {
            if (s.tipo === 'enviar') escrever(s.bytes);
            else if (s.modo === 'rst') sock.resetAndDestroy();
            else sock.end();
          };
          if (!s.atrasoMs) {
            // No delay and an empty queue: write now (synchronous reply, K17).
            fila = fila.then(executar);
          } else {
            const ms = s.atrasoMs;
            fila = fila.then(() => espera(ms)).then(executar);
          }
        }
      }
    });
    sock.on('close', () => {
      sockets.delete(sock);
      this.sim.conc.registrarLog(id, 'INFO', 'desconectou');
      this.ganchos.aoFechar?.(info);
    });
    sock.on('error', (err: NodeJS.ErrnoException) => {
      // Q2 (verdict #92, bench error notes E1): the 2.7.2 does not handle the client socket error,
      // so it opens "Asynchronous socket error 10053." on every abrupt client drop (RST). FIN
      // arrives as FD_CLOSE without error and opens nothing. The listener keeps serving.
      if ((err.code === 'ECONNRESET' || err.code === 'EPIPE') && this.sim.conc.q('Q2')) {
        this.sim.conc.travar('Asynchronous socket error 10053.');
      }
    });
  }

  /**
   * In-memory client connection to the listening logical port `logica`, served by the same path
   * as a TCP socket. For the recorded-oracle replay (`src/diff/oraculo.ts`): no socket, no real
   * wait. Throws (like ECONNREFUSED) when that logical port is not listening.
   */
  conectarMemoria(logica: number): ConexaoMemoria {
    const o = this.ouvintes.find((x) => x.logica === logica);
    if (!o) throw Object.assign(new Error(`connect ECONNREFUSED memoria:${logica}`), { code: 'ECONNREFUSED' });
    const par = criarParMemoria(`memoria:${this.proximoId}`);
    this.atender(o, par.servidor);
    return par.cliente;
  }

  portas(): PortaEscuta[] {
    return this.ouvintes.map(({ logica, fisica }) => ({ logica, fisica }));
  }

  /** Physical port of a logical one (useful with an ephemeral `mapa`). */
  fisica(logica: number): number | undefined {
    return this.ouvintes.find((o) => o.logica === logica)?.fisica;
  }

  conexoes(): number {
    return this.ouvintes.reduce((n, o) => n + o.sockets.size, 0);
  }

  /** Connected clients (K19). */
  listarConexoes(): InfoConexao[] {
    return this.ouvintes.flatMap((o) => [...o.sockets.values()].map((i) => ({ ...i })));
  }

  /**
   * Drops connections: by id, by logical port, or all. `rst` = RST (reset),
   * `fin` = normal close. Returns how many dropped.
   */
  desconectar(filtro: { id?: number; porta?: number; modo?: 'rst' | 'fin' } = {}): number {
    let n = 0;
    for (const o of this.ouvintes) {
      if (filtro.porta !== undefined && o.logica !== filtro.porta) continue;
      for (const [sock, info] of o.sockets) {
        if (filtro.id !== undefined && info.id !== filtro.id) continue;
        if (filtro.modo === 'fin') sock.end();
        else sock.resetAndDestroy();
        n++;
      }
    }
    return n;
  }

  /** Opens one more port (real profiles). */
  async abrirPorta(logica: number): Promise<void> {
    if (this.ouvintes.some((o) => o.logica === logica)) return;
    if (this.sim.conc.perfil.escutaTcp === 'umaPorVez') {
      await this.trocarPorta(logica);
      return;
    }
    await this.ouvir(logica);
  }

  /** Closes a port and its connections. */
  async fecharPorta(logica: number): Promise<void> {
    const o = this.ouvintes.find((x) => x.logica === logica);
    if (!o) return;
    this.ouvintes = this.ouvintes.filter((x) => x !== o);
    await ServidorTcp.fecharOuvinte(o);
  }

  /** Single-port profile only (2.7.2 radio): closes the current one and opens `logica`. */
  async trocarPorta(logica: number): Promise<void> {
    if (this.sim.conc.perfil.escutaTcp !== 'umaPorVez') {
      throw new Error(`${this.sim.conc.perfil.id} escuta as portas simultaneamente; não há troca`);
    }
    this.validarOpcao(logica);
    await this.fechar();
    await this.ouvir(logica);
  }

  private static fecharOuvinte(o: Ouvinte): Promise<void> {
    return new Promise<void>((res) => {
      for (const s of o.sockets.keys()) s.destroy();
      o.server.close(() => res());
    });
  }

  async fechar(): Promise<void> {
    const ouvintes = this.ouvintes;
    this.ouvintes = [];
    await Promise.all(ouvintes.map((o) => ServidorTcp.fecharOuvinte(o)));
  }
}
