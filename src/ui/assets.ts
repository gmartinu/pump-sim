import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Static files of the web UI (`ui/` at the package root). In a Node single executable (SEA)
 * they come from the executable's assets (`ui/<path>`); otherwise from disk, next to `dist/`
 * (or `src/` under the tests). Nothing is generated at build time.
 */
const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** Only plain relative names: no `..`, no absolute path, a known extension. */
const NOME_VALIDO = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.(?:html|js|css|svg|json|woff2)$/i;

type Sea = { isSea(): boolean; getAsset(chave: string): ArrayBuffer };

function sea(): Sea | null {
  try {
    const m = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule?.('node:sea') as Sea | undefined;
    return m && m.isSea() ? m : null;
  } catch {
    return null;
  }
}

/**
 * Where this module runs from. ESM (`src/`, `dist/`): `import.meta.url`. The single-file CJS bundle
 * (`build/sea/pump-sim.cjs`) has no `import.meta` (the build defines `import.meta.url` as
 * `undefined`), so it falls back to `__dirname`, then to the folder of the executable.
 */
function basesCandidatas(): string[] {
  const bases: string[] = [];
  try {
    const url = import.meta.url as string | undefined;
    if (url) bases.push(path.dirname(fileURLToPath(url)));
  } catch {
    // not an ES module
  }
  if (typeof __dirname === 'string') bases.push(__dirname);
  bases.push(path.dirname(process.execPath));
  return bases;
}

let dirUiCache: string | undefined;

/**
 * Folder of the UI files on disk: `<package>/ui`, two levels above `src/ui`, `dist/ui` or
 * `build/sea`; or `ui/` next to (or one level above) the running file or executable. The first
 * folder holding `index.html` wins; with none, the ESM default (`../../ui`) is returned.
 */
export function dirUi(): string {
  if (dirUiCache) return dirUiCache;
  const bases = basesCandidatas();
  const candidatos = bases.flatMap((b) => [path.resolve(b, '..', '..', 'ui'), path.resolve(b, '..', 'ui'), path.resolve(b, 'ui')]);
  const achado = candidatos.find((d) => fs.existsSync(path.join(d, 'index.html')));
  dirUiCache = achado ?? candidatos[0]!;
  return dirUiCache;
}

export function lerAssetUi(rel: string): { corpo: Buffer; tipo: string } | null {
  if (!NOME_VALIDO.test(rel)) return null;
  const tipo = TIPOS[path.extname(rel).toLowerCase()];
  if (!tipo) return null;
  const s = sea();
  // Inside the SEA the files are the executable's assets; the disk is never read.
  if (s) {
    try {
      return { corpo: Buffer.from(s.getAsset(`ui/${rel}`)), tipo };
    } catch {
      return null;
    }
  }
  const arq = path.join(dirUi(), rel);
  if (!arq.startsWith(dirUi() + path.sep)) return null;
  try {
    return { corpo: fs.readFileSync(arq), tipo };
  } catch {
    return null;
  }
}
