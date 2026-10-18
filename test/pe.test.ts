import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SUBSISTEMA_CONSOLE, SUBSISTEMA_GUI, calcularChecksum, definirSubsistema, lerChecksum, lerSubsistema } from '../tools/pe.mjs';

/**
 * DECISIONS §34: the Windows executable is patched from the console to the GUI subsystem after the
 * build (tools/pe.mjs, step 8 of tools/build-sea.mjs), with the PE checksum recomputed.
 * The real-file cases run when the files exist locally (the cached official node.exe after one
 * `npm run build:sea:win`; `PUMP_SIM_EXE` pointing at a finished executable).
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE_EXE = path.join(RAIZ, 'build', 'sea', 'node', 'node-v22.20.0-win-x64', 'node.exe');
const EXE = process.env['PUMP_SIM_EXE'];

/** A minimal PE32+ header: MZ, e_lfanew 0x80, PE signature, optional header magic 0x20b. */
function peSintetico(subsistema: number, checksum: number): Buffer {
  const b = Buffer.alloc(0x400, 0x5a);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(0x80, 0x3c);
  b.write('PE\0\0', 0x80, 'latin1');
  const o = 0x80 + 24;
  b.writeUInt16LE(0x20b, o);
  b.writeUInt32LE(checksum, o + 64);
  b.writeUInt16LE(subsistema, o + 68);
  return b;
}

describe('tools/pe.mjs', () => {
  it('reads and sets the subsystem; a set checksum is recomputed', () => {
    const b = peSintetico(SUBSISTEMA_CONSOLE, 0x1234);
    expect(lerSubsistema(b)).toBe(3);
    const r = definirSubsistema(b, SUBSISTEMA_GUI);
    expect(r.antes).toBe(3);
    expect(lerSubsistema(b)).toBe(2);
    expect(r.checksum).toBe(calcularChecksum(b));
    expect(lerChecksum(b)).toBe(r.checksum);
  });

  it('a zero checksum stays zero (the loader ignores it)', () => {
    const b = peSintetico(SUBSISTEMA_CONSOLE, 0);
    expect(definirSubsistema(b, SUBSISTEMA_GUI).checksum).toBeNull();
    expect(lerChecksum(b)).toBe(0);
  });

  it('the checksum ignores its own field and includes the length (odd length too)', () => {
    const a = peSintetico(2, 0);
    const b = peSintetico(2, 0xdeadbeef);
    expect(calcularChecksum(a)).toBe(calcularChecksum(b));
    const impar = Buffer.concat([a, Buffer.from([7])]);
    expect(calcularChecksum(impar)).not.toBe(calcularChecksum(a));
  });

  it('rejects what is not a PE', () => {
    expect(() => lerSubsistema(Buffer.alloc(0x100))).toThrow(/MZ/);
    const b = peSintetico(3, 0);
    b.write('XX', 0x80, 'latin1');
    expect(() => lerSubsistema(b)).toThrow(/PE signature/);
  });

  it.skipIf(!fs.existsSync(NODE_EXE))('official node.exe: our checksum equals the linker checksum, and the patch changes only Subsystem + CheckSum', () => {
    const orig = fs.readFileSync(NODE_EXE);
    expect(lerSubsistema(orig)).toBe(SUBSISTEMA_CONSOLE);
    expect(lerChecksum(orig)).not.toBe(0);
    expect(calcularChecksum(orig)).toBe(lerChecksum(orig));
    const b = Buffer.from(orig);
    definirSubsistema(b, SUBSISTEMA_GUI);
    expect(lerSubsistema(b)).toBe(SUBSISTEMA_GUI);
    expect(calcularChecksum(b)).toBe(lerChecksum(b));
    const opcional = orig.readUInt32LE(0x3c) + 24;
    const diferentes: number[] = [];
    for (let i = 0; i < b.length; i++) if (b[i] !== orig[i]) diferentes.push(i);
    expect(diferentes.every((i) => (i >= opcional + 64 && i < opcional + 68) || i === opcional + 68 || i === opcional + 69)).toBe(true);
  });

  it.skipIf(!EXE)('the built executable (PUMP_SIM_EXE) is GUI subsystem with a valid checksum', () => {
    const b = fs.readFileSync(EXE!);
    expect(lerSubsistema(b)).toBe(SUBSISTEMA_GUI);
    const soma = lerChecksum(b);
    if (soma !== 0) expect(calcularChecksum(b)).toBe(soma);
  });
});
