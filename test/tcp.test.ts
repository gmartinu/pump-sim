import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Hub, ManualClock, ServidorTcp, executarComando, quadroH, type PerfilId } from '../src/index.js';
import { abastecer, kk, novo } from './util.js';

const EFEMERAS = { 2001: 0, 1771: 0, 857: 0, 7002: 0 };
const HOST = '127.0.0.1';
const abertos: ServidorTcp[] = [];
const clientes: net.Socket[] = [];

const hubs: Hub[] = [];

afterEach(async () => {
  for (const c of clientes.splice(0)) c.destroy();
  await Promise.all(abertos.splice(0).map((s) => s.fechar()));
  await Promise.all(hubs.splice(0).map((h) => h.fechar()));
});

async function abrir(sim: Parameters<typeof ServidorTcp.abrir>[0], portas?: number[]) {
  const s = await ServidorTcp.abrir(sim, { host: HOST, portas, mapa: EFEMERAS });
  abertos.push(s);
  return s;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Cliente {
  sock: net.Socket;
  /** Sends the chunks in separate segments and returns what arrived within `ms`. */
  trocar(pedacos: string[], ms?: number, intervaloMs?: number): Promise<string>;
}

function conectar(porta: number): Promise<Cliente> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: HOST, port: porta }, () => {
      sock.setNoDelay(true);
      let rx = '';
      sock.on('data', (b) => (rx += b.toString('latin1')));
      resolve({
        sock,
        async trocar(pedacos, ms = 80, intervaloMs = 25) {
          rx = '';
          for (const p of pedacos) {
            sock.write(p, 'latin1');
            await espera(intervaloMs);
          }
          await espera(ms);
          return rx;
        },
      });
    });
    clientes.push(sock);
    sock.once('error', reject);
  });
}

describe('TCP — perfis reais: portas simultâneas', () => {
  it('cbc-32 escuta 2001 e 1771 ao mesmo tempo, cada uma com o seu ponteiro', async () => {
    const { sim, clock } = novo('cbc-32');
    const s = await abrir(sim);
    expect(s.portas().map((p) => p.logica).sort()).toEqual([1771, 2001]);
    abastecer(sim, clock, 0x04, 2000);
    const a = await conectar(s.fisica(2001)!);
    const b = await conectar(s.fisica(1771)!);
    const r = await a.trocar(['(&A)']);
    expect(r).toHaveLength(52);
    expect(await a.trocar(['(&I)'])).toBe('');
    expect(await a.trocar(['(&A)'])).toBe('(0)');
    expect(await b.trocar(['(&A)'])).toBe(r);
    expect(s.conexoes()).toBe(2);
  });

  it('horustech-48 escuta 2001, 1771 e 857; Horustech nativo pela 857 com o ponteiro dela', async () => {
    const { sim, clock } = novo('horustech-48');
    const s = await abrir(sim);
    expect(s.portas().map((p) => p.logica).sort()).toEqual([1771, 2001, 857]);
    abastecer(sim, clock, 0x04, 2000);
    const c857 = await conectar(s.fisica(857)!);
    const c2001 = await conectar(s.fisica(2001)!);
    expect(await c857.trocar(['>?00020667'])).toBe(quadroH('06000001000001'));
    expect(await c857.trocar(['>?00020263'])).toBe('>!00020245');
    expect((await c2001.trocar(['>?0002', '0263'])).slice(0, 6)).toBe('>!006B');
  });

  it('framing por delimitador: fragmento é remontado e dois quadros no segmento são atendidos', async () => {
    const { sim } = novo('cbc-32');
    const s = await abrir(sim);
    const c = await conectar(s.fisica(2001)!);
    const status = sim.pedir('(&S)')!;
    expect(await c.trocar(['(&S', ')'])).toBe(status);
    expect(await c.trocar(['(&S)(&V)'])).toBe(status + '(0)');
    expect(await c.trocar(['lixo\r\n(&S)'])).toBe(status);
  });

  it('não permite trocar de porta', async () => {
    const s = await abrir(novo('cbc-32').sim);
    await expect(s.trocarPorta(857)).rejects.toThrow(/simultaneamente/);
  });
});

describe('TCP — simulador-2.7.2: uma porta por vez', () => {
  it('padrão 2001; pedir duas portas ou uma fora do rádio falha', async () => {
    const { sim } = novo();
    const s = await abrir(sim);
    expect(s.portas().map((p) => p.logica)).toEqual([2001]);
    await expect(ServidorTcp.abrir(sim, { portas: [2001, 1771], mapa: EFEMERAS, host: HOST })).rejects.toThrow(/uma porta por vez/);
    await expect(ServidorTcp.abrir(sim, { portas: [857], mapa: EFEMERAS, host: HOST })).rejects.toThrow(/fora das opções/);
  });

  it('cada leitura é um comando: `(&S` sem `)` é atendido antes do `)`, que é ignorado (DIFF-04 temporal)', async () => {
    const { sim } = novo();
    const s = await abrir(sim, [7002]);
    const c = await conectar(s.fisica(7002)!);
    const status = sim.pedir('(&S)')!;
    // Bench capture (2026-10-17): the real 2.7.2 replies BEFORE the `)` arrives, at every interval.
    for (const gap of [10, 20, 50, 100, 200, 500]) {
      expect(await c.trocar(['(&S'], gap, 0), `antes do ) com ${gap} ms`).toBe(status);
      expect(await c.trocar([')'], 80, 0), `) atrasado com ${gap} ms`).toBe('');
    }
    expect(await c.trocar(['(&S'], 80, 0)).toBe(status);
    // Only &S has evidence: `(&T04L` without KK and without `)` stays silent (goes to the parser: ERRO CMD in the log), and so does the later `)`.
    expect(await c.trocar(['(&T04L'], 80, 0)).toBe('');
    expect(await c.trocar([')'], 80, 0)).toBe('');
    expect(sim.conc.log.some((l) => l.dir === 'ERRO' && l.texto === 'ERRO CMD: (&T04L')).toBe(true);
    expect(await c.trocar(['(&S)(&V)'])).toBe(status);
    expect(await c.trocar(['(&S)'])).toBe(status);
  });

  it('perfil real (cbc-32): `(&S` + `)` atrasado é remontado e só responde depois do `)`', async () => {
    const { sim } = novo('cbc-32');
    const s = await abrir(sim, [2001]);
    const c = await conectar(s.fisica(2001)!);
    const status = sim.pedir('(&S)')!;
    expect(await c.trocar(['(&S'], 100, 0)).toBe('');
    expect(await c.trocar([')'], 80, 0)).toBe(status);
  });

  it('trocarPorta derruba as conexões e o ponteiro é o mesmo em todas as portas', async () => {
    const { sim, clock } = novo();
    const s = await abrir(sim, [7002]);
    abastecer(sim, clock, 0x04, 2000);
    const c = await conectar(s.fisica(7002)!);
    expect(await c.trocar(['(&A)'])).toHaveLength(52);
    await c.trocar(['(&I)']);
    const fechou = new Promise((r) => c.sock.once('close', r));
    await s.trocarPorta(1771);
    await fechou;
    expect(s.portas().map((p) => p.logica)).toEqual([1771]);
    const d = await conectar(s.fisica(1771)!);
    expect(await d.trocar(['(&A)'])).toBe('(0)');
    expect(await d.trocar([kk('&T99P')])).toMatch(/^\(TG99/);
  });
});

// §11 (DECISIONS): the framing comes from the current state on every read, not from the sim at the time the connection opened.
describe('TCP — enquadramento acompanha quirk/perfil com a conexão aberta', () => {
  async function hubTcp(perfil: PerfilId) {
    const hub = new Hub({ clock: new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0)), host: HOST, mapa: EFEMERAS });
    hubs.push(hub);
    const rt = await hub.criar('default', perfil);
    const cmd = (nome: string, args: Record<string, unknown> = {}) => executarComando(hub, nome, args);
    const c = await conectar(rt.servidor!.fisica(rt.servidor!.portas()[0]!.logica)!);
    return { rt, cmd, c };
  }

  it('set_quirk Q1 off no simulador-2.7.2: a mesma conexão passa a remontar `(&S` + `)`', async () => {
    const { rt, cmd, c } = await hubTcp('simulador-2.7.2');
    const status = rt.sim.pedir('(&S)')!;
    expect(await c.trocar(['(&S'], 80, 0)).toBe(status);
    expect(await c.trocar([')'], 80, 0)).toBe('');
    await cmd('set_quirk', { nome: 'Q1', on: false });
    expect(await c.trocar(['(&S'], 80, 0)).toBe('');
    expect(await c.trocar([')'], 80, 0)).toBe(status);
    await cmd('set_quirk', { nome: 'Q1', on: true });
    expect(await c.trocar(['(&S'], 80, 0)).toBe(status);
  });

  it('set_quirk Q1 on no cbc-32: a mesma conexão passa a atender `(&S` sem `)`', async () => {
    const { rt, cmd, c } = await hubTcp('cbc-32');
    const status = rt.sim.pedir('(&S)')!;
    expect(await c.trocar(['(&S'], 80, 0)).toBe('');
    expect(await c.trocar([')'], 80, 0)).toBe(status);
    await cmd('set_quirk', { nome: 'Q1', on: true });
    expect(await c.trocar(['(&S'], 80, 0)).toBe(status);
  });

  it('set_perfil simulador-2.7.2 ⇄ cbc05-dip3 (ambos só na 2001, a conexão não cai): o enquadramento troca junto', async () => {
    const { rt, cmd, c } = await hubTcp('simulador-2.7.2');
    const status = rt.sim.pedir('(&S)')!;
    expect(await c.trocar(['(&S'], 80, 0)).toBe(status);
    await cmd('set_perfil', { perfil: 'cbc05-dip3' });
    expect(rt.servidor!.conexoes()).toBe(1);
    expect(await c.trocar(['(&S'], 80, 0)).toBe('');
    expect(await c.trocar([')'], 80, 0)).toBe(rt.sim.pedir('(&S)')!);
    await cmd('set_perfil', { perfil: 'simulador-2.7.2' });
    expect(rt.servidor!.conexoes()).toBe(1);
    expect(await c.trocar(['(&S'], 80, 0)).toBe(status);
  });

  it('snapshot_carregar com o mesmo id de perfil e outro Q1 (quirks trocados no lugar): a conexão segue o Q1 carregado', async () => {
    const { rt, cmd, c } = await hubTcp('simulador-2.7.2');
    await cmd('set_quirk', { nome: 'Q1', on: false });
    await cmd('snapshot_salvar', { nome: 'semQ1' });
    await cmd('set_quirk', { nome: 'Q1', on: true });
    const status = rt.sim.pedir('(&S)')!;
    expect(await c.trocar(['(&S'], 80, 0)).toBe(status);
    await cmd('snapshot_carregar', { nome: 'semQ1' });
    expect(rt.sim.conc.quirks.Q1).toBe(false);
    expect(await c.trocar(['(&S'], 80, 0)).toBe('');
    expect(await c.trocar([')'], 80, 0)).toBe(status);
  });

  it('fluxo: quadro partido sobrevive a um set_quirk que não muda o enquadramento', async () => {
    const { rt, cmd, c } = await hubTcp('cbc-32');
    const status = rt.sim.pedir('(&S)')!;
    expect(await c.trocar(['(&S'], 80, 0)).toBe('');
    await cmd('set_quirk', { nome: 'Q6', on: true });
    expect(await c.trocar([')'], 80, 0)).toBe(status);
  });
});
