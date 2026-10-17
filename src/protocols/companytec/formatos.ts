import type { Concentrador } from '../../core/concentrador.js';
import { hex2 } from '../../core/codigo-bico.js';
import type { Registro } from '../../core/modelo.js';
import { deMilesimos, hexN, padNum } from '../../core/numeros.js';
import { decodificarVirgula } from '../../core/virgula.js';
import { comKK } from './checksum.js';

/**
 * Fueling record layouts (DT435 §3.1; behavioral equivalence). All functions
 * return the complete frame, with KK and parentheses.
 */

const p2 = (n: number) => padNum(n, 2);

export function cartao(conc: Concentrador, c: string | null): string {
  if (c) return c.toUpperCase().padStart(16, '0').slice(-16);
  return conc.q('CARTAO_VAZIO_ZEROS') ? '0'.repeat(16) : 'F'.repeat(16);
}

export interface Base {
  T6: string;
  L6: string;
  P4: string;
  V2: string;
  C4: string;
  B2: string;
  /** DD HH MM NN (day hour minute month) */
  DHMN: string;
  R4: string;
  R6: string;
  E10: string;
  i10: string;
}

export function base(conc: Concentrador, r: Registro): Base {
  const casas = decodificarVirgula(r.virgula);
  const trunc = conc.q('Q6');
  const d = r.data;
  return {
    T6: padNum(deMilesimos(r.totalMil, casas.total, trunc), 6),
    L6: padNum(deMilesimos(r.volumeMl, casas.volume, trunc), 6),
    P4: padNum(r.precoUnit, 4),
    V2: hex2(r.virgula & 0x3f),
    C4: hexN(r.duracaoS, 4),
    B2: hex2(r.codigoBico),
    DHMN: p2(d.dia) + p2(d.hora) + p2(d.minuto) + p2(d.mes),
    R4: padNum(r.numero, 4),
    R6: padNum(r.numero, 6),
    E10: padNum(Math.floor(r.encFimMl / 10), 10),
    i10: padNum(Math.floor(r.encIniMl / 10), 10),
  };
}

/**
 * `&A` in 52 chars? `formatoA` 52 always; `dip3` follows DIP3 — with A36 (2.7.2) the DIP3 of the
 * moment the record was stored (verdict #12, bench diff r4b DIFF-07), otherwise the current one.
 */
export function usarA52(conc: Concentrador, r: Registro): boolean {
  const f = conc.perfil.formatoA;
  if (f === 52) return true;
  if (f !== 'dip3') return false;
  return conc.q('A36') ? (r.dip3NaGravacao ?? conc.dips[2] === true) : conc.dips[2] === true;
}

const nucleo = (b: Base) => b.T6 + b.L6 + b.P4 + b.V2 + b.C4 + b.B2;

/** (&A) 52: T L P V C B DD HH MM NN R E SS KK */
export function a52(conc: Concentrador, r: Registro): string {
  const b = base(conc, r);
  return comKK(nucleo(b) + b.DHMN + b.R4 + b.E10 + '00');
}

/** (&A) 34: T L P V C B DD HH MM KK (DT435 p.4) */
export function a34(conc: Concentrador, r: Registro): string {
  const b = base(conc, r);
  return comKK(nucleo(b) + b.DHMN.slice(0, 6));
}

/** (&A) 36 of the 2.7.2 with DIP3 off: T L P V C B ddhhmmMM KK (behavioral equivalence) */
export function a36(conc: Concentrador, r: Registro): string {
  const b = base(conc, r);
  return comKK(nucleo(b) + b.DHMN);
}

/** (&A67) 75: A + 52-layout + I16 M4 P2 KK */
export function a67(conc: Concentrador, r: Registro): string {
  const b = base(conc, r);
  const m4 = conc.q('A67_M_IGUAL_R') ? b.R4 : padNum(r.numeroIdentificacao, 4);
  return comKK('A' + nucleo(b) + b.DHMN + b.R4 + b.E10 + '00' + cartao(conc, r.cartao1) + m4 + '00');
}

/** (&@66) 87: @ + 52-layout + I16 i16 SS KK */
export function a66(conc: Concentrador, r: Registro): string {
  const b = base(conc, r);
  return comKK(
    '@' + nucleo(b) + b.DHMN + b.R4 + b.E10 + '00' + cartao(conc, r.cartao1) + cartao(conc, r.cartao2) + '00',
  );
}

function cabecalhoPaf(conc: Concentrador, h: string): string {
  return conc.q('PAF_G9') ? `${h}G99999999` : `${h}$${padNum(Number(conc.perfil.numeroSerie), 8)}`;
}

function pista(r: Registro): string {
  return p2(r.numeroPista) + p2(r.combustivel) + p2(r.tanque) + padNum(r.volumeTanque, 8);
}

/** (&A299) PAF1, 123 (DT435 p.7). Also the &LC of the Horustech profiles. */
export function paf1(conc: Concentrador, r: Registro): string {
  const b = base(conc, r);
  const d = r.data;
  return comKK(
    cabecalhoPaf(conc, 'a2') +
      nucleo(b) +
      b.DHMN +
      p2(d.ano % 100) +
      b.R6 +
      b.E10 +
      b.i10 +
      pista(r) +
      cartao(conc, r.cartao1) +
      cartao(conc, r.cartao2) +
      '00',
  );
}

function dataPaf2(r: Registro): string {
  const d = r.data;
  return p2(d.ano % 100) + p2(d.mes) + p2(d.dia) + p2(d.hora) + p2(d.minuto) + p2(d.segundo);
}

/** (&A39A) PAF2, 127 (DT435 p.8). */
export function paf2(conc: Concentrador, r: Registro): string {
  const b = base(conc, r);
  return comKK(
    cabecalhoPaf(conc, 'a3') +
      nucleo(b) +
      dataPaf2(r) +
      b.R6 +
      b.E10 +
      b.i10 +
      pista(r) +
      cartao(conc, r.cartao1) +
      cartao(conc, r.cartao2) +
      '00' +
      '00',
  );
}

/** (&A49B) extended TWC/MQTT, 148 (DT435 p.9-10). Price level in bits 6-7 of the comma. */
export function a4(conc: Concentrador, r: Registro): string {
  const casas = decodificarVirgula(r.virgula);
  const trunc = conc.q('Q6');
  const b = base(conc, r);
  const virgula = hex2((r.virgula & 0x3f) | ((r.nivelPreco & 0x3) << 6));
  return comKK(
    cabecalhoPaf(conc, 'a4') +
      padNum(deMilesimos(r.totalMil, casas.total, trunc), 8) +
      padNum(deMilesimos(r.volumeMl, casas.volume, trunc), 8) +
      padNum(r.precoUnit, 6) +
      virgula +
      b.C4 +
      b.B2 +
      dataPaf2(r) +
      b.R6 +
      b.E10 +
      b.i10 +
      pista(r) +
      cartao(conc, r.cartao1) +
      cartao(conc, r.cartao2) +
      '00000' +
      '00000' +
      '00000' +
      hex2(r.nivelPreco) +
      '00',
  );
}

/** &LR 74 (CBC04/05/06): …E10 F2 I16 N4 S2 KK; N4 = R (DT435 example p.12). */
export function lr74(conc: Concentrador, r: Registro): string {
  const b = base(conc, r);
  return comKK(nucleo(b) + b.DHMN + b.R4 + b.E10 + '00' + cartao(conc, r.cartao1) + b.R4 + '00');
}

/** &LR 82 (Horustech): …E10 F2 I16 N4(fixed 0000) X8(start of the client id) S2 KK. */
export function lr82(conc: Concentrador, r: Registro): string {
  const b = base(conc, r);
  if (conc.perfil.leituraRegistro.porModelo) {
    // 2.7.2 col7: T…E 00 I1 + 14 zeros.
    return comKK(nucleo(b) + b.DHMN + b.R4 + b.E10 + '00' + cartao(conc, r.cartao1) + '0'.repeat(14));
  }
  return comKK(
    nucleo(b) + b.DHMN + b.R4 + b.E10 + '00' + cartao(conc, r.cartao1) + '0000' + cartao(conc, r.cartao2).slice(0, 8) + '00',
  );
}

/** &LC "CBC format" (90-char CBC06 example, DT435 p.11): 00 + 52-layout without SS + 00 I16 N4 i16. */
export function lcCbc(conc: Concentrador, r: Registro): string {
  const b = base(conc, r);
  return comKK(
    '00' + nucleo(b) + b.DHMN + b.R4 + b.E10 + '00' + cartao(conc, r.cartao1) + b.R4 + cartao(conc, r.cartao2),
  );
}

/**
 * Empty position on real profiles: the frame of the layout's length filled with `F`,
 * ending in `01` before the KK (empty &LR example, DT435 p.12, KK 29 checks).
 */
export function vazioF(tamanhoQuadro: number, prefixo = '', zeros: readonly number[] = []): string {
  const dados = tamanhoQuadro - 4; // ( ) and KK
  const corpo = (prefixo + 'F'.repeat(Math.max(0, dados - prefixo.length - 2))).split('');
  // `zeros` = offsets in the frame (counting the `(`) that the manual shows as `00` at the empty position.
  for (const o of zeros) {
    corpo[o - 1] = '0';
    corpo[o] = '0';
  }
  return comKK(corpo.join('') + '01');
}

/**
 * Empty &LC PAF1 (123): the DT435 p.11 example has `00` at offset 46 (start of R6), KK 3A checks.
 * Only this layout has an example; the 74/82/90 ones stay pure F.
 */
export const ZEROS_VAZIO_PAF1: readonly number[] = [46];
