import { spawnSync } from 'node:child_process';

/**
 * Startup behaviour of `--ui` and of the Windows executable (double click), kept out of cli.ts
 * so it can be unit-tested: control-port fallback, the "press Enter" pause on a fatal error and
 * the UTF-8 console code page.
 */

/** First control port `--ui` tries when `--control` is missing. */
export const PORTA_CONTROLE_PADRAO = 7070;
/** Last port of the `--ui` fallback scan (7070..7089). */
export const PORTA_CONTROLE_ULTIMA = 7089;

export type ResultadoControle<S> =
  | { ok: true; servidor: S; porta: number; tentadas: number[] }
  | { ok: false; erro: Error; tentadas: number[] };

function ehPortaOcupada(e: unknown): boolean {
  const c = (e as { code?: string } | null)?.code;
  return c === 'EADDRINUSE' || c === 'EACCES';
}

/**
 * Opens the control server. An explicit `--control` port is honoured as is (one attempt); the
 * `--ui` default scans `inicial..ultima` and takes the first free port. Never throws: a failure
 * comes back as `{ ok: false }` so the simulator keeps running without the API.
 */
export async function abrirControleComFallback<S>(
  abrir: (porta: number) => Promise<S>,
  opcoes: { porta: number; explicita: boolean; ultima?: number },
): Promise<ResultadoControle<S>> {
  const ultima = opcoes.explicita ? opcoes.porta : Math.max(opcoes.porta, opcoes.ultima ?? PORTA_CONTROLE_ULTIMA);
  const tentadas: number[] = [];
  let erro: Error = new Error('nenhuma porta tentada');
  for (let p = opcoes.porta; p <= ultima; p++) {
    tentadas.push(p);
    try {
      return { ok: true, servidor: await abrir(p), porta: p, tentadas };
    } catch (e) {
      erro = e instanceof Error ? e : new Error(String(e));
      if (!ehPortaOcupada(e)) break;
    }
  }
  return { ok: false, erro, tentadas };
}

/** Portuguese message for a control-port failure (shown in the console). */
export function mensagemFalhaControle(r: { erro: Error; tentadas: number[] }, explicita: boolean): string {
  const ocupada = ehPortaOcupada(r.erro);
  const faixa = r.tentadas.length > 1 ? `${r.tentadas[0]}..${r.tentadas[r.tentadas.length - 1]}` : String(r.tentadas[0]);
  const motivo = ocupada ? (r.tentadas.length > 1 ? `portas ${faixa} ocupadas` : `porta ${faixa} ocupada`) : r.erro.message;
  const dica = explicita ? 'escolha outra com --control <porta>' : 'feche o outro pump-sim ou use --control <porta>';
  return `[pump-sim] não consegui abrir a API de controle/UI (${motivo}); o simulador segue sem UI — ${dica}`;
}

/**
 * Whether a fatal error waits for Enter before exiting: only the Windows executable started with
 * no arguments (double click), with an interactive console. A script, a pipe or an explicit
 * command line keeps the immediate exit with code 1.
 */
export function deveEsperarEnter(c: { executavel: boolean; semArgumentos: boolean; tty: boolean }): boolean {
  return c.executavel && c.semArgumentos && c.tty;
}

/** Portuguese text of a fatal startup error. */
export function mensagemErroFatal(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const c = (e as { code?: string } | null)?.code;
  if (c === 'EADDRINUSE') return `[pump-sim] erro ao iniciar: porta já em uso (${m})`;
  return `[pump-sim] erro ao iniciar: ${m}`;
}

/**
 * Switches the Windows console to UTF-8 (code page 65001) so the Portuguese messages do not show
 * as mojibake in a cp850 console. Runs `chcp` in a child that shares this console; best effort.
 */
export function consoleUtf8(plataforma: NodeJS.Platform = process.platform): boolean {
  if (plataforma !== 'win32') return false;
  try {
    const r = spawnSync('cmd.exe', ['/d', '/s', '/c', 'chcp 65001 >NUL'], { stdio: 'inherit', windowsVerbatimArguments: true });
    return r.status === 0;
  } catch {
    return false;
  }
}
