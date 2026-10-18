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
 * - `erro`: the reply becomes the codec's own error frame for the request's verb: `(` + verb letter +
 *   `codigo` + `)`, e.g. `(&M04L…)` + `?r` → `(M?r)`, like the natural errors (no KK). A `codigo` that does not
 *   start with `?` goes out verbatim inside the parentheses. The command is **not** applied unless
 *   `aplicar: true` (DECISIONS §36).
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
  /**
   * false = the frame does not even reach the simulator (the command is not applied). Default true,
   * except for `erro`, where the default is false and `true` applies the command anyway.
   */
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

/**
 * Verb letter of the natural error frame for a request (DECISIONS §36): `(&M…)` → `M`, `(&U…)` → the
 * profile's price ack letter, Identfid `(?F…)` → `F`. Horustech and anything else: no letter.
 */
export function letraErro(quadro: string, ackPreco = 'U'): string {
  const m = /^\((?:&|\?)([A-Za-z])/.exec(quadro);
  if (!m) return '';
  return quadro[1] === '&' && m[1] === 'U' ? ackPreco : m[1]!;
}

/** The `erro` fault's frame: the request's verb letter + `codigo`, without KK, like the codec's own errors. */
export function quadroErro(quadro: string, codigo = '?t', ackPreco = 'U'): string {
  return codigo.startsWith('?') ? `(${letraErro(quadro, ackPreco)}${codigo})` : `(${codigo})`;
}

export class InjetorFalhas {
  private regras: RegraFalha[] = [];
  private proximoId = 1;
  private readonly aleatorio: () => number;
  /** Observer: called each time a rule fires (the UI traffic console shows it). No effect on the output. */
  aoDisparar?: (regra: RegraFalha, porta: number, quadro: string) => void;
  /** Communication log (`get_log_comunicacao`) of a reply the fault wrote instead of the simulator's. */
  registrar?: (porta: number, dir: 'RX' | 'TX' | 'INFO', texto: string) => void;
  /** Price ack letter of the current profile (`Perfil.ackPreco`), for the `erro` frame of `&U`. */
  ackPreco: () => string = () => 'U';

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

  /**
   * Transport `atender` hook. A fired rule writes to the communication log (`registrar`) what really
   * happened (DECISIONS §36 F1): the RX when the simulator did not see the frame, an INFO line with the
   * fault and the simulator's own reply, then one TX per write that leaves, or "sem resposta".
   */
  atender(porta: number, quadro: string, processar: (op?: { logTx?: boolean }) => ResultadoQuadro): SaidaTcp[] {
    const r = this.escolher(porta, quadro);
    if (!r) return saidaPadrao(processar());
    this.aoDisparar?.({ ...r, param: { ...r.param } }, porta, quadro);
    let natural: string | null | undefined;
    // The immediate reply goes to the log only as the bytes that leave (below), never as the simulator made it.
    const proc = (): ResultadoQuadro => {
      const res = processar({ logTx: false });
      natural = res.resposta;
      return res;
    };
    const saidas = this.transformar(r, quadro, proc);
    if (natural === undefined) this.registrar?.(porta, 'RX', quadro);
    const simulador = natural === undefined ? 'não aplicado' : natural === null ? 'sem resposta' : natural;
    this.registrar?.(porta, 'INFO', `falha ${r.tipo} #${r.id}${r.param.ms ? ` ${r.param.ms} ms` : ''} (simulador: ${simulador})`);
    let enviou = false;
    for (const x of saidas) {
      if (x.tipo === 'enviar') {
        enviou = true;
        this.registrar?.(porta, 'TX', x.bytes.toString('latin1'));
      } else {
        this.registrar?.(porta, 'INFO', `falha ${r.tipo}: conexão derrubada (${x.modo})`);
      }
    }
    if (!enviou && !saidas.some((x) => x.tipo === 'desconectar')) this.registrar?.(porta, 'INFO', `falha ${r.tipo}: sem resposta`);
    return saidas;
  }

  private transformar(r: RegraFalha, quadro: string, processar: () => ResultadoQuadro): SaidaTcp[] {
    const p = r.param;
    if (r.tipo === 'desconectar') {
      if (p.aplicar !== false) processar();
      return [{ tipo: 'desconectar', modo: p.modo ?? 'rst' }];
    }
    if (r.tipo === 'travamento') {
      this.travar(p.ms === undefined ? null : p.ms);
      return [];
    }
    if (r.tipo === 'erro') {
      if (p.aplicar === true) processar();
      return [{ tipo: 'enviar', bytes: Buffer.from(quadroErro(quadro, p.codigo, this.ackPreco()), 'latin1') }];
    }
    const res = p.aplicar === false ? null : processar();
    const txt = res?.resposta ?? null;
    switch (r.tipo) {
      case 'sem_resposta':
        return [];
      case 'atraso':
        return txt ? [{ tipo: 'enviar', bytes: Buffer.from(txt, 'latin1'), atrasoMs: p.ms ?? 1000 }] : [];
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
