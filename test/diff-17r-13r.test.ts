/**
 * DIFF-17R and DIFF-13R (docs/DECISIONS.md §21, "DIFF-17R / DIFF-13R"): the buffer wrap and the
 * identified-records pointer = 10000 bug (verdict #13) with `&M S` ghost records (verdict #27) instead of fuelings
 * through the screen. Both targets are pump-sim `simulador-2.7.2` on a manual clock, and the run
 * passes no `esperar`: the executor itself turns `aguardar` into `avancar_tempo` (the clock is
 * detected through `get_estado_simulador`), which is what makes side B never wait in real time.
 * Also: DIFF-17 and DIFF-13R are opt-in (out of `todos`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  DIFF13R_ATE_O_BUG,
  DIFF17R_BICOS,
  DIFF17R_TOTAL,
  Hub,
  ManualClock,
  ROTEIROS,
  TICK_FANTASMA_MS,
  type AlvoDiff,
  type PassoComparado,
  comKK,
  detectarRelogioManual,
  executarComando,
  executarDiff,
  fantasmas,
  quadroH,
  roteiro,
  selecionarRoteiros,
} from '../src/index.js';

const HOST = '127.0.0.1';
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

async function alvo(nome: string) {
  const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
  const hub = new Hub({ clock, host: HOST, mapa: { 2001: 0, 1771: 0, 857: 0, 7002: 0 } });
  fechar.push(() => hub.fechar());
  const rt = await hub.criar('default', 'simulador-2.7.2');
  const a: AlvoDiff = { nome, alvo: { host: HOST, porta: rt.servidor!.fisica(2001)! }, controle: `ctl-${nome}` };
  return { hub, rt, clock, alvo: a };
}

async function rodar(ids: string) {
  const a = await alvo('A');
  const b = await alvo('B');
  const hubs: Record<string, Hub> = { 'ctl-A': a.hub, 'ctl-B': b.hub };
  const t0 = { a: a.clock.now(), b: b.clock.now() };
  const rel = await executarDiff(selecionarRoteiros(ids), a.alvo, b.alvo, {
    timeoutMs: 120,
    ociosoMs: 30,
    chamarControle: (url, c, args) => executarComando(hubs[url]!, c, args),
  });
  return { rel, a, b, virtualMs: { a: a.clock.now() - t0.a, b: b.clock.now() - t0.b } };
}

const semFalhas = (rel: Awaited<ReturnType<typeof rodar>>['rel']) => {
  for (const c of rel.casos) {
    expect(c.pulado, c.id).toBeUndefined();
    expect(c.pulados, c.id).toEqual([]);
    expect(c.acoes.filter((x) => !x.ok).map((x) => `${c.id} ${x.alvo} ${x.passo}: ${x.erro}`)).toEqual([]);
    const dif = c.passos.filter((p) => !p.igual || p.aConfere === false || p.bConfere === false);
    expect(dif.map((p) => `${c.id} ${p.quadro}: ${p.a.texto} × ${p.b.texto}`)).toEqual([]);
  }
};

const tp99 = (passos: PassoComparado[]) => passos.filter((p) => p.quadro === '(&T99P3C)').map((p) => p.a.texto);
const ehFantasma = (p: PassoComparado) => /^\(&M[0-9A-F]{2}S/.test(p.quadro);

describe('roteiro: DIFF-17R/13R e os casos opt-in', () => {
  it('DIFF-17 e DIFF-13R ficam fora de `todos`; pelo id, ou com incluirOpcionais, entram', () => {
    const todos = selecionarRoteiros('todos').map((c) => c.id);
    expect(todos).toContain('DIFF-17R');
    expect(todos).not.toContain('DIFF-17');
    expect(todos).not.toContain('DIFF-13R');
    expect(todos).toHaveLength(ROTEIROS.length - 2);
    expect(selecionarRoteiros('todos', { incluirOpcionais: true })).toHaveLength(ROTEIROS.length);
    expect(selecionarRoteiros('DIFF-17,DIFF-13R').map((c) => c.id)).toEqual(['DIFF-17', 'DIFF-13R']);
    expect(roteiro('DIFF-17')!.opcional).toMatch(/2 h/);
    expect(roteiro('DIFF-13R')!.opcional).toMatch(/recém-abertos/);
    // The original DIFF-17 is unchanged: N fuelings through the screen.
    expect(roteiro('DIFF-17', { diff17N: 5 })!.passos.filter((p) => 'acao' in p && p.acao === 'abastecer')).toHaveLength(5);
  });

  it('quadros: 995 fantasmas no DIFF-17R e 10000 no DIFF-13R, 13R só com o botão de config padrão, um tick por rodada', () => {
    const fant = (id: string) => roteiro(id)!.passos.filter((p) => 'enviar' in p && /^\(&M[0-9A-F]{2}S/.test(String(p.enviar)));
    expect(fant('DIFF-17R')).toHaveLength(DIFF17R_TOTAL - 2 * DIFF17R_BICOS.length);
    expect(fant('DIFF-13R')).toHaveLength(DIFF13R_ATE_O_BUG + 1);
    // Protocol-only apart from the "Carregar configuração padrão" button (start and end).
    expect(roteiro('DIFF-13R')!.passos.filter((p) => 'acao' in p).map((p) => (p as { acao: string }).acao)).toEqual(['config_padrao', 'config_padrao']);
    for (const id of ['DIFF-17R', 'DIFF-13R']) for (const p of fant(id)) expect(p).toMatchObject({ terminaEm: ')' });
    // 7 over 3 nozzles = 3 rounds (3 + 3 + 1), each followed by one tick.
    const f = fantasmas(7, ['04', '44', '05']);
    expect(f.map((p) => ('enviar' in p ? p.enviar : `~${(p as { aguardar: number }).aguardar}`))).toEqual([
      '(&M04S2A)', '(&M44S2E)', '(&M05S2B)', `~${TICK_FANTASMA_MS}`,
      '(&M04S2A)', '(&M44S2E)', '(&M05S2B)', `~${TICK_FANTASMA_MS}`,
      '(&M04S2A)', `~${TICK_FANTASMA_MS}`,
    ]);
    expect(() => fantasmas(1, [])).toThrow(/sem bicos/);
  });
});

describe('executor: relógio manual detectado', () => {
  it('pump-sim com relógio manual → true; com `esperar`, driver ou sem controle → false; falha → false', async () => {
    const a = await alvo('A');
    const chamar = (_u: string, c: string, args: Record<string, unknown>) => executarComando(a.hub, c, args);
    expect(await detectarRelogioManual(a.alvo, { chamarControle: chamar })).toBe(true);
    expect(await detectarRelogioManual(a.alvo, { chamarControle: chamar, esperar: async () => undefined })).toBe(false);
    expect(await detectarRelogioManual({ ...a.alvo, driver: 'http://x' }, { chamarControle: chamar })).toBe(false);
    expect(await detectarRelogioManual({ ...a.alvo, controle: undefined })).toBe(false);
    expect(await detectarRelogioManual({ ...a.alvo, relogioManual: false }, { chamarControle: chamar })).toBe(false);
    expect(await detectarRelogioManual(a.alvo, { chamarControle: async () => Promise.reject(new Error('x')) })).toBe(false);
  });
});

describe('DIFF-17R: a volta do buffer com fantasmas (2.7.2 × 2.7.2, relógio virtual)', () => {
  it('zero divergências; escrita 3 e leitura empurrada para 4; a linha 1 sobrescrita; o tempo é virtual', async () => {
    const { rel, b, virtualMs } = await rodar('DIFF-17R');
    semFalhas(rel);
    const c = rel.casos[0]!;
    const fant = c.passos.filter(ehFantasma);
    expect(fant).toHaveLength(995);
    for (const p of fant) expect(p.a.texto).toBe(`(M${p.quadro.slice(3, 5)})`);
    // The 2.7.2 answers &T99P with the TG default (write − 1, read − 1; DIFF-09).
    expect(tp99(c.passos)).toEqual([comKK('TG9900000000'), comKK('TG9900020003'), comKK('TG9900020004')]);
    const lr = (pos: string) => c.passos.find((p) => p.quadro === comKK(`&LR${pos}`))!.a.texto;
    // Record cells: 999 = 1st real of the 2nd batch (04), 1 = 44 (wrap), 2 = 05 (record 1001), 3 = 05 of the 1st batch.
    const bico = (r: string) => r.slice(23, 25); // B2 after T6 L6 P4 V2 C4
    expect([lr('0999'), lr('0001'), lr('0002'), lr('0003')].map(bico)).toEqual(['04', '44', '05', '05']);
    const [a1, a2] = c.passos.filter((p) => p.quadro === '(&A)').map((p) => p.a.texto);
    expect(bico(a1!)).toBe('04'); // the 1st ghost (record 4)
    expect(bico(a2!)).toBe('44');
    expect(c.passos.find((p) => p.quadro === '>?00020667')!.a.texto).toBe(quadroH('06000006000003')); // 06 advances the read pointer, then reports
    // B waited in virtual time: at least one tick per ghost round, and the buffer ends rewound.
    expect(virtualMs.b).toBeGreaterThanOrEqual(332 * TICK_FANTASMA_MS);
    const pont = (await executarComando(b.hub, 'get_ponteiros', {})) as { escrita: number };
    expect(pont.escrita).toBe(1);
  }, 120_000);
});

describe('DIFF-13R: ponteiro de identificados em 10000 (veredito #13), alvos recém-abertos', () => {
  it('escrita 9 → 1 no registro 9999 → 2; o bug não dispara de novo', async () => {
    const { rel, b } = await rodar('DIFF-13R');
    semFalhas(rel);
    const c = rel.casos[0]!;
    expect(c.passos.filter(ehFantasma)).toHaveLength(10_000);
    // 9998 records from position 1: write 9, read pushed to 10 (Q4); the 9999th sets the write to 1.
    // TG default of &T99P: write − 1, read − 1.
    expect(tp99(c.passos)).toEqual([comKK('TG9900000000'), comKK('TG9900080009'), comKK('TG9900000010'), comKK('TG9900010010')]);
    expect(c.passos.find((p) => p.quadro === '>?00020667')!.a.texto).toBe(quadroH('06000012000002')); // 06 advances the read pointer, then reports
    const pont = (await executarComando(b.hub, 'get_ponteiros', {})) as { escritaIdentificada: number };
    expect(pont.escritaIdentificada).toBe(10_001);
  }, 300_000);
});

describe('DIFF-17 original (opt-in), N pequeno', () => {
  it('pelo id, com N = 3: roda pelas ações e sem divergência', async () => {
    const a = await alvo('A');
    const b = await alvo('B');
    const hubs: Record<string, Hub> = { 'ctl-A': a.hub, 'ctl-B': b.hub };
    const rel = await executarDiff(selecionarRoteiros('DIFF-17', { diff17N: 3 }), a.alvo, b.alvo, {
      timeoutMs: 120,
      ociosoMs: 30,
      chamarControle: (url, c, args) => executarComando(hubs[url]!, c, args),
    });
    semFalhas(rel);
    expect(rel.casos[0]!.passos.at(-1)!.a.texto).not.toBe('(0)');
  }, 60_000);
});
