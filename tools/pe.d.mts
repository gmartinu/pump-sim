// Types for tools/pe.mjs (imported by test/pe.test.ts).
export declare const SUBSISTEMA_GUI: number;
export declare const SUBSISTEMA_CONSOLE: number;
export declare function lerSubsistema(b: Buffer): number;
export declare function lerChecksum(b: Buffer): number;
export declare function calcularChecksum(b: Buffer): number;
export declare function definirSubsistema(b: Buffer, valor: number): { antes: number; depois: number; checksum: number | null };
