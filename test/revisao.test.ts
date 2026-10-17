import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Hub, ManualClock, abrirServidorControle, derivePerfil, kkValido } from '../src/index.js';
import { criar, kk } from './golden-util.js';

// Findings of the adversarial review (docs/DECISIONS.md §7).

describe('&T I: cartão ausente segue a mesma regra dos registros', () => {
  it('perfis reais: 16 F por cartão (DT435 §3.3.6 + exemplos de registro)', () => {
    const r = criar('cbc-32').sim.pedir(kk('&T08I'))!;
    expect(r).toBe(kk('TI08' + 'F'.repeat(32)));
    expect(kkValido(r)).toBe(true);
  });

  it('2.7.2 sem o quirk TG: 16 zeros (CARTAO_VAZIO_ZEROS)', () => {
    const p = derivePerfil('simulador-2.7.2', { quirks: { TG: false } });
    expect(criar(p).sim.pedir(kk('&T08I'))).toBe(kk('TI08' + '0'.repeat(32)));
  });
});

describe('&U: o prefixo do erro acompanha o ack (ackPreco)', () => {
  it('padrão U: bico inexistente → (U?b)', () => {
    expect(criar('cbc-32').sim.pedir(kk('&U7F001234'))).toBe('(U?b)');
  });
  it('ackPreco M: (M?b), como na estrutura do DT435 p.24-25', () => {
    const p = derivePerfil('cbc-32', { ackPreco: 'M' });
    expect(criar(p).sim.pedir(kk('&U7F001234'))).toBe('(M?b)');
  });
});

describe('(&M99c48) só limpa a lista onde o perfil tem M99', () => {
  it('cbc05-dip3 (sem M99): cai no &M do bico 99 → (M?b)', () => {
    expect(criar('cbc05-dip3').sim.pedir('(&M99c48)')).toBe('(M?b)');
  });
  it('2.7.2: a forma curta segue a equivalência comportamental (`c` → limpa e (M99)); só a longa recusa com (M?f) (DIFF-02)', () => {
    const { sim } = criar('simulador-2.7.2');
    expect(sim.pedir('(&M99c48)')).toBe('(M99)');
    expect(sim.pedir('(&M99c000000000000000048)')).toBe('(M?f)');
  });
});

// ───────────────────────── control API security ─────────────────────────

const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

async function api() {
  const hub = new Hub({ clock: new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0)), host: '127.0.0.1', semTcp: true });
  fechar.push(() => hub.fechar());
  await hub.criar('default', 'cbc-32');
  const s = await abrirServidorControle(hub, 0);
  fechar.push(() => s.fechar());
  return s;
}

function pedir(porta: number, op: { metodo: string; caminho: string; headers?: Record<string, string>; corpo?: string }) {
  return new Promise<{ status: number; corpo: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, method: op.metodo, path: op.caminho, headers: op.headers }, (res) => {
      let c = '';
      res.on('data', (b: Buffer) => (c += b.toString('utf8')));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: c }));
    });
    req.on('error', reject);
    req.end(op.corpo);
  });
}

describe('API de controle: só loopback, sem CSRF', () => {
  it('escuta em 127.0.0.1 por padrão e não libera CORS', async () => {
    const s = await api();
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const r = await fetch(`${s.url}/api/catalogo`);
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('Origin de outro site → 403, inclusive no preflight', async () => {
    const s = await api();
    const r = await pedir(s.porta, { metodo: 'POST', caminho: '/api/comandos/reset', headers: { origin: 'https://exemplo.invalid', 'content-type': 'application/json' }, corpo: '{}' });
    expect(r.status).toBe(403);
    const o = await pedir(s.porta, { metodo: 'OPTIONS', caminho: '/api/comandos/reset', headers: { origin: 'https://exemplo.invalid' } });
    expect(o.status).toBe(403);
    const local = await pedir(s.porta, { metodo: 'GET', caminho: '/api/catalogo', headers: { origin: 'http://localhost:5173' } });
    expect(local.status).toBe(200);
  });

  it('Host que não é loopback (DNS rebinding) → 403', async () => {
    const s = await api();
    const r = await pedir(s.porta, { metodo: 'GET', caminho: '/api/catalogo', headers: { host: 'atacante.invalid' } });
    expect(r.status).toBe(403);
  });

  it('POST sem content-type JSON → 415; GET de comando que não é leitura → 405', async () => {
    const s = await api();
    const p = await pedir(s.porta, { metodo: 'POST', caminho: '/api/comandos/start_recording', headers: { 'content-type': 'text/plain' }, corpo: '{"arquivo":"x.jsonl"}' });
    expect(p.status).toBe(415);
    const g = await pedir(s.porta, { metodo: 'GET', caminho: '/api/comandos/start_recording?arquivo=%22x.jsonl%22' });
    expect(g.status).toBe(405);
    const leitura = await pedir(s.porta, { metodo: 'GET', caminho: '/api/comandos/get_status' });
    expect(leitura.status).toBe(200);
  });

  it('WS com Origin de outro site é recusado', async () => {
    const s = await api();
    const ws = new WebSocket(`${s.url.replace('http', 'ws')}/ws`, { origin: 'https://exemplo.invalid' });
    const fim = await new Promise<string>((r) => {
      ws.once('open', () => r('aberto'));
      ws.once('error', () => r('recusado'));
    });
    ws.terminate();
    expect(fim).toBe('recusado');
  });
});
