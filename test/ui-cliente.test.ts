import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket as WsNode } from 'ws';
import { Hub, ManualClock, type PerfilId, abrirServidorControle, executarComando } from '../src/index.js';
import { dirUi } from '../src/ui/assets.js';

/**
 * Client logic of the web UI (ui/js), without a browser (§19: no heavy harness). Two layers:
 *  1. screen modules (`render(app)` returns HTML, `acoes` map clicks to commands) fed with the REAL
 *     state of a simulator, so a caption or a button the UI draws is checked against what the
 *     driver/simulator says;
 *  2. the shell (`app.js`) booted against a real control server through minimal browser stubs
 *     (WebSocket = the `ws` client, a fake `document`), with only the DOM patcher replaced by a
 *     recorder: events pushed over the WS, theme switch and click dispatch.
 */

const HOST = '127.0.0.1';
const tela = async (nome: string) => (await import(pathToFileURL(path.join(dirUi(), 'js', 'telas', `${nome}.js`)).href)) as Tela;

type Tela = {
  default: { render(app: App): string; acoes: Record<string, (app: App, d: Record<string, string>) => unknown> };
};
type App = {
  estado: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  displays: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  dados: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  ui: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  menu: string | null;
  chamar: (c: string, a?: Record<string, unknown>) => Promise<unknown>;
  chamadas: [string, Record<string, unknown>][];
  ir: (t: string) => void;
  abrirModal: (m: unknown) => void;
};

const hubs: Hub[] = [];
afterEach(async () => {
  await Promise.all(hubs.splice(0).map((h) => h.fechar()));
});

async function criar(perfil: PerfilId) {
  const hub = new Hub({ clock: new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0)), host: HOST, semTcp: true });
  hubs.push(hub);
  await hub.criar('default', perfil);
  const cmd = <T = any>(nome: string, args: Record<string, unknown> = {}) => executarComando(hub, nome, args) as Promise<T>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** An `app` as app.js builds it, fed by the same two reads the refresh loop makes. */
  const app = async (): Promise<App> => {
    const a: App = {
      estado: await cmd('get_estado_simulador'),
      displays: (await cmd('get_displays')).enderecos,
      dados: {},
      ui: {},
      menu: null,
      chamadas: [],
      chamar: async (c, args = {}) => {
        a.chamadas.push([c, args]);
        try {
          return await cmd(c, args);
        } catch {
          return undefined;
        }
      },
      ir: (t) => void (a.ui.irPara = t),
      abrirModal: (m) => void (a.ui.modal = m),
    };
    return a;
  };
  const atualizar = async (a: App) => {
    a.estado = await cmd('get_estado_simulador');
    a.displays = (await cmd('get_displays')).enderecos;
  };
  return { hub, cmd, app, atualizar };
}

/** The first `<button>` carrying `data-act="<act>"` inside a chunk of HTML: caption and data-*. */
function botoes(html: string, act: string) {
  const out: { legenda: string; dados: Record<string, string>; desabilitado: boolean }[] = [];
  for (const m of html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)) {
    const attrs = m[1]!;
    if (!new RegExp(`data-act="${act}"`).test(attrs)) continue;
    const dados: Record<string, string> = {};
    for (const a of attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)) dados[a[1]!] = a[2]!;
    out.push({ legenda: m[2]!.replace(/<span class="ms[^"]*">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '').trim(), dados, desabilitado: /\sdisabled(\s|$)/.test(attrs) });
  }
  return out;
}

/** The HTML of one side (`data-key="l<canal>-<end>"`) of the detailed grid. */
const ladoHtml = (html: string, canal: number, end: number) => {
  const ini = html.indexOf(`data-key="l${canal}-${end}"`);
  expect(ini, `lado ${canal}-${end} no HTML`).toBeGreaterThan(-1);
  const prox = html.indexOf('data-key="l', ini + 10);
  return html.slice(ini, prox === -1 ? undefined : prox);
};

describe('Pista: legenda do botão por estado do bico (como o 2.7.2)', () => {
  it('em repouso "Retirar Bico" retira; abastecendo vira "Abastecendo.." e recoloca; "Concluindo.." fica desabilitado', async () => {
    const { cmd, app, atualizar } = await criar('simulador-2.7.2');
    const { default: pista } = await tela('pista');
    const a = await app();

    let b = botoes(ladoHtml(pista.render(a), 1, 1), 'botao');
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ legenda: 'Retirar Bico', desabilitado: false, dados: { bico: '04', retirar: '1' } });

    await cmd('retirar_bico', { bico: '04' });
    await cmd('avancar_tempo', { ms: 2000 });
    await atualizar(a);
    b = botoes(ladoHtml(pista.render(a), 1, 1), 'botao');
    expect(b[0]).toMatchObject({ legenda: 'Abastecendo..', desabilitado: false, dados: { bico: '04', retirar: '0' } });

    await cmd('recolocar_bico', { bico: '04' });
    await atualizar(a);
    b = botoes(ladoHtml(pista.render(a), 1, 1), 'botao');
    expect(b[0]).toMatchObject({ legenda: 'Concluindo..', desabilitado: true });

    await cmd('avancar_tempo', { ms: 5000 });
    await atualizar(a);
    b = botoes(ladoHtml(pista.render(a), 1, 1), 'botao');
    expect(b[0]).toMatchObject({ legenda: 'Retirar Bico', desabilitado: false, dados: { retirar: '1' } });
  });

  it('o clique no botão chama retirar_bico / recolocar_bico no bico do rádio e o simulador muda', async () => {
    const { app, atualizar } = await criar('simulador-2.7.2');
    const { default: pista } = await tela('pista');
    const a = await app();
    // The radio picks the 2nd nozzle (44) of the side; the button then moves that one.
    await pista.acoes.radio!(a, { c: '1', e: '1', bico: '44' });
    const html = ladoHtml(pista.render(a), 1, 1);
    expect(botoes(html, 'botao')[0]!.dados.bico).toBe('44');
    await pista.acoes.botao!(a, botoes(html, 'botao')[0]!.dados);
    expect(a.chamadas.at(-1)).toEqual(['retirar_bico', { bico: '44' }]);
    await atualizar(a);
    expect(a.estado.lados[0].bicos.map((x: { estado: string }) => x.estado)).toEqual(['repouso', 'retirado']);

    // With a nozzle out the radio is locked and the button recolocates the one that is out.
    await pista.acoes.radio!(a, { c: '1', e: '1', bico: '04' });
    expect(botoes(ladoHtml(pista.render(a), 1, 1), 'botao')[0]!.dados).toMatchObject({ bico: '44', retirar: '0' });
    await pista.acoes.botao!(a, botoes(ladoHtml(pista.render(a), 1, 1), 'botao')[0]!.dados);
    expect(a.chamadas.at(-1)).toEqual(['recolocar_bico', { bico: '44' }]);
    await atualizar(a);
    // Put back before any flow: the nozzle goes straight to rest, no "concluiu".
    expect(a.estado.lados[0].bicos[1].estado).toBe('repouso');
  });

  it('lado em falha mostra "Limpar falha" no lugar do botão; o clique limpa no simulador', async () => {
    const { cmd, app, atualizar } = await criar('simulador-2.7.2');
    const { default: pista } = await tela('pista');
    await cmd('set_falha_endereco', { canal: 1, endereco: 1, ativo: true });
    const a = await app();
    const html = ladoHtml(pista.render(a), 1, 1);
    expect(botoes(html, 'botao')).toHaveLength(0);
    const f = botoes(html, 'falha');
    expect(f[0]).toMatchObject({ legenda: 'Limpar falha', dados: { c: '1', e: '1', on: '0' } });
    expect(html).toContain('st-falha');
    await pista.acoes.falha!(a, f[0]!.dados);
    expect(a.chamadas.at(-1)).toEqual(['set_falha_endereco', { canal: 1, endereco: 1, ativo: false }]);
    await atualizar(a);
    expect(a.estado.lados[0].falha).toBe(false);
  });

  it('o chip e a contagem por estado seguem a letra do &S (L, A, C)', async () => {
    const { cmd, app, atualizar } = await criar('simulador-2.7.2');
    const { default: pista } = await tela('pista');
    const a = await app();
    const total = a.estado.lados.length;
    let html = pista.render(a);
    expect(html).toContain(`Livre ${total}`);
    expect(html).toContain('Abastecendo 0');
    await cmd('retirar_bico', { bico: '04' });
    await cmd('avancar_tempo', { ms: 2000 });
    await atualizar(a);
    html = pista.render(a);
    expect(ladoHtml(html, 1, 1)).toContain('st-abastecendo');
    expect(html).toContain(`Livre ${total - 1}`);
    expect(html).toContain('Abastecendo 1');
    expect(html).toContain('1 abastecendo');
    await cmd('recolocar_bico', { bico: '04' });
    await atualizar(a);
    html = pista.render(a);
    expect(ladoHtml(html, 1, 1)).toContain('st-concluiu');
    expect(html).toContain('Concluiu 1');
  });

  it('displays em pt-BR; 888888 do pisca (Q6) sai cru', async () => {
    const { cmd, app, atualizar } = await criar('simulador-2.7.2');
    const { default: pista } = await tela('pista');
    await cmd('retirar_bico', { bico: '04' });
    await cmd('avancar_tempo', { ms: 2000 });
    const a = await app();
    const d = a.displays.find((x: { canal: number; endereco: number }) => x.canal === 1 && x.endereco === 1)!;
    const html = ladoHtml(pista.render(a), 1, 1);
    expect(html).toContain(`>${String(d.total).replace('.', ',')}<`);
    expect(html).toContain(`>${String(d.preco).replace('.', ',')}<`);
    a.displays = a.displays.map((x: object) => ({ ...x, piscando: true, total: '888888', volume: '888888' }));
    expect(pista.render(a)).toContain('>888888<');
    await atualizar(a);
  });

  it('porta ocupada: faixa de erro com "Tentar de novo" e a alternativa; o clique chama abrir_porta', async () => {
    const { app } = await criar('simulador-2.7.2');
    const { default: pista } = await tela('pista');
    const a = await app();
    a.estado = { ...a.estado, erroPorta: { porta: 1771, codigo: 'EADDRINUSE' }, perfil: { ...a.estado.perfil, opcoesPortaTcp: [2001, 1771, 857] } };
    const html = pista.render(a);
    expect(html).toContain('A porta 1771 já está em uso por outro processo (EADDRINUSE)');
    const p = botoes(html, 'porta');
    expect(p.map((x) => [x.legenda, x.dados.p])).toEqual([['Usar 2001', '2001'], ['Tentar de novo', '1771']]);
    await pista.acoes.porta!(a, { p: '2001' });
    expect(a.chamadas.at(-1)).toEqual(['abrir_porta', { porta: 2001 }]);
    // Sem erro e sem conexão: o aviso de "nenhum software conectado" com o comando de teste.
    a.estado = { ...a.estado, erroPorta: null, portas: [{ logica: 2001, fisica: 2001 }], conexoes: [] };
    expect(pista.render(a)).toContain('nc 127.0.0.1 2001');
  });

  it('Espera (E): mostra Apresentar cartão e Liberar (&M A); Liberar manda set_modo autoriza no bico do lado', async () => {
    const { app } = await criar('simulador-2.7.2');
    const { default: pista } = await tela('pista');
    const a = await app();
    a.estado.lados[0].letra = 'E';
    const html = ladoHtml(pista.render(a), 1, 1);
    expect(botoes(html, 'apresentar')[0]!.legenda).toBe('Apresentar cartão');
    const lib = botoes(html, 'liberar')[0]!;
    expect(lib.legenda).toBe('Liberar (&amp;M A)'); // HTML-escaped; the browser shows "Liberar (&M A)"
    await pista.acoes.liberar!(a, lib.dados);
    expect(a.chamadas.at(-1)).toEqual(['set_modo', { bico: '04', modo: 'autoriza' }]);
    // Fora de Espera não há os dois botões.
    a.estado.lados[0].letra = 'L';
    expect(botoes(ladoHtml(pista.render(a), 1, 1), 'liberar')).toHaveLength(0);
  });

  it('Horustech (12 canais): grade compacta por padrão, detalhada sob escolha, botão só com ícone e legenda no title', async () => {
    const { app } = await criar('horustech-48');
    const { default: pista } = await tela('pista');
    const a = await app();
    expect(a.estado.perfil.canais).toBeGreaterThan(8);
    let html = pista.render(a);
    expect(html).toContain('class="g12"');
    expect(html).toContain('endereços');
    expect(html).toContain('data-key="e1-1"');
    expect(html).toMatch(/<button class="ib"[^>]*title="Retirar Bico"/);
    expect(html).not.toContain('data-key="l1-1"');
    await pista.acoes.vista!(a, { v: 'detalhada' });
    html = pista.render(a);
    expect(html).toContain('class="grid4"');
    expect(html).toContain('data-key="l1-1"');
  });

  it('o menu do canal só aparece aberto e oferece simular/limpar falha por endereço', async () => {
    const { app } = await criar('simulador-2.7.2');
    const { default: pista } = await tela('pista');
    const a = await app();
    expect(pista.render(a)).not.toContain('Simular falha do END');
    a.menu = 'canal-1';
    const html = pista.render(a);
    expect(html).toContain('Simular falha do END 1');
    const f = botoes(html, 'falha').find((x) => x.dados.c === '1' && x.dados.e === '1' && x.legenda.includes('Simular'))!;
    expect(f.dados.on).toBe('1');
    await pista.acoes.falha!(a, f.dados);
    expect(a.menu).toBeNull();
    expect(a.chamadas.at(-1)).toEqual(['set_falha_endereco', { canal: 1, endereco: 1, ativo: true }]);
  });

  it('Recolocar todos recoloca só quem está fora do descanso; Gerar abastecimentos abre o modal com o 1º bico', async () => {
    const { cmd, app, atualizar } = await criar('simulador-2.7.2');
    const { default: pista } = await tela('pista');
    await cmd('retirar_bico', { bico: '04' });
    const a = await app();
    await pista.acoes['recolocar-todos']!(a, {});
    expect(a.chamadas.filter(([c]) => c === 'recolocar_bico')).toEqual([['recolocar_bico', { bico: '04' }]]);
    await atualizar(a);
    expect(a.estado.lados[0].bicos[0].estado).toBe('repouso');
    pista.acoes.gerar!(a, {});
    expect(a.ui.modal).toMatchObject({ titulo: 'Gerar abastecimentos', valores: { bico: '04', quantidade: '10', litros: '20,00' } });
  });
});

describe('Pista no 2.7.2 x perfil real: legendas', () => {
  it('LEGENDAS_EM_REPOUSO decide "bico fora" só para o texto que não é de repouso', async () => {
    const fmt = (await import(pathToFileURL(path.join(dirUi(), 'js', 'fmt.js')).href)) as { legendaRetirada(l: string): boolean; estadoDe(l: string): { id: string }; chip(l: string): string };
    for (const l of ['Retirar Bico', 'Retira Bico', 'Concluindo..', 'Bicos Bloqueados']) expect(fmt.legendaRetirada(l), l).toBe(false);
    for (const l of ['Abastecendo..', 'Aguarda liberação']) expect(fmt.legendaRetirada(l), l).toBe(true);
    expect(['L', 'P', 'A', 'C', 'B', 'E', 'F'].map((x) => fmt.estadoDe(x).id)).toEqual(['livre', 'pronta', 'abastecendo', 'concluiu', 'bloqueada', 'espera', 'falha']);
    expect(fmt.estadoDe('?').id).toBe('livre');
    expect(fmt.chip('F')).toContain('st-falha');
  });
});

// ───────────────────────── shell (app.js) against a real control server ─────────────────────────

const registro = vi.hoisted(() => ({ html: '' }));
vi.mock('../ui/js/morph.js', () => ({ morph: (_alvo: unknown, html: string) => void (registro.html = html) }));

describe('shell da UI (app.js) contra a API de controle de verdade', () => {
  let fecharTudo: () => Promise<void>;
  let appUi: { tema: string | null; trafego: Record<string, any>[]; estado: any; tela: string; toast: any; api: { ws: { onclose: unknown; close(): void } | null } }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let hub: Hub;
  const handlers: Record<string, (ev: unknown) => unknown> = {};
  const janela: Record<string, (ev: unknown) => unknown> = {};
  let local: { hash: string };
  const corpoBody = { className: '', classList: { contains: (c: string) => corpoBody.className.split(' ').includes(c) } };
  const documentoHtml = { className: '' };
  const guardados = new Map<string, string>();
  // The OS asks for light: the UI must still start dark (DECISIONS §33 U2).
  const escuroNoSistema = false;

  const esperar = async (cond: () => boolean, ms = 4000) => {
    for (let i = 0; !cond(); i++) {
      if (i * 20 > ms) throw new Error(`tempo esgotado esperando a condição (último HTML: ${registro.html.slice(0, 200)})`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  /** Click on the first element of the rendered HTML matching `data-act`, as the delegated handler sees it. */
  const clicar = async (act: string, filtro: (d: Record<string, string>) => boolean = () => true) => {
    for (const m of registro.html.matchAll(/<(\w+)\b([^>]*\sdata-act="([^"]*)"[^>]*)>/g)) {
      if (m[3] !== act) continue;
      const dataset: Record<string, string> = { act };
      for (const a of m[2]!.matchAll(/\sdata-([\w-]+)="([^"]*)"/g)) dataset[a[1]!.replace(/-(\w)/g, (_x, c: string) => c.toUpperCase())] = a[2]!;
      if (!filtro(dataset)) continue;
      const el = { dataset, disabled: /\sdisabled(\s|$)/.test(m[2]!), closest: () => null };
      await handlers.click!({ target: { closest: () => el }, stopPropagation() {} });
      await new Promise((r) => setTimeout(r, 30));
      return;
    }
    throw new Error(`nenhum elemento com data-act="${act}" no HTML`);
  };

  beforeAll(async () => {
    hub = new Hub({ clock: new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0)), host: HOST, mapa: { 2001: 0, 1771: 0 } });
    await hub.criar('default', 'simulador-2.7.2');
    const s = await abrirServidorControle(hub, 0);
    const base = s.url;
    const raiz = { addEventListener: (t: string, f: (ev: unknown) => unknown) => void (handlers[t] = f), querySelector: () => null };
    const g = globalThis as Record<string, unknown>;
    local = { search: '', hash: '', host: `${HOST}:${s.porta}`, port: String(s.porta) } as typeof local;
    g.location = local;
    g.document = { getElementById: () => raiz, body: corpoBody, documentElement: documentoHtml, activeElement: null };
    g.window = { addEventListener: (t: string, f: (ev: unknown) => unknown) => void (janela[t] = f) };
    g.matchMedia = () => ({ get matches() { return escuroNoSistema; }, addEventListener() {} });
    g.localStorage = { getItem: (k: string) => guardados.get(k) ?? null, setItem: (k: string, v: string) => void guardados.set(k, v), removeItem: (k: string) => void guardados.delete(k) };
    class WS extends WsNode {
      constructor(url: string) {
        super(url, { headers: { origin: base } });
      }
    }
    g.WebSocket = WS;
    const fetchReal = globalThis.fetch;
    g.fetch = (u: string, i?: RequestInit) => fetchReal(String(u).startsWith('/') ? `${base}${u}` : u, i);
    const mod = (await import(pathToFileURL(path.join(dirUi(), 'js', 'app.js')).href)) as { app: typeof appUi };
    appUi = mod.app;
    fecharTudo = async () => {
      appUi.api.ws!.onclose = null;
      appUi.api.ws!.close();
      await s.fechar();
      await hub.fechar();
    };
    await esperar(() => registro.html.includes('Lados'));
  });
  afterAll(async () => {
    await fecharTudo();
  });

  it('desenha a barra superior e a Pista com o estado do simulador depois de conectar', async () => {
    expect(registro.html).toContain('pump-sim');
    expect(registro.html).toContain('simulador-2.7.2');
    expect(registro.html).toContain('class="tab on" data-act="g:ir" data-tela="pista"');
    expect(registro.html).toContain('2001');
    for (const rot of ['Pista', 'Comandos básicos', 'Comunicação', 'Preços', 'Configuração', 'Tráfego', 'Identfid', 'Diff', 'Gravação & agentes'])
      expect(registro.html, rot).toContain(rot);
    expect(appUi.estado.perfil.id).toBe('simulador-2.7.2');
  });

  it('tema: escuro por padrão (mesmo com o sistema claro), o botão alterna, guarda a escolha e troca o ícone', async () => {
    // DECISIONS §33 U2: the default is dark whatever the OS preference; light only by the toggle.
    expect(escuroNoSistema).toBe(false);
    expect(corpoBody.className).toBe('th-dark');
    expect(documentoHtml.className).toBe('th-dark');
    expect(registro.html).toContain('>light_mode<');
    await clicar('g:tema');
    expect(corpoBody.className).toBe('th-light');
    expect(documentoHtml.className).toBe('th-light');
    expect(guardados.get('pump-sim.tema')).toBe('claro');
    expect(registro.html).toContain('>dark_mode<');
    await clicar('g:tema');
    expect(corpoBody.className).toBe('th-dark');
    expect(guardados.get('pump-sim.tema')).toBe('escuro');
    // With no saved choice: dark, even when the OS asks for light.
    appUi.tema = null;
    await clicar('g:menu', (d) => d.menu === 'canal-1'); // any click re-renders
    expect(corpoBody.className).toBe('th-dark');
    await clicar('g:menu', (d) => d.menu === 'canal-1');
    // The remembered choice wins over the default.
    appUi.tema = 'claro';
    await clicar('g:menu', (d) => d.menu === 'canal-1');
    expect(corpoBody.className).toBe('th-light');
    await clicar('g:menu', (d) => d.menu === 'canal-1');
  });

  it('clique no botão do lado chega ao simulador pelo WS; o texto muda no ciclo seguinte', async () => {
    await clicar('botao', (d) => d.bico === '04');
    const lado = (await executarComando(hub, 'get_estado_simulador', {}) as { lados: { bicos: { codigo: string; estado: string }[] }[] }).lados[0]!;
    expect(lado.bicos.find((b) => b.codigo === '04')!.estado).toBe('retirado');
    await esperar(() => /data-act="botao" data-bico="04" data-retirar="0"/.test(registro.html));
    await clicar('botao', (d) => d.bico === '04');
    const depois = (await executarComando(hub, 'get_estado_simulador', {}) as { lados: { bicos: { estado: string }[] }[] }).lados[0]!;
    expect(depois.bicos[0]!.estado).toBe('repouso');
  });

  it('eventos do WS entram no console: conexão aberta/fechada, rx/tx e falha injetada', async () => {
    const antes = appUi.trafego.length;
    await executarComando(hub, 'injetar_falha', { tipo: 'atraso', verbo: '&S', param: { ms: 5 } });
    await executarComando(hub, 'enviar_pela_porta', { quadro: '(&S)', porta: 2001 });
    await esperar(() => appUi.trafego.slice(antes).some((r) => r.dir === 'tx'));
    const novos = appUi.trafego.slice(antes);
    const evs = novos.filter((r) => r.dir === 'ev').map((r) => r.texto);
    expect(evs).toEqual(expect.arrayContaining(['conexão aberta', expect.stringContaining('falha injetada: atraso 5 ms (&S) em (&S)')]));
    expect(novos.find((r) => r.dir === 'rx')).toMatchObject({ porta: 2001, texto: '(&S)' });
    expect(novos.find((r) => r.dir === 'tx')!.texto).toMatch(/^\(S/);
    expect(novos.find((r) => r.falha)).toMatchObject({ dir: 'ev', porta: 2001 });
    const ns = appUi.trafego.map((r) => r.n);
    expect(new Set(ns).size).toBe(ns.length);
    expect(ns).toEqual([...ns].sort((x, y) => x - y));
  });

  it('o console guarda no máximo 3000 linhas, descartando as mais antigas', async () => {
    const fisica = hub.obter('default').servidor!.fisica(2001)!;
    const sock = net.connect(fisica, HOST);
    await new Promise((r) => sock.once('connect', r));
    // One frame per round trip: the simulator answers each chunk as one frame.
    for (let i = 0; i < 1550; i++) {
      const resp = new Promise((r) => sock.once('data', r));
      sock.write('(&S)');
      await resp;
    }
    await esperar(() => appUi.trafego.at(-1)!.n > 3100, 8000);
    sock.destroy();
    expect(appUi.trafego).toHaveLength(3000);
    expect(appUi.trafego[0]!.n).toBeGreaterThan(1);
  });

  it('erro de comando vira aviso com o nome do comando e fecha pelo botão; a rota troca a tela', async () => {
    const r = await (appUi as unknown as { chamar(c: string, a: object): Promise<unknown> }).chamar('retirar_bico', { bico: '3F' });
    expect(r).toBeUndefined();
    expect(appUi.toast).toMatchObject({ tipo: 'err' });
    expect(appUi.toast.texto).toMatch(/^retirar_bico: .*bico inexistente/);
    expect(registro.html).toContain('retirar_bico: ');
    await clicar('g:fechar-toast');
    expect(appUi.toast).toBeNull();
    expect(registro.html).not.toContain('class="toast"');

    await clicar('g:ir', (d) => d.tela === 'trafego');
    expect(local.hash).toBe('#/trafego');
    janela.hashchange!({});
    expect(appUi.tela).toBe('trafego');
    await esperar(() => registro.html.includes('class="tab on" data-act="g:ir" data-tela="trafego"'));
    local.hash = '#/nao-existe';
    janela.hashchange!({});
    expect(appUi.tela).toBe('pista');
  });
});

describe('Pista: preço da lista de bicos = display = &T U', () => {
  /** Price shown in the nozzle row of `bico` inside a side's HTML. */
  const precoDaLista = (html: string, bico: string) => {
    const m = new RegExp(`data-bico="${bico}">[\\s\\S]*?<span class="ppl">([^<]+)</span>`).exec(html);
    expect(m, `linha do bico ${bico}`).not.toBeNull();
    return m![1]!;
  };
  const precoDoDisplay = (html: string) => /<span class="dl">Preço<\/span><span class="dv"[^>]*>([^<]+)<\/span>/.exec(html)![1]!;

  for (const perfil of ['simulador-2.7.2', 'cbc-32'] as const) {
    it(`${perfil}: com preço pendente, a lista mostra o mesmo valor do display e do &T U (não o vigente)`, async () => {
      const { cmd, app, atualizar } = await criar(perfil);
      const { default: pista } = await tela('pista');
      const a = await app();
      // A fresh nozzle 04: 1120 current, 1123 pending; `&T U` replies the pending one (precoConfigurado).
      const p = await cmd<{ vigentes: number[]; pendentes: (number | null)[]; quadro: string }>('get_precos', { bico: '04' });
      expect(p.vigentes[0]).toBe(1120);
      expect(p.pendentes[0]).toBe(1123);
      expect(p.quadro).toContain('1123');
      let html = ladoHtml(pista.render(a), 1, 1);
      expect(precoDoDisplay(html)).toBe('1,123');
      expect(precoDaLista(html, '04')).toBe('1,123');
      expect(precoDaLista(html, '44')).toBe('2,123');

      // Fueling: the pending price becomes current; display and list still agree.
      await cmd('retirar_bico', { bico: '04' });
      await cmd('avancar_tempo', { ms: 2000 });
      await atualizar(a);
      html = ladoHtml(pista.render(a), 1, 1);
      expect(precoDoDisplay(html)).toBe('1,123');
      expect(precoDaLista(html, '04')).toBe('1,123');
    });
  }
});

describe('Tráfego: checksum do TX e quadros ligados à falha injetada', () => {
  type Linha = { n: number; ts: number; porta: number; conexao: number | null; dir: string; texto: string; falha?: boolean; falhaTipo?: string; quadroFalha?: string; alvo?: number; verbo?: string };
  const mod = async () =>
    (await tela('trafego')) as unknown as Tela & {
      ligarFalhas(rows: Linha[]): Linha[];
      noFundo(el: { scrollTop: number; scrollHeight: number; clientHeight: number }, folga?: number): boolean;
      seguirFim(u: Record<string, unknown>, el: { scrollTop: number; scrollHeight: number; clientHeight: number } | null): boolean;
    };
  const fmt = async () => (await import(pathToFileURL(path.join(dirUi(), 'js', 'fmt.js')).href)) as { classeKK(q: string, dir: string, falha?: string): string; kk(c: string): string };
  const S = '(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G78)';

  it('classeKK: TX com KK certo é válido, TX de formato com KK e KK errado é inválido, (S…) sem KK', async () => {
    const { classeKK, kk } = await fmt();
    expect(kk('TU0400001123')).toBe('94');
    expect(classeKK('(TU040000112394)', 'tx')).toBe('ok');
    expect(classeKK('(TU04000011239F)', 'tx')).toBe('bad');
    expect(classeKK('(TU040000112ZZ)', 'tx')).toBe('bad');
    expect(classeKK('(TL0400000000ZZ)', 'tx')).toBe('bad');
    expect(classeKK('((TL0800000000B0)', 'tx')).toBe('ok');
    expect(classeKK(S, 'tx')).toBe('na');
    expect(classeKK('(M04)', 'tx')).toBe('na');
    expect(classeKK('(U04)', 'tx')).toBe('na');
    // The checksum fault rewrites the two chars before ")" even on a reply with no KK.
    expect(classeKK(S, 'tx', 'checksum_errado')).toBe('bad');
    expect(classeKK(S, 'tx', 'atraso')).toBe('na');
    // RX unchanged.
    expect(classeKK(`(&T04U${kk('&T04U')})`, 'rx')).toBe('ok');
    expect(classeKK('(&T04UZZ)', 'rx')).toBe('bad');
    expect(classeKK('(&S)', 'rx')).toBe('na');
  });

  it('ligarFalhas: rx → falha → tx liga a falha ao pedido e à resposta alterada; o &S anterior e o seguinte ficam de fora', async () => {
    const { ligarFalhas } = await mod();
    const r = ligarFalhas([
      { n: 1, ts: 1, porta: 2001, conexao: 3, dir: 'rx', texto: '(&S)' },
      { n: 2, ts: 1, porta: 2001, conexao: 3, dir: 'tx', texto: S },
      { n: 3, ts: 2, porta: 2001, conexao: 3, dir: 'rx', texto: '(&S)' },
      { n: 4, ts: 2, porta: 2001, conexao: null, dir: 'ev', falha: true, falhaTipo: 'checksum_errado', quadroFalha: '(&S)', texto: 'falha injetada: checksum_errado (&S) em (&S)' },
      { n: 5, ts: 2, porta: 2001, conexao: 3, dir: 'tx', texto: S.replace('G78', 'G22') },
      { n: 6, ts: 3, porta: 2001, conexao: 3, dir: 'rx', texto: '(&S)' },
      { n: 7, ts: 3, porta: 2001, conexao: 3, dir: 'tx', texto: S },
    ]);
    expect(r.map((x) => x.falhaTipo ?? null)).toEqual([null, null, 'checksum_errado', 'checksum_errado', 'checksum_errado', null, null]);
    expect(r[3]!.alvo).toBe(5);
    expect(r[4]!.verbo).toBe('&S');
  });

  it('ligarFalhas: falha que engole a resposta (sem_resposta) não puxa a resposta do pedido seguinte', async () => {
    const { ligarFalhas } = await mod();
    const r = ligarFalhas([
      { n: 1, ts: 1, porta: 2001, conexao: 3, dir: 'rx', texto: '(&S)' },
      { n: 2, ts: 1, porta: 2001, conexao: null, dir: 'ev', falha: true, falhaTipo: 'sem_resposta', quadroFalha: '(&S)', texto: 'falha injetada: sem_resposta (&S) em (&S)' },
      { n: 3, ts: 2, porta: 2001, conexao: 3, dir: 'rx', texto: '(&S)' },
      { n: 4, ts: 2, porta: 2001, conexao: 3, dir: 'tx', texto: S },
      // Another port with the same frame is not affected.
      { n: 5, ts: 2, porta: 1771, conexao: 4, dir: 'rx', texto: '(&S)' },
      { n: 6, ts: 2, porta: 1771, conexao: 4, dir: 'tx', texto: S },
    ]);
    expect(r[0]!.falhaTipo).toBe('sem_resposta');
    expect(r[1]!.alvo).toBeUndefined();
    expect(r.slice(2).every((x) => !x.falhaTipo)).toBe(true);
  });

  it('render: a resposta alterada sai "inválido" e marcada; o filtro Falhas mostra o pedido, o evento e a resposta', async () => {
    const { cmd, app } = await criar('simulador-2.7.2');
    const { default: trafego } = await tela('trafego');
    const a = (await app()) as App & { trafego: Linha[] };
    a.trafego = [
      { n: 1, ts: 1, porta: 2001, conexao: 3, dir: 'rx', texto: '(&S)' },
      { n: 2, ts: 1, porta: 2001, conexao: null, dir: 'ev', falha: true, falhaTipo: 'checksum_errado', quadroFalha: '(&S)', texto: 'falha injetada: checksum_errado (&S) em (&S)' },
      { n: 3, ts: 1, porta: 2001, conexao: 3, dir: 'tx', texto: S.replace('G78', 'G22') },
      { n: 4, ts: 2, porta: 2001, conexao: 3, dir: 'rx', texto: '(&S)' },
      { n: 5, ts: 2, porta: 2001, conexao: 3, dir: 'tx', texto: S },
    ];
    void cmd;
    const html = trafego.render(a);
    const linha = (n: number) => new RegExp(`<div class="con-row([^"]*)"[^>]*data-key="t${n}"[^>]*>([\\s\\S]*?)</div>`).exec(html)!;
    expect(linha(3)[1]).toContain('afetado');
    expect(linha(3)[2]).toContain('inválido');
    expect(linha(5)[1]).not.toContain('afetado');
    expect(linha(5)[2]).toContain('sem KK');
    expect(linha(2)[1]).toContain('falha');
    // Clicking the event selects the reply it changed.
    expect(linha(2)[0]).toContain('data-n="3"');
    a.ui.trafego.verbo = 'Falhas';
    const keys = [...trafego.render(a).matchAll(/data-key="t(\d+)"/g)].map((m) => Number(m[1]));
    expect(keys).toEqual([1, 2, 3]);
  });

  it('console segue o fim ao vivo; para quando o usuário rola para cima; volta no fim; pausado não mexe', async () => {
    const { noFundo, seguirFim } = await mod();
    const el = { scrollTop: 0, scrollHeight: 2000, clientHeight: 560 };
    const u: Record<string, unknown> = { pausado: null };
    expect(seguirFim(u, el)).toBe(true);
    expect(el.scrollTop).toBe(2000);
    // Browsers clamp scrollTop; emulate it.
    el.scrollTop = el.scrollHeight - el.clientHeight;
    u.topo = el.scrollTop;
    // New lines: the content grows, the console follows.
    el.scrollHeight = 2400;
    expect(noFundo(el)).toBe(false);
    expect(seguirFim(u, el)).toBe(true);
    el.scrollTop = el.scrollHeight - el.clientHeight;
    u.topo = el.scrollTop;
    // The user scrolls up and a render lands before the scroll event: following stops, nothing moves.
    el.scrollTop = 300;
    el.scrollHeight = 2600;
    expect(seguirFim(u, el)).toBe(false);
    expect(u.seguir).toBe(false);
    expect(el.scrollTop).toBe(300);
    expect(seguirFim(u, el)).toBe(false);
    // Back at the bottom: the scroll handler sees it and following resumes.
    const { default: trafego } = await tela('trafego');
    const a = { ui: { trafego: u } } as unknown as App;
    el.scrollTop = el.scrollHeight - el.clientHeight;
    (trafego as unknown as { aoRolar(app: App, el: unknown): void }).aoRolar(a, { ...el, classList: { contains: (c: string) => c === 'con-body' } });
    expect(u.seguir).toBe(true);
    el.scrollHeight = 3000;
    expect(seguirFim(u, el)).toBe(true);
    expect(el.scrollTop).toBe(3000);
    // Paused ("Pausado"): never moves.
    u.pausado = [];
    el.scrollTop = 10;
    expect(seguirFim(u, el)).toBe(false);
    expect(el.scrollTop).toBe(10);
  });
});
