import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { CATALOGO, Hub, ManualClock, OCIOSA_MS, type OpcoesControle, VERSAO, abrirServidorControle, executarComando } from '../src/index.js';

/**
 * MCP over streamable HTTP at `<control>/mcp` (DECISIONS §33): the real SDK client against the real
 * control server, the runtime on/off switch, the session status the UI shows, and the same loopback
 * guards as the rest of the control API.
 */

const HOST = '127.0.0.1';
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

async function servidor(op: OpcoesControle = {}) {
  const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
  const hub = new Hub({ clock, host: HOST, mapa: { 2001: 0 } });
  fechar.push(() => hub.fechar());
  await hub.criar('default', 'simulador-2.7.2');
  const s = await abrirServidorControle(hub, 0, HOST, op);
  fechar.push(() => s.fechar());
  return { hub, s, clock };
}

async function conectar(url: string, nome = 'agente-http') {
  const client = new Client({ name: nome, version: '9.9.9' });
  const transporte = new StreamableHTTPClientTransport(new URL(`${url}/mcp`));
  await client.connect(transporte);
  fechar.push(() => client.close());
  return Object.assign(client, { transporte });
}

type Status = { ativo: boolean; url: string; sessoes: { id: string; cliente: string; versao: string; chamadas: number; desde: number; ultima: number }[] };
const getJson = async <T>(url: string) => ((await (await fetch(url)).json()) as { resultado: T }).resultado;
const ligar = (url: string, ativo: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  fetch(`${url}/api/mcp`, { method: 'POST', headers, body: JSON.stringify({ ativo }) });

/** Raw request, to control the Host header (fetch forbids overriding it). */
const bruto = (porta: number, metodo: string, caminho: string, headers: Record<string, string>, corpo = '') =>
  new Promise<{ status: number; corpo: string }>((resolve, reject) => {
    const req = http.request({ host: HOST, port: porta, method: metodo, path: caminho, headers }, (res) => {
      let txt = '';
      res.on('data', (c) => (txt += String(c)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: txt }));
    });
    req.on('error', reject);
    req.end(corpo);
  });

const INIT = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } } });

describe('MCP por HTTP em <controle>/mcp', () => {
  it('o cliente do SDK lista o catálogo e chama tools no mesmo processo; a versão é a do pacote', async () => {
    const { s, hub } = await servidor();
    const client = await conectar(s.url);
    expect(client.getServerVersion()).toMatchObject({ name: 'pump-sim', version: VERSAO });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(CATALOGO.map((c) => c.nome).sort());
    const r = (await client.callTool({ name: 'set_preco', arguments: { bico: '04', preco: 4321 } })) as { content: { text: string }[]; isError?: boolean };
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content[0]!.text).pendentes[0]).toBe(4321);
    const est = (await executarComando(hub, 'get_estado_simulador', {})) as { lados: { bicos: { codigo: string; precosPendentes: (number | null)[] }[] }[] };
    expect(est.lados[0]!.bicos.find((b) => b.codigo === '04')!.precosPendentes[0]).toBe(4321);
    const ruim = (await client.callTool({ name: 'retirar_bico', arguments: { bico: '3F' } })) as { isError?: boolean; content: { text: string }[] };
    expect(ruim.isError).toBe(true);
    expect(ruim.content[0]!.text).toMatch(/3F/);
  });

  it('/api/servidor mostra as sessões (cliente, versão, chamadas) e as chamadas com origem mcp', async () => {
    const { s } = await servidor();
    const client = await conectar(s.url, 'Claude Code');
    await client.callTool({ name: 'get_status', arguments: {} });
    await client.callTool({ name: 'get_relogio', arguments: {} });
    const sv = await getJson<{ mcpHttp: Status; mcp: { cliente: string } | null; chamadas: { origem: string; cliente: string | null; comando: string }[] }>(`${s.url}/api/servidor`);
    expect(sv.mcpHttp.ativo).toBe(true);
    expect(sv.mcpHttp.url).toBe(`http://127.0.0.1:${s.porta}/mcp`);
    expect(sv.mcpHttp.sessoes).toHaveLength(1);
    expect(sv.mcpHttp.sessoes[0]).toMatchObject({ cliente: 'Claude Code', versao: '9.9.9', chamadas: 2 });
    expect(sv.mcpHttp.sessoes[0]!.id).toMatch(/^[0-9a-f-]{8}$/);
    expect(sv.chamadas.slice(0, 2).map((c) => [c.origem, c.cliente, c.comando])).toEqual([
      ['mcp', 'Claude Code', 'get_relogio'],
      ['mcp', 'Claude Code', 'get_status'],
    ]);
    expect(sv.mcp?.cliente).toBe('Claude Code');
    // A client that ends its session (DELETE) leaves the list.
    await client.transporte.terminateSession();
    expect((await getJson<Status>(`${s.url}/api/mcp`)).sessoes).toEqual([]);
  });

  it('a URL usa a porta real da API (0 → a porta que o sistema deu) e 127.0.0.1 num bind curinga', async () => {
    const clock = new ManualClock(0);
    const hub = new Hub({ clock, host: HOST, mapa: { 2001: 0 } });
    fechar.push(() => hub.fechar());
    await hub.criar('default', 'simulador-2.7.2');
    const s = await abrirServidorControle(hub, 0, '0.0.0.0');
    fechar.push(() => s.fechar());
    expect(s.porta).toBeGreaterThan(0);
    const st = await getJson<Status>(`http://127.0.0.1:${s.porta}/api/mcp`);
    expect(st.url).toBe(`http://127.0.0.1:${s.porta}/mcp`);
  });

  it('desligar fecha as sessões e responde 503; religar aceita sessão nova', async () => {
    const { s } = await servidor();
    const client = await conectar(s.url);
    const off = await ligar(s.url, false);
    expect(off.status).toBe(200);
    expect(((await off.json()) as { resultado: Status }).resultado).toMatchObject({ ativo: false, sessoes: [] });
    const r = await bruto(s.porta, 'POST', '/mcp', { host: `${HOST}:${s.porta}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, INIT);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.corpo)).toMatchObject({ jsonrpc: '2.0', error: { message: expect.stringMatching(/desligado/) } });
    await expect(client.callTool({ name: 'get_status', arguments: {} })).rejects.toThrow();
    expect((await ligar(s.url, true)).status).toBe(200);
    const novo = await conectar(s.url);
    expect((await novo.listTools()).tools.length).toBe(CATALOGO.length);
    expect((await getJson<Status>(`${s.url}/api/mcp`)).sessoes).toHaveLength(1);
  });

  it('mcpHttp: false sobe desligado; o corpo do POST /api/mcp é validado', async () => {
    const { s } = await servidor({ mcpHttp: false });
    expect((await getJson<Status>(`${s.url}/api/mcp`)).ativo).toBe(false);
    expect(s.mcp.ativo).toBe(false);
    expect((await ligar(s.url, 'sim')).status).toBe(400);
    expect((await ligar(s.url, true, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await getJson<Status>(`${s.url}/api/mcp`)).ativo).toBe(false);
  });

  it('sessão desconhecida é 404, GET sem sessão é 400, mensagem que não é initialize não abre sessão', async () => {
    const { s } = await servidor();
    const h = { host: `${HOST}:${s.porta}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    expect((await bruto(s.porta, 'POST', '/mcp', { ...h, 'mcp-session-id': 'nao-existe' }, INIT)).status).toBe(404);
    expect((await bruto(s.porta, 'GET', '/mcp', { host: h.host, accept: 'text/event-stream' })).status).toBe(400);
    const lista = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect((await bruto(s.porta, 'POST', '/mcp', h, lista)).status).toBe(400);
    expect((await getJson<Status>(`${s.url}/api/mcp`)).sessoes).toEqual([]);
  });

  it('mesmas guardas da API de controle: Origin e Host de fora 403, POST sem JSON 415', async () => {
    const { s } = await servidor();
    const h = { host: `${HOST}:${s.porta}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const origem = await bruto(s.porta, 'POST', '/mcp', { ...h, origin: 'https://exemplo.invalid' }, INIT);
    expect(origem.status).toBe(403);
    expect(origem.corpo).toContain('origem recusada');
    const host = await bruto(s.porta, 'POST', '/mcp', { ...h, host: 'exemplo.invalid' }, INIT);
    expect(host.status).toBe(403);
    expect(host.corpo).toContain('host recusado');
    expect((await bruto(s.porta, 'POST', '/mcp', { ...h, 'content-type': 'text/plain' }, INIT)).status).toBe(415);
    expect((await bruto(s.porta, 'POST', '/api/mcp', { host: h.host, origin: 'https://exemplo.invalid', 'content-type': 'application/json' }, '{"ativo":false}')).status).toBe(403);
    expect((await getJson<Status>(`${s.url}/api/mcp`)).ativo).toBe(true);
    // A loopback Origin (the UI, a local tool) is accepted.
    expect((await bruto(s.porta, 'POST', '/mcp', { ...h, origin: `http://localhost:${s.porta}` }, INIT)).status).toBe(200);
  });

  it(`uma sessão sem pedidos por ${OCIOSA_MS / 60000} min sai da lista`, async () => {
    const { s, clock } = await servidor();
    const client = await conectar(s.url);
    await client.callTool({ name: 'get_status', arguments: {} });
    clock.advance(OCIOSA_MS - 1000);
    expect((await getJson<Status>(`${s.url}/api/mcp`)).sessoes).toHaveLength(1);
    clock.advance(2000);
    expect((await getJson<Status>(`${s.url}/api/mcp`)).sessoes).toEqual([]);
  });
});
