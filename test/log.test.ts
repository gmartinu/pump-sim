import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { Hub, ManualClock, abrirServidorControle } from '../src/index.js';
import { CAUDA_PADRAO, LOG_MANTER, LOG_MAX_BYTES, LogArquivo, dirLogs, espelhar, lerCauda } from '../src/ui/log.js';
import { argsErroHost, encerraComJanela } from '../src/ui/janela.js';

/**
 * DECISIONS §34: the GUI executable's log file (rotation, timestamps, mirroring of stdout/stderr),
 * the `GET /api/logs` tail of the control API and the window-close / error-dialog decisions.
 */

const T0 = Date.UTC(2026, 9, 17, 12, 0, 0);
const agora = () => new Date(T0);
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-sim-log-'));
  fechar.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

describe('dirLogs', () => {
  it('%LOCALAPPDATA%\\pump-sim\\logs, or the profile default', () => {
    expect(dirLogs({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Local\\pump-sim\\logs');
    expect(dirLogs({}, 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Local\\pump-sim\\logs');
  });

  it('defaults: 5 MB, 3 old files', () => {
    expect(LOG_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(LOG_MANTER).toBe(3);
  });
});

describe('LogArquivo', () => {
  it('appends UTF-8 with one timestamp per line, also across chunks', () => {
    const arq = path.join(tmp(), 'sub', 'pump-sim.log');
    const l = new LogArquivo({ arquivo: arq, agora });
    l.escrever('[pump-sim] ouvindo em 0.0.0.0:2001\nsegunda ');
    l.escrever('metade da linha ção\n');
    l.escrever(Buffer.from('bytes\n'));
    l.fechar();
    const ts = new Date(T0).toISOString();
    expect(fs.readFileSync(arq, 'utf8')).toBe(`${ts} [pump-sim] ouvindo em 0.0.0.0:2001\n${ts} segunda metade da linha ção\n${ts} bytes\n`);
  });

  it('rotates past maxBytes into .1 .. .manter, dropping the oldest', () => {
    const arq = path.join(tmp(), 'pump-sim.log');
    const l = new LogArquivo({ arquivo: arq, agora, maxBytes: 100, manter: 3 });
    const linha = (i: number) => `linha ${i} ${'x'.repeat(50)}\n`; // ~82 bytes with the timestamp: one per file
    for (let i = 1; i <= 6; i++) l.escrever(linha(i));
    l.fechar();
    const dir = path.dirname(arq);
    expect(fs.readdirSync(dir).sort()).toEqual(['pump-sim.log', 'pump-sim.log.1', 'pump-sim.log.2', 'pump-sim.log.3']);
    expect(fs.readFileSync(arq, 'utf8')).toContain('linha 6 ');
    expect(fs.readFileSync(`${arq}.1`, 'utf8')).toContain('linha 5 ');
    expect(fs.readFileSync(`${arq}.3`, 'utf8')).toContain('linha 3 ');
    for (const n of fs.readdirSync(dir)) expect(fs.statSync(path.join(dir, n)).size).toBeLessThanOrEqual(100);
  });

  it('a new instance keeps appending to the existing file and counts its size', () => {
    const arq = path.join(tmp(), 'pump-sim.log');
    fs.writeFileSync(arq, 'y'.repeat(90));
    const l = new LogArquivo({ arquivo: arq, agora, maxBytes: 100 });
    l.escrever('mais uma linha\n');
    l.fechar();
    expect(fs.readFileSync(`${arq}.1`, 'utf8')).toBe('y'.repeat(90));
    expect(fs.readFileSync(arq, 'utf8')).toContain('mais uma linha');
  });

  it('never throws when the folder cannot be created', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'arquivo'), '');
    const l = new LogArquivo({ arquivo: path.join(d, 'arquivo', 'pump-sim.log'), agora });
    expect(() => l.escrever('x\n')).not.toThrow();
  });
});

describe('lerCauda', () => {
  it('whole file when small; starts at a whole line when cut; missing file is empty', () => {
    const arq = path.join(tmp(), 'pump-sim.log');
    expect(lerCauda(arq)).toEqual({ texto: '', tamanho: 0 });
    fs.writeFileSync(arq, 'primeira\nsegunda\nterceira\n');
    expect(lerCauda(arq).texto).toBe('primeira\nsegunda\nterceira\n');
    expect(lerCauda(arq, 12)).toEqual({ texto: 'terceira\n', tamanho: 26 });
  });
});

describe('espelhar', () => {
  it('copies writes into the log and still passes them on; the undo restores the stream', () => {
    const arq = path.join(tmp(), 'pump-sim.log');
    const l = new LogArquivo({ arquivo: arq, agora });
    const s = new PassThrough() as unknown as NodeJS.WriteStream;
    let passou = '';
    (s as unknown as PassThrough).on('data', (c: Buffer) => (passou += c.toString()));
    const desfazer = espelhar(s, l);
    s.write('olá\n');
    desfazer();
    s.write('fora do log\n');
    l.fechar();
    expect(passou).toBe('olá\nfora do log\n');
    expect(fs.readFileSync(arq, 'utf8')).toBe(`${new Date(T0).toISOString()} olá\n`);
  });
});

describe('GET /api/logs', () => {
  async function servidor(arquivoLog: string | null) {
    const hub = new Hub({ clock: new ManualClock(T0), host: '127.0.0.1', semTcp: true });
    await hub.criar('default', 'simulador-2.7.2');
    const s = await abrirServidorControle(hub, 0, '127.0.0.1', { arquivoLog });
    fechar.push(async () => {
      await s.fechar();
      await hub.fechar();
    });
    return s;
  }

  it('returns the tail of the executable log, and /api/servidor reports it', async () => {
    const arq = path.join(tmp(), 'pump-sim.log');
    fs.writeFileSync(arq, `${'a'.repeat(CAUDA_PADRAO)}\nfim do log\n`);
    const s = await servidor(arq);
    const r = (await (await fetch(`${s.url}/api/logs`)).json()) as { ok: boolean; resultado: { ativo: boolean; arquivo: string; texto: string; tamanho: number } };
    expect(r.ok).toBe(true);
    expect(r.resultado).toEqual({ ativo: true, arquivo: arq, texto: 'fim do log\n', tamanho: CAUDA_PADRAO + 12 });
    const curta = (await (await fetch(`${s.url}/api/logs?bytes=5`)).json()) as { resultado: { texto: string } };
    expect(curta.resultado.texto).toBe('');
    const sv = (await (await fetch(`${s.url}/api/servidor`)).json()) as { resultado: { log: unknown } };
    expect(sv.resultado.log).toEqual({ ativo: true, arquivo: arq });
  });

  it('without a log file (npm CLI): inactive, empty', async () => {
    const s = await servidor(null);
    const r = (await (await fetch(`${s.url}/api/logs`)).json()) as { resultado: unknown };
    expect(r.resultado).toEqual({ ativo: false, arquivo: null, texto: '', tamanho: 0 });
    const sv = (await (await fetch(`${s.url}/api/servidor`)).json()) as { resultado: { log: unknown } };
    expect(sv.resultado.log).toEqual({ ativo: false, arquivo: null });
  });

  it('keeps the loopback guards (foreign Origin is refused)', async () => {
    const s = await servidor(path.join(tmp(), 'pump-sim.log'));
    const r = await fetch(`${s.url}/api/logs`, { headers: { origin: 'http://evil.example' } });
    expect(r.status).toBe(403);
  });

  const ipLan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  it.skipIf(!ipLan)('refuses a non-loopback peer even when bound to 0.0.0.0', async () => {
    const hub = new Hub({ clock: new ManualClock(T0), host: '127.0.0.1', semTcp: true });
    await hub.criar('default', 'simulador-2.7.2');
    const s = await abrirServidorControle(hub, 0, '0.0.0.0', { arquivoLog: path.join(tmp(), 'pump-sim.log') });
    fechar.push(async () => {
      await s.fechar();
      await hub.fechar();
    });
    const r = await fetch(`http://${ipLan}:${s.porta}/api/logs`);
    expect(r.status).toBe(403);
    expect(((await r.json()) as { erro: string }).erro).toBe('log só pelo loopback');
  });
});

describe('window close and error dialog decisions', () => {
  it('the simulator ends with the window unless the browser fallback takes over', () => {
    expect(encerraComJanela({ erroSpawn: false, codigo: 0 })).toBe(true);
    expect(encerraComJanela({ erroSpawn: false, codigo: 1 })).toBe(true);
    expect(encerraComJanela({ erroSpawn: false, codigo: null })).toBe(true);
    expect(encerraComJanela({ erroSpawn: false, codigo: 3 })).toBe(false);
    expect(encerraComJanela({ erroSpawn: true, codigo: null })).toBe(false);
  });

  it('the dialog is the host in -erro mode', () => {
    expect(argsErroHost('erro ao iniciar: x')).toEqual(['-erro', 'erro ao iniciar: x']);
  });
});
