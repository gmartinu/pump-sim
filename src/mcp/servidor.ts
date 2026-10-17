import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CATALOGO, defComando, schemaComSimId } from '../control/catalogo.js';

/**
 * MCP server (stdio): thin adapter of the control API. The tools are the
 * catalog (`src/control/catalogo.ts`, spec §5 + K18–K26); each call becomes a
 * `POST <controle>/api/comandos/<tool>` and the reply JSON comes back as text.
 * No simulation logic lives here.
 */
export function criarServidorMcp(urlControle: string, fetchImpl: typeof fetch = fetch): Server {
  const base = urlControle.replace(/\/$/, '');
  const server = new Server({ name: 'pump-sim', version: '0.1.0' }, { capabilities: { tools: {} } });

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
    try {
      const r = await fetchImpl(`${base}/api/comandos/${nome}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Lets the UI's agents panel tell MCP calls apart (and name the MCP client).
          'x-pump-sim-origem': 'mcp',
          'x-pump-sim-cliente': server.getClientVersion()?.name ?? '',
        },
        body: JSON.stringify(req.params.arguments ?? {}),
      });
      const corpo = (await r.json()) as { ok: boolean; resultado?: unknown; erro?: string };
      if (!corpo.ok) return { isError: true, content: [{ type: 'text' as const, text: corpo.erro ?? `HTTP ${r.status}` }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(corpo.resultado ?? null, null, 2) }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { isError: true, content: [{ type: 'text' as const, text: `API de controle inacessível em ${base}: ${msg}` }] };
    }
  });
  return server;
}

export async function rodarMcpStdio(urlControle: string): Promise<void> {
  const server = criarServidorMcp(urlControle);
  await server.connect(new StdioServerTransport());
}
