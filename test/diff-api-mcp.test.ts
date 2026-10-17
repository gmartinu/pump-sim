import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  CATALOGO,
  Hub,
  ManualClock,
  type PerfilId,
  ROTEIROS,
  abrirServidorControle,
  criarServidorMcp,
  defComando,
  executarComando,
  executarDiff,
  kkValido,
  schemaComSimId,
  selecionarRoteiros,
  validar,
} from '../src/index.js';

const HOST = '127.0.0.1';
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

async function hubCom(perfil: PerfilId, semTcp = false) {
  const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
  const hub = new Hub({ clock, host: HOST, mapa: { 2001: 0, 1771: 0, 857: 0, 7002: 0 }, semTcp });
  fechar.push(() => hub.fechar());
  const rt = await hub.criar('default', perfil);
  return { hub, rt, clock };
}

describe('roteiro do diff (dados)', () => {
  it('tem DIFF-01..20, DIFF-30 e a bancada de 17/10', () => {
    const ids = ROTEIROS.map((c) => c.id);
    for (let i = 1; i <= 20; i++) expect(ids).toContain(`DIFF-${String(i).padStart(2, '0')}`);
    expect(ids).toContain('DIFF-30');
    expect(ids).toContain('BANCADA-1710');
    // DIFF-17 and DIFF-13R are opt-in: out of `todos` unless asked for (docs/DECISIONS.md §21).
    expect(selecionarRoteiros('todos', { incluirOpcionais: true })).toHaveLength(ROTEIROS.length);
    expect(selecionarRoteiros('todos')).toHaveLength(ROTEIROS.filter((c) => !c.opcional).length);
    expect(() => selecionarRoteiros('DIFF-99')).toThrow(/desconhecido/);
  });

  it('todo quadro tem KK válido, salvo os errados de propósito e os verbos sem KK', () => {
    // EQUIV-COMANDOS: the 2.7.2 &KW does not check the KK (#39), deliberately wrong/non-numeric.
    const intencionais = new Set(['(&T08L2e)', '(&T08L00)', '(&T04L00)', '(&KW126101606143000B8)', '(&KW1261016XX143000BA)']);
    const semKK = new Set(['(&S)', '(&V)', '(&I)', '(&A)', '(&R)', '(&F)', '(&X)', '(&A67)', '(&@66)']);
    const ruins: string[] = [];
    for (const c of ROTEIROS)
      for (const p of c.passos) {
        if (!('enviar' in p) || Array.isArray(p.enviar)) continue;
        const q = p.enviar;
        if (!/^\([&?].*\)$/.test(q) || q.includes(')(') || semKK.has(q) || intencionais.has(q)) continue;
        if (/^\(&[EH]/.test(q)) continue; // &E and &H carry no KK (DT435; behavioral equivalence)
        if (!kkValido(q)) ruins.push(`${c.id} ${q}`);
      }
    expect(ruins).toEqual([]);
  });

  it('os passos manuais chamam comandos do catálogo com argumentos válidos', () => {
    const erros: string[] = [];
    for (const c of ROTEIROS)
      for (const p of c.passos) {
        if (!('manual' in p)) continue;
        for (const ctl of p.controle ?? []) {
          const def = defComando(ctl.comando);
          if (!def) erros.push(`${c.id}: ${ctl.comando} não existe`);
          else erros.push(...validar(schemaComSimId(def), ctl.args ?? {}).map((e) => `${c.id} ${ctl.comando}: ${e}`));
        }
      }
    expect(erros).toEqual([]);
  });
});

describe('executor do diff', () => {
  // DIFF-16 left the list in diff r5: it now fuels to set its own grid state (test/diff-r5.test.ts).
  const CASOS_SEM_ESPERA = ['DIFF-03', 'DIFF-04', 'DIFF-10', 'DIFF-11', 'BANCADA-1710'];

  it('2.7.2 × 2.7.2: zero divergências, e a bancada de 17/10 confere byte a byte', async () => {
    const a = await hubCom('simulador-2.7.2');
    const b = await hubCom('simulador-2.7.2');
    const alvo = (h: typeof a) => ({ host: HOST, porta: h.rt.servidor!.portas()[0]!.fisica });
    const rel = await executarDiff(selecionarRoteiros(CASOS_SEM_ESPERA), { nome: 'A', alvo: alvo(a) }, { nome: 'B', alvo: alvo(b) }, { timeoutMs: 120, ociosoMs: 30 });
    expect(rel.total.casosComDivergencia).toEqual([]);
    const banc = rel.casos.find((c) => c.id === 'BANCADA-1710')!;
    expect(banc.passos.filter((p) => p.aConfere === false).map((p) => `${p.quadro} → ${p.a.texto}`)).toEqual([]);
    expect(banc.passos).toHaveLength(11);
  }, 30_000);

  it('2.7.2 × cbc-32: o DIFF-04 acusa o Q1 (só o 1º de dois quadros colados)', async () => {
    const a = await hubCom('simulador-2.7.2');
    const b = await hubCom('cbc-32');
    const rel = await executarDiff(
      selecionarRoteiros('DIFF-04'),
      { nome: 'A', alvo: { host: HOST, porta: a.rt.servidor!.fisica(2001)! } },
      { nome: 'B', alvo: { host: HOST, porta: b.rt.servidor!.fisica(2001)! } },
      { timeoutMs: 120, ociosoMs: 30 },
    );
    const colados = rel.casos[0]!.passos.find((p) => p.quadro === '(&S)(&V)')!;
    expect(colados.igual).toBe(false);
    expect(colados.a.texto).toMatch(/^\(S[^)]*\)$/);
    expect(colados.b.texto).toMatch(/^\(S[^)]*\)\(/);
  });

  it('passos manuais e ações rodam pela API de controle do alvo', async () => {
    const a = await hubCom('simulador-2.7.2');
    const b = await hubCom('simulador-2.7.2');
    const hubs: Record<string, Hub> = { 'ctl-a': a.hub, 'ctl-b': b.hub };
    const rel = await executarDiff(
      selecionarRoteiros('DIFF-14'),
      { nome: 'A', alvo: { host: HOST, porta: a.rt.servidor!.fisica(2001)! }, controle: 'ctl-a' },
      { nome: 'B', alvo: { host: HOST, porta: b.rt.servidor!.fisica(2001)! }, controle: 'ctl-b' },
      {
        timeoutMs: 120,
        ociosoMs: 30,
        chamarControle: (url, c, args) => executarComando(hubs[url]!, c, args),
        // The panel button waits for the caption, which follows the state timer: the wait advances the clock.
        esperar: async (ms, x) => {
          const t = x.nome === 'A' ? a : b;
          t.clock.advance(ms);
          t.rt.tick();
        },
      },
    );
    const caso = rel.casos[0]!;
    expect(caso.pulados).toEqual([]);
    expect(caso.acoes.filter((x) => !x.ok)).toEqual([]);
    // drenar + the default configuration (bench diff r6: a fresh 2.7.2 has no nozzles) + 3 manual
    // steps (IDF) + lift/hang up, on both targets
    expect(caso.acoes.filter((x) => x.alvo === 'A').map((x) => x.passo)).toEqual([
      'drenar',
      'config_padrao',
      'apresentar_cartao',
      'configurar_sensor',
      'apresentar_cartao',
      'canal {"n":1}',
      'bico_radio {"lado":"esquerdo","alt":false}',
      'retirar {"lado":"esquerdo"}',
      'canal {"n":1}',
      'bico_radio {"lado":"esquerdo","alt":false}',
      'recolocar {"lado":"esquerdo"}',
    ]);
    expect(caso.divergencias).toBe(0);
  }, 20_000);
});

describe('API HTTP + WS', () => {
  it('catálogo, comando, leitura por GET, erros com status e eventos no WS', async () => {
    const { hub } = await hubCom('simulador-2.7.2', true);
    const s = await abrirServidorControle(hub, 0);
    fechar.push(() => s.fechar());
    const cat = (await (await fetch(`${s.url}/api/catalogo`)).json()) as { resultado: unknown[] };
    expect(cat.resultado).toHaveLength(CATALOGO.length);
    const st = (await (await fetch(`${s.url}/api/comandos/get_status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()) as { ok: boolean; resultado: { quadro: string } };
    expect(st.ok).toBe(true);
    expect(st.resultado.quadro).toMatch(/^\(S/);
    const g = (await (await fetch(`${s.url}/api/comandos/get_precos?bico=04`)).json()) as { resultado: { bico: string } };
    expect(g.resultado.bico).toBe('04');
    const e = await fetch(`${s.url}/api/comandos/retirar_bico`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bico: '3F' }) });
    expect(e.status).toBe(404);
    expect(((await e.json()) as { ok: boolean }).ok).toBe(false);
    const est = (await (await fetch(`${s.url}/api/estado`)).json()) as { resultado: { perfil: { id: string } } };
    expect(est.resultado.perfil.id).toBe('simulador-2.7.2');

    const ws = new WebSocket(`${s.url.replace('http', 'ws')}/ws`);
    const msgs: { tipo?: string; id?: number; ok?: boolean; resultado?: { resposta: string }; dados?: { dir: string } }[] = [];
    await new Promise<void>((r) => ws.once('open', () => r()));
    fechar.push(() => ws.terminate());
    ws.on('message', (d) => msgs.push(JSON.parse(String(d)) as (typeof msgs)[number]));
    ws.send(JSON.stringify({ id: 7, comando: 'enviar_comando_cru', args: { quadro: '(&T04L2A)' } }));
    await new Promise((r) => setTimeout(r, 100));
    const resp = msgs.find((m) => m.id === 7)!;
    expect(resp.ok).toBe(true);
    expect(resp.resultado!.resposta).toBe('(TL040000000084)');
    expect(msgs.filter((m) => m.tipo === 'log').map((m) => m.dados!.dir)).toEqual(['RX', 'TX']);
  });
});

describe('MCP', () => {
  it('lista o catálogo como tools e repassa para a API', async () => {
    const { hub } = await hubCom('cbc-32', true);
    const s = await abrirServidorControle(hub, 0);
    fechar.push(() => s.fechar());
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = criarServidorMcp(s.url);
    await server.connect(st);
    const client = new Client({ name: 'teste', version: '1.0.0' });
    await client.connect(ct);
    fechar.push(() => client.close());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(CATALOGO.map((c) => c.nome).sort());
    expect(tools.find((t) => t.name === 'abastecer')!.inputSchema.properties).toHaveProperty('sim_id');
    const r = (await client.callTool({ name: 'set_preco', arguments: { bico: '04', preco: 4321 } })) as { content: { text: string }[]; isError?: boolean };
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content[0]!.text).pendentes[0]).toBe(4321);
    const ruim = (await client.callTool({ name: 'set_preco', arguments: { preco: 1 } })) as { isError?: boolean; content: { text: string }[] };
    expect(ruim.isError).toBe(true);
    expect(ruim.content[0]!.text).toMatch(/bico: obrigatório/);
  });
});
