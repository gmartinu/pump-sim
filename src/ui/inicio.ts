/**
 * Startup behaviour of `--ui` and of the Windows executable (double click), kept out of cli.ts
 * so it can be unit-tested: control-port fallback and the fatal-error text and dialog. The
 * executable is a GUI-subsystem program since DECISIONS §34 (no console: no "press Enter" pause,
 * no `chcp`; its output goes to the log file of `src/ui/log.ts`).
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

/** Portuguese text of a fatal startup error. */
export function mensagemErroFatal(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const c = (e as { code?: string } | null)?.code;
  if (c === 'EADDRINUSE') return `[pump-sim] erro ao iniciar: porta já em uso (${m})`;
  return `[pump-sim] erro ao iniciar: ${m}`;
}

/**
 * Stack trace safe to log from the executable: every absolute path in an `at …` frame (the SEA main
 * is the bundle's build-machine path, e.g. /Users/<dev>/…/build/sea/pump-sim.cjs) becomes its file
 * basename, keeping line and column. The message lines are left as they are.
 */
export function pilhaSemCaminhos(pilha: string): string {
  const caminho = /(?<=[\s(])(?:file:\/\/\/?)?(?:[A-Za-z]:[\\/]|\/)[^\s()]*[\\/]([^\\/\s()]+:\d+(?::\d+)?)/g;
  return pilha
    .split('\n')
    .map((l) => (/^\s*at\s/.test(l) ? l.replace(caminho, '$1') : l))
    .join('\n');
}

/** Longest message passed to the dialog (the host's command line is limited to 32767 characters). */
export const MAX_DIALOGO = 2000;

/**
 * Text of the fatal-error dialog of the executable: the message without the `[pump-sim] ` prefix,
 * truncated, plus where the log file is (when there is one).
 */
export function textoDialogoErro(mensagem: string, arquivoLog: string | null): string {
  let m = mensagem.replace(/^\[pump-sim\] /, '').trim();
  if (m.length > MAX_DIALOGO) m = `${m.slice(0, MAX_DIALOGO - 1)}…`;
  return arquivoLog ? `${m}\n\nDetalhes no log: ${arquivoLog}` : m;
}
