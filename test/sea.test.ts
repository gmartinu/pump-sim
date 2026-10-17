import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dirUi } from '../src/ui/assets.js';
import { comoAbrir } from '../src/ui/navegador.js';

/**
 * Windows distribution (DECISIONS §19, U8/U10): the UI folder resolution the CJS bundle relies on
 * and the order in which `--ui` picks a browser (Edge --app, Chrome --app, default browser).
 */

const URL_UI = 'http://127.0.0.1:7070/';
const ENV_WIN = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
const EDGE_WIN = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CHROME_WIN = 'C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';

describe('dirUi', () => {
  it('resolves the package ui/ folder (with index.html) from src/', () => {
    expect(dirUi()).toBe(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui'));
    expect(fs.existsSync(path.join(dirUi(), 'index.html'))).toBe(true);
  });
});

describe('comoAbrir', () => {
  it('Windows: Edge --app by install path, before Chrome', () => {
    const r = comoAbrir(URL_UI, 'win32', ENV_WIN, (p) => p === EDGE_WIN || p === CHROME_WIN);
    expect(r).toEqual({ cmd: EDGE_WIN, args: [`--app=${URL_UI}`] });
  });

  it('Windows: Chrome --app (per-user install) when Edge is missing', () => {
    const r = comoAbrir(URL_UI, 'win32', ENV_WIN, (p) => p === CHROME_WIN);
    expect(r).toEqual({ cmd: CHROME_WIN, args: [`--app=${URL_UI}`] });
  });

  it('Windows: default browser through start with an empty title, verbatim', () => {
    const r = comoAbrir(URL_UI, 'win32', ENV_WIN, () => false);
    expect(r).toEqual({ cmd: 'cmd', args: ['/c', `start "" "${URL_UI}"`], verbatim: true });
  });

  it('Windows: a missing env root is skipped, not joined as "undefined"', () => {
    const vistos: string[] = [];
    comoAbrir(URL_UI, 'win32', { ProgramFiles: 'C:\\Program Files' }, (p) => (vistos.push(p), false));
    expect(vistos).toEqual(['C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']);
  });

  it('macOS: Edge, then Chrome, as a new app instance; else open <url>', () => {
    expect(comoAbrir(URL_UI, 'darwin', {}, () => true)).toEqual({ cmd: 'open', args: ['-na', 'Microsoft Edge', '--args', `--app=${URL_UI}`] });
    expect(comoAbrir(URL_UI, 'darwin', {}, (p) => p.includes('Chrome'))).toEqual({ cmd: 'open', args: ['-na', 'Google Chrome', '--args', `--app=${URL_UI}`] });
    expect(comoAbrir(URL_UI, 'darwin', {}, () => false)).toEqual({ cmd: 'open', args: [URL_UI] });
  });

  it('Linux: xdg-open without Edge or Chrome', () => {
    expect(comoAbrir(URL_UI, 'linux', {}, () => false)).toEqual({ cmd: 'xdg-open', args: [URL_UI] });
  });
});
