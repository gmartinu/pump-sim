/**
 * Recorded 2.7.2 oracle (README "Recorded oracle", docs/DECISIONS.md §24). The side-A replies of the
 * latest real-bench run (SimuladorCBC 2.7.2 on Windows, Go driver) live in test/fixtures/oracle-2.7.2;
 * the replay runs them through the diff executor against pump-sim `simulador-2.7.2` in process.
 *
 * - Every recorded case whose script hash is unchanged must be byte-equal (the live diff's masks).
 * - A case whose script changed since the recording is stale ("needs bench"): reported as skipped,
 *   never as a pass, and pinned in STALE_RECONHECIDOS so a new stale case turns CI red until it is
 *   acknowledged here or re-recorded with `pump-sim oracle --atualizar-de <diff.json>`.
 */
import fs from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  type CasoDiff,
  type CasoOraculo,
  type Oraculo,
  type RelatorioOraculo,
  ClienteTcp,
  Hub,
  ManualClock,
  ROTEIROS,
  construirOraculo,
  executarComando,
  executarDiff,
  executarOraculo,
  formatarRelatorioOraculo,
  hashRoteiro,
  lerOraculo,
  mesclarOraculo,
  roteiro,
} from '../src/index.js';

const DIR = 'test/fixtures/oracle-2.7.2';

/**
 * Stale cases acknowledged today: none. The r10 bench run (§29, the final Windows confirmation)
 * re-recorded every case with the current scripts.
 */
const STALE_RECONHECIDOS: string[] = [];
/**
 * Steps that differ in the replay, pinned with both exact replies: any other difference, or one of
 * these changing or disappearing, turns CI red. None today: the last one, the EQUIV-MOTOR #26
 * free-flow record (A 23 ticks × B 25, §23 residual, pinned in §26–§28), is equal since §29 set the
 * `simulador-2.7.2` flow tick to the Windows-effective 109.375 ms. The two `&KR1` seconds differences
 * of §26 left with the §27 mask.
 */
const DIFERENCAS_RECONHECIDAS: Record<string, [indice: number, a: string, b: string][]> = {};
/** No oracle: the 2.7.2 only listens on its configured port, so DIFF-30 (1771/857) is skipped on every bench. */
const PULADOS_RECONHECIDOS = ['DIFF-30'];

const oraculo = lerOraculo(DIR);
const ids = oraculo.manifesto.sessoes.flatMap((s) => s.casos.filter((id) => oraculo.casos.get(id)?.sessao === s.id));

let rel: RelatorioOraculo;
let duracaoMs = 0;
beforeAll(async () => {
  const t0 = performance.now();
  rel = await executarOraculo(oraculo);
  duracaoMs = performance.now() - t0;
}, 60_000);

describe('oráculo gravado do 2.7.2 (bancada r10)', () => {
  it.for(ids)('%s', (id, ctx) => {
    const r = rel.casos.find((c) => c.id === id)!;
    expect(r, `${id} não saiu no relatório`).toBeDefined();
    if (r.estado === 'stale') ctx.skip(`stale: ${r.motivo}`);
    if (r.estado === 'pulado') ctx.skip(r.motivo);
    if (r.estado === 'informativo') ctx.skip('informativo: não compara bytes');
    const reconhecidas = DIFERENCAS_RECONHECIDAS[id] ?? [];
    expect(r.diferentes.map((p) => [p.indice, p.a.texto, p.b.texto]), formatarRelatorioOraculo({ ...rel, casos: [r] })).toEqual(reconhecidas);
    expect(r.estado).toBe(reconhecidas.length ? 'diferente' : 'igual');
    expect(r.divergencias).toBe(reconhecidas.length);
    expect(r.passos).toBe(oraculo.casos.get(id)!.passos.length);
  });

  it('os casos stale e pulados são exatamente os reconhecidos (nada passa em silêncio)', () => {
    expect(rel.stale.map((s) => s.id)).toEqual(STALE_RECONHECIDOS);
    expect(rel.pulados.map((s) => s.id)).toEqual(PULADOS_RECONHECIDOS);
    expect(rel.falhas).toEqual(Object.keys(DIFERENCAS_RECONHECIDAS));
  });

  it('cobre todos os casos não opcionais do roteiro e roda em menos de 60 s', () => {
    expect(ROTEIROS.filter((c) => !c.opcional).every((c) => oraculo.casos.has(c.id))).toBe(true);
    expect(rel.total.casos).toBe(ids.length);
    expect(duracaoMs).toBeLessThan(60_000);
  });

  it('os passos sensíveis ao tempo estão marcados e mantêm as máscaras do roteiro', () => {
    const passos = [...oraculo.casos.values()].flatMap((c) => c.passos);
    for (const p of passos.filter((x) => x.sensivel?.includes('relogio'))) expect(p.mascara?.length).toBeGreaterThan(0);
    for (const p of passos.filter((x) => x.sensivel?.includes('bateria'))) expect(p.ignorarFim).toBe(2);
    expect(passos.some((p) => p.sensivel?.includes('relogio'))).toBe(true);
  });
});

/** Deep copy of the oracle with `mudar` applied to one case. */
function copiar(o: Oraculo, id: string, mudar: (c: CasoOraculo) => void): Oraculo {
  const casos = new Map([...o.casos].map(([k, v]) => [k, structuredClone(v)]));
  mudar(casos.get(id)!);
  return { manifesto: structuredClone(o.manifesto), casos };
}

describe('replay do oráculo: o que falha e o que fica stale', () => {
  it('um byte trocado num quadro A gravado faz o caso falhar (diferente), não stale', async () => {
    const o = copiar(oraculo, 'DIFF-01', (c) => {
      c.passos[0]!.a = '(U05)';
    });
    const r = await executarOraculo(o);
    const c = r.casos.find((x) => x.id === 'DIFF-01')!;
    expect(c.estado).toBe('diferente');
    expect(c.diferentes.map((p) => [p.indice, p.a.texto, p.b.texto])).toEqual([[0, '(U05)', '(U04)']]);
    expect(r.falhas).toEqual(['DIFF-01', ...Object.keys(DIFERENCAS_RECONHECIDAS)]);
  }, 60_000);

  it('silêncio gravado onde o pump-sim responde também falha', async () => {
    const o = copiar(oraculo, 'DIFF-01', (c) => {
      c.passos[1]!.a = null;
    });
    const c = (await executarOraculo(o)).casos.find((x) => x.id === 'DIFF-01')!;
    expect(c.estado).toBe('diferente');
    expect(c.diferentes[0]!.a.latenciaMs).toBeNull();
  }, 60_000);

  it('hash do roteiro diferente do gravado = stale (precisa de bancada), não passa nem falha', async () => {
    const o = copiar(oraculo, 'DIFF-01', (c) => {
      c.roteiroHash = 'sha256:00000000000000000000000000000000';
      c.passos[0]!.a = '(U05)'; // would fail if it were compared
    });
    const r = await executarOraculo(o);
    const c = r.casos.find((x) => x.id === 'DIFF-01')!;
    expect(c.estado).toBe('stale');
    expect(c.motivo).toMatch(/roteiro mudou .* precisa de bancada/);
    expect(r.stale.map((s) => s.id)).toContain('DIFF-01');
    expect(r.falhas).toEqual(Object.keys(DIFERENCAS_RECONHECIDAS));
  }, 60_000);

  it('um quadro gravado que não é o do roteiro de mesmo hash falha (fixture editada à mão)', async () => {
    const o = copiar(oraculo, 'DIFF-01', (c) => {
      c.passos[0]!.quadro = '(&U0500123409)';
    });
    const c = (await executarOraculo(o)).casos.find((x) => x.id === 'DIFF-01')!;
    expect(c.estado).toBe('diferente');
    expect(c.motivo).toMatch(/não confere com o roteiro de mesmo hash/);
  }, 60_000);

  it('uma gravação com passos além do roteiro de mesmo hash falha (fixture editada à mão)', async () => {
    const o = copiar(oraculo, 'DIFF-01', (c) => {
      c.passos.push({ ...c.passos[c.passos.length - 1]!, indice: c.passos.length });
    });
    const c = (await executarOraculo(o)).casos.find((x) => x.id === 'DIFF-01')!;
    expect(c.estado).toBe('diferente');
    expect(c.motivo).toMatch(/1 passo\(s\) gravado\(s\) além do roteiro/);
  }, 60_000);

  it('--atualizar-de avisa quando A trouxe bytes atrasados (a gravação ficaria sem eles)', () => {
    const base = roteiro('DIFF-01')!;
    const passos = base.passos.filter((p) => 'enviar' in p).map((p, i) => {
      const quadro = Array.isArray(p.enviar) ? p.enviar.join('') : p.enviar;
      const r = { texto: '', hex: '', latenciaMs: null, caiu: false };
      return { indice: i, quadro, a: i === 0 ? { ...r, atrasados: '(tarde)' } : r, b: r, igual: true, byte: -1 };
    });
    const relDiff = {
      alvoA: 'A x:1',
      alvoB: 'B x:2',
      casos: [{ id: 'DIFF-01', titulo: base.titulo, comparacao: 'bytes' as const, passos, pulados: [], acoes: [], divergencias: 0, roteiroHash: hashRoteiro(base) }],
    } as unknown as Parameters<typeof construirOraculo>[0];
    const { avisos } = construirOraculo(relDiff, { sessao: 's', fonte: 'f', inicioRelogio: '2026-10-17T14:35:32' });
    expect(avisos.some((a) => a.includes('bytes atrasados em A') && a.includes('(tarde)'))).toBe(true);
  });

  it('um caso novo do roteiro sem gravação sai stale "sem gravação"', async () => {
    const novo: CasoDiff = { id: 'DIFF-NOVO', titulo: 'novo', resolve: 'teste', passos: [{ enviar: '(&S)', ignorarFim: 2 }] };
    const r = await executarOraculo(oraculo, { todos: [...ROTEIROS.filter((c) => !c.opcional), novo] });
    expect(r.stale.find((s) => s.id === 'DIFF-NOVO')?.motivo).toBe('sem gravação: precisa de bancada');
  }, 60_000);
});

describe('hashRoteiro', () => {
  const base = roteiro('DIFF-01')!;
  it('é estável e ignora só texto (nota, título, texto do manual)', () => {
    const c = structuredClone(base);
    c.titulo = 'outro';
    for (const p of c.passos) if ('enviar' in p) p.nota = 'outra nota';
    expect(hashRoteiro(c)).toBe(hashRoteiro(base));
    expect(hashRoteiro(base)).toBe(oraculo.casos.get('DIFF-01')!.roteiroHash);
  });
  it('muda com quadro, espera, máscara ou ação', () => {
    const mudancas: ((c: CasoDiff) => void)[] = [
      (c) => c.passos.push({ aguardar: 100 }),
      (c) => c.passos.unshift({ enviar: '(&S)' }),
      (c) => {
        const p = c.passos.find((x) => 'enviar' in x && x.ignorarFim) as { ignorarFim?: number };
        p.ignorarFim = 3;
      },
      (c) => c.passos.push({ acao: 'canal', params: { n: 2 } }),
    ];
    for (const m of mudancas) {
      const c = structuredClone(base);
      m(c);
      expect(hashRoteiro(c)).not.toBe(hashRoteiro(base));
    }
  });
});

describe('--atualizar-de: relatório novo (com roteiroHash) vira oráculo e repete igual', () => {
  const fechar: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const f of fechar.splice(0)) await f();
  });

  it('diff ao vivo entre dois pump-sim → construir → mesclar → replay: iguais, hash do relatório', async () => {
    const hubs: Record<string, Hub> = {};
    const alvo = async (nome: string) => {
      const clock = new ManualClock(Date.UTC(2026, 9, 17, 14, 35, 32));
      const h = new Hub({ clock, host: '127.0.0.1', fusoMinutos: 0, mapa: { 7002: 0 } });
      fechar.push(() => h.fechar());
      const rt = await h.criar('default', 'simulador-2.7.2', [7002], { configPadrao: true });
      hubs[nome] = h;
      return { nome, alvo: { host: '127.0.0.1', porta: rt.servidor!.fisica(7002)! }, controle: nome, relogioManual: true };
    };
    const casos = ['DIFF-01', 'DIFF-03', 'DIFF-10'].map((id) => roteiro(id)!);
    const relDiff = await executarDiff(casos, await alvo('A'), await alvo('B'), {
      timeoutMs: 120,
      ociosoMs: 30,
      chamarControle: (url, c, a) => executarComando(hubs[url]!, c, a),
    });
    expect(relDiff.casos.every((c) => c.roteiroHash === hashRoteiro(roteiro(c.id)!))).toBe(true);
    const novo = construirOraculo(relDiff, { sessao: 'teste', fonte: 'teste.json', inicioRelogio: '2026-10-17T14:35:32' });
    expect(novo.casos.map((c) => c.origemHash)).toEqual(['relatório da bancada', 'relatório da bancada', 'relatório da bancada']);
    expect(novo.sessao.drenarAntes).toBe(false);
    // Merge into the real oracle: the 3 cases move to the new session, r10 keeps the others.
    const o = mesclarOraculo(oraculo, novo);
    expect(o.manifesto.sessoes.map((s) => s.id)).toEqual(['diff-r10', 'teste']);
    expect(o.casos.get('DIFF-03')!.sessao).toBe('teste');
    const r = await executarOraculo(o);
    expect(r.casos.filter((c) => c.sessao === 'teste').map((c) => [c.id, c.estado])).toEqual([
      ['DIFF-01', 'igual'],
      ['DIFF-03', 'igual'],
      ['DIFF-10', 'igual'],
    ]);
    // r10 still runs DIFF-01/03/10 (current script, not compared) to keep the state of the next cases.
    expect(r.falhas).toEqual(Object.keys(DIFERENCAS_RECONHECIDAS));
    expect(r.casos.filter((c) => c.sessao === 'diff-r10').length).toBe(ids.length - 3);
  }, 60_000);
});

describe('conexão em memória × TCP (mesmo caminho do servidor)', () => {
  const fechar: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const f of fechar.splice(0)) await f();
  });

  it('as mesmas respostas e o mesmo modal 10053 no RST, sem esperar timeout no silêncio', async () => {
    const abrir = async () => {
      const h = new Hub({ clock: new ManualClock(Date.UTC(2026, 9, 17, 14, 35, 32)), host: '127.0.0.1', fusoMinutos: 0, mapa: { 7002: 0 } });
      fechar.push(() => h.fechar());
      return h.criar('default', 'simulador-2.7.2', [7002], { configPadrao: true });
    };
    const quadros = ['(&S)', '(&V)', '(&X)', '(&S', ')', '(&U0400123409)', '(&T04L)'];
    const tcpRt = await abrir();
    const memRt = await abrir();
    const tcp = await ClienteTcp.conectar({ host: '127.0.0.1', porta: tcpRt.servidor!.fisica(7002)! });
    const mem = memRt.servidor!.conectarMemoria(7002);
    for (const q of quadros) {
      const a = await tcp.trocar([q], { timeoutMs: 150, ociosoMs: 30 });
      const t0 = performance.now();
      const b = await mem.trocar([q]);
      expect(performance.now() - t0).toBeLessThan(100);
      expect([q, b.bytes.toString('latin1')]).toEqual([q, a.bytes.toString('latin1')]);
      expect(b.latenciaMs === null).toBe(a.latenciaMs === null);
    }
    tcp.fecharRst();
    mem.fecharRst();
    const modal = (rt: typeof tcpRt) => rt.sim.conc.eventos.filter((e) => e.tipo === 'MSG' && e.texto === 'Asynchronous socket error 10053.').length;
    for (let i = 0; i < 100 && modal(tcpRt) === 0; i++) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setImmediate(r));
    expect(modal(tcpRt)).toBe(1);
    expect(modal(memRt)).toBe(1);
    expect(() => memRt.servidor!.conectarMemoria(1771)).toThrow(/ECONNREFUSED/);
  }, 20_000);
});

it('fixtures: um arquivo por caso + manifest, formato pump-sim/oraculo@1', () => {
  const arquivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
  expect(arquivos.length).toBe(oraculo.casos.size + 1);
  for (const c of oraculo.casos.values()) expect(c.formato).toBe('pump-sim/oraculo@1');
});
