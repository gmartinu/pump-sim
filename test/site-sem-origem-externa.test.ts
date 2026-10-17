import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * CI guard for the static pages (site/ and ui/): nothing is loaded from an external origin.
 * An http(s) URL may appear only
 *   - in HTML, as the `href` of an `<a>` to an allowed documentation host (a link the user clicks),
 *     or as visible text naming one (a command to copy);
 *   - in JS, as display text (a command, a JSON snippet) naming an allowed documentation host, on a
 *     line that does not fetch, import, open a socket or set a `src`;
 *   - anywhere, pointing at loopback (127.0.0.1, localhost) or the `host:porta` placeholder;
 *   - as an XML namespace (`http://www.w3.org/2000/svg`, `…/1999/xlink`).
 * CSS and SVG may not reference any external URL. Markdown files and the font license texts are
 * documentation, never loaded by a page, and are not scanned.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASTAS = ['site', 'ui'];
const BINARIOS = new Set(['.woff2', '.png', '.ico', '.jpg', '.jpeg', '.gif', '.webp']);
const HOSTS_DOC = new Set(['github.com', 'signpath.org', 'about.signpath.io']);
const HOSTS_LOCAIS = new Set(['127.0.0.1', 'localhost', 'host']);
const NAMESPACES = new Set(['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink']);
const CARREGA = /\b(?:fetch|import|importScripts|WebSocket|EventSource|sendBeacon|XMLHttpRequest|open)\s*\(|\bsrc\s*[=:]|url\(|@import/;
const URL_RE = /https?:\/\/[^\s"'`<>)\\]+/g;

function listar(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listar(p) : [p];
  });
}

function host(url: string): string {
  return url.replace(/^https?:\/\//, '').split(/[/:?#]/)[0]!.toLowerCase();
}

/** Every external reference of one file that the rules above do not allow (`file:line url`). */
export function violacoes(rel: string, texto: string): string[] {
  const ext = path.extname(rel).toLowerCase();
  const erros: string[] = [];
  for (const m of texto.matchAll(URL_RE)) {
    const url = m[0];
    const i = m.index;
    const linha = texto.slice(0, i).split('\n').length;
    const h = host(url);
    if (NAMESPACES.has(url) || HOSTS_LOCAIS.has(h)) continue;
    let ok = false;
    const antes = texto.slice(0, i).toLowerCase();
    const emBloco = (abre: string, fecha: string): boolean => antes.lastIndexOf(abre) > antes.lastIndexOf(fecha);
    const htmlScript = (ext === '.html' || ext === '.htm') && emBloco('<script', '</script');
    const htmlStyle = (ext === '.html' || ext === '.htm') && emBloco('<style', '</style');
    if (htmlStyle) {
      // inline <style>: same rule as CSS, no external URL at all
    } else if (htmlScript) {
      // inline <script>: same rule as a .js file
      const inicio = texto.lastIndexOf('\n', i) + 1;
      const fim = texto.indexOf('\n', i);
      ok = HOSTS_DOC.has(h) && !CARREGA.test(texto.slice(inicio, fim < 0 ? undefined : fim));
    } else if (ext === '.html' || ext === '.htm') {
      const tag = texto.slice(texto.lastIndexOf('<', i), i);
      const textoVisivel = tag.includes('>'); // between tags: display text, e.g. a command to copy
      ok = HOSTS_DOC.has(h) && (textoVisivel || /^<a\s[^>]*\bhref=["']$/i.test(tag));
    } else if (ext === '.js' || ext === '.mjs') {
      const inicio = texto.lastIndexOf('\n', i) + 1;
      const fim = texto.indexOf('\n', i);
      const linhaTxt = texto.slice(inicio, fim < 0 ? undefined : fim);
      ok = HOSTS_DOC.has(h) && !CARREGA.test(linhaTxt);
    }
    if (!ok) erros.push(`${rel}:${linha} ${url}`);
  }
  return erros;
}

function arquivos(): string[] {
  return PASTAS.flatMap((p) => listar(path.join(RAIZ, p)))
    .map((a) => path.relative(RAIZ, a).split(path.sep).join('/'))
    .filter((rel) => !BINARIOS.has(path.extname(rel).toLowerCase()))
    .filter((rel) => !rel.endsWith('.md') && !rel.endsWith('/LICENSES.txt'));
}

describe('site/ e ui/ não carregam nada de origem externa', () => {
  it('a regra pega cada forma de carregar de fora e deixa passar link, loopback e namespace', () => {
    expect(violacoes('a.html', '<script src="https://cdn.example.com/x.js"></script>')).toHaveLength(1);
    expect(violacoes('a.html', '<link rel="stylesheet" href="https://fonts.googleapis.com/css">')).toHaveLength(1);
    expect(violacoes('a.html', '<img src="https://github.com/x.png">')).toHaveLength(1);
    expect(violacoes('a.html', '<a href="https://evil.example.com/">x</a>')).toHaveLength(1);
    expect(violacoes('a.html', '<iframe title="x" src="https://github.com/"></iframe>')).toHaveLength(1);
    expect(violacoes('a.html', '<span>git clone https://github.com/gmartinu/pump-sim</span>')).toEqual([]);
    expect(violacoes('a.css', '@font-face { src: url(https://github.com/f.woff2); }')).toHaveLength(1);
    expect(violacoes('a.js', "fetch('https://github.com/api')")).toHaveLength(1);
    expect(violacoes('a.js', "const s = 'https://cdn.example.com/x.js';")).toHaveLength(1);
    expect(violacoes('a.svg', '<image href="https://github.com/x.png"/>')).toHaveLength(1);
    expect(violacoes('a.html', '<a class="btn" href="https://github.com/gmartinu/pump-sim#readme">Docs</a>')).toEqual([]);
    expect(violacoes('a.js', "'git clone https://github.com/gmartinu/pump-sim && cd pump-sim',")).toEqual([]);
    expect(violacoes('a.js', '"args": ["mcp", "--control", "http://127.0.0.1:7070"]')).toEqual([]);
    expect(violacoes('a.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toEqual([]);
    expect(violacoes('a.html', "<script>fetch('https://github.com/api')</script>")).toHaveLength(1);
    expect(violacoes('a.html', '<style>@import url(https://github.com/x.css);</style>')).toHaveLength(1);
  });

  it('nenhum arquivo de site/ ou ui/ referencia origem externa fora dos links de documentação', () => {
    const lista = arquivos();
    expect(lista).toContain('site/index.html');
    expect(lista).toContain('ui/index.html');
    const erros = lista.flatMap((rel) => violacoes(rel, fs.readFileSync(path.join(RAIZ, rel), 'utf8')));
    expect(erros).toEqual([]);
  });

  it('site/ não publica notas internas: o Pages sobe a pasta inteira (DECISIONS §30, notas em docs/site/)', () => {
    const md = listar(path.join(RAIZ, 'site')).filter((f) => f.toLowerCase().endsWith('.md'));
    expect(md.map((f) => path.relative(RAIZ, f))).toEqual([]);
    expect(fs.existsSync(path.join(RAIZ, 'docs', 'site', 'README.md'))).toBe(true);
  });

  it('a CSP do site não abre nenhuma origem externa', () => {
    const html = fs.readFileSync(path.join(RAIZ, 'site', 'index.html'), 'utf8');
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
    expect(csp).toBeDefined();
    expect(csp).not.toMatch(/https?:|\*/);
    expect(csp).toMatch(/default-src 'none'/);
  });
});
