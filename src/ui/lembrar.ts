import fs from 'node:fs';
import path from 'node:path';
import { defComando } from '../control/catalogo.js';
import { validar } from '../control/validar.js';

/**
 * The last configuration kept by `--lembrar` (the Windows executable's default): profile, ports and
 * the equipment panel, in `%APPDATA%\pump-sim\ultima-config.json` (`$XDG_CONFIG_HOME` or `~/.config`
 * elsewhere). The file may come from an older version or be edited by hand, so it is validated key by
 * key before anything is applied (DECISIONS §35): an absent (or `null`) key is skipped silently, an
 * unknown or invalid one is dropped and reported in one log line.
 */
export interface UltimaConfig {
  perfil?: string;
  portas?: number[];
  dips?: boolean[];
  modelo?: string;
  automacao?: boolean;
  redeAC?: boolean;
  bateriaVolts?: number;
  tickVazaoMs?: number;
}

export const NOME_ULTIMA_CONFIG = 'ultima-config.json';

export function arquivoUltimaConfig(plataforma: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string {
  const base = plataforma === 'win32' ? (env.APPDATA ?? path.join(home, 'AppData', 'Roaming')) : (env.XDG_CONFIG_HOME ?? path.join(home, '.config'));
  return path.join(base, 'pump-sim', NOME_ULTIMA_CONFIG);
}

/** Schema of argument `arg` of catalog command `comando` (the restore goes through these commands). */
function argDe(comando: string, arg: string): Record<string, unknown> {
  const s = (defComando(comando)?.params.properties as Record<string, Record<string, unknown>> | undefined)?.[arg];
  if (!s) throw new Error(`catálogo sem ${comando}.${arg}`);
  return s;
}

const inteiro = (min: number, max: number) => (v: unknown) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Validity of each kept key; the equipment keys use the schema of the command that restores them. */
const VALIDOS: { [K in keyof Required<UltimaConfig>]: (v: unknown) => boolean } = {
  perfil: (v) => typeof v === 'string' && v.length > 0,
  portas: (v) => Array.isArray(v) && v.length > 0 && v.every(inteiro(1, 65535)),
  dips: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 4 && v.every((x) => typeof x === 'boolean'),
  modelo: (v) => validar(argDe('set_modelo', 'modelo'), v).length === 0,
  automacao: (v) => validar(argDe('set_automacao', 'on'), v).length === 0,
  redeAC: (v) => validar(argDe('set_rede_ac', 'ligada'), v).length === 0,
  bateriaVolts: (v) => validar(argDe('set_bateria', 'volts'), v).length === 0,
  tickVazaoMs: (v) => typeof v === 'number' && validar(argDe('set_velocidade', 'velocidade'), v).length === 0,
};

export interface LeituraUltimaConfig {
  config: UltimaConfig;
  /** Keys dropped: unknown, or present with a value the restore would reject. */
  ignoradas: string[];
}

/** Keeps the valid keys of a parsed file; absent and `null` keys are skipped silently. */
export function sanearUltimaConfig(v: unknown, perfis?: readonly string[]): LeituraUltimaConfig {
  const config: Record<string, unknown> = {};
  const ignoradas: string[] = [];
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { config, ignoradas: v === null || v === undefined ? [] : ['(arquivo não é um objeto)'] };
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (x === undefined || x === null) continue;
    const ok = Object.hasOwn(VALIDOS, k) && VALIDOS[k as keyof UltimaConfig](x) && (k !== 'perfil' || !perfis || perfis.includes(x as string));
    if (ok) config[k] = x;
    else ignoradas.push(k);
  }
  return { config: config as UltimaConfig, ignoradas };
}

/** One concise log line about what was dropped, or null when nothing was. */
export function avisoUltimaConfig(arquivo: string, ignoradas: readonly string[]): string | null {
  if (!ignoradas.length) return null;
  return `[pump-sim] última configuração (${arquivo}): ${ignoradas.length === 1 ? 'entrada ignorada' : 'entradas ignoradas'} (desconhecidas ou inválidas): ${ignoradas.join(', ')}`;
}

/** Reads and validates the file. A missing file is an empty configuration with no warning. */
export function lerUltimaConfig(arquivo: string, perfis?: readonly string[]): { config: UltimaConfig; aviso: string | null } {
  let txt: string;
  try {
    txt = fs.readFileSync(arquivo, 'utf8');
  } catch {
    return { config: {}, aviso: null };
  }
  let v: unknown;
  try {
    v = JSON.parse(txt.replace(/^\uFEFF/, ''));
  } catch {
    return { config: {}, aviso: `[pump-sim] última configuração (${arquivo}): JSON inválido, ignorada` };
  }
  const r = sanearUltimaConfig(v, perfis);
  return { config: r.config, aviso: avisoUltimaConfig(arquivo, r.ignoradas) };
}

/** The control commands that re-apply a (validated) configuration's equipment panel, in order. */
export function passosUltimaConfig(c: UltimaConfig): [string, Record<string, unknown>][] {
  const passos: [string, Record<string, unknown>][] = [];
  c.dips?.forEach((on, i) => passos.push(['set_dip', { n: i + 1, on }]));
  if (c.modelo !== undefined) passos.push(['set_modelo', { modelo: c.modelo }]);
  if (c.automacao !== undefined) passos.push(['set_automacao', { on: c.automacao }]);
  if (c.redeAC !== undefined) passos.push(['set_rede_ac', { ligada: c.redeAC }]);
  if (c.bateriaVolts !== undefined) passos.push(['set_bateria', { volts: c.bateriaVolts }]);
  if (c.tickVazaoMs !== undefined) passos.push(['set_velocidade', { velocidade: c.tickVazaoMs }]);
  return passos;
}
