import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { Hub, ManualClock, abrirServidorControle } from '../src/index.js';

/**
 * `POST /api/encerrar` (DECISIONS §35): "Encerrar pump-sim" in the UI, needed with the browser
 * fallback where no window owns the process. Loopback peers only, JSON POST, the usual Origin guard;
 * the callback runs after the reply went out. The CLI wiring (ports closed, exit 0) is in
 * test/inicio.test.ts.
 */

const T0 = Date.UTC(2026, 9, 17, 12, 0, 0);
const fechar: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

async function servidor(aoEncerrar?: () => void, host = '127.0.0.1') {
  const hub = new Hub({ clock: new ManualClock(T0), host: '127.0.0.1', semTcp: true });
  await hub.criar('default', 'simulador-2.7.2');
  const s = await abrirServidorControle(hub, 0, host, { aoEncerrar });
  fechar.push(async () => {
    await s.fechar();
    await hub.fechar();
  });
  return s;
}
const post = (url: string, init: RequestInit = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', ...init });

describe('POST /api/encerrar', () => {
  it('answers 202 and calls aoEncerrar after the reply is out: a callback that closes the server still lets the reply through; /api/servidor reports encerrar: true', async () => {
    let chamadas = 0;
    const alvo: { fechar?: () => Promise<void> } = {};
    const s = await servidor(() => {
      chamadas++;
      // What the CLI does (sair): close the control server right away.
      void alvo.fechar?.();
    });
    alvo.fechar = s.fechar;
    const sv = (await (await fetch(`${s.url}/api/servidor`)).json()) as { resultado: { encerrar: boolean } };
    expect(sv.resultado.encerrar).toBe(true);
    const r = await post(`${s.url}/api/encerrar`);
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ ok: true, resultado: { encerrando: true } });
    for (let i = 0; i < 50 && chamadas === 0; i++) await new Promise((ok) => setTimeout(ok, 10));
    expect(chamadas).toBe(1);
    await expect(fetch(`${s.url}/api/sims`)).rejects.toThrow();
  });

  it('without a callback (library use): 501, and /api/servidor reports encerrar: false', async () => {
    const s = await servidor();
    const r = await post(`${s.url}/api/encerrar`);
    expect(r.status).toBe(501);
    expect(((await r.json()) as { erro: string }).erro).toBe('encerrar não disponível neste processo');
    const sv = (await (await fetch(`${s.url}/api/servidor`)).json()) as { resultado: { encerrar: boolean } };
    expect(sv.resultado.encerrar).toBe(false);
  });

  it('keeps the guards: foreign Origin 403, non-JSON POST 415, GET is not a route', async () => {
    let chamadas = 0;
    const s = await servidor(() => void chamadas++);
    expect((await post(`${s.url}/api/encerrar`, { headers: { 'content-type': 'application/json', origin: 'http://evil.example' } })).status).toBe(403);
    expect((await post(`${s.url}/api/encerrar`, { headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect((await fetch(`${s.url}/api/encerrar`)).status).toBe(404);
    await new Promise((ok) => setTimeout(ok, 30));
    expect(chamadas).toBe(0);
  });

  const ipLan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  it.skipIf(!ipLan)('refuses a non-loopback peer even when bound to 0.0.0.0', async () => {
    let chamadas = 0;
    const s = await servidor(() => void chamadas++, '0.0.0.0');
    const r = await post(`http://${ipLan}:${s.porta}/api/encerrar`);
    expect(r.status).toBe(403);
    expect(((await r.json()) as { erro: string }).erro).toBe('encerrar só pelo loopback');
    expect(chamadas).toBe(0);
  });
});
