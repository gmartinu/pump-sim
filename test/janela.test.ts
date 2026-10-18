import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSET_JANELA, ASSET_JANELA_SHA, CODIGO_SEM_WEBVIEW2, argsHost, caiParaNavegador, dirHost, instalarHost, nomeHost, usarHost } from '../src/ui/janela.js';

/**
 * Frameless window host of the Windows executable (DECISIONS §32): the launcher decisions, the
 * sha-checked install of the embedded host, and the page side of the page ↔ host message protocol
 * (ui/js/janela.js) against the fixture the Go tests also read.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR_GO = path.join(RAIZ, 'tools', 'window-go');

type Fixture = {
  mensagens: { envio: Record<string, unknown>; acao: string }[];
  estado: { maximizada: boolean; regiao: boolean; json: string };
};
const fixture = JSON.parse(fs.readFileSync(path.join(DIR_GO, 'testdata', 'protocolo.json'), 'utf8')) as Fixture;

type Estado = { ativa: boolean; maximizada: boolean; regiao: boolean };
type Janela = { estado: Estado; acao(n: string): void; cor(hex: string | null, escuro: boolean): void };
type ModJanela = {
  mensagem(acao: string, extra?: Record<string, unknown>): Record<string, unknown>;
  hexDeRgb(s: string): string | null;
  criarJanela(webview: unknown, aoMudar?: () => void): Janela;
  botoesJanela(e: Estado): string;
  arrastavel(alvo: unknown): boolean;
};
const modJanela = async () => (await import(pathToFileURL(path.join(RAIZ, 'ui', 'js', 'janela.js')).href)) as ModJanela;

/** A stand-in for window.chrome.webview: records posts, lets the test deliver host messages. */
function webviewFalso() {
  const enviados: Record<string, unknown>[] = [];
  let ouvinte: ((ev: { data: unknown }) => void) | null = null;
  return {
    enviados,
    receber: (data: unknown) => ouvinte?.({ data }),
    postMessage: (m: Record<string, unknown>) => void enviados.push(m),
    addEventListener: (t: string, f: (ev: { data: unknown }) => void) => {
      if (t === 'message') ouvinte = f;
    },
  };
}

describe('launcher decisions', () => {
  it('the host is used only by the Windows executable that carries it', () => {
    expect(usarHost({ plataforma: 'win32', executavel: true, temHost: true })).toBe(true);
    expect(usarHost({ plataforma: 'win32', executavel: true, temHost: false })).toBe(false);
    expect(usarHost({ plataforma: 'win32', executavel: false, temHost: true })).toBe(false);
    expect(usarHost({ plataforma: 'darwin', executavel: true, temHost: true })).toBe(false);
    expect(usarHost({ plataforma: 'linux', executavel: true, temHost: true })).toBe(false);
  });

  it('falls back to the browser on a spawn error or the no-WebView2 exit code, never on a user close', () => {
    expect(caiParaNavegador({ erroSpawn: true, codigo: null })).toBe(true);
    expect(caiParaNavegador({ erroSpawn: false, codigo: CODIGO_SEM_WEBVIEW2 })).toBe(true);
    expect(caiParaNavegador({ erroSpawn: false, codigo: 0 })).toBe(false);
    expect(caiParaNavegador({ erroSpawn: false, codigo: 1 })).toBe(false);
    expect(caiParaNavegador({ erroSpawn: false, codigo: 2 })).toBe(false);
    expect(caiParaNavegador({ erroSpawn: false, codigo: null })).toBe(false);
  });

  it('the exit code matches the Go host (codigoSemWebView2)', () => {
    const go = fs.readFileSync(path.join(DIR_GO, 'protocol.go'), 'utf8');
    expect(go).toMatch(new RegExp(`codigoSemWebView2\\s*=\\s*${CODIGO_SEM_WEBVIEW2}\\b`));
  });

  it('host arguments, folder and content-addressed name', () => {
    expect(argsHost('http://127.0.0.1:7071/')).toEqual(['-url', 'http://127.0.0.1:7071/']);
    expect(dirHost({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Local\\pump-sim\\janela');
    expect(dirHost({}, 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Local\\pump-sim\\janela');
    expect(nomeHost('ab'.repeat(32))).toBe('pump-sim-janela-abababababababab.exe');
  });

  it('build-sea embeds the host under the asset keys the launcher reads', () => {
    const build = fs.readFileSync(path.join(RAIZ, 'tools', 'build-sea.mjs'), 'utf8');
    expect(build).toContain(`assets['${ASSET_JANELA}']`);
    expect(build).toContain(`assets['${ASSET_JANELA_SHA}']`);
  });
});

describe('instalarHost', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-sim-janela-'));
    dirs.push(d);
    return path.join(d, 'janela');
  };
  const bytes = Buffer.from('MZ fake host build 1');
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');

  it('writes the host once, then reuses it while the sha matches', () => {
    const dir = tmp();
    const a = instalarHost({ bytes, shaEsperado: sha, dir });
    expect(a).toEqual({ ok: true, caminho: path.join(dir, nomeHost(sha)), escrito: true });
    expect(fs.readFileSync(path.join(dir, nomeHost(sha)))).toEqual(bytes);
    expect(instalarHost({ bytes, shaEsperado: `${sha.toUpperCase()}\n`, dir })).toEqual({ ok: true, caminho: path.join(dir, nomeHost(sha)), escrito: false });
    expect(fs.readdirSync(dir)).toEqual([nomeHost(sha)]);
  });

  it('rewrites a host file whose sha no longer matches (truncated, tampered)', () => {
    const dir = tmp();
    instalarHost({ bytes, shaEsperado: sha, dir });
    fs.writeFileSync(path.join(dir, nomeHost(sha)), 'MZ tampered');
    const r = instalarHost({ bytes, shaEsperado: sha, dir });
    expect(r).toMatchObject({ ok: true, escrito: true });
    expect(fs.readFileSync(path.join(dir, nomeHost(sha)))).toEqual(bytes);
  });

  it('never writes an embedded host whose bytes do not match the embedded sha', () => {
    const dir = tmp();
    const r = instalarHost({ bytes: Buffer.from('other'), shaEsperado: sha, dir });
    expect(r).toEqual({ ok: false, motivo: 'janela embutida corrompida (sha256 não confere)' });
    expect(fs.existsSync(dir)).toBe(false);
    expect(instalarHost({ bytes, shaEsperado: 'not-a-sha', dir })).toMatchObject({ ok: false });
  });

  it('removes older hosts and leaves other files alone', () => {
    const dir = tmp();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pump-sim-janela-0000000000000000.exe'), 'old');
    fs.writeFileSync(path.join(dir, 'notas.txt'), 'keep');
    instalarHost({ bytes, shaEsperado: sha, dir });
    expect(fs.readdirSync(dir).sort()).toEqual([nomeHost(sha), 'notas.txt'].sort());
  });

  it('reports a folder that cannot be written instead of throwing', () => {
    const base = tmp();
    fs.mkdirSync(path.dirname(base), { recursive: true });
    fs.writeFileSync(base, 'a file where the folder should be');
    const r = instalarHost({ bytes, shaEsperado: sha, dir: base });
    expect(r.ok).toBe(false);
  });
});

describe('page ↔ host protocol (ui/js/janela.js)', () => {
  it('builds exactly the fixture messages the Go host parses', async () => {
    const { mensagem } = await modJanela();
    expect(fixture.mensagens).toHaveLength(6);
    for (const m of fixture.mensagens) {
      const { tipo: _t, acao, ...extra } = m.envio;
      expect(mensagem(acao as string, Object.keys(extra).length ? extra : undefined)).toEqual(m.envio);
    }
  });

  it('stays inert without a bridge (browser, Edge --app)', async () => {
    const { criarJanela, botoesJanela } = await modJanela();
    for (const wv of [null, undefined, {}, { postMessage: 1 }]) {
      const j = criarJanela(wv);
      j.acao('fechar');
      expect(j.estado).toEqual({ ativa: false, maximizada: false, regiao: false });
      expect(botoesJanela(j.estado)).toBe('');
    }
  });

  it('asks for the state, turns on with the host answer and sends only known actions', async () => {
    const { criarJanela, mensagem } = await modJanela();
    const wv = webviewFalso();
    const mudou = vi.fn();
    const j = criarJanela(wv, mudou);
    expect(wv.enviados).toEqual([mensagem('pronto')]);
    j.acao('fechar'); // not active yet: nothing goes out
    wv.receber({ tipo: 'outro', maximizada: true });
    wv.receber('texto');
    expect(j.estado.ativa).toBe(false);
    wv.receber(JSON.parse(fixture.estado.json));
    expect(j.estado).toEqual({ ativa: true, maximizada: fixture.estado.maximizada, regiao: fixture.estado.regiao });
    expect(mudou).toHaveBeenCalledTimes(1);
    wv.receber(JSON.parse(fixture.estado.json));
    expect(mudou).toHaveBeenCalledTimes(1); // same state: no re-render
    for (const a of ['minimizar', 'maximizar', 'fechar', 'arrastar', 'navegar', 'pronto', 'cor']) j.acao(a);
    expect(wv.enviados.slice(1)).toEqual(['minimizar', 'maximizar', 'fechar', 'arrastar'].map((a) => mensagem(a)));
  });

  it('sends the bar color once per change, lower-case, and drops anything that is not #rrggbb', async () => {
    const { criarJanela } = await modJanela();
    const wv = webviewFalso();
    const j = criarJanela(wv);
    wv.receber({ tipo: 'janela', maximizada: false, regiao: true });
    j.cor('#1A2B3C', true);
    j.cor('#1a2b3c', true);
    j.cor('oklch(0.2 0 0)', true);
    j.cor(null, false);
    j.cor('#1a2b3c', false);
    const cores = wv.enviados.filter((m) => m.acao === 'cor');
    expect(cores).toEqual([fixture.mensagens.find((m) => m.acao === 'cor')!.envio, { tipo: 'janela', acao: 'cor', cor: '#1a2b3c', escuro: false }]);
  });

  it('draws three caption buttons (restore when maximized) wired to g:janela', async () => {
    const { botoesJanela } = await modJanela();
    const normal = botoesJanela({ ativa: true, maximizada: false, regiao: true });
    expect(normal.match(/data-act="g:janela"/g)).toHaveLength(3);
    expect(normal).toContain('data-acao="minimizar"');
    expect(normal).toContain('aria-label="Maximizar"');
    expect(normal).toContain('data-acao="fechar"');
    expect(botoesJanela({ ativa: true, maximizada: true, regiao: true })).toContain('aria-label="Restaurar"');
    expect(normal).not.toMatch(/https?:/);
  });

  it('hexDeRgb and the drag target test', async () => {
    const { hexDeRgb, arrastavel } = await modJanela();
    expect(hexDeRgb('rgb(253, 253, 254)')).toBe('#fdfdfe');
    expect(hexDeRgb('rgba(0, 16, 255, 0.5)')).toBe('#0010ff');
    expect(hexDeRgb('oklch(0.2 0 0)')).toBeNull();
    const el = (dentroTb: boolean, controle: boolean) => ({ closest: (s: string) => (s === '.tb' ? dentroTb : controle) || null });
    expect(arrastavel(el(true, false))).toBe(true);
    expect(arrastavel(el(true, true))).toBe(false);
    expect(arrastavel(el(false, false))).toBe(false);
    expect(arrastavel(null)).toBe(false);
  });
});
