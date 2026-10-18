import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClienteTcp,
  Hub,
  InjetorFalhas,
  ManualClock,
  type PerfilId,
  ServidorReplay,
  executarComando,
  lerGravacao,
  replayCliente,
  trocas,
} from '../src/index.js';
import { kk } from './util.js';

const EFEMERAS = { 2001: 0, 1771: 0, 857: 0, 7002: 0 };
const HOST = '127.0.0.1';
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

async function novo(perfil: PerfilId = 'simulador-2.7.2', gravar?: string) {
  const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
  const hub = new Hub({ clock, host: HOST, mapa: EFEMERAS });
  fechar.push(() => hub.fechar());
  const rt = await hub.criar('default', perfil, undefined, { gravar });
  const cmd = <T = Record<string, unknown>>(nome: string, args: Record<string, unknown> = {}) => executarComando(hub, nome, args) as Promise<T>;
  const conectar = async (logica = rt.servidor!.portas()[0]!.logica) => {
    const c = await ClienteTcp.conectar({ host: HOST, porta: rt.servidor!.fisica(logica)! });
    fechar.push(() => c.fechar());
    return c;
  };
  return { hub, rt, cmd, conectar, clock };
}

const txt = async (c: ClienteTcp, q: string | string[], timeoutMs = 150) => (await c.trocar(Array.isArray(q) ? q : [q], { timeoutMs, ociosoMs: 40 })).bytes.toString('latin1');

describe('injeção de falhas no TCP', () => {
  it('sem_resposta só uma vez (padrão vezes=1), e o comando é aplicado', async () => {
    const { cmd, conectar } = await novo('cbc-32');
    const c = await conectar();
    await cmd('injetar_falha', { tipo: 'sem_resposta', verbo: '&M' });
    expect(await txt(c, kk('&M04B'))).toBe('');
    expect(await txt(c, '(&S)')).toMatch(/^\(SB/);
    expect(await txt(c, kk('&M04L'))).toBe('(M04)');
  });

  it('atraso, checksum_errado, truncado, frame_corrompido, resposta_dupla, erro', async () => {
    const { cmd, conectar } = await novo();
    const c = await conectar();
    const base = await txt(c, '(&T04L2A)');
    expect(base).toBe('(TL040000000084)');
    await cmd('injetar_falha', { tipo: 'atraso', verbo: '&T', param: { ms: 120 } });
    const t = await c.trocar(['(&T04L2A)'], { timeoutMs: 400, ociosoMs: 40 });
    expect(t.bytes.toString('latin1')).toBe(base);
    expect(t.latenciaMs).toBeGreaterThanOrEqual(100);
    await cmd('injetar_falha', { tipo: 'checksum_errado', verbo: '&T' });
    const ck = await txt(c, '(&T04L2A)');
    expect(ck.slice(0, -3)).toBe(base.slice(0, -3));
    expect(ck.slice(-3, -1)).not.toBe('84');
    await cmd('injetar_falha', { tipo: 'truncado', verbo: '&T', param: { bytes: 3 } });
    expect(await txt(c, '(&T04L2A)')).toBe(base.slice(0, -3));
    await cmd('injetar_falha', { tipo: 'frame_corrompido', verbo: '&T', param: { bytes: 2 } });
    const fc = await txt(c, '(&T04L2A)');
    expect(fc).toHaveLength(base.length);
    expect(fc).toContain('##');
    await cmd('injetar_falha', { tipo: 'resposta_dupla', verbo: '&T' });
    expect(await txt(c, '(&T04L2A)')).toBe(base + base);
    await cmd('injetar_falha', { tipo: 'erro', verbo: '&T', param: { codigo: '?b' } });
    // DECISIONS §36: the erro frame carries the verb letter, like the codec's own errors.
    expect(await txt(c, '(&T04L2A)')).toBe('(T?b)');
    expect(await txt(c, '(&T04L2A)')).toBe(base);
  });

  it('fragmentar entrega a resposta em vários writes; vezes "sempre" até limpar_falhas', async () => {
    const { cmd, conectar } = await novo();
    const c = await conectar();
    const f = (await cmd<{ id: number }>('injetar_falha', { tipo: 'fragmentar', verbo: '&S', param: { partes: 3, ms: 10 }, vezes: 'sempre' })).id;
    const a = await txt(c, '(&S)', 300);
    const b = await txt(c, '(&S)', 300);
    expect(a).toMatch(/^\(S.*\)$/);
    expect(b).toBe(a);
    expect((await cmd<{ falhas: { disparos: number }[] }>('list_falhas')).falhas[0]!.disparos).toBe(2);
    await cmd('limpar_falhas', { id: f });
    expect((await cmd<{ falhas: unknown[] }>('list_falhas')).falhas).toEqual([]);
  });

  it('desconectar por falha e pela API; recusar conexões; list_conexoes', async () => {
    const { cmd, conectar } = await novo('cbc-32');
    const c = await conectar(2001);
    await conectar(1771);
    await new Promise((r) => setTimeout(r, 30));
    expect((await cmd<{ conexoes: { logica: number }[] }>('list_conexoes')).conexoes.map((x) => x.logica).sort()).toEqual([1771, 2001]);
    await cmd('injetar_falha', { tipo: 'desconectar', verbo: '&V' });
    const r = await c.trocar(['(&V)'], { timeoutMs: 200 });
    expect(r.caiu).toBe(true);
    expect((await cmd<{ derrubadas: number }>('desconectar', { porta: 1771, modo: 'fin' })).derrubadas).toBe(1);
    await cmd('desconectar', { recusar_conexoes: true });
    // Refused: the RST may arrive before or after the client's connect.
    const recebido = await conectar(2001)
      .then((d) => d.trocar(['(&S)'], { timeoutMs: 200 }))
      .then((rr) => rr.bytes.length)
      .catch(() => 0);
    expect(recebido).toBe(0);
    await cmd('desconectar', { recusar_conexoes: false });
    expect(await txt(await conectar(2001), '(&S)')).toMatch(/^\(S/);
  });

  it('travamento por falha congela até liberar (perfil real; no 2.7.2 o modal não cala o socket)', async () => {
    const { cmd, conectar } = await novo('cbc-32');
    const c = await conectar();
    await cmd('injetar_falha', { tipo: 'travamento', verbo: '&I' });
    expect(await txt(c, '(&I)')).toBe('');
    expect(await txt(c, '(&S)')).toBe('');
    await cmd('liberar_travamento');
    expect(await txt(c, '(&S)')).toMatch(/^\(S/);
  });

  it('probabilidade é determinística pela semente', () => {
    const disparos = (semente: number) => {
      const inj = new InjetorFalhas(semente);
      inj.adicionar({ tipo: 'sem_resposta', vezes: 'sempre', probabilidade: 0.5 });
      return Array.from({ length: 20 }, () => inj.atender(2001, '(&S)', () => ({ quadro: '(&S)', resposta: '(S)' })).length).join('');
    };
    expect(disparos(7)).toBe(disparos(7));
    expect(disparos(7)).not.toBe(disparos(8));
    expect(disparos(7)).toMatch(/0/);
    expect(disparos(7)).toMatch(/1/);
  });

  it('abrir_porta/fechar_porta nos perfis reais', async () => {
    const { cmd, rt } = await novo('cbc-32');
    await cmd('fechar_porta', { porta: 1771 });
    expect(rt.servidor!.portas().map((p) => p.logica)).toEqual([2001]);
    await cmd('abrir_porta', { porta: 857 });
    expect(rt.servidor!.portas().map((p) => p.logica).sort()).toEqual([2001, 857]);
  });

  it('set_perfil com portas diferentes reabre o servidor', async () => {
    const { cmd, rt } = await novo();
    expect(rt.servidor!.portas().map((p) => p.logica)).toEqual([2001]);
    await cmd('set_perfil', { perfil: 'horustech-48' });
    expect(rt.servidor!.portas().map((p) => p.logica).sort()).toEqual([1771, 2001, 857]);
  });
});

describe('gravação e replay', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-sim-'));

  it('grava rx/tx/abre/fecha em JSONL com bytes hex', async () => {
    const arq = path.join(dir, 'a.jsonl');
    const { conectar, rt } = await novo('simulador-2.7.2', arq);
    const c = await conectar();
    await txt(c, ['(&S', ')'].join(''));
    await txt(c, '(&T04L2A)');
    c.fechar();
    await new Promise((r) => setTimeout(r, 50));
    rt.gravarFim();
    const linhas = lerGravacao(fs.readFileSync(arq, 'utf8'));
    expect(linhas[0]!.dir).toBe('meta');
    expect(linhas.map((l) => l.dir)).toEqual(['meta', 'abre', 'rx', 'tx', 'rx', 'tx', 'fecha']);
    expect(Buffer.from(linhas[4]!.bytes, 'hex').toString('latin1')).toBe('(&T04L2A)');
    expect(linhas[5]!.texto).toBe('(TL040000000084)');
    expect(linhas.every((l) => typeof l.ts === 'number' && typeof l.conexao === 'number')).toBe(true);
    expect(trocas(linhas)).toHaveLength(2);
  });

  it('servidor de replay responde o tx gravado; cliente de replay compara byte a byte', async () => {
    const arq = path.join(dir, 'b.jsonl');
    const { conectar, rt, cmd } = await novo('cbc-32', arq);
    const c = await conectar(2001);
    await txt(c, '(&S)');
    await txt(c, '(&T04L2A)');
    await txt(c, '(&T04L00)');
    rt.gravarFim();
    const linhas = lerGravacao(fs.readFileSync(arq, 'utf8'));

    const srv = await ServidorReplay.abrir(linhas, { host: HOST, mapa: { '2001': 0 } });
    fechar.push(() => srv.fechar());
    const r = await ClienteTcp.conectar({ host: HOST, porta: srv.portas()[0]!.fisica });
    fechar.push(() => r.fechar());
    expect(await txt(r, '(&T04L2A)')).toBe('(TL040000000084)');
    expect(await txt(r, '(&X)')).toBe('');
    expect(srv.naoEncontrados).toEqual(['(&X)']);

    const alvo = { host: HOST, porta: rt.servidor!.fisica(2001)! };
    const igual = await replayCliente(linhas, { alvos: { '2001': alvo }, timeoutMs: 200 });
    expect([igual.trocas, igual.iguais, igual.divergencias.length]).toEqual([3, 3, 0]);

    await cmd('gravar_encerrante', { bico: '04', valor: 50_000 });
    const dif = await replayCliente(linhas, { alvos: { '2001': alvo }, timeoutMs: 200 });
    expect(dif.divergencias).toHaveLength(1);
    expect(dif.divergencias[0]!.rx).toBe('(&T04L2A)');
    expect(dif.divergencias[0]!.byte).toBeGreaterThan(0);
  });

  it('gravar_inicio/gravar_fim em memória pela API', async () => {
    const { cmd, conectar } = await novo();
    await cmd('gravar_inicio');
    await txt(await conectar(), '(&S)');
    const r = await cmd<{ linhas: number; linhas_memoria: { dir: string }[] }>('gravar_fim');
    expect(r.linhas_memoria.map((l) => l.dir)).toEqual(['meta', 'abre', 'rx', 'tx']);
  });
});
