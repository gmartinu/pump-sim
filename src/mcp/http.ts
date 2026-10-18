import { randomUUID } from 'node:crypto';
import type http from 'node:http';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Clock } from '../core/clock.js';
import { type ExecutorMcp, montarServidorMcp } from './servidor.js';

/** One MCP client connected to `/mcp` (one MCP session). */
export interface SessaoMcp {
  /** First 8 chars of the session id (the full id is a credential-like handle: never shown). */
  id: string;
  /** `clientInfo.name` / `version` of `initialize`. */
  cliente: string;
  versao: string;
  desde: number;
  /** Last request of this session (any JSON-RPC message, tool call or not). */
  ultima: number;
  chamadas: number;
}

export interface StatusMcpHttp {
  ativo: boolean;
  sessoes: SessaoMcp[];
}

interface Entrada {
  transporte: StreamableHTTPServerTransport;
  server: Server;
  info: Omit<SessaoMcp, 'cliente' | 'versao'>;
}

/** A session with no request for this long is closed (a client that went away without a DELETE). */
export const OCIOSA_MS = 30 * 60 * 1000;
/** Upper bound of open sessions; the oldest idle one is closed first. */
const MAX_SESSOES = 32;

const erroJsonRpc = (res: http.ServerResponse, status: number, mensagem: string) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: mensagem }, id: null }));
};

/**
 * Streamable HTTP MCP endpoint of the control server (`/mcp`, DECISIONS §33): stateful sessions
 * (`mcp-session-id`), one MCP `Server` per session over the same tool definitions as the stdio
 * server, calling the commands in process. Can be switched off at runtime (`ativo`): it then answers
 * 503 and closes the open sessions. Origin/Host/content-type checks are done by the control server
 * before it gets here.
 */
export class McpHttp {
  private readonly sessoes = new Map<string, Entrada>();
  private _ativo: boolean;

  constructor(
    private readonly executar: ExecutorMcp,
    private readonly clock: Clock,
    ativo = true,
  ) {
    this._ativo = ativo;
  }

  get ativo(): boolean {
    return this._ativo;
  }

  async definirAtivo(ativo: boolean): Promise<void> {
    this._ativo = ativo;
    if (!ativo) await this.fechar();
  }

  status(): StatusMcpHttp {
    this.podar();
    // The client info is only known once the server has handled `initialize` (after the session id).
    const sessoes = [...this.sessoes.values()].map((e) => {
      const c = e.server.getClientVersion();
      return { ...e.info, cliente: c?.name ?? '', versao: c?.version ?? '' };
    });
    return { ativo: this._ativo, sessoes };
  }

  async atender(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this._ativo) return erroJsonRpc(res, 503, 'MCP por HTTP desligado na interface do pump-sim (Gravação & agentes)');
    this.podar();
    const sid = req.headers['mcp-session-id'];
    if (typeof sid === 'string' && sid) {
      const e = this.sessoes.get(sid);
      // Spec: an unknown session is 404, and the client starts a new one with `initialize`.
      if (!e) return erroJsonRpc(res, 404, 'sessão MCP inexistente ou encerrada');
      e.info.ultima = this.clock.now();
      await e.transporte.handleRequest(req, res);
      return;
    }
    if (req.method !== 'POST') return erroJsonRpc(res, 400, 'sem mcp-session-id: comece com initialize (POST)');
    if (this.sessoes.size >= MAX_SESSOES) this.fecharMaisAntiga();
    const agora = this.clock.now();
    const info: Omit<SessaoMcp, 'cliente' | 'versao'> = { id: '', desde: agora, ultima: agora, chamadas: 0 };
    const server = montarServidorMcp((nome, args, cliente) => {
      info.chamadas++;
      info.ultima = this.clock.now();
      return this.executar(nome, args, cliente);
    });
    const transporte = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      // Plain JSON replies to POSTs: every tool is request/response, no progress stream to send.
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        info.id = id.slice(0, 8);
        this.sessoes.set(id, { transporte, server, info });
      },
      onsessionclosed: (id) => {
        this.sessoes.delete(id);
      },
    });
    transporte.onclose = () => {
      if (transporte.sessionId) this.sessoes.delete(transporte.sessionId);
    };
    await server.connect(transporte);
    await transporte.handleRequest(req, res);
    // Not an `initialize` (the transport answered 400): nothing to keep.
    if (!transporte.sessionId || !this.sessoes.has(transporte.sessionId)) await server.close();
  }

  /** Closes idle sessions. */
  private podar(): void {
    const limite = this.clock.now() - OCIOSA_MS;
    for (const [id, e] of this.sessoes) {
      if (e.info.ultima < limite) {
        this.sessoes.delete(id);
        void e.server.close();
      }
    }
  }

  private fecharMaisAntiga(): void {
    let alvo: [string, Entrada] | null = null;
    for (const par of this.sessoes) if (!alvo || par[1].info.ultima < alvo[1].info.ultima) alvo = par;
    if (!alvo) return;
    this.sessoes.delete(alvo[0]);
    void alvo[1].server.close();
  }

  async fechar(): Promise<void> {
    const todas = [...this.sessoes.values()];
    this.sessoes.clear();
    await Promise.all(todas.map((e) => e.server.close()));
  }
}
