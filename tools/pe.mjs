/**
 * Minimal PE header access for tools/build-sea.mjs (DECISIONS §34): read and set the optional
 * header's Subsystem, and the PE checksum (the algorithm of imagehlp's CheckSumMappedFile).
 * Works on PE32 and PE32+ (both keep CheckSum at +64 and Subsystem at +68 of the optional header).
 */

export const SUBSISTEMA_GUI = 2; // IMAGE_SUBSYSTEM_WINDOWS_GUI
export const SUBSISTEMA_CONSOLE = 3; // IMAGE_SUBSYSTEM_WINDOWS_CUI

/** Offset of the optional header, after checking the MZ and PE signatures. Throws on anything else. */
function opcional(b) {
  if (b.length < 0x40 || b.toString('latin1', 0, 2) !== 'MZ') throw new Error('not a PE file (no MZ header)');
  const pe = b.readUInt32LE(0x3c);
  if (pe + 24 + 72 > b.length || b.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('not a PE file (no PE signature)');
  const o = pe + 24;
  const magia = b.readUInt16LE(o);
  if (magia !== 0x10b && magia !== 0x20b) throw new Error(`unknown optional header magic 0x${magia.toString(16)}`);
  return o;
}

/** The optional header's Subsystem (2 = Windows GUI, 3 = console). */
export function lerSubsistema(b) {
  return b.readUInt16LE(opcional(b) + 68);
}

/** The optional header's CheckSum field. */
export function lerChecksum(b) {
  return b.readUInt32LE(opcional(b) + 64);
}

/** PE checksum of `b`, skipping its CheckSum field: 16-bit one's-complement-style sum plus the file length. */
export function calcularChecksum(b) {
  const campo = opcional(b) + 64;
  let soma = 0;
  const pares = b.length & ~1;
  for (let i = 0; i < pares; i += 2) {
    if (i === campo || i === campo + 2) continue;
    soma += b[i] | (b[i + 1] << 8);
    soma = (soma & 0xffff) + (soma >>> 16);
  }
  if (b.length & 1) {
    soma += b[b.length - 1];
    soma = (soma & 0xffff) + (soma >>> 16);
  }
  soma = (soma & 0xffff) + (soma >>> 16);
  return (soma + b.length) >>> 0;
}

/**
 * Sets the Subsystem in place and, when the file carries a checksum (non-zero), recomputes it so the
 * header stays consistent. Returns `{ antes, depois, checksum }` (checksum null when none is set).
 */
export function definirSubsistema(b, valor) {
  const o = opcional(b);
  const antes = b.readUInt16LE(o + 68);
  b.writeUInt16LE(valor, o + 68);
  let checksum = null;
  if (b.readUInt32LE(o + 64) !== 0) {
    checksum = calcularChecksum(b);
    b.writeUInt32LE(checksum, o + 64);
  }
  return { antes, depois: valor, checksum };
}
