import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Hub, ManualClock, abrirServidorControle, executarComando } from '../src/index.js';
import { dirUi } from '../src/ui/assets.js';

/**
 * UI side of DECISIONS §33: the MCP card of "Gravação & agentes" (HTTP switch, live sessions, client
 * configs with the real control port, the `claude mcp add` command), the KK hint of the Comunicação
 * composer, and the scrollbar styles. Screen modules rendered against a real simulator state.
 */

const HOST = '127.0.0.1';
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

type Tela = { default: { render(app: any): string; acoes: Record<string, (app: any, d: Record<string, string>) => unknown> } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const importar = async (rel: string) => (await import(pathToFileURL(path.join(dirUi(), 'js', rel)).href)) as Tela & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function base() {
  const hub = new Hub({ clock: new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0)), host: HOST, semTcp: true });
  fechar.push(() => hub.fechar());
  await hub.criar('default', 'simulador-2.7.2');
  const estado = await executarComando(hub, 'get_estado_simulador', {});
  return { hub, estado };
}

/** Text of the `data-texto` of the copy buttons, unescaped. */
const copias = (html: string) =>
  [...html.matchAll(/data-act="g:copiar" data-texto="([^"]*)"/g)].map((m) =>
    m[1]!.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
  );

describe('Gravação & agentes: cartão do MCP', () => {
  const g = globalThis as Record<string, unknown>;
  const locAntes = g.location;
  afterEach(() => {
    g.location = locAntes;
  });

  async function appCom(servidor: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const { estado } = await base();
    g.location = { origin: 'http://127.0.0.1:7072', host: '127.0.0.1:7072', port: '7072', search: '', hash: '' };
    const avisos: [string, string][] = [];
    const posts: [string, unknown][] = [];
    const app = {
      estado,
      dados: {},
      ui: {},
      servidor,
      aviso: (t: string, tipo: string) => void avisos.push([t, tipo]),
      api: {
        post: async (caminho: string, corpo: { ativo: boolean }) => {
          posts.push([caminho, corpo]);
          return { ativo: corpo.ativo, sessoes: [], url: 'http://127.0.0.1:7072/mcp' };
        },
      },
      chamar: async () => undefined,
    };
    return { app, avisos, posts };
  }

  it('as configs dos 4 clientes e o comando do Claude Code usam a porta real (7072 depois do fallback)', async () => {
    const { default: agentes, configsMcp, comandoClaudeCode } = await importar('telas/agentes.js');
    const url = 'http://127.0.0.1:7072/mcp';
    const cfgs = configsMcp(url, 'http://127.0.0.1:7072') as Record<string, { rot: string; texto: string }>;
    expect(Object.values(cfgs).map((c) => c.rot)).toEqual(['Claude Code', 'Claude Desktop', 'Cursor', 'VS Code']);
    expect(JSON.parse(cfgs['claude-code']!.texto)).toEqual({ mcpServers: { 'pump-sim': { type: 'http', url } } });
    expect(JSON.parse(cfgs.cursor!.texto)).toEqual({ mcpServers: { 'pump-sim': { url } } });
    expect(JSON.parse(cfgs.vscode!.texto)).toEqual({ servers: { 'pump-sim': { type: 'http', url } } });
    expect(JSON.parse(cfgs['claude-desktop']!.texto)).toEqual({ mcpServers: { 'pump-sim': { command: 'npx', args: ['-y', 'pump-sim', 'mcp', '--control', 'http://127.0.0.1:7072'] } } });
    expect(comandoClaudeCode(url)).toBe('claude mcp add --transport http pump-sim http://127.0.0.1:7072/mcp');

    const { app } = await appCom({ agora: 0, wsClientes: 1, chamadas: [], mcp: null, mcpHttp: { ativo: true, url, sessoes: [] } });
    let html = agentes.render(app);
    expect(html).toContain('ligado · nenhum cliente conectado');
    expect(html).toContain('<span class="sw on" data-act="mcp-ligar"');
    expect(copias(html)).toEqual([cfgs['claude-code']!.texto]);
    expect(html).toContain('Copiar config');
    // Each client of the selector swaps the config that the button copies.
    for (const k of ['claude-desktop', 'cursor', 'vscode']) {
      agentes.acoes['mcp-cliente']!(app, { v: k });
      expect(copias(agentes.render(app))).toEqual([cfgs[k]!.texto]);
    }
    // "Adicionar ao Claude Code" only shows the command to copy.
    expect(html).not.toContain('claude mcp add');
    agentes.acoes['mcp-comando']!(app, {});
    html = agentes.render(app);
    expect(copias(html)).toContain('claude mcp add --transport http pump-sim http://127.0.0.1:7072/mcp');
    expect(html).toContain('a interface não executa nada na sua máquina');
  });

  it('mostra as sessões ao vivo e o estado desligado', async () => {
    const { default: agentes } = await importar('telas/agentes.js');
    const t0 = Date.UTC(2026, 9, 16, 14, 30, 0);
    const sessoes = [{ id: 'abcd1234', cliente: 'claude-code', versao: '2.1.0', desde: t0, ultima: t0 + 5000, chamadas: 3 }];
    const { app } = await appCom({ agora: t0 + 6000, wsClientes: 0, chamadas: [], mcp: { ultima: t0 + 5000, cliente: 'claude-code' }, mcpHttp: { ativo: true, url: 'http://127.0.0.1:7072/mcp', sessoes } });
    let html = agentes.render(app);
    expect(html).toContain('1 cliente conectado');
    expect(html).toContain('claude-code <span class="faint">2.1.0</span>');
    expect(html).toContain('3 chamadas');
    expect(html).toMatch(/<span class="dot"><\/span><span class="h2">MCP<\/span>/);
    app.servidor.mcpHttp = { ativo: false, url: 'http://127.0.0.1:7072/mcp', sessoes: [] };
    html = agentes.render(app);
    expect(html).toContain('HTTP desligado');
    expect(html).toContain('<span class="sw" data-act="mcp-ligar"');
    expect(html).toContain('ligue o MCP por HTTP para o cliente conectar');
    expect(html).toMatch(/<span class="dot off"><\/span><span class="h2">MCP<\/span>/);
  });

  it('o interruptor faz POST /api/mcp com o valor invertido e atualiza o estado', async () => {
    const { default: agentes } = await importar('telas/agentes.js');
    const { app, posts, avisos } = await appCom({ agora: 0, chamadas: [], mcp: null, mcpHttp: { ativo: true, url: 'http://127.0.0.1:7072/mcp', sessoes: [] } });
    await agentes.acoes['mcp-ligar']!(app, {});
    expect(posts).toEqual([['/api/mcp', { ativo: false }]]);
    expect(app.servidor.mcpHttp.ativo).toBe(false);
    expect(avisos[0]![0]).toMatch(/desligado/);
    await agentes.acoes['mcp-ligar']!(app, {});
    expect(posts[1]).toEqual(['/api/mcp', { ativo: true }]);
    expect(avisos[1]![0]).toBe('MCP por HTTP ligado em http://127.0.0.1:7072/mcp');
  });

  it('Api.post fala com a rota de verdade (interruptor ponta a ponta)', async () => {
    const { hub } = await base();
    const s = await abrirServidorControle(hub, 0);
    fechar.push(() => s.fechar());
    const fetchAntes = globalThis.fetch;
    g.fetch = (u: string, i?: RequestInit) => fetchAntes(String(u).startsWith('/') ? `${s.url}${u}` : u, i);
    try {
      const { Api } = await importar('api.js');
      const api = new Api();
      expect(await api.post('/api/mcp', { ativo: false })).toMatchObject({ ativo: false, url: `http://127.0.0.1:${s.porta}/mcp` });
      expect(s.mcp.ativo).toBe(false);
      await expect(api.post('/api/mcp', { ativo: 1 })).rejects.toThrow(/ativo/);
    } finally {
      g.fetch = fetchAntes;
    }
  });
});

describe('Comunicação: KK digitado à mão que não confere', () => {
  it('(&T04U37) leva o KK do &T08U: o chip avisa e diz o esperado (33); (&S) e o automático não', async () => {
    const { estado } = await base();
    const { default: comunicacao } = await importar('telas/comunicacao.js');
    const app = { estado, dados: {}, ui: { comunicacao: { texto: '&T04U37', modoKK: 'manual', entrega: 'local', hist: [], ultimo: null, bico: null, valor: '', unidade: 'litros' } } };
    let html = comunicacao.render(app);
    expect(html).toContain('KK NÃO CONFERE · ESPERADO 33');
    app.ui.comunicacao.texto = '&T04U33';
    expect(comunicacao.render(app)).toContain('>KK MANUAL<');
    app.ui.comunicacao.texto = '&S';
    expect(comunicacao.render(app)).toContain('>KK MANUAL<');
    app.ui.comunicacao.modoKK = 'sem';
    app.ui.comunicacao.texto = '&T04U';
    expect(comunicacao.render(app)).toContain('KK NÃO CONFERE · ESPERADO 33');
    app.ui.comunicacao.modoKK = 'auto';
    html = comunicacao.render(app);
    expect(html).toContain('KK 33 · CALCULADO');
  });
});

describe('barras de rolagem e tema', () => {
  const css = fs.readFileSync(path.join(dirUi(), 'app.css'), 'utf8');
  it('barras finas com os tokens do tema: pseudo-elementos WebKit e scrollbar-color do Firefox', () => {
    expect(css).toMatch(/::-webkit-scrollbar \{ width: 10px; height: 10px; \}/);
    expect(css).toMatch(/::-webkit-scrollbar-thumb \{ background-color: var\(--line-2\)/);
    expect(css).toMatch(/::-webkit-scrollbar-thumb:hover \{ background-color: var\(--ink-3\)/);
    expect(css).toMatch(/@supports not selector\(::-webkit-scrollbar\) \{\n {2}\* \{ scrollbar-width: thin; scrollbar-color: var\(--line-2\) transparent; \}/);
    // The tokens exist in both themes.
    const tokens = fs.readFileSync(path.join(dirUi(), 'tokens.css'), 'utf8');
    for (const tema of ['th-light', 'th-dark']) {
      const bloco = new RegExp(`\\.${tema} \\{([^}]*)\\}`).exec(tokens)![1]!;
      for (const v of ['--line-2', '--ink-3', '--ink-2']) expect(bloco, `${tema} ${v}`).toContain(`${v}:`);
    }
  });
  it('a página nasce escura (sem piscar o tema claro antes do JS)', () => {
    const html = fs.readFileSync(path.join(dirUi(), 'index.html'), 'utf8');
    expect(html).toContain('<html lang="pt-BR" class="th-dark">');
    expect(html).toContain('<body class="th-dark">');
  });
});
