import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { CATALOGO, Hub, ManualClock, type PerfilId, abrirServidorControle } from '../src/index.js';

/**
 * Control API additions made for the web UI (§19, U5), exercised over the real HTTP/WS surface:
 * loopback-only rules, schema validation of the new arguments, and that each new operation
 * reaches the simulator. The in-process behavior of the same commands is in ui.test.ts.
 */

const HOST = '127.0.0.1';
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

async function servidor(perfil: PerfilId = 'cbc-32', op: { dirGravacoes?: string } = {}) {
  const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
  const hub = new Hub({ clock, host: HOST, mapa: { 2001: 0, 1771: 0, 857: 0, 7002: 0 }, dirGravacoes: op.dirGravacoes });
  fechar.push(() => hub.fechar());
  const rt = await hub.criar('default', perfil);
  const s = await abrirServidorControle(hub, 0);
  fechar.push(() => s.fechar());
  return { hub, rt, s };
}

type Resp = { ok: boolean; erro?: string; resultado?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const post = async (url: string, cmd: string, args: unknown = {}, headers: Record<string, string> = {}) => {
  const r = await fetch(`${url}/api/comandos/${cmd}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(args) });
  return { status: r.status, json: (await r.json()) as Resp };
};

/** Raw request, to control the Host header (fetch forbids overriding it). */
const bruto = (porta: number, caminho: string, headers: Record<string, string>) =>
  new Promise<{ status: number; corpo: string }>((resolve, reject) => {
    const req = http.request({ host: HOST, port: porta, path: caminho, headers }, (res) => {
      let corpo = '';
      res.on('data', (c) => (corpo += String(c)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo }));
    });
    req.on('error', reject);
    req.end();
  });

describe('API de controle da UI: só loopback', () => {
  it('Host de fora (DNS rebinding) é 403 na UI, na API e no download de gravação', async () => {
    const { s } = await servidor();
    for (const caminho of ['/', '/ui/js/app.js', '/api/servidor', '/api/gravacoes/x.jsonl', '/api/comandos/list_roteiros_diff']) {
      const r = await bruto(s.porta, caminho, { host: 'exemplo.invalid' });
      expect(r.status, caminho).toBe(403);
      expect(r.corpo).toContain('host recusado');
    }
    const ok = await bruto(s.porta, '/api/servidor', { host: `localhost:${s.porta}` });
    expect(ok.status).toBe(200);
  });

  it('Origin de fora é 403 também nas rotas novas e nos comandos que escrevem', async () => {
    const { s } = await servidor();
    for (const caminho of ['/api/servidor', '/api/gravacoes/x.jsonl']) {
      expect((await fetch(`${s.url}${caminho}`, { headers: { origin: 'https://exemplo.invalid' } })).status, caminho).toBe(403);
    }
    const r = await post(s.url, 'limpar_buffer', {}, { origin: 'https://exemplo.invalid' });
    expect(r.status).toBe(403);
    // A loopback origin (the UI's own page) passes.
    expect((await post(s.url, 'limpar_buffer', {}, { origin: s.url })).status).toBe(200);
  });

  it('o WebSocket recusa o upgrade de Origin de fora e aceita o da própria UI', async () => {
    const { s } = await servidor();
    const ws = (origin: string) => new WebSocket(`${s.url.replace('http', 'ws')}/ws`, { headers: { origin } });
    const fora = ws('https://exemplo.invalid');
    const erro = await new Promise<string>((r) => {
      fora.on('error', (e) => r(e.message));
      fora.on('open', () => r('abriu'));
    });
    expect(erro).not.toBe('abriu');
    const dentro = ws(s.url);
    fechar.push(() => dentro.close());
    const ola = await new Promise<{ tipo: string }>((r) => dentro.once('message', (m) => r(JSON.parse(String(m)) as { tipo: string })));
    expect(ola.tipo).toBe('ola');
  });

  it('o download de gravação só serve nomes simples .jsonl da pasta de gravações', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-sim-api-'));
    fechar.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'a.jsonl'), '{"x":1}\n');
    fs.writeFileSync(path.join(dir, 'segredo.txt'), 'nao');
    const { s } = await servidor('cbc-32', { dirGravacoes: dir });
    const a = await fetch(`${s.url}/api/gravacoes/a.jsonl`);
    expect(a.status).toBe(200);
    expect(a.headers.get('content-type')).toContain('ndjson');
    expect(await a.text()).toBe('{"x":1}\n');
    for (const nome of ['segredo.txt', '..%2f..%2fetc%2fpasswd.jsonl', '%2e%2e%2fa.jsonl', 'sub%2fa.jsonl']) {
      expect((await fetch(`${s.url}/api/gravacoes/${nome}`)).status, nome).toBe(404);
    }
  });
});

describe('API de controle da UI: validação dos argumentos novos', () => {
  it('cada argumento novo está no catálogo com o tipo certo', () => {
    const props = (nome: string) => (CATALOGO.find((c) => c.nome === nome)!.params as { properties: Record<string, { type?: string; enum?: string[] }> }).properties;
    expect(props('list_abastecimentos').com_quadro?.type).toBe('boolean');
    expect(props('gravar_inicio').na_pasta?.type).toBe('boolean');
    expect(props('gravar_encerrante').painel?.type).toBe('boolean');
    expect(props('diff_executar').drenar_antes?.type).toBe('boolean');
    expect(props('diff_executar').tipo_controle_a?.enum).toEqual(['driver', 'pump-sim']);
    expect(props('diff_executar').tipo_controle_b?.enum).toEqual(['driver', 'pump-sim']);
    expect(props('enviar_pela_porta').timeout_ms?.type).toBe('integer');
  });

  it('argumento de tipo errado ou desconhecido vira 400 com o caminho do campo, sem tocar no simulador', async () => {
    const { s, rt } = await servidor();
    const escrita = rt.sim.conc.buffer.escrita;
    const casos: [string, unknown, RegExp][] = [
      ['list_abastecimentos', { com_quadro: 'sim' }, /com_quadro: deve ser boolean/],
      ['gravar_inicio', { na_pasta: 1 }, /na_pasta: deve ser boolean/],
      ['gravar_encerrante', { bico: '04', valor: 1000, painel: 'x' }, /painel: deve ser boolean/],
      ['enviar_pela_porta', {}, /quadro: obrigatório/],
      ['enviar_pela_porta', { quadro: '(&S)', timeout_ms: 0 }, /timeout_ms: mínimo 1/],
      ['enviar_pela_porta', { quadro: '(&S)', timeout_ms: 1.5 }, /timeout_ms: deve ser integer/],
      ['limpar_buffer', { qualquer: 1 }, /parâmetro desconhecido/],
      ['list_roteiros_diff', { id: 'DIFF-01' }, /parâmetro desconhecido/],
      ['list_gravacoes', { dir: 7 }, /dir: deve ser string/],
      ['diff_executar', { roteiro: 'DIFF-01', alvo_a: 'a:1', alvo_b: 'b:2', tipo_controle_a: 'outro' }, /tipo_controle_a: deve ser um de/],
      ['diff_executar', { roteiro: 'DIFF-01', alvo_a: 'a:1', alvo_b: 'b:2', drenar_antes: 'sim' }, /drenar_antes: deve ser boolean/],
      ['diff_executar', { roteiro: 'DIFF-01', alvo_a: 'a:1' }, /alvo_b: obrigatório/],
    ];
    for (const [cmd, args, re] of casos) {
      const r = await post(s.url, cmd, args);
      expect(r.status, cmd).toBe(400);
      expect(r.json.ok).toBe(false);
      expect(r.json.erro, cmd).toMatch(re);
    }
    expect(rt.sim.conc.buffer.escrita).toBe(escrita);
    expect(rt.gravador).toBeNull();
  });

  it('GET só vale para comandos de leitura: os novos que escrevem pedem POST (405), os de leitura aceitam GET', async () => {
    const { s } = await servidor();
    for (const cmd of ['limpar_buffer', 'enviar_pela_porta', 'gravar_inicio']) {
      expect((await fetch(`${s.url}/api/comandos/${cmd}`)).status, cmd).toBe(405);
    }
    const r = await fetch(`${s.url}/api/comandos/list_roteiros_diff`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as Resp;
    expect(j.resultado.casos.length).toBeGreaterThan(20);
    expect((await fetch(`${s.url}/api/comandos/list_gravacoes`)).status).toBe(200);
  });

  it('POST sem content-type JSON é 415 e corpo que não é objeto é 400', async () => {
    const { s } = await servidor();
    const sem = await fetch(`${s.url}/api/comandos/limpar_buffer`, { method: 'POST', body: '{}' });
    expect(sem.status).toBe(415);
    const lista = await fetch(`${s.url}/api/comandos/limpar_buffer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]' });
    expect(lista.status).toBe(400);
  });
});

describe('API de controle da UI: cada operação nova chega ao simulador', () => {
  it('limpar_buffer, list_abastecimentos com_quadro e gravar_encerrante painel pelo HTTP', async () => {
    const { s } = await servidor('simulador-2.7.2');
    await post(s.url, 'gerar_abastecimentos', { bico: '04', quantidade: 2, volume: 5000 });
    const lista = await post(s.url, 'list_abastecimentos', { com_quadro: true });
    expect(lista.json.resultado.registros).toHaveLength(2);
    expect(lista.json.resultado.registros[0].quadro).toMatch(/^\([0-9A-F]{50}\)$/);
    const zero = await post(s.url, 'limpar_buffer');
    expect(zero.status).toBe(200);
    expect((await post(s.url, 'list_abastecimentos')).json.resultado.total).toBe(0);
    const painel = await post(s.url, 'gravar_encerrante', { bico: '05', valor: 2_000_000, painel: true });
    expect(painel.status).toBe(200);
    const apos = await post(s.url, 'list_abastecimentos');
    expect(apos.json.resultado.registros).toEqual([expect.objectContaining({ volumeMl: 0, encFimMl: 2_000_000 })]);
  });

  it('enviar_pela_porta pelo HTTP: porta fechada ou sem servidor é 409 e o o quadro passa pela porta pedida', async () => {
    const { s } = await servidor('cbc-32');
    await post(s.url, 'gerar_abastecimentos', { bico: '04', quantidade: 1 });
    const r = await post(s.url, 'enviar_pela_porta', { quadro: '(&S)', porta: 1771 });
    expect(r.status).toBe(200);
    expect(r.json.resultado).toMatchObject({ porta: 1771, caiu: false });
    expect(r.json.resultado.resposta).toMatch(/^\(S/);
    const fechada = await post(s.url, 'enviar_pela_porta', { quadro: '(&S)', porta: 9 });
    expect(fechada.status).toBe(409);
    expect(fechada.json.erro).toMatch(/não está aberta/);
    const sem = await servidor('cbc-32');
    sem.hub.obter('default').servidor = null;
    const r2 = await post(sem.s.url, 'enviar_pela_porta', { quadro: '(&S)' });
    expect(r2.status).toBe(409);
    expect(r2.json.erro).toMatch(/sem servidor TCP/);
  });

  it('gravar_inicio na_pasta + gravar_fim + list_gravacoes + download, de ponta a ponta pelo HTTP', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-sim-api-'));
    fechar.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const { s } = await servidor('cbc-32', { dirGravacoes: dir });
    const ini = await post(s.url, 'gravar_inicio', { na_pasta: true });
    expect(ini.status).toBe(200);
    await post(s.url, 'enviar_pela_porta', { quadro: '(&S)' });
    await post(s.url, 'gravar_fim');
    const l = await post(s.url, 'list_gravacoes');
    expect(l.json.resultado.gravacoes).toHaveLength(1);
    const nome = l.json.resultado.gravacoes[0].nome as string;
    expect(l.json.resultado.gravacoes[0].quadros).toBe(2);
    const baixado = await (await fetch(`${s.url}/api/gravacoes/${nome}`)).text();
    expect(baixado.trim().split('\n').length).toBeGreaterThanOrEqual(3);
    expect(fs.readFileSync(path.join(dir, nome), 'utf8')).toBe(baixado);
  });

  it('list_gravacoes devolve erro por arquivo corrompido sem derrubar a lista', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-sim-api-'));
    fechar.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'quebrada.jsonl'), 'isto não é json\n');
    fs.writeFileSync(path.join(dir, 'ignorado.txt'), 'x');
    const { s } = await servidor('cbc-32', { dirGravacoes: dir });
    const l = await post(s.url, 'list_gravacoes');
    expect(l.status).toBe(200);
    expect(l.json.resultado.gravacoes.map((g: { nome: string }) => g.nome)).toEqual(['quebrada.jsonl']);
    expect(l.json.resultado.gravacoes[0].erro).toBeTruthy();
  });

  it('diff_executar com controle_a/b e drenar_antes: argumentos válidos passam pela validação até o executor', async () => {
    const { s } = await servidor('cbc-32');
    // Targets that cannot be reached: the validation must pass and the failure must come from the run,
    // not from "parâmetro desconhecido".
    const r = await post(s.url, 'diff_executar', {
      roteiro: 'DIFF-01', alvo_a: '127.0.0.1:1', alvo_b: '127.0.0.1:1', timeout_ms: 50,
      controle_a: 'http://127.0.0.1:1', controle_b: 'http://127.0.0.1:1', tipo_controle_a: 'pump-sim', tipo_controle_b: 'driver', drenar_antes: true,
    });
    expect(r.json.erro ?? '').not.toMatch(/parâmetro desconhecido|deve ser/);
  });

  it('a origem e o cliente enviados nos cabeçalhos entram em /api/servidor; chamadas da UI (WS origem ui) não', async () => {
    const { s } = await servidor('cbc-32');
    await post(s.url, 'get_relogio', {}, { 'x-pump-sim-origem': 'mcp', 'x-pump-sim-cliente': 'c'.repeat(200) });
    await post(s.url, 'get_status', {}, { 'x-pump-sim-origem': 'ui' });
    await post(s.url, 'retirar_bico', { bico: '3F' }, {});
    const j = (await (await fetch(`${s.url}/api/servidor`)).json()) as Resp;
    const ch = j.resultado.chamadas as { origem: string; cliente: string | null; comando: string; ok: boolean }[];
    expect(ch.map((c) => [c.origem, c.comando, c.ok])).toEqual([
      ['http', 'retirar_bico', false],
      ['mcp', 'get_relogio', true],
    ]);
    expect(ch[1]!.cliente).toHaveLength(80);
    expect(j.resultado.mcp.cliente).toHaveLength(80);
  });

  it('o buffer de chamadas guarda só as 50 mais recentes', async () => {
    const { s } = await servidor('cbc-32');
    for (let i = 0; i < 55; i++) await post(s.url, 'set_preco', { bico: '04', preco: 1000 + i });
    const j = (await (await fetch(`${s.url}/api/servidor`)).json()) as Resp;
    expect(j.resultado.chamadas).toHaveLength(50);
    expect(j.resultado.chamadas[0].args).toContain('1054');
  });
});
