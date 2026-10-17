/**
 * Icon font helpers shared by `tools/gen-icon-subset.mjs` and `test/ui-icones.test.ts` (DECISIONS §30).
 *
 * - `lerWoff2`: the sfnt tables of a WOFF2 file (Brotli via node:zlib; only untransformed tables are
 *   returned as bytes, which covers cmap and GSUB; glyf/loca/hmtx are transformed and not needed).
 * - `ligaturas`: icon name → glyph id, read from the GSUB ligature lookups (type 4, also inside type 7
 *   extensions), with the component glyphs mapped back to characters through cmap. This is what the
 *   browser does with `<span class="ms">download</span>`, so a name that is not here renders as text.
 * - `preenchidos`: glyph id → its filled glyph id, from the GSUB single-substitution lookups (type 1)
 *   that the FILL axis switches on through FeatureVariations (`.ms.fill`).
 * - `iconesUi`: the icon names the web UI can show: the literal text of every `.ms` span (`estaticos`)
 *   and every quoted lowercase identifier of the UI scripts (`candidatos`: dynamic icons such as
 *   `${escuro ? 'light_mode' : 'dark_mode'}` or `ic: 'lock_open'`; most candidates are not icons, so a
 *   caller intersects them with the ligatures of the full font).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

/** @param {Buffer} buf @returns {Map<string, Buffer>} */
export function lerWoff2(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 file');
  if (buf.toString('latin1', 4, 8) === 'ttcf') throw new Error('font collections are not supported');
  const numTables = buf.readUInt16BE(12);
  const compressedLength = buf.readUInt32BE(20);
  let p = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = buf[p++];
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error('bad UIntBase128');
  };
  const dir = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[p++];
    let tag = TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      tag = buf.toString('latin1', p, p + 4);
      p += 4;
    }
    const versao = flags >> 6;
    const origLength = base128();
    // glyf/loca: version 0 is the transform (3 is none); every other table: 0 is none.
    const transformado = tag === 'glyf' || tag === 'loca' ? versao !== 3 : versao !== 0;
    const comprimento = transformado ? base128() : origLength;
    dir.push({ tag, comprimento, transformado });
  }
  const dados = zlib.brotliDecompressSync(buf.subarray(p, p + compressedLength));
  const out = new Map();
  let o = 0;
  for (const t of dir) {
    if (!t.transformado) out.set(t.tag, dados.subarray(o, o + t.comprimento));
    o += t.comprimento;
  }
  if (o !== dados.length) throw new Error(`WOFF2 table stream: ${o} bytes in the directory, ${dados.length} decompressed`);
  return out;
}

/**
 * Glyph id → character (BMP format 4 or format 12 subtable of the Unicode cmap). The icon font maps
 * upper and lower case to the same glyphs; the lower-case character wins, as icon names are written.
 */
function cmapReverso(cmap) {
  const n = cmap.readUInt16BE(2);
  let melhor = -1;
  for (let i = 0; i < n; i++) {
    const plat = cmap.readUInt16BE(4 + i * 8);
    const enc = cmap.readUInt16BE(6 + i * 8);
    const off = cmap.readUInt32BE(8 + i * 8);
    const fmt = cmap.readUInt16BE(off);
    if ((plat === 3 && (enc === 1 || enc === 10)) || plat === 0) {
      if (fmt === 12 || (fmt === 4 && melhor < 0)) melhor = off;
    }
  }
  if (melhor < 0) throw new Error('no Unicode cmap subtable');
  const rev = new Map();
  const fmt = cmap.readUInt16BE(melhor);
  if (fmt === 12) {
    const grupos = cmap.readUInt32BE(melhor + 12);
    for (let g = 0; g < grupos; g++) {
      const b = melhor + 16 + g * 12;
      const ini = cmap.readUInt32BE(b);
      const fim = cmap.readUInt32BE(b + 4);
      const gid = cmap.readUInt32BE(b + 8);
      for (let c = ini; c <= fim; c++) guardar(rev, gid + c - ini, c);
    }
    return rev;
  }
  const segX2 = cmap.readUInt16BE(melhor + 6);
  const fins = melhor + 14;
  const inis = fins + segX2 + 2;
  const deltas = inis + segX2;
  const ranges = deltas + segX2;
  for (let s = 0; s < segX2 / 2; s++) {
    const fim = cmap.readUInt16BE(fins + s * 2);
    const ini = cmap.readUInt16BE(inis + s * 2);
    const delta = cmap.readInt16BE(deltas + s * 2);
    const ro = cmap.readUInt16BE(ranges + s * 2);
    for (let c = ini; c <= fim && c !== 0xffff; c++) {
      let gid;
      if (ro === 0) gid = (c + delta) & 0xffff;
      else {
        gid = cmap.readUInt16BE(ranges + s * 2 + ro + (c - ini) * 2);
        if (gid !== 0) gid = (gid + delta) & 0xffff;
      }
      if (gid !== 0) guardar(rev, gid, c);
    }
  }
  return rev;
}

function guardar(rev, gid, c) {
  if (!rev.has(gid) || (c >= 0x61 && c <= 0x7a)) rev.set(gid, String.fromCodePoint(c));
}

/** Glyph ids of a coverage table, in coverage-index order. */
function cobertura(t, off) {
  const fmt = t.readUInt16BE(off);
  const n = t.readUInt16BE(off + 2);
  const gids = [];
  if (fmt === 1) for (let i = 0; i < n; i++) gids.push(t.readUInt16BE(off + 4 + i * 2));
  else if (fmt === 2) {
    for (let i = 0; i < n; i++) {
      const b = off + 4 + i * 6;
      for (let g = t.readUInt16BE(b); g <= t.readUInt16BE(b + 2); g++) gids.push(g);
    }
  } else throw new Error(`coverage format ${fmt}`);
  return gids;
}

/** Every GSUB subtable as [type, absolute offset], extension (type 7) subtables unwrapped. */
function subtabelas(gsub) {
  const lista = gsub.readUInt16BE(8);
  const n = gsub.readUInt16BE(lista);
  const out = [];
  for (let i = 0; i < n; i++) {
    const lk = lista + gsub.readUInt16BE(lista + 2 + i * 2);
    const tipo = gsub.readUInt16BE(lk);
    const ns = gsub.readUInt16BE(lk + 4);
    for (let s = 0; s < ns; s++) {
      const st = lk + gsub.readUInt16BE(lk + 6 + s * 2);
      if (tipo === 7) out.push([gsub.readUInt16BE(st + 2), st + gsub.readUInt32BE(st + 4)]);
      else out.push([tipo, st]);
    }
  }
  return out;
}

/** @param {Map<string, Buffer>} tabelas @returns {Map<string, number>} icon name → glyph id */
export function ligaturas(tabelas) {
  const gsub = tabelas.get('GSUB');
  const cmap = tabelas.get('cmap');
  if (!gsub || !cmap) throw new Error('font without GSUB or cmap');
  const rev = cmapReverso(cmap);
  const out = new Map();
  for (const [tipo, st] of subtabelas(gsub)) {
    if (tipo !== 4) continue;
    const cob = cobertura(gsub, st + gsub.readUInt16BE(st + 2));
    const nSets = gsub.readUInt16BE(st + 4);
    for (let i = 0; i < nSets; i++) {
      const set = st + gsub.readUInt16BE(st + 6 + i * 2);
      const primeiro = rev.get(cob[i]);
      if (primeiro === undefined) continue;
      const nLig = gsub.readUInt16BE(set);
      for (let l = 0; l < nLig; l++) {
        const lig = set + gsub.readUInt16BE(set + 2 + l * 2);
        const gid = gsub.readUInt16BE(lig);
        const comp = gsub.readUInt16BE(lig + 2);
        let nome = primeiro;
        for (let c = 1; c < comp; c++) {
          const ch = rev.get(gsub.readUInt16BE(lig + 2 + c * 2));
          if (ch === undefined) {
            nome = null;
            break;
          }
          nome += ch;
        }
        if (nome !== null && !out.has(nome)) out.set(nome, gid);
      }
    }
  }
  return out;
}

/** @param {Map<string, Buffer>} tabelas @returns {Map<number, number>} glyph id → filled glyph id */
export function preenchidos(tabelas) {
  const gsub = tabelas.get('GSUB');
  if (!gsub) throw new Error('font without GSUB');
  const out = new Map();
  for (const [tipo, st] of subtabelas(gsub)) {
    if (tipo !== 1) continue;
    const fmt = gsub.readUInt16BE(st);
    const cob = cobertura(gsub, st + gsub.readUInt16BE(st + 2));
    if (fmt === 1) {
      const delta = gsub.readInt16BE(st + 4);
      for (const g of cob) out.set(g, (g + delta) & 0xffff);
    } else {
      cob.forEach((g, i) => out.set(g, gsub.readUInt16BE(st + 6 + i * 2)));
    }
  }
  return out;
}

function listar(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listar(p) : [p];
  });
}

const NOME = /^[a-z][a-z0-9_]*$/;

/** @param {string} dirUi @returns {{ estaticos: Set<string>, candidatos: Set<string> }} */
export function iconesUi(dirUi) {
  const estaticos = new Set();
  const candidatos = new Set();
  for (const arq of listar(dirUi).filter((f) => /\.(?:html|js)$/.test(f))) {
    const txt = fs.readFileSync(arq, 'utf8');
    // `<span class="ms …">name</span>`: the text is literal when it holds no `${`.
    for (const m of txt.matchAll(/<span class="ms\b[^"]*"[^>]*>([^<]*)<\/span>/g)) {
      const t = m[1].trim();
      if (NOME.test(t)) estaticos.add(t);
    }
    if (arq.endsWith('.js')) for (const m of txt.matchAll(/(['"])([a-z][a-z0-9_]*)\1/g)) candidatos.add(m[2]);
  }
  return { estaticos, candidatos };
}
