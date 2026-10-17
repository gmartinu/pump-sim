import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { type WebSocket, WebSocketServer } from 'ws';
import { lerAssetUi } from '../ui/assets.js';
import { defComando } from './catalogo.js';
import { catalogoCompleto, executarComando } from './comandos.js';
import type { Hub } from './hub.js';
import type { SimRuntime } from './runtime.js';

/**
 * Control API: HTTP + WebSocket, no framework.
 *
 * - `GET  /api/catalogo` — commands, groups and the JSON Schema of the arguments.
 * - `GET  /api/estado?sim_id=` — `get_estado_simulador`.
 * - `GET  /api/sims` — instances.
 * - `POST /api/comandos/<nome>` — JSON body with the arguments (includes `sim_id`).
 * - `GET  /api/comandos/<nome>?arg=…` — shortcut for reads (JSON or text values).
 * - `WS   /ws` — pushes `log` (RX/TX/ERRO/INFO), `evento` (CBC memory),
 *   `conexao`, `perfil`, `reset`, `trafego` (each socket read/write, with the connection) and
 *   `falha` (an injected fault fired); and accepts `{id, comando, args, origem?}` → `{id, ok, resultado|erro}`.
 * - `GET  /` and `/ui/<arquivo>` — the web UI (static files; it drives the simulator only through this API).
 * - `GET  /api/servidor` — WS clients, recent calls from agents (HTTP, MCP, WS; the UI's own are left out).
 * - `GET  /api/gravacoes/<nome>.jsonl` — download of a recording in the recordings folder.
 *
 * Every reply is `{ ok: true, resultado }` or `{ ok: false, erro }`.
 *
 * Security (the API has no authentication and some commands write files, e.g.
 * `start_recording {arquivo}`): listens on 127.0.0.1 by default; refuses (403) a request
 * with a non-loopback `Origin`, and the WS upgrade too; when bound to loopback,
 * refuses a non-loopback `Host` (DNS rebinding); `POST` requires
 * `content-type: application/json` (a website cannot send that without a preflight); `GET` on
 * `/api/comandos` only works for commands of the `leitura` group. No CORS allowed.
 */
export interface ServidorControle {
  porta: number;
  url: string;
  fechar(): Promise<void>;
}

/** One command call seen by the API (the agents panel of the UI). */
export interface ChamadaApi {
  ts: number;
  /** `mcp`, `http`, `ws` (header `x-pump-sim-origem` / the WS message's `origem`). */
  origem: string;
  /** MCP client name, when the MCP server forwards it (`x-pump-sim-cliente`). */
  cliente: string | null;
  comando: string;
  args: string;
  ok: boolean;
  resumo: string;
}

const MAX_CHAMADAS = 50;
const curto = (v: unknown, max: number): string => {
  const t = typeof v === 'string' ? v : (JSON.stringify(v) ?? '');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

const CSP = (host: string) =>
  [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `connect-src 'self' ws://${host}`,
    "img-src 'self' data:",
    "frame-ancestors 'none'",
  ].join('; ');

function lerCorpo(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let tam = 0;
    req.on('data', (b: Buffer) => {
      tam += b.length;
      if (tam > 16 * 1024 * 1024) {
        reject(new Error('corpo grande demais'));
        req.destroy();
      } else partes.push(b);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

function responder(res: http.ServerResponse, status: number, corpo: unknown): void {
  const txt = JSON.stringify(corpo);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(txt);
}

const statusDe = (e: unknown): number => {
  const s = (e as { status?: unknown }).status;
  return typeof s === 'number' ? s : 400;
};

function argsDaQuery(u: URL): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of u.searchParams) {
    try {
      out[k] = JSON.parse(v);
    } catch {
      out[k] = v;
    }
    // "04" is a hex nozzle, not the number 4.
    if (typeof out[k] === 'number' && /^0\d/.test(v)) out[k] = v;
  }
  return out;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Hostname of a `Host`/`Origin` (without port). */
function nomeHost(valor: string): string {
  try {
    return new URL(valor.includes('://') ? valor : `http://${valor}`).hostname;
  } catch {
    return '';
  }
}

const ehLoopback = (h: string): boolean => LOOPBACK.has(h) || /^127\.\d+\.\d+\.\d+$/.test(h);

/** null = accepted; text = reason for the 403. */
export function recusaOrigem(headers: http.IncomingHttpHeaders, bindLoopback: boolean): string | null {
  const origin = headers.origin;
  if (origin !== undefined && !ehLoopback(nomeHost(origin))) return `origem recusada: ${origin}`;
  if (bindLoopback && !ehLoopback(nomeHost(headers.host ?? ''))) return `host recusado: ${headers.host ?? ''}`;
  return null;
}

export function abrirServidorControle(hub: Hub, porta: number, host = '127.0.0.1'): Promise<ServidorControle> {
  const clientes = new Set<WebSocket>();
  const anexados = new WeakSet<SimRuntime>();
  const difundir = (msg: unknown) => {
    const txt = JSON.stringify(msg);
    for (const c of clientes) if (c.readyState === c.OPEN) c.send(txt);
  };
  const anexar = () => {
    for (const [id, rt] of hub.todos()) {
      if (anexados.has(rt)) continue;
      anexados.add(rt);
      for (const tipo of ['log', 'evento', 'conexao', 'perfil', 'reset', 'trafego', 'falha']) {
        rt.on(tipo, (dados: unknown) => difundir({ tipo, sim_id: id, dados }));
      }
    }
  };
  anexar();

  const chamadas: ChamadaApi[] = [];
  const registrar = (c: Omit<ChamadaApi, 'ts'>) => {
    chamadas.push({ ts: hub.clock.now(), ...c });
    if (chamadas.length > MAX_CHAMADAS) chamadas.splice(0, chamadas.length - MAX_CHAMADAS);
  };
  const executar = async (nome: string, args: Record<string, unknown>, origem = 'http', cliente: string | null = null) => {
    try {
      const r = await executarComando(hub, nome, args);
      if (origem !== 'ui') registrar({ origem, cliente, comando: nome, args: curto(args, 200), ok: true, resumo: curto(r, 90) });
      return r;
    } catch (e) {
      if (origem !== 'ui') registrar({ origem, cliente, comando: nome, args: curto(args, 200), ok: false, resumo: `${statusDe(e)} · ${e instanceof Error ? e.message : String(e)}` });
      throw e;
    } finally {
      anexar();
    }
  };
  const cabecalho = (req: http.IncomingMessage, nome: string): string | null => {
    const v = req.headers[nome];
    return typeof v === 'string' && v ? v.slice(0, 80) : null;
  };
  const servirUi = (req: http.IncomingMessage, res: http.ServerResponse, rel: string): boolean => {
    const a = lerAssetUi(rel);
    if (!a) return false;
    res.writeHead(200, {
      'content-type': a.tipo,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'content-security-policy': CSP(req.headers.host ?? '127.0.0.1'),
    });
    res.end(a.corpo);
    return true;
  };

  const bindLoopback = ehLoopback(nomeHost(host));
  const server = http.createServer((req, res) => {
    void (async () => {
      const u = new URL(req.url ?? '/', 'http://localhost');
      try {
        const recusa = recusaOrigem(req.headers, bindLoopback);
        if (recusa) return responder(res, 403, { ok: false, erro: recusa });
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
        if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
          if (servirUi(req, res, 'index.html')) return;
        }
        if (req.method === 'GET' && u.pathname.startsWith('/ui/')) {
          if (servirUi(req, res, u.pathname.slice(4))) return;
          return responder(res, 404, { ok: false, erro: `arquivo da UI inexistente: ${u.pathname}` });
        }
        if (req.method === 'GET' && u.pathname === '/api/servidor') {
          const mcp = [...chamadas].reverse().find((c) => c.origem === 'mcp');
          return responder(res, 200, {
            ok: true,
            resultado: {
              wsClientes: clientes.size,
              dirGravacoes: path.resolve(hub.dirGravacoes),
              agora: hub.clock.now(),
              mcp: mcp ? { ultima: mcp.ts, cliente: mcp.cliente } : null,
              chamadas: [...chamadas].reverse(),
            },
          });
        }
        const g = /^\/api\/gravacoes\/([\w.-]+\.jsonl)$/.exec(u.pathname);
        if (req.method === 'GET' && g) {
          const arq = path.join(path.resolve(hub.dirGravacoes), g[1]!);
          if (!fs.existsSync(arq)) return responder(res, 404, { ok: false, erro: `gravação inexistente: ${g[1]!}` });
          res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'content-disposition': `attachment; filename="${g[1]!}"` });
          fs.createReadStream(arq).pipe(res);
          return;
        }
        if (req.method === 'GET' && u.pathname === '/api/catalogo') return responder(res, 200, { ok: true, resultado: catalogoCompleto() });
        if (req.method === 'GET' && u.pathname === '/api/sims') return responder(res, 200, { ok: true, resultado: hub.listar() });
        if (req.method === 'GET' && u.pathname === '/api/estado') {
          return responder(res, 200, { ok: true, resultado: await executar('get_estado_simulador', argsDaQuery(u)) });
        }
        const m = /^\/api\/comandos\/([a-z0-9_]+)$/.exec(u.pathname);
        if (m && (req.method === 'POST' || req.method === 'GET')) {
          let args: Record<string, unknown> = {};
          if (req.method === 'GET' && defComando(m[1]!)?.grupo !== 'leitura') {
            return responder(res, 405, { ok: false, erro: `${m[1]!}: use POST (GET só para comandos de leitura)` });
          }
          if (req.method === 'POST' && !/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
            return responder(res, 415, { ok: false, erro: 'POST exige content-type: application/json' });
          }
          if (req.method === 'POST') {
            const txt = await lerCorpo(req);
            if (txt.trim()) {
              const v = JSON.parse(txt) as unknown;
              if (typeof v !== 'object' || v === null || Array.isArray(v)) throw Object.assign(new Error('corpo deve ser um objeto JSON'), { status: 400 });
              args = v as Record<string, unknown>;
            }
          } else args = argsDaQuery(u);
          return responder(res, 200, { ok: true, resultado: await executar(m[1]!, args, cabecalho(req, 'x-pump-sim-origem') ?? 'http', cabecalho(req, 'x-pump-sim-cliente')) });
        }
        responder(res, 404, { ok: false, erro: `rota inexistente: ${req.method ?? ''} ${u.pathname}` });
      } catch (e) {
        responder(res, statusDe(e), { ok: false, erro: e instanceof Error ? e.message : String(e) });
      }
    })();
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, sock, head) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws' || recusaOrigem(req.headers, bindLoopback)) {
      sock.destroy();
      return;
    }
    wss.handleUpgrade(req, sock, head, (ws) => {
      clientes.add(ws);
      ws.on('close', () => clientes.delete(ws));
      ws.on('message', (data) => {
        void (async () => {
          let id: unknown = null;
          try {
            const msg = JSON.parse(String(data)) as { id?: unknown; comando?: string; args?: Record<string, unknown>; origem?: unknown };
            id = msg.id ?? null;
            if (!msg.comando) throw new Error('mensagem sem comando');
            const origem = typeof msg.origem === 'string' && msg.origem ? msg.origem.slice(0, 20) : 'ws';
            ws.send(JSON.stringify({ id, ok: true, resultado: await executar(msg.comando, msg.args ?? {}, origem) }));
          } catch (e) {
            ws.send(JSON.stringify({ id, ok: false, erro: e instanceof Error ? e.message : String(e) }));
          }
        })();
      });
      ws.send(JSON.stringify({ tipo: 'ola', sims: hub.listar() }));
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(porta, host, () => {
      server.off('error', reject);
      const a = server.address();
      const p = typeof a === 'object' && a ? a.port : porta;
      resolve({
        porta: p,
        url: `http://${host}:${p}`,
        fechar: () =>
          new Promise<void>((r) => {
            for (const c of clientes) c.terminate();
            wss.close();
            server.closeAllConnections();
            server.close(() => r());
          }),
      });
    });
  });
}
