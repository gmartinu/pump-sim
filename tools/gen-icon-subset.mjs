#!/usr/bin/env node
/**
 * Regenerates ui/fonts/material-symbols-rounded-subset.woff2 (DECISIONS §30): the Material Symbols
 * Rounded font reduced to the icons the web UI uses, so the page and the Windows executable do not
 * carry the full ~3 MB font.
 *
 *   node tools/gen-icon-subset.mjs [--dry-run]
 *
 * Needs `pyftsubset` (fontTools, `pip install fonttools brotli`) on PATH. Same method as the homepage
 * subset (docs/site/README.md): ASCII kept for the ligature components, layout features kept, no
 * layout closure; the glyphs are selected by id instead of by name, because one glyph serves several
 * ligature names. The icon names come from `iconesUi` (tools/fonte-icones.mjs): every literal `.ms`
 * span text, plus every quoted identifier of ui/js that is a ligature of the full font (dynamic icons).
 * Each icon's filled glyph (the FILL axis substitution, `.ms.fill`) is kept too.
 * `test/ui-icones.test.ts` fails when a UI icon is missing from the committed subset.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconesUi, lerWoff2, ligaturas, preenchidos } from './fonte-icones.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONTE = path.join(RAIZ, 'tools', 'fonts', 'material-symbols-rounded.woff2');
const SAIDA = path.join(RAIZ, 'ui', 'fonts', 'material-symbols-rounded-subset.woff2');

const cheia = lerWoff2(fs.readFileSync(FONTE));
const lig = ligaturas(cheia);
const fill = preenchidos(cheia);
const { estaticos, candidatos } = iconesUi(path.join(RAIZ, 'ui'));

const desconhecidos = [...estaticos].filter((n) => !lig.has(n));
if (desconhecidos.length) {
  process.stderr.write(`[gen-icon-subset] not an icon of the full font: ${desconhecidos.join(', ')}\n`);
  process.exit(1);
}
const nomes = [...new Set([...estaticos, ...[...candidatos].filter((n) => lig.has(n))])].sort();
const gids = new Set();
for (const n of nomes) {
  const g = lig.get(n);
  gids.add(g);
  if (fill.has(g)) gids.add(fill.get(g));
}
process.stdout.write(`[gen-icon-subset] ${nomes.length} icons, ${gids.size} glyphs: ${nomes.join(' ')}\n`);
if (process.argv.includes('--dry-run')) process.exit(0);

const r = spawnSync(
  'pyftsubset',
  [
    FONTE,
    '--unicodes=U+0020-007F',
    `--gids=${[...gids].sort((a, b) => a - b).join(',')}`,
    '--layout-features=*',
    '--no-layout-closure',
    '--flavor=woff2',
    `--output-file=${SAIDA}`,
  ],
  { stdio: 'inherit' },
);
if (r.error || r.status !== 0) {
  process.stderr.write(`[gen-icon-subset] pyftsubset failed${r.error ? `: ${r.error.message}` : ` (exit ${r.status})`}\n`);
  process.exit(1);
}
process.stdout.write(`[gen-icon-subset] ${path.relative(RAIZ, SAIDA)}: ${fs.statSync(SAIDA).size} bytes\n`);
