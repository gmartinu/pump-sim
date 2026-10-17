import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { IDS_PERFIS, ServidorTcp, obterPerfil } from '../src/index.js';
import { novo, type IdPerfil } from './util.js';

/**
 * Time-based DIFF-04 (Windows bench capture, 2026-10-17), over real TCP on an ephemeral port.
 * A = real SimuladorCBC 2.7.2. On `simulador-2.7.2` A wins: `(&S` without `)` is served at once and
 * the late `)` gets no 2nd reply. Real profiles follow the manual (they reassemble, only replying
 * after the `)`) and do not get the quirk.
 */

const HOST = '127.0.0.1';
const EFEMERAS = { 2001: 0, 1771: 0, 857: 0, 7002: 0 };
const abertos: ServidorTcp[] = [];
const socks: net.Socket[] = [];
afterEach(async () => {
  for (const s of socks.splice(0)) s.destroy();
  await Promise.all(abertos.splice(0).map((s) => s.fechar()));
});

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The &S voltage (`G` + 2 chars) varies on the real 2.7.2. */
const mascT = (r: string) => r.replace(/G[0-9A-F]{2}\)$/, 'G**)');

/** A's rx (bench capture 2026-10-17, target A): `(&S` and then `)` with a gap_ms interval. */
const LINHAS_A = [
  { gap_ms: 10, rx: '(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G87)', antes_do_fecha: true },
  { gap_ms: 20, rx: '(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G87)', antes_do_fecha: true },
  { gap_ms: 50, rx: '(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G87)', antes_do_fecha: true },
  { gap_ms: 100, rx: '(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G87)', antes_do_fecha: true },
  { gap_ms: 200, rx: '(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G87)', antes_do_fecha: true },
  { gap_ms: 500, rx: '(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G87)', antes_do_fecha: true },
] as const;

interface Conn {
  /** Everything that arrived, with the instant (ms) of each chunk. */
  rx: { t: number; s: string }[];
  sock: net.Socket;
  texto(): string;
}

async function conectar(porta: number): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: HOST, port: porta }, () => {
      sock.setNoDelay(true);
      const c: Conn = { rx: [], sock, texto: () => c.rx.map((x) => x.s).join('') };
      sock.on('data', (b) => c.rx.push({ t: performance.now(), s: b.toString('latin1') }));
      resolve(c);
    });
    socks.push(sock);
    sock.once('error', reject);
  });
}

async function servir(perfil: IdPerfil) {
  const { sim } = novo(perfil);
  const p = obterPerfil(perfil).portas.find((x) => x.tipo === 'tcp');
  const logica = (p as { porta: number }).porta;
  const srv = await ServidorTcp.abrir(sim, { host: HOST, portas: [logica], mapa: EFEMERAS });
  abertos.push(srv);
  return { sim, c: await conectar(srv.fisica(logica)!) };
}

describe('DIFF-04 temporal no simulador-2.7.2 (TCP real, porta efêmera)', () => {
  for (const l of LINHAS_A) {
    it(`(&S, ${l.gap_ms} ms, ) → responde antes do ) e o ) não gera 2ª resposta`, async () => {
      const { sim, c } = await servir('simulador-2.7.2');
      const status = sim.pedir('(&S)')!;
      expect(mascT(status)).toBe(mascT(l.rx));
      c.sock.write('(&S', 'latin1');
      await espera(l.gap_ms);
      // Instant at which THE TEST ITSELF will send the `)`; the reply must have arrived before it.
      const tFecha = performance.now();
      expect(c.rx.length).toBeGreaterThan(0);
      const antesDoFecha = c.rx[c.rx.length - 1]!.t < tFecha;
      expect(antesDoFecha).toBe(l.antes_do_fecha);
      expect(mascT(c.texto())).toBe(mascT(l.rx));
      c.sock.write(')', 'latin1');
      await espera(80);
      expect(mascT(c.texto())).toBe(mascT(l.rx));
    });
  }

  it('"(&S" sozinho → resposta (sem o ")" nunca chegar)', async () => {
    const { sim, c } = await servir('simulador-2.7.2');
    c.sock.write('(&S', 'latin1');
    await espera(120);
    expect(mascT(c.texto())).toBe(mascT('(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G89)'));
    expect(c.texto()).toBe(sim.pedir('(&S)'));
  });

  it('")" atrasado de um "(&S" já atendido → sem segunda resposta, mesmo depois de vários', async () => {
    const { c } = await servir('simulador-2.7.2');
    c.sock.write('(&S', 'latin1');
    await espera(60);
    const primeira = c.texto();
    expect(primeira).not.toBe('');
    for (let i = 0; i < 3; i++) {
      c.sock.write(')', 'latin1');
      await espera(40);
    }
    expect(c.texto()).toBe(primeira);
  });

  it('"(&T04L" sem moldura → silêncio, e o ")" depois também', async () => {
    const { c } = await servir('simulador-2.7.2');
    c.sock.write('(&T04L', 'latin1');
    await espera(120);
    expect(c.texto()).toBe('');
    c.sock.write(')', 'latin1');
    await espera(80);
    expect(c.texto()).toBe('');
  });
});

describe('perfis reais: "(&S" sem ")" NÃO é atendido antes da moldura', () => {
  it('nenhum perfil real liga o Q1 (o enquadramento de leitura única é só do simulador-2.7.2)', () => {
    for (const id of IDS_PERFIS.filter((x) => x !== 'simulador-2.7.2')) {
      expect(obterPerfil(id).quirks.Q1, id).toBe(false);
      expect(novo(id).sim.modoFramer(), id).toBe('fluxo');
    }
  });
  const reais = IDS_PERFIS.filter((id) => id !== 'simulador-2.7.2' && obterPerfil(id).portas.some((x) => x.tipo === 'tcp'));
  for (const id of reais) {
    it(`${id}: silêncio até o ")" (se o perfil responde ao &S)`, async () => {
      const { sim, c } = await servir(id);
      const status = sim.pedir('(&S)');
      c.sock.write('(&S', 'latin1');
      await espera(150);
      // Without the quirk: nothing before the frame closes, whatever the profile.
      expect(c.texto()).toBe('');
      c.sock.write(')', 'latin1');
      await espera(100);
      // Only with the ")" comes the reply the manual specifies (the same as for the whole frame).
      expect(c.texto()).toBe(status ?? '');
    });
  }
});
