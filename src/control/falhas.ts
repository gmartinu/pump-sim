import type { ResultadoQuadro } from '../sim.js';
import { type SaidaTcp, saidaPadrao } from '../transport/tcp.js';

/**
 * Transport fault injection (spec §5.3 `injetar_falha`). The rule matches by
 * port and by verb (frame prefix without the `(`: "&S", "&T", "?A", ">?"; "*" = all)
 * and transforms the frame's output.
 *
 * - `sem_resposta`: does not reply (the command is applied, unless `aplicar: false`).
 * - `atraso`: replies after `ms`.
 * - `frame_corrompido`: replaces `bytes` chars in the middle of the reply with `#`.
 * - `truncado`: cuts the last `bytes` chars (default 1, loses the `)`).
 * - `checksum_errado`: replaces the 2 chars before the `)` (the KK when there is one).
 * - `fragmentar`: the reply in `partes` writes separated by `ms`.
 * - `resposta_dupla`: the same reply twice.
 * - `erro`: the reply becomes `(` + `codigo` + `)`, e.g. `?t`, `?b`, `?m`.
 * - `desconectar`: drops the connection on receiving the frame (`modo` rst|fin).
 * - `travamento`: freezes the concentrator (modal MessageBox) for `ms` (null = until released).
 */
export const TIPOS_FALHA = [
  'sem_resposta',
  'atraso',
  'frame_corrompido',
  'truncado',
  'checksum_errado',
  'fragmentar',
  'resposta_dupla',
  'erro',
  'desconectar',
  'travamento',
] as const;
export type TipoFalha = (typeof TIPOS_FALHA)[number];

export interface ParamFalha {
  ms?: number | null;
  bytes?: number;
  partes?: number;
  codigo?: string;
  modo?: 'rst' | 'fin';
  /** false = the frame does not even reach the simulator (the command is not applied). */
  aplicar?: boolean;
}

export interface RegraFalha {
  id: number;
  tipo: TipoFalha;
  porta: number | null;
  verbo: string;
  param: ParamFalha;
  /** How many more times it applies; null = always. */
  restantes: number | null;
  probabilidade: number;
  disparos: number;
}

export interface NovaFalha {
  tipo: TipoFalha;
  porta?: number | null;
  verbo?: string;
  param?: ParamFalha;
  vezes?: number | 'sempre';
  probabilidade?: number;
}

/** Deterministic PRNG (mulberry32) for `probabilidade`. */
export function prng(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function casaVerbo(verbo: string, quadro: string): boolean {
  if (verbo === '*' || verbo === '') return true;
  const q = quadro.startsWith('(') ? quadro.slice(1) : quadro;
  return q.startsWith(verbo);
}

export class InjetorFalhas {
  private regras: RegraFalha[] = [];
  private proximoId = 1;
  private readonly aleatorio: () => number;
  /** Observer: called each time a rule fires (the UI traffic console shows it). No effect on the output. */
  aoDisparar?: (regra: RegraFalha, porta: number, quadro: string) => void;

  constructor(
    semente = 1,
    /** Called by the `travamento` fault. */
    private readonly travar: (ms: number | null) => void = () => undefined,
  ) {
    this.aleatorio = prng(semente);
  }

  adicionar(f: NovaFalha): RegraFalha {
    const r: RegraFalha = {
      id: this.proximoId++,
      tipo: f.tipo,
      porta: f.porta ?? null,
      verbo: f.verbo ?? '*',
      param: { ...(f.param ?? {}) },
      restantes: f.vezes === undefined ? 1 : f.vezes === 'sempre' ? null : f.vezes,
      probabilidade: f.probabilidade ?? 1,
      disparos: 0,
    };
    this.regras.push(r);
    return { ...r };
  }

  listar(): RegraFalha[] {
    return this.regras.map((r) => ({ ...r, param: { ...r.param } }));
  }

  limpar(id?: number): number {
    const antes = this.regras.length;
    this.regras = id === undefined ? [] : this.regras.filter((r) => r.id !== id);
    return antes - this.regras.length;
  }

  /** The 1st live rule that matches (consumes once). */
  private escolher(porta: number, quadro: string): RegraFalha | null {
    for (const r of this.regras) {
      if (r.restantes !== null && r.restantes <= 0) continue;
      if (r.porta !== null && r.porta !== porta) continue;
      if (!casaVerbo(r.verbo, quadro)) continue;
      if (r.probabilidade < 1 && this.aleatorio() >= r.probabilidade) continue;
      if (r.restantes !== null) r.restantes--;
      r.disparos++;
      if (r.restantes === 0) this.regras = this.regras.filter((x) => x !== r);
      return r;
    }
    return null;
  }

  /** Transport `atender` hook. */
  atender(porta: number, quadro: string, processar: () => ResultadoQuadro): SaidaTcp[] {
    const r = this.escolher(porta, quadro);
    if (!r) return saidaPadrao(processar());
    this.aoDisparar?.({ ...r, param: { ...r.param } }, porta, quadro);
    const p = r.param;
    if (r.tipo === 'desconectar') {
      if (p.aplicar !== false) processar();
      return [{ tipo: 'desconectar', modo: p.modo ?? 'rst' }];
    }
    if (r.tipo === 'travamento') {
      this.travar(p.ms === undefined ? null : p.ms);
      return [];
    }
    const res = p.aplicar === false ? null : processar();
    const txt = res?.resposta ?? null;
    switch (r.tipo) {
      case 'sem_resposta':
        return [];
      case 'atraso':
        return txt ? [{ tipo: 'enviar', bytes: Buffer.from(txt, 'latin1'), atrasoMs: p.ms ?? 1000 }] : [];
      case 'erro':
        return [{ tipo: 'enviar', bytes: Buffer.from(`(${p.codigo ?? '?t'})`, 'latin1') }];
      default:
        break;
    }
    if (!txt) return [];
    const enviar = (s: string, atrasoMs?: number): SaidaTcp => ({ tipo: 'enviar', bytes: Buffer.from(s, 'latin1'), atrasoMs });
    switch (r.tipo) {
      case 'frame_corrompido': {
        const n = Math.max(1, Math.min(p.bytes ?? 1, txt.length - 2));
        const ini = Math.max(1, Math.floor((txt.length - n) / 2));
        return [enviar(txt.slice(0, ini) + '#'.repeat(n) + txt.slice(ini + n))];
      }
      case 'truncado':
        return [enviar(txt.slice(0, Math.max(0, txt.length - Math.max(1, p.bytes ?? 1))))];
      case 'checksum_errado': {
        if (txt.length < 4 || !txt.endsWith(')')) return [enviar(txt)];
        const kk = txt.slice(-3, -1);
        const ruim = ((parseInt(kk, 16) || 0) ^ 0x5a).toString(16).toUpperCase().padStart(2, '0');
        return [enviar(txt.slice(0, -3) + (ruim === kk ? 'ZZ' : ruim) + ')')];
      }
      case 'fragmentar': {
        const partes = Math.max(2, p.partes ?? 2);
        const tam = Math.ceil(txt.length / partes);
        const out: SaidaTcp[] = [];
        for (let i = 0; i < txt.length; i += tam) out.push(enviar(txt.slice(i, i + tam), i === 0 ? undefined : (p.ms ?? 20)));
        return out;
      }
      case 'resposta_dupla':
        return [enviar(txt), enviar(txt)];
      default:
        return [enviar(txt)];
    }
  }
}
