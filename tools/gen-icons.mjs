#!/usr/bin/env node
/**
 * Regenerates the raster icons from ui/icone.svg (the single source of the pump-sim mark).
 *
 *   node tools/gen-icons.mjs [--chrome <path to Chrome/Chromium>]
 *
 * Writes, all committed (the build never runs this script):
 *   - site/assets/icone.svg            copy of ui/icone.svg
 *   - site/assets/icone-32.png         32 px favicon fallback
 *   - site/assets/apple-touch-icon.png 180 px, square full-bleed background (iOS rounds the corners)
 *   - tools/icon/pump-sim.ico          16, 24, 32, 48, 64, 128, 256 px (PNG entries), set into the
 *                                      Windows executable by tools/build-sea.mjs
 *
 * Rendering goes through headless Chrome over the DevTools protocol (device metrics override at
 * scale 1, transparent background, Page.captureScreenshot), so no image library is needed.
 * Node 22's global WebSocket talks to the DevTools endpoint.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG = path.join(RAIZ, 'ui', 'icone.svg');
const TAMANHOS_ICO = [16, 24, 32, 48, 64, 128, 256];

function arg(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const CHROME = arg(
  '--chrome',
  process.env.CHROME ??
    (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : process.platform === 'win32'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : 'google-chrome'),
);

async function abrirChrome() {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-sim-icons-'));
  const proc = spawn(CHROME, ['--headless', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${perfil}`, 'about:blank'], {
    stdio: 'ignore',
  });
  const arqPorta = path.join(perfil, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(arqPorta); i++) await new Promise((r) => setTimeout(r, 100));
  if (!fs.existsSync(arqPorta)) throw new Error(`Chrome did not start (${CHROME})`);
  const porta = fs.readFileSync(arqPorta, 'utf8').split('\n')[0];
  const alvos = await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json();
  const pagina = alvos.find((a) => a.type === 'page');
  const ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((ok, erro) => {
    ws.onopen = ok;
    ws.onerror = erro;
  });
  let id = 0;
  const pendentes = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pendentes.has(m.id)) {
      const { ok, erro } = pendentes.get(m.id);
      pendentes.delete(m.id);
      if (m.error) erro(new Error(m.error.message));
      else ok(m.result);
    }
  };
  const cdp = (method, params = {}) =>
    new Promise((ok, erro) => {
      pendentes.set(++id, { ok, erro });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const fechar = async () => {
    ws.close();
    const saiu = new Promise((r) => proc.once('exit', r));
    proc.kill();
    await saiu;
    fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { cdp, fechar };
}

async function renderizar(cdp, svg, tamanho) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: tamanho, height: tamanho, deviceScaleFactor: 1, mobile: false });
  await cdp('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const html = `<!doctype html><html><body style="margin:0;background:transparent"><img width="${tamanho}" height="${tamanho}" style="display:block" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`;
  await cdp('Page.navigate', { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` });
  await new Promise((r) => setTimeout(r, 300));
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: tamanho, height: tamanho, scale: 1 } });
  return Buffer.from(data, 'base64');
}

/** ICO container with PNG entries (Windows Vista and later read PNG at every size). */
function ico(pngs) {
  const cabecalho = Buffer.alloc(6 + 16 * pngs.length);
  cabecalho.writeUInt16LE(0, 0);
  cabecalho.writeUInt16LE(1, 2);
  cabecalho.writeUInt16LE(pngs.length, 4);
  let deslocamento = cabecalho.length;
  pngs.forEach(({ tamanho, png }, i) => {
    const e = 6 + 16 * i;
    cabecalho.writeUInt8(tamanho >= 256 ? 0 : tamanho, e);
    cabecalho.writeUInt8(tamanho >= 256 ? 0 : tamanho, e + 1);
    cabecalho.writeUInt8(0, e + 2);
    cabecalho.writeUInt8(0, e + 3);
    cabecalho.writeUInt16LE(1, e + 4);
    cabecalho.writeUInt16LE(32, e + 6);
    cabecalho.writeUInt32LE(png.length, e + 8);
    cabecalho.writeUInt32LE(deslocamento, e + 12);
    deslocamento += png.length;
  });
  return Buffer.concat([cabecalho, ...pngs.map((p) => p.png)]);
}

async function main() {
  const svg = fs.readFileSync(SVG, 'utf8');
  // iOS masks the apple-touch icon itself: draw the background square, without the rounded corners.
  const svgQuadrado = svg.replace(/(<rect width="64" height="64") rx="\d+"/, '$1');
  if (svgQuadrado === svg) throw new Error('ui/icone.svg: background <rect width="64" height="64" rx=…> not found');
  const { cdp, fechar } = await abrirChrome();
  try {
    const dirSite = path.join(RAIZ, 'site', 'assets');
    fs.copyFileSync(SVG, path.join(dirSite, 'icone.svg'));
    fs.writeFileSync(path.join(dirSite, 'icone-32.png'), await renderizar(cdp, svg, 32));
    fs.writeFileSync(path.join(dirSite, 'apple-touch-icon.png'), await renderizar(cdp, svgQuadrado, 180));
    const pngs = [];
    for (const tamanho of TAMANHOS_ICO) pngs.push({ tamanho, png: await renderizar(cdp, svg, tamanho) });
    const dirIco = path.join(RAIZ, 'tools', 'icon');
    fs.mkdirSync(dirIco, { recursive: true });
    fs.writeFileSync(path.join(dirIco, 'pump-sim.ico'), ico(pngs));
    process.stdout.write(`[gen-icons] site/assets (svg, 32 px, 180 px) and tools/icon/pump-sim.ico (${TAMANHOS_ICO.join(', ')} px)\n`);
  } finally {
    await fechar();
  }
}

main().catch((e) => {
  process.stderr.write(`[gen-icons] ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
