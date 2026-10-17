/**
 * Comma code (DT435 §3.7, p.34): bit field.
 *   b0-1 total decimals, b2-3 volume decimals, b4-5 price decimals,
 *   b6-7 price level (only in `&A4`, p.10).
 * Examples: 2A = price 2 / vol 2 / total 2; 3A = 3/2/2; 3E = 3/3/2.
 */
export interface Casas {
  total: number;
  volume: number;
  preco: number;
}

export function decodificarVirgula(codigo: number): Casas & { nivel: number } {
  return {
    total: codigo & 0x03,
    volume: (codigo >> 2) & 0x03,
    preco: (codigo >> 4) & 0x03,
    nivel: (codigo >> 6) & 0x03,
  };
}

export function codificarVirgula(casas: Casas, nivel = 0): number {
  return (
    (casas.total & 0x03) |
    ((casas.volume & 0x03) << 2) |
    ((casas.preco & 0x03) << 4) |
    ((nivel & 0x03) << 6)
  );
}

/**
 * Validates a comma code: decimals between 0 and 3 always fit in 2 bits, so the
 * validation is about the practical domain — total and volume 2..3, price 2..3 (the values
 * the 2.7.2 generates: 2A/2E/3A/3E). Outside that, the code is accepted but flagged.
 */
export function virgulaUsual(codigo: number): boolean {
  const c = decodificarVirgula(codigo & 0x3f);
  return c.total === 2 && (c.volume === 2 || c.volume === 3) && (c.preco === 2 || c.preco === 3);
}
