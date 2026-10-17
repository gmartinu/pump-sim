import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  Hub,
  LEGENDAS_EM_REPOUSO,
  ManualClock,
  type PerfilId,
  ROTEIROS,
  abrirServidorControle,
  checksum,
  criarServidorMcp,
  executarComando,
} from '../src/index.js';
import { iconesUi, lerWoff2, ligaturas, preenchidos } from '../tools/fonte-icones.mjs';
import { dirUi, lerAssetUi } from '../src/ui/assets.js';

/**
 * Web UI (ui/) and the control API additions it uses (§19 of docs/DECISIONS.md): static serving
 * under the same loopback rules, the new commands, the live traffic stream and the agents panel.
 */

const HOST = '127.0.0.1';
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

async function hubCom(perfil: PerfilId, op: { semTcp?: boolean; dirGravacoes?: string } = {}) {
  const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
  const hub = new Hub({ clock, host: HOST, mapa: { 2001: 0, 1771: 0, 857: 0, 7002: 0 }, semTcp: op.semTcp, dirGravacoes: op.dirGravacoes });
  fechar.push(() => hub.fechar());
  const rt = await hub.criar('default', perfil);
  return { hub, rt, clock };
}

async function comServidor(perfil: PerfilId = 'simulador-2.7.2', op: { dirGravacoes?: string } = {}) {
  const x = await hubCom(perfil, op);
  const s = await abrirServidorControle(x.hub, 0);
  fechar.push(() => s.fechar());
  return { ...x, s };
}

const cmd = <T = Record<string, unknown>>(hub: Hub, nome: string, args: Record<string, unknown> = {}) => executarComando(hub, nome, args) as Promise<T>;

describe('UI estática servida pela API de controle', () => {
  it('GET / e /ui/* devolvem os arquivos com tipo, CSP e nosniff', async () => {
    const { s } = await comServidor();
    const raiz = await fetch(`${s.url}/`);
    expect(raiz.status).toBe(200);
    expect(raiz.headers.get('content-type')).toMatch(/^text\/html/);
    expect(raiz.headers.get('x-content-type-options')).toBe('nosniff');
    expect(raiz.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(raiz.headers.get('access-control-allow-origin')).toBeNull();
    expect(await raiz.text()).toContain('/ui/js/app.js');
    const js = await fetch(`${s.url}/ui/js/app.js`);
    expect(js.headers.get('content-type')).toMatch(/^text\/javascript/);
    const css = await fetch(`${s.url}/ui/tokens.css`);
    expect(css.headers.get('content-type')).toMatch(/^text\/css/);
  });

  it('a UI não sai do loopback: fontes locais, CSP sem origem externa, nenhuma URL http(s) nos arquivos', async () => {
    const { s } = await comServidor();
    const csp = (await fetch(`${s.url}/`)).headers.get('content-security-policy') ?? '';
    expect(csp).not.toMatch(/https?:/);
    expect(csp).toContain("font-src 'self'");
    const fontesCss = fs.readFileSync(path.join(dirUi(), 'fonts.css'), 'utf8');
    const urls = [...fontesCss.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      const r = await fetch(`${s.url}/ui/${u}`);
      expect(r.status, u).toBe(200);
      expect(r.headers.get('content-type')).toBe('font/woff2');
    }
    const textos = fs
      .readdirSync(dirUi(), { recursive: true })
      .map(String)
      .filter((f) => /\.(?:html|js|css)$/.test(f));
    for (const f of textos) {
      const t = fs.readFileSync(path.join(dirUi(), f), 'utf8');
      // Only placeholder/help text may mention a URL scheme; nothing the page loads.
      expect(t, f).not.toMatch(/(?:@import|src=|href=|url\()\s*["']?https?:/);
      expect(t, f).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/);
    }
  });

  it('a fonte de ícones é o subconjunto e tem todo ícone que a UI usa (DECISIONS §30)', () => {
    // The UI serves the subset, never the full ~3 MB font (tools/fonts/, the subset's source).
    const fontesCss = fs.readFileSync(path.join(dirUi(), 'fonts.css'), 'utf8');
    expect(fontesCss).toContain('url("fonts/material-symbols-rounded-subset.woff2")');
    for (const f of fs.readdirSync(path.join(dirUi(), 'fonts'))) expect(fs.statSync(path.join(dirUi(), 'fonts', f)).size, f).toBeLessThan(200_000);
    expect(fs.existsSync(path.join(dirUi(), 'fonts', 'LICENSES.txt'))).toBe(true);
    const cheia = lerWoff2(fs.readFileSync(new URL('../tools/fonts/material-symbols-rounded.woff2', import.meta.url)));
    const sub = lerWoff2(fs.readFileSync(path.join(dirUi(), 'fonts', 'material-symbols-rounded-subset.woff2')));
    const [ligCheia, ligSub] = [ligaturas(cheia), ligaturas(sub)];
    const [fillCheia, fillSub] = [preenchidos(cheia), preenchidos(sub)];
    const { estaticos, candidatos } = iconesUi(dirUi());
    // Every literal `.ms` text is an icon (a typo renders as text), and the dynamic ones are found.
    expect(estaticos.size).toBeGreaterThan(40);
    expect([...estaticos].filter((n) => !ligCheia.has(n))).toEqual([]);
    const usados = new Set([...estaticos, ...[...candidatos].filter((n) => ligCheia.has(n))]);
    for (const n of ['light_mode', 'dark_mode', 'back_hand', 'pan_tool_alt', 'radio_button_unchecked', 'local_gas_station', 'smart_toy']) expect(usados.has(n), n).toBe(true);
    // Each used icon resolves to a glyph in the subset, and its filled form too when the full font has one.
    expect([...usados].filter((n) => !ligSub.has(n))).toEqual([]);
    expect([...usados].filter((n) => fillCheia.has(ligCheia.get(n)!) && !fillSub.has(ligSub.get(n)!))).toEqual([]);
    // The check tells a kept icon from a dropped one: an icon the UI does not use is not in the subset.
    expect(ligCheia.has('rocket_launch') && !usados.has('rocket_launch')).toBe(true);
    expect(ligSub.has('rocket_launch')).toBe(false);
  });

  it('não sai da pasta ui/ e recusa Origin de fora também na UI', async () => {
    const { s } = await comServidor();
    expect((await fetch(`${s.url}/ui/%2e%2e/package.json`)).status).toBe(404);
    expect((await fetch(`${s.url}/ui/js/nao-existe.js`)).status).toBe(404);
    expect(lerAssetUi('../package.json')).toBeNull();
    expect(lerAssetUi('/etc/passwd')).toBeNull();
    expect(lerAssetUi('js/app.ts')).toBeNull();
    const r = await fetch(`${s.url}/`, { headers: { origin: 'https://exemplo.invalid' } });
    expect(r.status).toBe(403);
  });

  it('todo import relativo dos módulos da UI existe (a página não quebra por arquivo faltando)', () => {
    const dir = path.join(dirUi(), 'js');
    const arquivos = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.js'));
    expect(arquivos.length).toBeGreaterThanOrEqual(13);
    for (const f of arquivos) {
      const txt = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of txt.matchAll(/from '(\.[^']+)'/g)) {
        expect(fs.existsSync(path.resolve(dir, path.dirname(f), m[1]!)), `${f} → ${m[1]!}`).toBe(true);
      }
    }
    const html = fs.readFileSync(path.join(dirUi(), 'index.html'), 'utf8');
    for (const m of html.matchAll(/(?:href|src)="\/ui\/([^"]+)"/g)) expect(lerAssetUi(m[1]!), m[1]!).not.toBeNull();
  });
});

describe('helpers de exibição da UI (ui/js/fmt.js) batem com o simulador', () => {
  const carregar = async () => (await import(pathToFileURL(path.join(dirUi(), 'js', 'fmt.js')).href)) as Record<string, (...a: unknown[]) => unknown> & { LEGENDAS_EM_REPOUSO: string[] };

  it('o KK da prévia é o checksum do protocolo e as legendas em repouso são as do driver', async () => {
    const fmt = await carregar();
    for (const corpo of ['&T99P', '&U04006290', 'TG9901770176', '?A']) expect(fmt.kk!(corpo)).toBe(checksum(corpo));
    expect(fmt.LEGENDAS_EM_REPOUSO).toEqual([...LEGENDAS_EM_REPOUSO]);
    expect(fmt.numTxt!('1234.56')).toBe('1.234,56');
    expect(fmt.lerNum!('6,390')).toBe(6.39);
    expect(fmt.classeKK!('(&T99P3C)', 'rx')).toBe('ok');
    expect(fmt.classeKK!('(&T08L2e)', 'rx')).toBe('bad');
    expect(fmt.classeKK!('(&S)', 'rx')).toBe('na');
  });

  it('a decodificação do &A 52 confere com o registro estruturado', async () => {
    const fmt = await carregar();
    const { hub } = await hubCom('cbc-32', { semTcp: true });
    await cmd(hub, 'gerar_abastecimentos', { bico: '04', quantidade: 1, volume: 12340 });
    const r = await cmd<{ registros: { quadro: string; volumeMl: number; codigoBico: number; numero: number }[] }>(hub, 'list_abastecimentos', { com_quadro: true });
    const reg = r.registros[0]!;
    const campos = new Map(fmt.decodificarA52!(reg.quadro) as [string, string][]);
    expect(campos.get('B bico')).toBe('04');
    expect(campos.get('L volume')).toMatch(/12,34/);
    expect(campos.get('R registro')).toBe(String(reg.numero).padStart(4, '0'));
    expect(campos.get('KK')).toMatch(/confere$/);
    expect(campos.get('KK')).not.toMatch(/não confere/);
  });
});

describe('comandos novos da API de controle', () => {
  it('list_abastecimentos com_quadro traz o mesmo quadro do get_abastecimento; limpar_buffer zera escrita e leitura', async () => {
    const { hub } = await hubCom('simulador-2.7.2', { semTcp: true });
    await cmd(hub, 'gerar_abastecimentos', { bico: '08', quantidade: 3 });
    const lista = await cmd<{ registros: { posicao: number; quadro: string; formato: string }[] }>(hub, 'list_abastecimentos', { com_quadro: true });
    expect(lista.registros).toHaveLength(3);
    for (const r of lista.registros) {
      const um = await cmd<{ quadro: string; formato: string }>(hub, 'get_abastecimento', { posicao: r.posicao });
      expect(r.quadro).toBe(um.quadro);
      expect(r.formato).toBe(um.formato);
    }
    expect((await cmd<{ registros: object[] }>(hub, 'list_abastecimentos')).registros[0]).not.toHaveProperty('quadro');
    const z = await cmd<{ escrita: number }>(hub, 'limpar_buffer');
    expect(z.escrita).toBe(1);
    expect((await cmd<{ total: number }>(hub, 'list_abastecimentos')).total).toBe(0);
    const p = await cmd<{ escrita: number; leitura: Record<string, number> }>(hub, 'get_ponteiros');
    expect(p.escrita).toBe(1);
    expect(Object.values(p.leitura).every((v) => v === 1)).toBe(true);
  });

  it('list_roteiros_diff lista o roteiro inteiro', async () => {
    const { hub } = await hubCom('cbc-32', { semTcp: true });
    const r = await cmd<{ casos: { id: string; passos: number }[] }>(hub, 'list_roteiros_diff');
    expect(r.casos.map((c) => c.id)).toEqual(ROTEIROS.map((c) => c.id));
  });

  it('list_cartoes traz a classe e a lista negra de cada cartão', async () => {
    const { hub } = await hubCom('cbc-32', { semTcp: true });
    await cmd(hub, 'gravar_cartao', { codigo: '00000000000000AA', tipo: 7, permissao: 2 });
    await cmd(hub, 'gravar_cartao', { codigo: '00000000000000BB', tipo: 0xd, permissao: 2 });
    await cmd(hub, 'lista_negra', { acao: 'poe', codigo: '00000000000000BB' });
    const r = await cmd<{ cartoes: { cartao: { codigo: string }; classe: string; listaNegra: boolean }[] }>(hub, 'list_cartoes');
    expect(r.cartoes.map((c) => [c.cartao.codigo, c.classe, c.listaNegra])).toEqual([
      ['00000000000000AA', 'funcionario', false],
      ['00000000000000BB', 'gerente', true],
    ]);
  });

  it('gravar_encerrante painel: no 2.7.2 é o botão Gravar totais (registro de volume zero); Dinheiro não grava', async () => {
    const { hub } = await hubCom('simulador-2.7.2', { semTcp: true });
    await cmd(hub, 'gravar_encerrante', { bico: '04', valor: 1_000_000, painel: true });
    const lista = await cmd<{ registros: { volumeMl: number; encFimMl: number }[] }>(hub, 'list_abastecimentos');
    expect(lista.registros).toHaveLength(1);
    expect(lista.registros[0]).toMatchObject({ volumeMl: 0, encFimMl: 1_000_000 });
    await expect(cmd(hub, 'gravar_encerrante', { bico: '04', valor: 5000, unidade: 'valor', painel: true })).rejects.toMatchObject({ status: 409 });
    // Without `painel` (and on the real profiles) the old command is unchanged: no record.
    await cmd(hub, 'gravar_encerrante', { bico: '05', valor: 2000 });
    expect((await cmd<{ total: number }>(hub, 'list_abastecimentos')).total).toBe(1);
    const real = await hubCom('cbc-32', { semTcp: true });
    await cmd(real.hub, 'gravar_encerrante', { bico: '04', valor: 1_000_000, painel: true });
    expect((await cmd<{ total: number }>(real.hub, 'list_abastecimentos')).total).toBe(0);
  });

  it('enviar_pela_porta usa uma conexão TCP de verdade: mexe no ponteiro daquela porta', async () => {
    const { hub } = await hubCom('cbc-32');
    await cmd(hub, 'gerar_abastecimentos', { bico: '04', quantidade: 2 });
    const st = await cmd<{ resposta: string; porta: number; latenciaMs: number | null }>(hub, 'enviar_pela_porta', { quadro: '(&S)', porta: 1771 });
    expect(st.resposta).toMatch(/^\(S/);
    expect(st.porta).toBe(1771);
    await cmd(hub, 'enviar_pela_porta', { quadro: '(&I)', porta: 1771, timeout_ms: 200 });
    const p = await cmd<{ leitura: Record<string, number> }>(hub, 'get_ponteiros');
    expect(p.leitura['tcp:1771']).toBe(1);
    expect(p.leitura['tcp:2001']).toBe(0);
    await expect(cmd(hub, 'enviar_pela_porta', { quadro: '(&S)', porta: 7002 })).rejects.toMatchObject({ status: 409 });
  });

  it('gravar_inicio na_pasta + list_gravacoes, e o estado mostra a gravação em curso', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-sim-grav-'));
    fechar.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const { hub, rt } = await hubCom('cbc-32', { dirGravacoes: path.join(dir, 'sub') });
    const ini = await cmd<{ arquivo: string }>(hub, 'gravar_inicio', { na_pasta: true });
    expect(path.dirname(ini.arquivo)).toBe(path.join(dir, 'sub'));
    expect(path.basename(ini.arquivo)).toMatch(/^trafego-2026-10-16T14-30-00\.jsonl$/);
    await cmd(hub, 'enviar_pela_porta', { quadro: '(&S)' });
    const e = await cmd<{ gravacao: { arquivo: string; quadros: number; bytes: number; inicio: number } }>(hub, 'get_estado_simulador');
    expect(e.gravacao.arquivo).toBe(ini.arquivo);
    expect(e.gravacao.quadros).toBe(2);
    expect(e.gravacao.bytes).toBeGreaterThan(4);
    await cmd(hub, 'gravar_fim');
    expect(rt.gravador).toBeNull();
    const l = await cmd<{ existe: boolean; gravacoes: { nome: string; perfil: string; quadros: number }[] }>(hub, 'list_gravacoes');
    expect(l.existe).toBe(true);
    expect(l.gravacoes).toEqual([expect.objectContaining({ nome: path.basename(ini.arquivo), perfil: 'cbc-32', quadros: 2 })]);
    expect((await cmd<{ existe: boolean }>(hub, 'list_gravacoes', { dir: path.join(dir, 'nao-existe') })).existe).toBe(false);
  });

  it('a gravação baixa por GET /api/gravacoes/<nome>.jsonl, só de dentro da pasta', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-sim-grav-'));
    fechar.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const { hub, s } = await comServidor('cbc-32', { dirGravacoes: dir });
    const ini = await cmd<{ arquivo: string }>(hub, 'gravar_inicio', { na_pasta: true });
    await cmd(hub, 'gravar_fim');
    const r = await fetch(`${s.url}/api/gravacoes/${path.basename(ini.arquivo)}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('attachment');
    expect(await r.text()).toContain('pump-sim/trafego@1');
    expect((await fetch(`${s.url}/api/gravacoes/..%2fx.jsonl`)).status).toBe(404);
    expect((await fetch(`${s.url}/api/gravacoes/nada.jsonl`)).status).toBe(404);
  });
});

describe('porta ocupada (EADDRINUSE)', () => {
  const ocupar = async (): Promise<{ porta: number; liberar: () => Promise<void> }> => {
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, HOST, r));
    const porta = (srv.address() as net.AddressInfo).port;
    return { porta, liberar: () => new Promise<void>((r) => srv.close(() => r())) };
  };

  it('abrir_porta que falha fica em erroPorta; tentar de novo depois de liberar limpa', async () => {
    const o = await ocupar();
    const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
    const hub = new Hub({ clock, host: HOST, mapa: { 2001: 0, 1771: o.porta } });
    fechar.push(() => hub.fechar());
    await hub.criar('default', 'simulador-2.7.2');
    await expect(cmd(hub, 'abrir_porta', { porta: 1771 })).rejects.toMatchObject({ status: 409 });
    let e = await cmd<{ erroPorta: { porta: number; codigo: string } | null; portas: unknown[] }>(hub, 'get_estado_simulador');
    expect(e.erroPorta).toMatchObject({ porta: 1771, codigo: 'EADDRINUSE' });
    expect(e.portas).toEqual([]);
    await o.liberar();
    await cmd(hub, 'abrir_porta', { porta: 1771 });
    e = await cmd(hub, 'get_estado_simulador');
    expect(e.erroPorta).toBeNull();
    expect(e.portas).toEqual([{ logica: 1771, fisica: o.porta }]);
  });

  it('tolerarPortaOcupada: a partida não aborta, o simulador roda sem porta e abre depois', async () => {
    const o = await ocupar();
    const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
    const hub = new Hub({ clock, host: HOST, mapa: { 2001: o.porta } });
    fechar.push(() => hub.fechar());
    await expect(hub.criar('x', 'simulador-2.7.2')).rejects.toMatchObject({ code: 'EADDRINUSE' });
    const rt = await hub.criar('default', 'simulador-2.7.2', undefined, { tolerarPortaOcupada: true });
    expect(rt.erroPorta).toMatchObject({ porta: 2001, codigo: 'EADDRINUSE' });
    expect(rt.servidor?.portas()).toEqual([]);
    await o.liberar();
    await cmd(hub, 'abrir_porta', { porta: 2001 });
    expect(rt.servidor?.portas()).toEqual([{ logica: 2001, fisica: o.porta }]);
    expect(rt.erroPorta).toBeNull();
  });
});

describe('eventos ao vivo e painel de agentes', () => {
  it('o WS empurra trafego (com a conexão) e falha quando uma regra dispara', async () => {
    const { hub, s } = await comServidor('cbc-32');
    const ws = new WebSocket(`${s.url.replace('http', 'ws')}/ws`, { headers: { origin: s.url } });
    fechar.push(() => ws.close());
    const msgs: { tipo: string; dados: Record<string, unknown> }[] = [];
    ws.on('message', (m) => msgs.push(JSON.parse(String(m)) as (typeof msgs)[number]));
    await new Promise((r) => ws.once('open', r));
    await cmd(hub, 'injetar_falha', { tipo: 'atraso', verbo: '&S', param: { ms: 10 } });
    await cmd(hub, 'enviar_pela_porta', { quadro: '(&S)', porta: 2001 });
    for (let i = 0; i < 50 && !msgs.some((m) => m.tipo === 'trafego' && m.dados.dir === 'tx'); i++) await new Promise((r) => setTimeout(r, 20));
    const tr = msgs.filter((m) => m.tipo === 'trafego');
    expect(tr.map((m) => m.dados.dir)).toEqual(expect.arrayContaining(['abre', 'rx', 'tx']));
    const rx = tr.find((m) => m.dados.dir === 'rx')!;
    expect(rx.dados).toMatchObject({ porta: 2001, texto: '(&S)' });
    expect(typeof rx.dados.conexao).toBe('number');
    const f = msgs.find((m) => m.tipo === 'falha');
    expect(f?.dados).toMatchObject({ porta: 2001, quadro: '(&S)', regra: { tipo: 'atraso', verbo: '&S' } });
  });

  it('/api/servidor lista as chamadas de MCP/HTTP/WS com a origem, sem as da própria UI', async () => {
    const { s } = await comServidor('cbc-32');
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = criarServidorMcp(s.url);
    await server.connect(st);
    const client = new Client({ name: 'agente-teste', version: '1.0.0' });
    await client.connect(ct);
    fechar.push(() => client.close());
    await client.callTool({ name: 'set_preco', arguments: { bico: '04', preco: 4321 } });
    await client.callTool({ name: 'retirar_bico', arguments: { bico: '3F' } });
    const ws = new WebSocket(`${s.url.replace('http', 'ws')}/ws`, { headers: { origin: s.url } });
    fechar.push(() => ws.close());
    await new Promise((r) => ws.once('open', r));
    const resp = (id: number) => new Promise<void>((r) => ws.on('message', (m) => (JSON.parse(String(m)) as { id?: number }).id === id && r()));
    const p1 = resp(1);
    ws.send(JSON.stringify({ id: 1, comando: 'get_status', origem: 'ui' }));
    await p1;
    const p2 = resp(2);
    ws.send(JSON.stringify({ id: 2, comando: 'get_relogio' }));
    await p2;
    const r = (await (await fetch(`${s.url}/api/servidor`)).json()) as {
      resultado: { wsClientes: number; mcp: { cliente: string } | null; chamadas: { origem: string; cliente: string | null; comando: string; ok: boolean; resumo: string }[] };
    };
    const ch = r.resultado.chamadas;
    expect(ch.map((c) => [c.origem, c.comando, c.ok])).toEqual([
      ['ws', 'get_relogio', true],
      ['mcp', 'retirar_bico', false],
      ['mcp', 'set_preco', true],
    ]);
    expect(ch[1]!.resumo).toMatch(/^404 · /);
    expect(ch[2]!.cliente).toBe('agente-teste');
    expect(r.resultado.mcp?.cliente).toBe('agente-teste');
    expect(r.resultado.wsClientes).toBe(1);
  });
});
