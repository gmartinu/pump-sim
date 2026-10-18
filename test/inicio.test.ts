import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Hub, ManualClock, abrirServidorControle } from '../src/index.js';
import {
  PORTA_CONTROLE_PADRAO,
  PORTA_CONTROLE_ULTIMA,
  MAX_DIALOGO,
  pilhaSemCaminhos,
  abrirControleComFallback,
  mensagemErroFatal,
  mensagemFalhaControle,
  textoDialogoErro,
} from '../src/ui/inicio.js';

/**
 * Executable startup (DECISIONS §31): `--ui` falls back past an occupied control port, an explicit
 * `--control` that is busy does not end the process. The GUI executable (§34) shows a fatal error in
 * a dialog instead of waiting for Enter (W3 struck): `textoDialogoErro`.
 */

const HOST = '127.0.0.1';
const fechar: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

/** Holds `porta` on 127.0.0.1; `null` when something else already holds it (still occupied). */
function ocupar(porta: number): Promise<net.Server | null> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', (e: NodeJS.ErrnoException) => (e.code === 'EADDRINUSE' ? resolve(null) : reject(e)));
    s.listen(porta, HOST, () => {
      fechar.push(() => new Promise<void>((r) => s.close(() => r())));
      resolve(s);
    });
  });
}

async function portaLivre(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, HOST, () => r()));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}

function novoHub(): Hub {
  const hub = new Hub({ clock: new ManualClock(0), host: HOST, fusoMinutos: 0 });
  fechar.push(() => hub.fechar());
  return hub;
}

describe('abrirControleComFallback', () => {
  it('--ui default: 7070 occupied → the next free port in 7070..7089, and the API answers there', async () => {
    await ocupar(PORTA_CONTROLE_PADRAO);
    const hub = novoHub();
    const r = await abrirControleComFallback((p) => abrirServidorControle(hub, p, HOST), { porta: PORTA_CONTROLE_PADRAO, explicita: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    fechar.push(r.servidor.fechar);
    expect(r.porta).toBeGreaterThan(PORTA_CONTROLE_PADRAO);
    expect(r.porta).toBeLessThanOrEqual(PORTA_CONTROLE_ULTIMA);
    expect(r.tentadas[0]).toBe(PORTA_CONTROLE_PADRAO);
    expect(r.tentadas[r.tentadas.length - 1]).toBe(r.porta);
    expect(r.servidor.url).toBe(`http://${HOST}:${r.porta}`);
    const res = await fetch(`${r.servidor.url}/`);
    expect(res.status).toBe(200);
  });

  it('takes exactly the first free port: busy ports are skipped one by one', async () => {
    const tentadas: number[] = [];
    const ocupadas = new Set([7070, 7071, 7072]);
    const r = await abrirControleComFallback(
      async (p) => {
        tentadas.push(p);
        if (ocupadas.has(p)) throw Object.assign(new Error(`listen EADDRINUSE: address already in use ${HOST}:${p}`), { code: 'EADDRINUSE' });
        return p;
      },
      { porta: 7070, explicita: false },
    );
    expect(r).toEqual({ ok: true, servidor: 7073, porta: 7073, tentadas: [7070, 7071, 7072, 7073] });
    expect(tentadas).toEqual([7070, 7071, 7072, 7073]);
  });

  it('explicit --control busy: one attempt, returns a failure instead of throwing', async () => {
    const porta = await portaLivre();
    await ocupar(porta);
    const hub = novoHub();
    const r = await abrirControleComFallback((p) => abrirServidorControle(hub, p, HOST), { porta, explicita: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.tentadas).toEqual([porta]);
    expect((r.erro as NodeJS.ErrnoException).code).toBe('EADDRINUSE');
    expect(mensagemFalhaControle(r, true)).toBe(
      `[pump-sim] não consegui abrir a API de controle/UI (porta ${porta} ocupada); o simulador segue sem UI — escolha outra com --control <porta>`,
    );
  });

  it('the whole range occupied: failure naming the range', async () => {
    const erro = () => Promise.reject(Object.assign(new Error('ocupada'), { code: 'EADDRINUSE' }));
    const r = await abrirControleComFallback(erro, { porta: 7070, explicita: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.tentadas).toHaveLength(20);
    expect(mensagemFalhaControle(r, false)).toContain('portas 7070..7089 ocupadas');
  });

  it('a non-port error stops the scan at the first attempt', async () => {
    let n = 0;
    const r = await abrirControleComFallback(
      () => {
        n++;
        return Promise.reject(Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' }));
      },
      { porta: 7070, explicita: false },
    );
    expect(n).toBe(1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(mensagemFalhaControle(r, false)).toContain('getaddrinfo ENOTFOUND x');
  });
});

describe('textoDialogoErro (DECISIONS §34)', () => {
  it('drops the [pump-sim] prefix and points at the log file', () => {
    expect(textoDialogoErro('[pump-sim] erro ao iniciar: perfil desconhecido: x', 'C:\\u\\pump-sim.log')).toBe(
      'erro ao iniciar: perfil desconhecido: x\n\nDetalhes no log: C:\\u\\pump-sim.log',
    );
  });

  it('without a log file, only the message', () => {
    expect(textoDialogoErro('[pump-sim] erro ao iniciar: x', null)).toBe('erro ao iniciar: x');
  });

  it('truncates a long message to MAX_DIALOGO characters', () => {
    const t = textoDialogoErro('a'.repeat(MAX_DIALOGO * 3), null);
    expect(t).toHaveLength(MAX_DIALOGO);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('mensagemErroFatal', () => {
  it('Portuguese prefix, EADDRINUSE named', () => {
    expect(mensagemErroFatal(new Error('perfil desconhecido: x'))).toBe('[pump-sim] erro ao iniciar: perfil desconhecido: x');
    expect(mensagemErroFatal(Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }))).toBe(
      '[pump-sim] erro ao iniciar: porta já em uso (listen EADDRINUSE)',
    );
    expect(mensagemErroFatal('texto')).toBe('[pump-sim] erro ao iniciar: texto');
  });
});

describe('CLI process', () => {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  // Inside the repo so the bundle's bare imports (ws, zod, MCP SDK) resolve from node_modules.
  fs.mkdirSync(path.join(raiz, 'node_modules', '.cache'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(raiz, 'node_modules', '.cache', 'pump-sim-cli-'));
  const bundle = path.join(dir, 'cli.mjs');

  beforeAll(async () => {
    await build({
      entryPoints: [path.join(raiz, 'src', 'cli.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: bundle,
      packages: 'external',
      logLevel: 'silent',
      absWorkingDir: raiz,
    });
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('explicit --control busy: logs the failure and keeps running (no exit 1)', async () => {
    const ctl = await portaLivre();
    await ocupar(ctl);
    // --ui tolerates a busy simulator port (2001 may be taken on this machine); --sem-abrir opens no window.
    const p = spawn(process.execPath, [bundle, '--ui', '--sem-abrir', '--sem-config-padrao', '--control', String(ctl)], {
      cwd: raiz,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let saida = '';
    let codigo: number | null | undefined;
    p.stderr.on('data', (b: Buffer) => (saida += b.toString('utf8')));
    p.on('exit', (c) => (codigo = c));
    fechar.push(
      () =>
        new Promise<void>((r) => {
          if (codigo !== undefined) return r();
          p.once('exit', () => r());
          p.kill('SIGTERM');
        }),
    );
    const limite = performance.now() + 10_000;
    while (!saida.includes('não consegui abrir a API') && codigo === undefined && performance.now() < limite) await new Promise((r) => setTimeout(r, 50));
    expect(saida).toContain(`porta ${ctl} ocupada`);
    expect(saida).not.toContain('erro ao iniciar');
    // Still alive a moment later: the simulator keeps running without the API/UI.
    await new Promise((r) => setTimeout(r, 300));
    expect(codigo).toBeUndefined();
  }, 30_000);

  it('--ui without --control, 7070 occupied: prints and serves the next free port', async () => {
    await ocupar(PORTA_CONTROLE_PADRAO);
    const p = spawn(process.execPath, [bundle, '--ui', '--sem-abrir', '--sem-config-padrao'], { cwd: raiz, stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    let codigo: number | null | undefined;
    p.stderr.on('data', (b: Buffer) => (saida += b.toString('utf8')));
    p.on('exit', (c) => (codigo = c));
    fechar.push(
      () =>
        new Promise<void>((r) => {
          if (codigo !== undefined) return r();
          p.once('exit', () => r());
          p.kill('SIGTERM');
        }),
    );
    const limite = performance.now() + 10_000;
    while (!/UI em http:\/\/127\.0\.0\.1:\d+\//.test(saida) && codigo === undefined && performance.now() < limite) await new Promise((r) => setTimeout(r, 50));
    const m = /UI em http:\/\/127\.0\.0\.1:(\d+)\//.exec(saida);
    expect(m, saida).not.toBeNull();
    const porta = Number(m![1]);
    expect(porta).toBeGreaterThan(PORTA_CONTROLE_PADRAO);
    expect(porta).toBeLessThanOrEqual(PORTA_CONTROLE_ULTIMA);
    expect(saida).toContain(`porta ${PORTA_CONTROLE_PADRAO} ocupada; usando ${porta}`);
    // The bundle lives outside src/, so the UI assets do not resolve here; the API is what matters.
    expect((await fetch(`http://${HOST}:${porta}/api/sims`)).status).toBe(200);
  }, 30_000);

  it('--lembrar restores a saved 2.7.2 file (fractional tick, junk keys: one line), and POST /api/encerrar closes the ports and exits 0 (DECISIONS §35)', async () => {
    const ctl = await portaLivre();
    const cfg = fs.mkdtempSync(path.join(dir, 'cfg-'));
    const arq = path.join(cfg, 'pump-sim', 'ultima-config.json');
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    // As written by capturarConfig for simulador-2.7.2 (tick 109.375 ms, §29), plus keys no version writes.
    fs.writeFileSync(arq, JSON.stringify({ perfil: 'simulador-2.7.2', automacao: false, bateriaVolts: 'doze', tickVazaoMs: 109.375, velocidade: 'normal' }));
    const p = spawn(process.execPath, [bundle, '--ui', '--sem-abrir', '--lembrar', '--control', String(ctl)], {
      cwd: raiz,
      env: { ...process.env, XDG_CONFIG_HOME: cfg },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let saida = '';
    let codigo: number | null | undefined;
    p.stderr.on('data', (b: Buffer) => (saida += b.toString('utf8')));
    const saiu = new Promise<void>((r) => p.on('exit', (c) => ((codigo = c), r())));
    fechar.push(async () => {
      if (codigo === undefined) p.kill('SIGTERM');
      await saiu;
    });
    const limite = performance.now() + 10_000;
    while (!saida.includes('UI em') && codigo === undefined && performance.now() < limite) await new Promise((r) => setTimeout(r, 50));
    expect(saida).toContain(`UI em http://127.0.0.1:${ctl}/`);
    const avisos = saida.split('\n').filter((l) => l.includes('última configuração'));
    expect(avisos).toEqual([`[pump-sim] última configuração (${arq}): entradas ignoradas (desconhecidas ou inválidas): bateriaVolts, velocidade`]);
    expect(saida).not.toContain('falhou');
    const tcp = /ouvindo em 0\.0\.0\.0:(\d+)/.exec(saida);
    const sv = (await (await fetch(`http://${HOST}:${ctl}/api/servidor`)).json()) as { resultado: { encerrar: boolean } };
    expect(sv.resultado.encerrar).toBe(true);
    const r = await fetch(`http://${HOST}:${ctl}/api/encerrar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(202);
    await Promise.race([saiu, new Promise((r2) => setTimeout(r2, 10_000))]);
    expect(codigo).toBe(0);
    expect(saida).toContain('[pump-sim] encerrado pela interface; fechando as portas');
    const conecta = (porta: number) =>
      new Promise<string>((ok) => {
        const c = net.connect(porta, HOST);
        c.once('connect', () => (c.destroy(), ok('aberta')));
        c.once('error', (e: NodeJS.ErrnoException) => ok(e.code ?? 'erro'));
      });
    expect(await conecta(ctl)).toBe('ECONNREFUSED');
    // 2001 may be taken on this machine (--ui tolerates it): check the TCP port only when it was ours.
    if (tcp) expect(await conecta(Number(tcp[1]))).toBe('ECONNREFUSED');
    // The configuration was saved on the way out, with the valid keys only.
    const salva = JSON.parse(fs.readFileSync(arq, 'utf8')) as Record<string, unknown>;
    expect(salva).toMatchObject({ perfil: 'simulador-2.7.2', automacao: false, tickVazaoMs: 109.375 });
    expect(salva).not.toHaveProperty('velocidade');
  }, 30_000);
});

describe('pilhaSemCaminhos', () => {
  it('drops build-machine paths from frames, keeping basename, line and column', () => {
    const pilha = [
      'Error: perfil desconhecido: xx',
      '    at carregar (/Users/dev/github/nuvel/pump-sim/build/sea/pump-sim.cjs:37949:11)',
      '    at C:\\Users\\dev\\pump-sim\\build\\sea\\pump-sim.cjs:10:2',
      '    at file:///home/dev/pump-sim/dist/cli.js:5:1',
      '    at Module._compile (node:internal/modules/cjs/loader:1554:14)',
    ].join('\n');
    expect(pilhaSemCaminhos(pilha)).toBe(
      [
        'Error: perfil desconhecido: xx',
        '    at carregar (pump-sim.cjs:37949:11)',
        '    at pump-sim.cjs:10:2',
        '    at cli.js:5:1',
        '    at Module._compile (node:internal/modules/cjs/loader:1554:14)',
      ].join('\n'),
    );
  });

  it('leaves the message lines alone', () => {
    expect(pilhaSemCaminhos('Error: ENOENT /Users/dev/x.json:1')).toBe('Error: ENOENT /Users/dev/x.json:1');
  });
});
