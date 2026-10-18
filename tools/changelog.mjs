#!/usr/bin/env node
/**
 * Prints the CHANGELOG.md entry of a version as the "## Changes" section that opens its GitHub
 * release notes (DECISIONS §33, C5). Fails (exit 1) when the entry is missing, empty, has more than
 * 5 bullets or anything but bullets, so a tag without its changelog never gets released.
 *
 *   node tools/changelog.mjs 1.0.3 [--arquivo CHANGELOG.md]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_ITENS = 5;

/** Bullets of the `## <versao>` entry (`- …` lines, continuation lines joined). Throws when invalid. */
export function itensChangelog(texto, versao) {
  const linhas = texto.replace(/\r\n/g, '\n').split('\n');
  const esc = versao.replace(/[.]/g, '\\.');
  const ini = linhas.findIndex((l) => new RegExp(`^## \\[?v?${esc}\\]?(\\s|$)`).test(l));
  if (ini < 0) throw new Error(`CHANGELOG.md: sem entrada "## ${versao}"`);
  const itens = [];
  for (const l of linhas.slice(ini + 1)) {
    if (/^#{1,2} /.test(l)) break;
    if (!l.trim()) continue;
    if (/^- /.test(l)) itens.push(l.slice(2).trim());
    else if (/^\s+\S/.test(l) && itens.length) itens[itens.length - 1] += ' ' + l.trim();
    else throw new Error(`CHANGELOG.md ${versao}: só itens "- …" (veio: ${l.trim().slice(0, 60)})`);
  }
  if (!itens.length) throw new Error(`CHANGELOG.md ${versao}: entrada vazia`);
  if (itens.length > MAX_ITENS) throw new Error(`CHANGELOG.md ${versao}: ${itens.length} itens (máximo ${MAX_ITENS})`);
  return itens;
}

/** The section that opens the release notes. */
export function secaoChanges(texto, versao) {
  return `## Changes\n\n${itensChangelog(texto, versao)
    .map((i) => `- ${i}`)
    .join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const versao = (args[0] ?? '').replace(/^v/, '');
  const i = args.indexOf('--arquivo');
  const arquivo = i >= 0 ? args[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md');
  try {
    if (!/^\d+\.\d+\.\d+/.test(versao)) throw new Error('uso: node tools/changelog.mjs <versão> [--arquivo CHANGELOG.md]');
    process.stdout.write(secaoChanges(fs.readFileSync(arquivo, 'utf8'), versao));
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
