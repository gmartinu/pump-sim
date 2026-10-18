import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Hub, ManualClock, executarComando } from '../src/index.js';
import { IDS_PERFIS } from '../src/profiles/index.js';
import { arquivoUltimaConfig, avisoUltimaConfig, lerUltimaConfig, passosUltimaConfig, sanearUltimaConfig } from '../src/ui/lembrar.js';

/**
 * `--lembrar` restore (DECISIONS §35): the saved file is validated key by key. The beta report: a
 * restart logged "set_velocidade falhou (args.velocidade: não casa com nenhuma forma aceita)" because
 * simulador-2.7.2 ticks at 109.375 ms (§29) and set_velocidade only took an integer.
 */

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-sim-lembrar-'));
  dirs.push(d);
  return d;
};
const hubs: Hub[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  await Promise.all(hubs.splice(0).map((h) => h.fechar()));
});

async function hub2_7_2() {
  const hub = new Hub({ clock: new ManualClock(Date.UTC(2026, 9, 17, 12, 0, 0)), host: '127.0.0.1', semTcp: true });
  hubs.push(hub);
  await hub.criar('default', 'simulador-2.7.2');
  return hub;
}

/** What `capturarConfig` (src/cli.ts) writes for a fresh simulador-2.7.2. */
const SALVA_2_7_2 = { perfil: 'simulador-2.7.2', portas: [2001], dips: [false, false, false, true], modelo: 'CBC-06', automacao: true, redeAC: true, bateriaVolts: 12, tickVazaoMs: 109.375 };

describe('sanearUltimaConfig', () => {
  it('keeps every valid key of a saved simulador-2.7.2 configuration, the fractional tick included', () => {
    const r = sanearUltimaConfig(SALVA_2_7_2, IDS_PERFIS);
    expect(r.ignoradas).toEqual([]);
    expect(r.config).toEqual(SALVA_2_7_2);
  });

  it('skips absent and null keys silently (an older file without the tick)', () => {
    const { tickVazaoMs: _t, ...semTick } = SALVA_2_7_2;
    const r = sanearUltimaConfig({ ...semTick, bateriaVolts: null }, IDS_PERFIS);
    expect(r.ignoradas).toEqual([]);
    expect(r.config).not.toHaveProperty('tickVazaoMs');
    expect(r.config).not.toHaveProperty('bateriaVolts');
    expect(passosUltimaConfig(r.config).map(([n]) => n)).not.toContain('set_velocidade');
    expect(passosUltimaConfig(r.config).map(([n]) => n)).not.toContain('set_bateria');
  });

  it('drops unknown and invalid keys and lists them', () => {
    const r = sanearUltimaConfig(
      { perfil: 'nao-existe', portas: [70000], dips: [1, 0], modelo: 'CBC-99', automacao: 'sim', redeAC: true, bateriaVolts: 'doze', tickVazaoMs: 0, velocidade: 'normal' },
      IDS_PERFIS,
    );
    expect(r.ignoradas).toEqual(['perfil', 'portas', 'dips', 'modelo', 'automacao', 'bateriaVolts', 'tickVazaoMs', 'velocidade']);
    expect(r.config).toEqual({ redeAC: true });
  });

  it('a file that is not an object restores nothing', () => {
    expect(sanearUltimaConfig([1, 2])).toEqual({ config: {}, ignoradas: ['(arquivo não é um objeto)'] });
    expect(sanearUltimaConfig(null)).toEqual({ config: {}, ignoradas: [] });
  });

  it('one concise warning line, or none', () => {
    expect(avisoUltimaConfig('/x/ultima-config.json', [])).toBeNull();
    expect(avisoUltimaConfig('/x/ultima-config.json', ['velocidade'])).toBe('[pump-sim] última configuração (/x/ultima-config.json): entrada ignorada (desconhecidas ou inválidas): velocidade');
    const v = avisoUltimaConfig('/x/ultima-config.json', ['velocidade', 'dips'])!;
    expect(v).toBe('[pump-sim] última configuração (/x/ultima-config.json): entradas ignoradas (desconhecidas ou inválidas): velocidade, dips');
    expect(v).not.toContain('\n');
  });
});

describe('lerUltimaConfig', () => {
  it('missing file: empty, no warning; invalid JSON: empty, one warning; BOM accepted', () => {
    const d = tmp();
    const arq = path.join(d, 'ultima-config.json');
    expect(lerUltimaConfig(arq)).toEqual({ config: {}, aviso: null });
    fs.writeFileSync(arq, '{"perfil": ');
    expect(lerUltimaConfig(arq)).toEqual({ config: {}, aviso: `[pump-sim] última configuração (${arq}): JSON inválido, ignorada` });
    fs.writeFileSync(arq, `\uFEFF${JSON.stringify({ perfil: 'cbc-32', extra: 1 })}`);
    expect(lerUltimaConfig(arq, IDS_PERFIS)).toEqual({ config: { perfil: 'cbc-32' }, aviso: `[pump-sim] última configuração (${arq}): entrada ignorada (desconhecidas ou inválidas): extra` });
  });

  it('the file location per platform', () => {
    expect(arquivoUltimaConfig('win32', { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'C:\\Users\\u')).toBe(path.join('C:\\Users\\u\\AppData\\Roaming', 'pump-sim', 'ultima-config.json'));
    expect(arquivoUltimaConfig('linux', { XDG_CONFIG_HOME: '/cfg' }, '/home/u')).toBe(path.join('/cfg', 'pump-sim', 'ultima-config.json'));
    expect(arquivoUltimaConfig('darwin', {}, '/Users/u')).toBe(path.join('/Users/u', '.config', 'pump-sim', 'ultima-config.json'));
  });
});

describe('restore through the control commands', () => {
  it('every step of a saved simulador-2.7.2 configuration is accepted (the 109.375 ms tick included)', async () => {
    const hub = await hub2_7_2();
    const passos = passosUltimaConfig(sanearUltimaConfig(SALVA_2_7_2, IDS_PERFIS).config);
    expect(passos.map(([n]) => n)).toEqual(['set_dip', 'set_dip', 'set_dip', 'set_dip', 'set_modelo', 'set_automacao', 'set_rede_ac', 'set_bateria', 'set_velocidade']);
    for (const [nome, args] of passos) await expect(executarComando(hub, nome, args), nome).resolves.toBeDefined();
    const est = (await executarComando(hub, 'get_estado_simulador')) as { timers: { tickVazaoMs: number } };
    expect(est.timers.tickVazaoMs).toBe(109.375);
  });

  it('set_velocidade: a fractional tick is accepted, below 1 ms and other strings are still refused', async () => {
    const hub = await hub2_7_2();
    await expect(executarComando(hub, 'set_velocidade', { velocidade: 62.5 })).resolves.toEqual({ tickVazaoMs: 62.5 });
    await expect(executarComando(hub, 'set_velocidade', { velocidade: 0.5 })).rejects.toThrow(/velocidade/);
    await expect(executarComando(hub, 'set_velocidade', { velocidade: 'turbo' })).rejects.toThrow(/velocidade/);
    await expect(executarComando(hub, 'set_velocidade', { velocidade: 'rapido' })).resolves.toBeDefined();
  });

  it('real profiles: the saved tick of each profile restores as is', async () => {
    for (const id of IDS_PERFIS) {
      const hub = new Hub({ clock: new ManualClock(Date.UTC(2026, 9, 17, 12, 0, 0)), host: '127.0.0.1', semTcp: true });
      hubs.push(hub);
      await hub.criar('default', id);
      const tick = ((await executarComando(hub, 'get_estado_simulador')) as { timers: { tickVazaoMs: number } }).timers.tickVazaoMs;
      expect(sanearUltimaConfig({ perfil: id, tickVazaoMs: tick }, IDS_PERFIS).ignoradas, id).toEqual([]);
      await expect(executarComando(hub, 'set_velocidade', { velocidade: tick }), id).resolves.toEqual({ tickVazaoMs: tick });
    }
  });
});
