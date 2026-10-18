import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket as WsNode } from 'ws';
import { Hub, ManualClock, abrirServidorControle } from '../src/index.js';
import { dirUi } from '../src/ui/assets.js';

/**
 * DECISIONS §35, from the Windows beta: (1) the minimize button vanished at the default 1280 px window
 * width (the status pills slid under the caption buttons), (2) native tooltips were clipped at the
 * window's right edge, (4) "Encerrar pump-sim" for the browser fallback. No browser here: the layout
 * rules are checked in the CSS and the markup the shell renders, the tooltip placement is a pure
 * function; the headless-Chrome measurement at 1280/1100/900 px is recorded in §35.
 */

type Rect = { left: number; top: number; right: number; bottom: number };
type Dica = {
  posicionarDica(alvo: Rect, tam: { w: number; h: number }, vista: { w: number; h: number }): { left: number; top: number; lado: string };
  trocarTitulos(raiz: unknown): void;
  instalarDicas(raiz: unknown, doc: unknown): { atualizar(): void };
  MARGEM: number;
  FOLGA: number;
};
const dica = async () => (await import(pathToFileURL(path.join(dirUi(), 'js', 'dica.js')).href)) as Dica;
const css = fs.readFileSync(path.join(dirUi(), 'app.css'), 'utf8');
/** Declarations of the first rule whose selector is exactly `sel` (outside or inside a media query). */
const regra = (sel: string) => {
  const m = new RegExp(`(^|[}\\s])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!m) throw new Error(`regra ${sel} não encontrada`);
  return m[2]!;
};

describe('tooltip placement (ui/js/dica.js)', () => {
  const vista = { w: 1280, h: 820 };
  const tam = { w: 308, h: 26 };

  it('below the target, centered, when it fits', async () => {
    const { posicionarDica, FOLGA } = await dica();
    const p = posicionarDica({ left: 600, top: 100, right: 640, bottom: 120 }, tam, vista);
    expect(p).toEqual({ left: 620 - 154, top: 120 + FOLGA, lado: 'baixo' });
  });

  it('the MCP switch at the right edge: shifted left, never past the viewport (the beta clipped it)', async () => {
    const { posicionarDica, MARGEM } = await dica();
    // The switch of the MCP card, 30 px from the right edge of a 1280 px window.
    const p = posicionarDica({ left: 1215, top: 495, right: 1245, bottom: 515 }, tam, vista);
    expect(p.left + tam.w).toBe(vista.w - MARGEM);
    expect(p.left).toBeGreaterThanOrEqual(MARGEM);
    for (const w of [1100, 900, 640]) {
      const q = posicionarDica({ left: w - 65, top: 495, right: w - 35, bottom: 515 }, tam, { w, h: 820 });
      expect(q.left + tam.w, String(w)).toBeLessThanOrEqual(w - MARGEM);
    }
  });

  it('near the left edge: shifted right', async () => {
    const { posicionarDica, MARGEM } = await dica();
    expect(posicionarDica({ left: 0, top: 10, right: 20, bottom: 30 }, tam, vista).left).toBe(MARGEM);
  });

  it('above the target when there is no room below; clamped when there is room nowhere', async () => {
    const { posicionarDica, FOLGA, MARGEM } = await dica();
    const p = posicionarDica({ left: 600, top: 790, right: 640, bottom: 810 }, tam, vista);
    expect(p).toMatchObject({ top: 790 - FOLGA - tam.h, lado: 'cima' });
    const alto = posicionarDica({ left: 600, top: 10, right: 640, bottom: 30 }, { w: 300, h: 815 }, vista);
    expect(alto.top).toBe(MARGEM);
  });

  it('every title becomes data-dica (no native tooltip); icon-only elements keep it as their name', async () => {
    const { trocarTitulos } = await dica();
    const el = (attrs: Record<string, string>, texto: string) => {
      const a = new Map(Object.entries(attrs));
      return {
        a,
        textContent: texto,
        getAttribute: (k: string) => a.get(k) ?? null,
        setAttribute: (k: string, v: string) => void a.set(k, v),
        removeAttribute: (k: string) => void a.delete(k),
        hasAttribute: (k: string) => a.has(k),
      };
    };
    const comTexto = el({ title: 'Trocar de perfil' }, 'simulador-2.7.2');
    const icone = el({ title: 'Desligar o MCP por HTTP (http://127.0.0.1:7070/mcp)' }, '');
    const rotulado = el({ title: 'Minimizar', 'aria-label': 'Minimizar' }, '');
    const vazio = el({ title: '' }, '');
    trocarTitulos({ querySelectorAll: (s: string) => (s === '[title]' ? [comTexto, icone, rotulado, vazio] : []) });
    expect(Object.fromEntries(comTexto.a)).toEqual({ 'data-dica': 'Trocar de perfil' });
    expect(Object.fromEntries(icone.a)).toEqual({ 'data-dica': 'Desligar o MCP por HTTP (http://127.0.0.1:7070/mcp)', 'aria-label': 'Desligar o MCP por HTTP (http://127.0.0.1:7070/mcp)' });
    expect(Object.fromEntries(rotulado.a)).toEqual({ 'data-dica': 'Minimizar', 'aria-label': 'Minimizar' });
    expect(Object.fromEntries(vazio.a)).toEqual({});
  });

  it('the patcher converts titles on the way in; the tooltip is fixed, inert to the pointer, and bounded by the viewport', async () => {
    const morph = fs.readFileSync(path.join(dirUi(), 'js', 'morph.js'), 'utf8');
    expect(morph).toMatch(/t\.innerHTML = html;\s*trocarTitulos\(t\.content\);\s*filhos\(alvo, t\.content\);/);
    const d = regra('.dica');
    for (const decl of ['position: fixed', 'pointer-events: none', 'max-width: min(360px, calc(100vw - 16px))']) expect(d).toContain(decl);
    const { instalarDicas } = await dica();
    // Without a real document (the shell's test stubs) it stays inert instead of throwing.
    expect(() => instalarDicas({ addEventListener() {} }, { body: {} }).atualizar()).not.toThrow();
  });
});

describe('top bar layout (ui/app.css)', () => {
  it('the caption buttons are a non-shrinking item of the bar row, not an overlay', () => {
    const c = regra('.janela-ctl');
    expect(c).toContain('flex: none');
    expect(c).not.toContain('position: absolute');
    expect(regra('.tbw.em-janela .tb')).toContain('padding-right: 0');
    expect(css).not.toContain('padding-right: 146px');
    expect(regra('.tb-fixos')).toContain('flex: none');
  });

  it('the status pills collapse first: a fixed-height, clipped, right-to-left wrapping row', () => {
    const r = regra('.tb-right');
    for (const decl of ['flex: 1 1 0', 'min-width: 0', 'height: 28px', 'overflow: hidden', 'flex-direction: row-reverse', 'flex-wrap: wrap']) expect(r, decl).toContain(decl);
    expect(regra('.tb-right > *')).toContain('flex: none');
    expect(regra('.tb > .tb-perfil')).toContain('min-width: 0');
  });

  it('the bar row never wraps at narrow widths (the old <900 px rule moved the pills under the controls)', () => {
    for (const m of css.matchAll(/(?:^|\s)\.tb\s*\{([^}]*)\}/g)) expect(m[1]).not.toMatch(/flex-wrap:\s*wrap|height:\s*auto/);
  });
});

// ───────────────────────── the shell inside the window host, against a real server ─────────────────────────

const registro = vi.hoisted(() => ({ html: '' }));
vi.mock('../ui/js/morph.js', () => ({ morph: (_alvo: unknown, html: string) => void (registro.html = html) }));

describe('shell (app.js) in the window host: bar order, menu, "Encerrar pump-sim"', () => {
  const HOST = '127.0.0.1';
  let hub: Hub;
  let fecharTudo: () => Promise<void>;
  let appUi: { encerrado: boolean; api: { parado: boolean; ws: { onclose: unknown; close(): void } | null } };
  let encerrou = 0;
  const handlers: Record<string, (ev: unknown) => unknown> = {};
  const enviados: unknown[] = [];

  const esperar = async (cond: () => boolean, ms = 4000) => {
    for (let i = 0; !cond(); i++) {
      if (i * 20 > ms) throw new Error(`tempo esgotado (último HTML: ${registro.html.slice(0, 300)})`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const clicar = async (act: string, filtro: (d: Record<string, string>) => boolean = () => true) => {
    for (const m of registro.html.matchAll(/<(\w+)\b([^>]*\sdata-act="([^"]*)"[^>]*)>/g)) {
      if (m[3] !== act) continue;
      const dataset: Record<string, string> = { act };
      for (const a of m[2]!.matchAll(/\sdata-([\w-]+)="([^"]*)"/g)) dataset[a[1]!.replace(/-(\w)/g, (_x, c: string) => c.toUpperCase())] = a[2]!;
      if (!filtro(dataset)) continue;
      const el = { dataset, disabled: false, closest: (s: string) => (s === '.menu' && /role="menuitem"/.test(m[2]!) ? {} : null) };
      await handlers.click!({ target: { closest: () => el }, stopPropagation() {} });
      await new Promise((r) => setTimeout(r, 30));
      return;
    }
    throw new Error(`nenhum elemento com data-act="${act}" no HTML`);
  };
  /** The `.tb` row of the rendered HTML. */
  const barra = () => registro.html.slice(registro.html.indexOf('<div class="tb">'), registro.html.indexOf('<nav class="tabs">'));

  beforeAll(async () => {
    hub = new Hub({ clock: new ManualClock(Date.UTC(2026, 9, 17, 14, 30, 0)), host: HOST, semTcp: true });
    await hub.criar('default', 'simulador-2.7.2');
    const s = await abrirServidorControle(hub, 0, HOST, { aoEncerrar: () => void encerrou++ });
    const base = s.url;
    const raiz = { addEventListener: (t: string, f: (ev: unknown) => unknown) => void (handlers[t] = f), querySelector: () => null };
    const g = globalThis as Record<string, unknown>;
    g.location = { search: '', hash: '', host: `${HOST}:${s.porta}`, port: String(s.porta) };
    const corpo = { className: '', classList: { contains: (c: string) => corpo.className.split(' ').includes(c) } };
    g.document = { getElementById: () => raiz, body: corpo, documentElement: { className: '' }, activeElement: null, querySelector: () => null };
    // The WebView2 bridge of tools/window-go: answers "pronto" with the window state (§32 J5).
    const ouvintes: ((ev: unknown) => void)[] = [];
    const webview = {
      postMessage: (m: { acao: string }) => {
        enviados.push(m);
        if (m.acao === 'pronto') setTimeout(() => ouvintes.forEach((f) => f({ data: { tipo: 'janela', maximizada: false, regiao: true } })), 0);
      },
      addEventListener: (t: string, f: (ev: unknown) => void) => void (t === 'message' && ouvintes.push(f)),
    };
    g.window = { addEventListener() {}, chrome: { webview } };
    g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    class WS extends WsNode {
      constructor(url: string) {
        super(url, { headers: { origin: base } });
      }
    }
    g.WebSocket = WS;
    const fetchReal = globalThis.fetch;
    g.fetch = (u: string, i?: RequestInit) => fetchReal(String(u).startsWith('/') ? `${base}${u}` : u, i);
    appUi = ((await import(pathToFileURL(path.join(dirUi(), 'js', 'app.js')).href)) as { app: typeof appUi }).app;
    fecharTudo = async () => {
      if (appUi.api.ws) {
        appUi.api.ws.onclose = null;
        appUi.api.ws.close();
      }
      await s.fechar();
      await hub.fechar();
    };
    await esperar(() => registro.html.includes('Lados') && registro.html.includes('janela-ctl') && registro.html.includes('data-menu="topo"'));
  });
  afterAll(async () => {
    await fecharTudo();
  });

  it('bar row: brand, profile, pills, theme/menu, then the three caption buttons as its last item', () => {
    const b = barra();
    const ordem = ['class="brand"', 'tb-perfil', 'class="tb-right"', 'class="tb-fixos', 'class="janela-ctl"'].map((k) => b.indexOf(k));
    expect(ordem.every((i) => i >= 0), JSON.stringify(ordem)).toBe(true);
    expect([...ordem].sort((x, y) => x - y)).toEqual(ordem);
    for (const a of ['minimizar', 'maximizar', 'fechar']) expect(b).toContain(`data-acao="${a}"`);
    // Nothing after the controls inside the row.
    expect(b.slice(b.indexOf('class="janela-ctl"'))).not.toMatch(/class="(pill|btn)/);
    expect(enviados).toContainEqual({ tipo: 'janela', acao: 'pronto' });
  });

  it('pill order = collapse order: the API/MCP pill is kept longest, the clock goes first', () => {
    const r = barra().slice(barra().indexOf('class="tb-right"'), barra().indexOf('class="tb-fixos'));
    const pos = ['>API<', '>Portas<', 'conexões', 'Relógio do concentrador'].map((k) => r.indexOf(k));
    expect(pos.every((i) => i >= 0), JSON.stringify(pos)).toBe(true);
    expect([...pos].sort((x, y) => x - y)).toEqual(pos);
  });

  it('"Encerrar pump-sim": menu → confirmation → POST /api/encerrar → the page says the process ended', async () => {
    expect(registro.html).not.toContain('Encerrar pump-sim');
    await clicar('g:menu', (d) => d.menu === 'topo');
    expect(registro.html).toContain('role="menuitem" data-act="g:encerrar"');
    await clicar('g:encerrar');
    expect(registro.html).toContain('role="dialog" aria-label="Encerrar pump-sim"');
    expect(registro.html).toContain('Fecha as portas do concentrador');
    expect(encerrou).toBe(0);
    await clicar('g:confirmar-modal');
    await esperar(() => encerrou === 1 && appUi.encerrado);
    expect(registro.html).toContain('O pump-sim foi encerrado');
    expect(registro.html).toContain('Pode fechar esta janela');
    expect(appUi.api.parado).toBe(true);
  });
});
