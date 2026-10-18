import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_ITENS, itensChangelog, secaoChanges } from '../tools/changelog.mjs';
import { VERSAO } from '../src/index.js';

/** Release notes open with the version's CHANGELOG.md entry (DECISIONS §33 C5, release.yml). */

describe('versão e CHANGELOG', () => {
  it('VERSAO = package.json = package-lock = entrada do topo do CHANGELOG, que passa no extrator', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string };
    const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')) as { version: string; packages: Record<string, { version: string }> };
    expect(pkg.version).toBe(VERSAO);
    expect(lock.version).toBe(VERSAO);
    expect(lock.packages['']!.version).toBe(VERSAO);
    const texto = fs.readFileSync('CHANGELOG.md', 'utf8');
    expect(/^## (\d+\.\d+\.\d+)/m.exec(texto)?.[1]).toBe(VERSAO);
    const itens = itensChangelog(texto, VERSAO);
    expect(itens.length).toBeGreaterThanOrEqual(1);
    expect(itens.length).toBeLessThanOrEqual(MAX_ITENS);
  });

  it('1.0.4 é a única entrada (os releases antigos são apagados)', () => {
    expect([...fs.readFileSync('CHANGELOG.md', 'utf8').matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(['1.0.4']);
  });

  it('a seção começa por "## Changes" e junta linhas de continuação', () => {
    const t = '# Changelog\n\n## 2.0.0\n\n- a\n- b quebrada\n  em duas\n\n## 1.9.0\n\n- velho\n';
    expect(secaoChanges(t, '2.0.0')).toBe('## Changes\n\n- a\n- b quebrada em duas\n');
    expect(secaoChanges(t, '1.9.0')).toBe('## Changes\n\n- velho\n');
  });

  it('recusa versão sem entrada, entrada vazia, mais de 5 itens e texto solto', () => {
    expect(() => itensChangelog('## 1.0.0\n- x\n', '1.0.1')).toThrow(/sem entrada/);
    expect(() => itensChangelog('## 1.0.1\n\n## 1.0.0\n- x\n', '1.0.1')).toThrow(/vazia/);
    expect(() => itensChangelog(`## 1.0.1\n${'- x\n'.repeat(6)}`, '1.0.1')).toThrow(/6 itens/);
    expect(() => itensChangelog('## 1.0.1\nUm parágrafo.\n', '1.0.1')).toThrow(/só itens/);
    // "1.0.1" does not match "1.0.10".
    expect(() => itensChangelog('## 1.0.10\n- x\n', '1.0.1')).toThrow(/sem entrada/);
  });

  it('a linha de comando do release.yml aceita a tag com v e sai 1 sem entrada', () => {
    const saida = execFileSync('node', ['tools/changelog.mjs', `v${VERSAO}`], { encoding: 'utf8' });
    expect(saida.startsWith('## Changes\n\n- ')).toBe(true);
    expect(() => execFileSync('node', ['tools/changelog.mjs', 'v0.0.1'], { stdio: 'pipe' })).toThrow();
  });

  it('release.yml usa o extrator no job de teste e nas notas', () => {
    const yml = fs.readFileSync('.github/workflows/release.yml', 'utf8');
    expect(yml).toContain('node tools/changelog.mjs "$GITHUB_REF_NAME"\n');
    expect(yml).toContain('node tools/changelog.mjs "$GITHUB_REF_NAME" > notes.md');
    expect(yml).toContain('--notes-file notes.md --generate-notes');
  });
});
