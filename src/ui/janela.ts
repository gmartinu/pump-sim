import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The frameless window host of the Windows executable (DECISIONS §32): `tools/window-go`, built by
 * `tools/build-sea.mjs` and embedded as two SEA assets (the `.exe` and its sha256). On a double click
 * the executable writes it to `%LOCALAPPDATA%\pump-sim\janela\` (content-addressed name, checked
 * by sha before every launch) and runs it on the UI URL; Edge `--app` / the default browser
 * (`comoAbrir`) remain the fallback when the host is missing or the WebView2 runtime is. The same
 * host shows the fatal-error dialog (`-erro`), since the executable has no console (§34).
 */

/** Exit code of the host when the WebView2 runtime is missing or unusable (`codigoSemWebView2` in tools/window-go/protocol.go). */
export const CODIGO_SEM_WEBVIEW2 = 3;

export const ASSET_JANELA = 'janela/pump-sim-janela.exe';
export const ASSET_JANELA_SHA = 'janela/pump-sim-janela.exe.sha256';

/** Whether `--ui` opens the window host: only the Windows executable that carries it. */
export function usarHost(c: { plataforma: NodeJS.Platform; executavel: boolean; temHost: boolean }): boolean {
  return c.plataforma === 'win32' && c.executavel && c.temHost;
}

/** Whether a host run ends in the browser fallback: it could not start, or it reported no WebView2. Closing the window (0) does not. */
export function caiParaNavegador(r: { erroSpawn: boolean; codigo: number | null }): boolean {
  return r.erroSpawn || r.codigo === CODIGO_SEM_WEBVIEW2;
}

/** Folder the host is written to. */
export function dirHost(env: NodeJS.ProcessEnv, home: string): string {
  return path.win32.join(env['LOCALAPPDATA'] ?? path.win32.join(home, 'AppData', 'Local'), 'pump-sim', 'janela');
}

const PREFIXO = 'pump-sim-janela-';

/** Content-addressed file name: a new build never overwrites a host that is still running (Windows locks a running .exe). */
export function nomeHost(sha: string): string {
  return `${PREFIXO}${sha.slice(0, 16)}.exe`;
}

function sha256(b: Uint8Array): string {
  return crypto.createHash('sha256').update(b).digest('hex');
}

function shaArquivo(arq: string): string | null {
  try {
    return sha256(fs.readFileSync(arq));
  } catch {
    return null;
  }
}

export type Instalacao = { ok: true; caminho: string; escrito: boolean } | { ok: false; motivo: string };

/**
 * Makes sure `dir` holds the host whose sha256 is `shaEsperado` and returns its path. The asset bytes
 * are checked first (a broken build is never written), an existing file is reused only when its sha
 * matches, a new one goes through a temp file + rename and is read back before use. Older hosts in
 * `dir` are removed best effort (one still running stays). Never throws.
 */
export function instalarHost(o: { bytes: Uint8Array; shaEsperado: string; dir: string }): Instalacao {
  const esperado = o.shaEsperado.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(esperado)) return { ok: false, motivo: 'sha256 da janela inválido no executável' };
  if (sha256(o.bytes) !== esperado) return { ok: false, motivo: 'janela embutida corrompida (sha256 não confere)' };
  const caminho = path.join(o.dir, nomeHost(esperado));
  let escrito = false;
  try {
    if (shaArquivo(caminho) !== esperado) {
      fs.mkdirSync(o.dir, { recursive: true });
      const tmp = `${caminho}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, o.bytes);
      fs.renameSync(tmp, caminho);
      escrito = true;
      if (shaArquivo(caminho) !== esperado) return { ok: false, motivo: `sha256 de ${caminho} não confere depois de gravar` };
    }
  } catch (e) {
    return { ok: false, motivo: `não consegui gravar ${caminho}: ${e instanceof Error ? e.message : String(e)}` };
  }
  try {
    for (const n of fs.readdirSync(o.dir)) {
      if (n.startsWith(PREFIXO) && n !== path.basename(caminho)) {
        try {
          fs.rmSync(path.join(o.dir, n), { force: true });
        } catch {
          // still running, or locked by an antivirus scan: try again next time
        }
      }
    }
  } catch {
    // listing failed: nothing to clean
  }
  return { ok: true, caminho, escrito };
}

/** The host's arguments. */
export function argsHost(url: string): string[] {
  return ['-url', url];
}

/** The host's arguments for the fatal-error dialog (`MessageBoxW`, title pump-sim; DECISIONS §34). */
export function argsErroHost(mensagem: string): string[] {
  return ['-erro', mensagem];
}

/**
 * Whether the simulator stops when the host window ends (DECISIONS §34): the GUI executable has no
 * console to close, so closing the window (or the window dying) ends the process. A spawn error or
 * no WebView2 (the browser fallback takes over) does not.
 */
export function encerraComJanela(r: { erroSpawn: boolean; codigo: number | null }): boolean {
  return !caiParaNavegador(r);
}

type Sea = { isSea(): boolean; getAsset(chave: string): ArrayBuffer; getAsset(chave: string, codificacao: string): string };

/** The two host assets of the running single executable, or null (npm CLI, or a build without the host). */
export function lerAssetsHost(): { bytes: Uint8Array; sha: string } | null {
  try {
    const s = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule?.('node:sea') as Sea | undefined;
    if (!s?.isSea()) return null;
    return { bytes: new Uint8Array(s.getAsset(ASSET_JANELA)), sha: s.getAsset(ASSET_JANELA_SHA, 'utf8') };
  } catch {
    return null;
  }
}
