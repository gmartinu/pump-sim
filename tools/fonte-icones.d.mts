// Types for tools/fonte-icones.mjs (imported by test/ui.test.ts).
export function lerWoff2(buf: Buffer): Map<string, Buffer>;
export function ligaturas(tabelas: Map<string, Buffer>): Map<string, number>;
export function preenchidos(tabelas: Map<string, Buffer>): Map<number, number>;
export function iconesUi(dirUi: string): { estaticos: Set<string>; candidatos: Set<string> };
