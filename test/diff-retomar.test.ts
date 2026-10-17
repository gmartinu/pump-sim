/**
 * Diff resilience: per-case results as they end (`.partial.jsonl` + `--retomar`),
 * a case skipped when a port is unavailable (no abort), and `--drenar-antes`.
 */
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Hub, ManualClock, PULADO_PORTA, executarDiff, lerParcial } from '../src/index.js';
import type { AlvoDiff, CasoDiff, ResultadoCaso } from '../src/index.js';

const HOST = '127.0.0.1';
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

async function alvoSim(nome: string): Promise<AlvoDiff> {
  const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
  const hub = new Hub({ clock, host: HOST, mapa: { 2001: 0, 1771: 0, 857: 0, 7002: 0 } });
  fechar.push(() => hub.fechar());
  const rt = await hub.criar('default', 'simulador-2.7.2');
  return { nome, alvo: { host: HOST, porta: rt.servidor!.portas()[0]!.fisica } };
}

/** A port that nobody listens on (bound, then released). */
async function portaFechada(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, HOST, r));
  const porta = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return porta;
}

const caso = (id: string, extra: Partial<CasoDiff> = {}): CasoDiff => ({
  id,
  titulo: id,
  resolve: 'teste',
  passos: [{ enviar: '(&S)' }],
  ...extra,
} as CasoDiff);

describe('diff: resultado por caso e retomada', () => {
  it('chama aoTerminarCaso na ordem, um por caso, e o JSONL relido vira anteriores', async () => {
    const [a, b] = [await alvoSim('A'), await alvoSim('B')];
    const linhas: string[] = [];
    const rel = await executarDiff([caso('X-1'), caso('X-2')], a, b, { aoTerminarCaso: (r) => linhas.push(JSON.stringify(r)) });
    expect(linhas).toHaveLength(2);
    const lidos = lerParcial(linhas.join('\n') + '\n{"id":"X-3","tit'); // last line cut mid-write
    expect(lidos.map((r) => r.id)).toEqual(['X-1', 'X-2']);
    expect(lidos).toEqual(rel.casos);
  });

  it('retomar pula os casos já feitos e o relatório final inclui todos', async () => {
    const [a, b] = [await alvoSim('A'), await alvoSim('B')];
    const feito: ResultadoCaso = { id: 'X-1', titulo: 'X-1', comparacao: 'bytes', passos: [], pulados: [], acoes: [], divergencias: 3 };
    const novos: string[] = [];
    const rel = await executarDiff([caso('X-1'), caso('X-2')], a, b, { anteriores: [feito], aoTerminarCaso: (r) => novos.push(r.id) });
    expect(novos).toEqual(['X-2']);
    expect(rel.casos.map((c) => c.id)).toEqual(['X-1', 'X-2']);
    expect(rel.casos[0]).toBe(feito);
    expect(rel.total.divergencias).toBe(3);
    expect(rel.total.casosComDivergencia).toEqual(['X-1']);
  });

  it('caso pulado por porta indisponível é tentado de novo na retomada', async () => {
    const [a, b] = [await alvoSim('A'), await alvoSim('B')];
    const pulado: ResultadoCaso = { id: 'X-1', titulo: 'X-1', comparacao: 'bytes', passos: [], pulados: [], acoes: [], divergencias: 0, pulado: PULADO_PORTA };
    const novos: string[] = [];
    await executarDiff([caso('X-1')], a, b, { anteriores: [pulado], aoTerminarCaso: (r) => novos.push(r.id) });
    expect(novos).toEqual(['X-1']);
  });
});

describe('diff: porta indisponível', () => {
  it('marca o caso como pulado e segue para o próximo (não aborta)', async () => {
    const [a, b] = [await alvoSim('A'), await alvoSim('B')];
    const fechada = await portaFechada();
    const terminados: ResultadoCaso[] = [];
    const rel = await executarDiff(
      [caso('X-1'), caso('X-30', { passos: [{ enviar: '(&S)' }, { enviar: '(&S)', porta: fechada }] }), caso('X-3')],
      a,
      b,
      { aoTerminarCaso: (r) => terminados.push(r) },
    );
    expect(rel.casos.map((c) => c.id)).toEqual(['X-1', 'X-30', 'X-3']);
    const x30 = rel.casos[1]!;
    expect(x30.pulado).toBe('pulado: porta indisponível');
    expect(x30.motivo).toContain(`A ${HOST}:${fechada}`);
    expect(x30.passos).toEqual([]);
    expect(rel.casos[2]!.passos).toHaveLength(1);
    expect(terminados.map((r) => r.id)).toEqual(['X-1', 'X-30', 'X-3']);
  });

  it('só um lado sem a porta também pula o caso', async () => {
    const a = await alvoSim('A');
    const fechada = await portaFechada();
    const b: AlvoDiff = { nome: 'B', alvo: { host: HOST, porta: fechada } };
    const rel = await executarDiff([caso('X-1')], a, b);
    expect(rel.casos[0]!.pulado).toBe(PULADO_PORTA);
    expect(rel.casos[0]!.motivo).toContain('B ');
    expect(rel.total.divergencias).toBe(0);
  });
});

describe('diff: --drenar-antes', () => {
  it('drena o lado A uma vez, antes do primeiro caso', async () => {
    const [a, b] = [await alvoSim('A'), await alvoSim('B')];
    const rel = await executarDiff([caso('X-1'), caso('X-2')], a, b, { drenarAntes: true });
    const drenos = rel.casos.flatMap((c) => c.acoes.filter((x) => x.passo === 'drenar').map((x) => ({ caso: c.id, ...x })));
    expect(drenos).toHaveLength(1);
    expect(drenos[0]).toMatchObject({ caso: 'X-1', alvo: 'A', ok: true });
    expect(drenos[0]!.detalhe).toMatch(/registro\(s\) lido\(s\)/);
  });

  it('sem a opção não drena', async () => {
    const [a, b] = [await alvoSim('A'), await alvoSim('B')];
    const rel = await executarDiff([caso('X-1')], a, b);
    expect(rel.casos[0]!.acoes).toEqual([]);
  });
});
