/**
 * Nozzle code (DT360 p.4-6):
 *   code = 0x40·position + 4 + 4·(channel−1) + (address−1)
 * channel 1..12 (9..12 = Horustech ICOM3), address 1..4, position 0..3.
 * The low 6 bits minus 4 give the pump side index (0..47), which is the
 * position in the `&S` vector.
 */
export function codigoBico(canal: number, endereco: number, posicao: number): number {
  return 0x40 * posicao + 4 + 4 * (canal - 1) + (endereco - 1);
}

export function hex2(n: number): string {
  return (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

export interface PosicaoBico {
  canal: number;
  endereco: number;
  posicao: number;
  /** Side (address) index in the status vector: 4·(channel−1) + (address−1). */
  indiceLado: number;
}

export function decodificarBico(codigo: number): PosicaoBico | null {
  if (!Number.isInteger(codigo) || codigo < 0 || codigo > 0xff) return null;
  const baixo = codigo & 0x3f;
  if (baixo < 4) return null;
  const indiceLado = baixo - 4;
  const canal = Math.floor(indiceLado / 4) + 1;
  const endereco = (indiceLado % 4) + 1;
  const posicao = codigo >> 6;
  if (canal > 12) return null;
  return { canal, endereco, posicao, indiceLado };
}

export function indiceLado(canal: number, endereco: number): number {
  return 4 * (canal - 1) + (endereco - 1);
}
