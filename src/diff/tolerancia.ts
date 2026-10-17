import { kkValido } from '../protocols/companytec/checksum.js';
import { decodificarVirgula } from '../core/virgula.js';

/**
 * Wine free-flow tolerance (DECISIONS §26). When side A is the real SimuladorCBC 2.7.2 running under
 * Wine, its flow timer ticks every 100.0 ms instead of the 109.375 ms of Windows (§29; §26 said ~104),
 * so a fueling with no preset accumulates more volume over the same wall time. The bound is ±10%
 * (§30, the maintainer's; §26 had 4%): it covers the period ratio 1 − 100 / 109.375 = 8.6% (EQUIV-MOTOR
 * #26: Wine 2,99 × `simulador-2.7.2` 3,25 L, 8.0%) with a margin. Only for the steps the script
 * annotation marks `vazao-livre` (a volume read after a free-flow fueling), the volume, amount,
 * totalizer and duration fields of the reply are compared with this relative tolerance; every other
 * byte stays exact (after the script's masks) and the checksum of each side must check on its own.
 * Never used by the recorded oracle or by a Windows run.
 */
export const TOLERANCIA_WINE = 0.1;

/** What side A runs on. `wine` enables {@link TOLERANCIA_WINE}; the default is `windows` (byte-exact). */
export type PlataformaA = 'windows' | 'wine';

type TipoCampo = 'volume' | 'total' | 'encerrante' | 'duracao';

interface Campo {
  nome: string;
  tipo: TipoCampo;
  ini: number;
  fim: number;
  base: 10 | 16;
}

/** A field that differed within the tolerance. */
export interface CampoTolerado {
  campo: string;
  a: number;
  b: number;
  /** (b − a) / a, rounded to 0.1%. */
  desvio: number;
}

interface Mapa {
  campos: Campo[];
  /** The reply carries a KK before the `)`. */
  kk: boolean;
  /** Decimal places of the volume field (to bound the totalizer by the record's volume). */
  casasVolume?: number;
}

/**
 * Lengths (parentheses included) of the fueling-record layouts that start with the common core
 * T6 L6 P4 V2 C4 B2 (`formatos.ts`): `&A` 52/36/34, `&LR` 74/82, and with a one-char prefix
 * `&A67` 75 (`A`) and `&@66` 87 (`@`). The E10 totalizer follows DD HH MM NN R4 on the longer ones.
 */
const REGISTRO: Record<number, { prefixo: number; e10: boolean }> = {
  34: { prefixo: 0, e10: false },
  36: { prefixo: 0, e10: false },
  52: { prefixo: 0, e10: true },
  74: { prefixo: 0, e10: true },
  82: { prefixo: 0, e10: true },
  75: { prefixo: 1, e10: true },
  87: { prefixo: 1, e10: true },
};

const ehNum = (s: string, base: 10 | 16) => (base === 10 ? /^\d+$/ : /^[0-9A-F]+$/).test(s);

/** Field map of a free-flow reading, or `null` when the reply is not one this tolerance knows. */
function mapear(quadro: string, r: string): Mapa | null {
  if (r.length < 3 || r[0] !== '(' || r[r.length - 1] !== ')') return null;
  if (/^\(&V/.test(quadro)) {
    // (B2 L6 B2 L6 …), no KK.
    const corpo = r.slice(1, -1);
    if (corpo.length === 0 || corpo.length % 8 !== 0 || !/^([0-9A-F]{2}\d{6})+$/.test(corpo)) return null;
    const campos: Campo[] = [];
    for (let i = 0; i < corpo.length; i += 8) campos.push({ nome: `L6 bico ${corpo.slice(i, i + 2)}`, tipo: 'volume', ini: 1 + i + 2, fim: 1 + i + 8, base: 10 });
    return { campos, kk: false };
  }
  if (/^\(?(&A|&LR|&@)/.test(quadro)) {
    const lay = REGISTRO[r.length];
    if (!lay) return null;
    const p = 1 + lay.prefixo;
    const v2 = r.slice(p + 16, p + 18);
    if (!ehNum(r.slice(p, p + 12), 10) || !ehNum(v2, 16)) return null;
    const campos: Campo[] = [
      { nome: 'T6', tipo: 'total', ini: p, fim: p + 6, base: 10 },
      { nome: 'L6', tipo: 'volume', ini: p + 6, fim: p + 12, base: 10 },
      { nome: 'C4', tipo: 'duracao', ini: p + 18, fim: p + 22, base: 16 },
    ];
    if (lay.e10) campos.push({ nome: 'E10', tipo: 'encerrante', ini: p + 36, fim: p + 46, base: 10 });
    return { campos, kk: true, casasVolume: decodificarVirgula(parseInt(v2, 16)).volume };
  }
  return null;
}

/**
 * Compares two replies of a `vazao-livre` step under {@link TOLERANCIA_WINE}. `ma`/`mb` are the
 * replies after the script's masks (the masked bytes are equal on both sides); `a`/`b` the raw ones.
 * Returns the fields that differed within the tolerance, or `null` when the replies are not equal
 * under it (a byte outside the fields differs, a field is out of tolerance, a KK does not check, or
 * the reply has no known field map).
 */
export function compararComToleranciaWine(quadro: string, a: string, b: string, ma: string, mb: string): CampoTolerado[] | null {
  if (a.length !== b.length || ma.length !== mb.length || ma.length !== a.length) return null;
  const ga = mapear(quadro, a);
  const gb = mapear(quadro, b);
  if (!ga || !gb || ga.campos.length !== gb.campos.length) return null;
  const livre = new Uint8Array(a.length);
  for (const c of ga.campos) livre.fill(1, c.ini, c.fim);
  const kkIni = a.length - 3;
  const out: CampoTolerado[] = [];
  const valores = new Map<TipoCampo, { a: number; b: number }>();
  for (const c of ga.campos) {
    const sa = a.slice(c.ini, c.fim);
    const sb = b.slice(c.ini, c.fim);
    if (!ehNum(sa, c.base) || !ehNum(sb, c.base)) return null;
    const va = parseInt(sa, c.base);
    const vb = parseInt(sb, c.base);
    valores.set(c.tipo, { a: va, b: vb });
    // A field the script masks (e.g. C4) compares as the mask says.
    if (ma.slice(c.ini, c.fim) === mb.slice(c.ini, c.fim)) continue;
    out.push({ campo: c.nome, a: va, b: vb, desvio: va === 0 ? (vb === 0 ? 0 : Infinity) : Math.round(((vb - va) / va) * 1000) / 1000 });
  }
  for (let i = 0; i < a.length; i++) {
    if (livre[i]) continue;
    if (ga.kk && out.length && i >= kkIni && i < a.length - 1) continue; // the KK follows the fields
    if (ma[i] !== mb[i]) return null;
  }
  if (ga.kk && out.length && (!kkValido(a) || !kkValido(b))) return null;
  for (const t of out) {
    const c = ga.campos.find((x) => x.nome === t.campo)!;
    if (!dentro(c.tipo, t.a, t.b, valores, ga.casasVolume)) return null;
  }
  return out;
}

function dentro(tipo: TipoCampo, a: number, b: number, valores: Map<TipoCampo, { a: number; b: number }>, casasVolume = 3): boolean {
  const d = Math.abs(a - b);
  const max = Math.max(a, b);
  switch (tipo) {
    case 'volume':
    case 'duracao':
      return d <= TOLERANCIA_WINE * max;
    case 'total':
      // The amount is volume × price, rounded or truncated to its last digit.
      return d <= TOLERANCIA_WINE * max + 1;
    case 'encerrante': {
      // The totalizer is start + this fueling; the start is the same on both sides, so the
      // difference may only be the volume's: the tolerance of the record's volume (mL) plus the 10 mL floor.
      const v = valores.get('volume');
      if (!v) return false;
      const ml = (x: number) => x * 10 ** (3 - casasVolume);
      return d * 10 <= TOLERANCIA_WINE * ml(Math.max(v.a, v.b)) + 10;
    }
  }
}
