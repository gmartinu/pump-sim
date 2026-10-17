/** Decimal integer with leading zeros; above `digitos`, keeps the least significant ones. */
export function padNum(n: number, digitos: number): string {
  const v = Math.trunc(Math.abs(n));
  const s = v.toString();
  return s.length > digitos ? s.slice(s.length - digitos) : s.padStart(digitos, '0');
}

/** Same as `padNum`, but without cutting above `digitos` (the 2.7.2 `&V` does this). */
export function padNumSemCorte(n: number, digitos: number): string {
  return Math.trunc(Math.abs(n)).toString().padStart(digitos, '0');
}

export function hexN(n: number, digitos: number): string {
  const s = Math.trunc(Math.abs(n)).toString(16).toUpperCase();
  return s.length > digitos ? s.slice(s.length - digitos) : s.padStart(digitos, '0');
}

/**
 * Converts a value in thousandths (scale 3) to `casas` decimals.
 * `truncar` = 2.7.2 behavior (Q6); otherwise rounds half up.
 */
export function deMilesimos(valorMil: number, casas: number, truncar: boolean): number {
  const div = 10 ** (3 - casas);
  return truncar ? Math.floor(valorMil / div) : Math.floor((valorMil + div / 2) / div);
}

export function ehDecimal(s: string): boolean {
  return s.length > 0 && /^[0-9]+$/.test(s);
}

export function ehHex(s: string): boolean {
  return s.length > 0 && /^[0-9A-Fa-f]+$/.test(s);
}

/**
 * Delphi `StrToInt`: leading spaces, optional sign, decimal or `$hex`.
 * null = the conversion would raise an exception (E9). Out of the 32-bit range is also null.
 */
export function strToIntDelphi(s: string): number | null {
  const m = /^ *([+-]?)(?:\$([0-9A-Fa-f]+)|([0-9]+))$/.exec(s);
  if (!m) return null;
  const v = m[2] !== undefined ? parseInt(m[2], 16) : Number(m[3]);
  const n = m[1] === '-' ? -v : v;
  return n > 0x7fffffff || n < -0x80000000 ? null : n;
}

/**
 * Delphi `StrToFloat` with the Windows pt-BR decimal separator (`,`): spaces
 * at both ends, optional sign. null = the conversion would raise an exception (E8).
 */
export function strToFloatDelphi(s: string): number | null {
  const m = /^ *([+-]?)([0-9]*)(?:,([0-9]*))? *$/.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const v = Number(`${m[2] || '0'}.${m[3] || '0'}`);
  return m[1] === '-' ? -v : v;
}
