import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CATALOGO, defComando, schemaComSimId } from '../control/catalogo.js';
import { VERSAO } from '../versao.js';

/** Result of one tool call, as the control API answers it (`{ok, resultado}` / `{ok: false, erro}`). */
export type RespostaMcp = { ok: true; resultado: unknown } | { ok: false; erro: string };

/**
 * Runs one catalog command for the MCP server. `cliente` is the MCP client name (from `initialize`),
 * empty when unknown.
 */
export type ExecutorMcp = (nome: string, args: Record<string, unknown>, cliente: string) => Promise<RespostaMcp>;

/**
 * The MCP server, whatever the transport: the tools are the catalog (`src/control/catalogo.ts`,
 * spec §5 + K18–K26) and each call goes to `executar`; the reply JSON comes back as text. No
 * simulation logic lives here. Used by both the stdio server (`pump-sim mcp`, over the control API)
 * and the streamable HTTP endpoint `/mcp` of the control server (in process, DECISIONS §33).
 */
export function montarServidorMcp(executar: ExecutorMcp): Server {
  const server = new Server({ name: 'pump-sim', version: VERSAO }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: CATALOGO.map((c) => ({
      name: c.nome,
      description: `[${c.grupo}] ${c.descricao}`,
      inputSchema: schemaComSimId(c) as { type: 'object'; properties?: Record<string, object>; required?: string[] },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const nome = req.params.name;
    if (!defComando(nome)) return { isError: true, content: [{ type: 'text' as const, text: `tool desconhecida: ${nome}` }] };
    const r = await executar(nome, req.params.arguments ?? {}, server.getClientVersion()?.name ?? '');
    if (!r.ok) return { isError: true, content: [{ type: 'text' as const, text: r.erro }] };
    return { content: [{ type: 'text' as const, text: JSON.stringify(r.resultado ?? null, null, 2) }] };
  });
  return server;
}

/**
 * MCP server over the control API: each call becomes a `POST <controle>/api/comandos/<tool>`. This is
 * what `pump-sim mcp` (stdio) runs, so it works against any running pump-sim, whether or not its HTTP
 * MCP endpoint is on.
 */
export function criarServidorMcp(urlControle: string, fetchImpl: typeof fetch = fetch): Server {
  const base = urlControle.replace(/\/$/, '');
  return montarServidorMcp(async (nome, args, cliente) => {
    try {
      const r = await fetchImpl(`${base}/api/comandos/${nome}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Lets the UI's agents panel tell MCP calls apart (and name the MCP client).
          'x-pump-sim-origem': 'mcp',
          'x-pump-sim-cliente': cliente,
        },
        body: JSON.stringify(args),
      });
      const corpo = (await r.json()) as { ok: boolean; resultado?: unknown; erro?: string };
      if (!corpo.ok) return { ok: false, erro: corpo.erro ?? `HTTP ${r.status}` };
      return { ok: true, resultado: corpo.resultado ?? null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, erro: `API de controle inacessível em ${base}: ${msg}` };
    }
  });
}

export async function rodarMcpStdio(urlControle: string): Promise<void> {
  const server = criarServidorMcp(urlControle);
  await server.connect(new StdioServerTransport());
}
