import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Hub, ManualClock, executarComando } from '../src/index.js';
import { dirUi } from '../src/ui/assets.js';

/**
 * UI side of DECISIONS §34: the "Log do executável" card of Gravação & agentes ("Ver logs" reads
 * `GET /api/logs`), shown only when the server reports a log file (the Windows executable).
 */

const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

type Tela = { default: { render(app: any): string; acoes: Record<string, (app: any, d: Record<string, string>) => unknown> } }; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Gravação & agentes: Log do executável', () => {
  const g = globalThis as Record<string, unknown>;
  const locAntes = g.location;
  afterEach(() => {
    g.location = locAntes;
  });

  async function appCom(log: { ativo: boolean; arquivo: string | null }, resposta: unknown) {
    const hub = new Hub({ clock: new ManualClock(Date.UTC(2026, 9, 17, 12, 0, 0)), host: '127.0.0.1', semTcp: true });
    fechar.push(() => hub.fechar());
    await hub.criar('default', 'simulador-2.7.2');
    const estado = await executarComando(hub, 'get_estado_simulador', {});
    g.location = { origin: 'http://127.0.0.1:7070', host: '127.0.0.1:7070', port: '7070', search: '', hash: '' };
    const gets: string[] = [];
    const avisos: [string, string][] = [];
    const app = {
      estado,
      dados: {},
      ui: {},
      servidor: { agora: 0, wsClientes: 1, chamadas: [], mcp: null, mcpHttp: { ativo: true, url: 'http://127.0.0.1:7070/mcp', sessoes: [] }, log },
      aviso: (t: string, tipo: string) => void avisos.push([t, tipo]),
      api: {
        get: async (c: string) => {
          gets.push(c);
          if (resposta instanceof Error) throw resposta;
          return resposta;
        },
      },
      chamar: async () => undefined,
    };
    return { app, gets, avisos };
  }

  const importar = async () => (await import(pathToFileURL(path.join(dirUi(), 'js', 'telas', 'agentes.js')).href)) as Tela;

  it('npm CLI (no log file): no card', async () => {
    const { default: agentes } = await importar();
    const { app } = await appCom({ ativo: false, arquivo: null }, null);
    expect(agentes.render(app)).not.toContain('Log do executável');
  });

  it('executable: "Ver logs" loads the tail, escaped; Atualizar / Ocultar', async () => {
    const { default: agentes } = await importar();
    const arq = 'C:\\Users\\u\\AppData\\Local\\pump-sim\\logs\\pump-sim.log';
    const { app, gets } = await appCom({ ativo: true, arquivo: arq }, { ativo: true, arquivo: arq, texto: '2026-10-17T12:00:00.000Z [pump-sim] <ok>\n', tamanho: 41 });
    let html = agentes.render(app);
    expect(html).toContain('Log do executável');
    expect(html).toContain(arq);
    expect(html).toContain('data-act="ver-logs"');
    expect(html).toContain('Ver logs');
    await agentes.acoes['ver-logs']!(app, {});
    expect(gets).toEqual(['/api/logs']);
    html = agentes.render(app);
    expect(html).toContain('[pump-sim] &lt;ok&gt;');
    expect(html).toContain('Atualizar');
    agentes.acoes['ocultar-logs']!(app, {});
    expect(agentes.render(app)).toContain('Ver logs');
  });

  it('a failed read shows a warning', async () => {
    const { default: agentes } = await importar();
    const { app, avisos } = await appCom({ ativo: true, arquivo: 'x.log' }, new Error('log só pelo loopback'));
    await agentes.acoes['ver-logs']!(app, {});
    expect(avisos).toEqual([['Log: log só pelo loopback', 'err']]);
  });
});
