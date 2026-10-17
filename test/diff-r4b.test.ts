/**
 * Fixes from the first full diff against the real 2.7.2 (diff r4b, 17/10; DECISIONS §18 and
 * docs/DECISIONS.md §20). Each block cites the step of the bench report it reproduces. All of it
 * is a quirk of `simulador-2.7.2`; the "perfis reais" checks show the real profiles did not move.
 */
import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Hub,
  LEGENDAS_EM_REPOUSO,
  MODAIS_272,
  ManualClock,
  clicarBotaoPainel,
  executarComando,
  roteiro,
  selecionarRoteiros,
} from '../src/index.js';
import { kk, novo, passo } from './util.js';

const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

const letra = (s: string | null, grupo: number) => (s ?? '').charAt(2 + grupo);
/** T6, L6, P4 of an `&A`/`&LR` reply (char 1 on). */
const nucleo = (r: string | null) => ({ total: (r ?? '').slice(1, 7), volume: (r ?? '').slice(7, 13), preco: (r ?? '').slice(13, 17) });

describe('"Carregar configuração padrão" reinicia os bicos ativos (PADRAO_272; DIFF-05/07/10, EQUIV-LEITURA)', () => {
  it('2.7.2: o preço do &U se perde, o P some até o próximo tick e volta, o bloqueio sai', () => {
    const { sim, clock } = novo();
    expect(sim.pedir(kk('&U04001234'))).toBe('(U04)');
    expect(sim.pedir('(&P05000500030)')).toBe('(P05)');
    sim.pedir(kk('?C001010100'));
    passo(sim, clock, 1000);
    expect(letra(sim.pedir('(&S)'), 1)).toBe('P');
    sim.conc.carregarConfigPadrao();
    // DIFF-05 step 0: right after the click address 2 shows L; one state tick later P again.
    expect(sim.pedir('(&S)')!.slice(0, 4)).toBe('(SLL');
    passo(sim, clock, 1000);
    expect(letra(sim.pedir('(&S)'), 1)).toBe('P');
    // DIFF-10: back to the initial price (TU shows the "next price" 11,23), not the 12,34 of the &U.
    expect(sim.pedir('(&T04U33)')).toBe('(TU040000112394)');
    // EQUIV-LEITURA: the ?C block is gone, 04 fuels (the 2.7.2 lifted it after the button).
    expect(sim.conc.bico(0x04)!.bloqueio).toBe(false);
    expect(sim.conc.lado(1, 1)!.bloqueado).toBe(false);
  });

  it('2.7.2: um bico preso abastecendo volta ao repouso (B: não medido no 2.7.2)', () => {
    const { sim, clock } = novo();
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 3000);
    expect(sim.conc.bico(0x04)!.estado).toBe('abastecendo');
    sim.conc.carregarConfigPadrao();
    expect([sim.conc.bico(0x04)!.estado, letra(sim.pedir('(&S)'), 0)]).toEqual(['repouso', 'L']);
  });

  it('perfis reais: o botão não mexe nos bicos já ativos', () => {
    const { sim } = novo('cbc-32');
    const b = sim.conc.bico(0x04)!;
    b.precos[0] = 1234;
    sim.conc.carregarConfigPadrao();
    expect(sim.conc.bico(0x04)!.precos[0]).toBe(1234);
  });
});

describe('&A: o layout 52 × 36 é o da DIP3 na gravação (A36, veredito #12; DIFF-07)', () => {
  it('2.7.2: gravado com a DIP3 ligada segue 52 depois de desligar; gravado desligada sai 36', () => {
    const { sim, clock } = novo();
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 3000);
    sim.conc.recolocarBico(0x04);
    passo(sim, clock, 2000);
    sim.conc.dips[2] = false;
    expect(sim.pedir('(&A)')).toHaveLength(52);
    sim.pedir('(&I)');
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 3000);
    sim.conc.recolocarBico(0x04);
    passo(sim, clock, 2000);
    expect(sim.pedir('(&A)')).toHaveLength(36);
  });

  it('perfil real com DIP3 (cbc05-dip3): segue a DIP3 da leitura, como antes', () => {
    const { sim, clock } = novo('cbc05-dip3');
    sim.conc.dips[2] = true;
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 3000);
    sim.conc.recolocarBico(0x04);
    passo(sim, clock, 3000);
    sim.conc.dips[2] = false;
    expect(sim.pedir('(&A)')).toHaveLength(34);
  });
});

describe('?F G: M6 = cadastro antes da gravação (IDF_272; DIFF-14/15, EQUIV-COMANDOS)', () => {
  const g = (c: string) => kk(`?F27G${c}0000235900002359`);
  it('2.7.2: 0/0, 1/1 (bancada)', () => {
    const { sim } = novo();
    expect(sim.pedir(g('ABCDEF0123456789'))!.slice(3, 15)).toBe('000000000000');
    expect(sim.pedir(g('1122334455667788'))!.slice(3, 15)).toBe('000001000001');
  });
  it('perfis reais: M6 = quantidade depois (DT435)', () => {
    const { sim } = novo('cbc-32');
    expect(sim.pedir(g('ABCDEF0123456789'))!.slice(3, 15)).toBe('000000000001');
  });
});

describe('&E: registro com o encerrante antigo, o preço configurado e a duração (E_272; EQUIV-COMANDOS #42)', () => {
  it('2.7.2: inicial = o encerrante de antes, final = o novo; preço 11,23 logo depois de um &C', () => {
    const { sim, clock } = novo();
    sim.pedir('(&E0400001000)');
    sim.pedir('(&I)');
    sim.pedir('(&CW013A010200B8)');
    passo(sim, clock, 5000);
    expect(sim.pedir('(&E0400001234)')).toBe('((TL0400001234B6)');
    const r = sim.conc.buffer.todos().at(-1)!;
    expect([r.encIniMl, r.encFimMl, r.volumeMl, r.precoUnit]).toEqual([1_000_000, 1_234_000, 0, 1123]);
    expect(nucleo(sim.pedir('(&A)')).preco).toBe('1123');
  });

  it('2.7.2: a duração conta do último início do bico (B, a bancada deu 0x2C)', () => {
    const { sim, clock } = novo();
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 3000);
    sim.conc.recolocarBico(0x04);
    passo(sim, clock, 2000);
    sim.pedir('(&I)');
    passo(sim, clock, 40_000);
    sim.pedir('(&E0400009999)');
    expect(sim.conc.buffer.todos().at(-1)!.duracaoS).toBeGreaterThanOrEqual(40);
  });
});

describe('legenda do painel e o botão como o driver o clica (§18)', () => {
  async function hub(perfil: 'simulador-2.7.2' | 'cbc-32' = 'simulador-2.7.2') {
    const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
    const h = new Hub({ clock, host: '127.0.0.1', mapa: { 2001: 0 }, semTcp: true });
    fechar.push(() => h.fechar());
    const rt = await h.criar('default', perfil);
    const cmd = (c: string, a: Record<string, unknown> = {}) => executarComando(h, c, a);
    const esperar = async (ms: number) => {
      clock.advance(ms);
      rt.tick();
    };
    const legenda = async () => ((await cmd('get_displays', { canal: 1 })) as { enderecos: { statusTexto: string }[] }).enderecos[0]!.statusTexto;
    return { cmd, esperar, legenda, rt };
  }
  const botao = (retirar: boolean) => ({ bico: '04', canal: 1, lado: 'esquerdo' as const, retirar });

  it('2.7.2: "Bicos Bloqueados" está em repouso; o clique leva a "Aguarda liberação" no tick, e volta', async () => {
    const h = await hub();
    h.rt.sim.pedir(kk('?C001010100'));
    expect(await h.legenda()).toBe('Bicos Bloqueados');
    await h.cmd('retirar_bico', { bico: '04' });
    // Before the state timer runs the caption has not changed (driver: 'Bicos Bloqueados' -> 'Aguarda liberação').
    expect(await h.legenda()).toBe('Bicos Bloqueados');
    await h.cmd('recolocar_bico', { bico: '04' });
    const chamar = (comando: string, args: Record<string, unknown>) => h.cmd(comando, args);
    expect(await clicarBotaoPainel(botao(true), chamar, h.esperar)).toBe("botão esquerdo 'Bicos Bloqueados' -> 'Aguarda liberação'");
    // Idempotent like the driver: already lifted → no click.
    expect(await clicarBotaoPainel(botao(true), chamar, h.esperar)).toBe("botão esquerdo 'Aguarda liberação' -> 'Aguarda liberação'");
    expect(await clicarBotaoPainel(botao(false), chamar, h.esperar)).toBe("botão esquerdo 'Aguarda liberação' -> 'Bicos Bloqueados'");
  });

  it('2.7.2: liberado, o retirar só volta com "Abastecendo.." (o início do abastecimento)', async () => {
    const h = await hub();
    const chamar = (comando: string, args: Record<string, unknown>) => h.cmd(comando, args);
    expect(await clicarBotaoPainel(botao(true), chamar, h.esperar)).toBe("botão esquerdo 'Retirar Bico' -> 'Abastecendo..'");
    expect(h.rt.sim.conc.bico(0x04)!.estado).toBe('abastecendo');
    expect(await clicarBotaoPainel(botao(false), chamar, h.esperar)).toBe("botão esquerdo 'Abastecendo..' -> 'Concluindo..'");
  });

  it('perfil real: a legenda de um bico retirado segue "Aguarda liberação" na hora', async () => {
    const h = await hub('cbc-32');
    await h.cmd('retirar_bico', { bico: '04' });
    expect(await h.legenda()).not.toBe('Retirar Bico');
  });

  it('o driver da bancada usa o mesmo conjunto de legendas em repouso', () => {
    const ps1 = fs.readFileSync(new URL('../tools/driver-simuladorcbc/driver.ps1', import.meta.url), 'utf8');
    const m = /\$script:LEGENDAS_REPOUSO = @\(([^)]*)\)/.exec(ps1);
    expect(m).not.toBeNull();
    expect([...m![1]!.matchAll(/'([^']*)'/g)].map((x) => x[1])).toEqual([...LEGENDAS_EM_REPOUSO]);
    expect(ps1).toMatch(/function Test-Retirado\(\[string\]\$caption\) \{ \$caption -notin \$script:LEGENDAS_REPOUSO \}/);
  });
});

describe('catálogo de modais do 2.7.2', () => {
  it('traz os textos da bancada r4b e o pump-sim abre os modelados com o mesmo texto', () => {
    const textos = MODAIS_272.map((m) => m.texto);
    for (const t of [
      'Invalid argument to date encode.',
      'Invalid argument to time encode.',
      "''XX'' is not a valid integer value.",
      "'000012X4' is not a valid floating point value.",
      "''$XX'' is not a valid integer value.",
      'Asynchronous socket error 10053.',
    ])
      expect(textos).toContain(t);
    const { sim } = novo();
    const ultimo = () => sim.conc.eventos.at(-1)?.texto;
    sim.pedir('(&KW1261016XX143000BA)');
    expect(textos).toContain(ultimo());
    sim.pedir('(&E04000012X4)');
    expect(textos).toContain(ultimo());
    sim.conc.setModelo('Horustech');
    sim.pedir('>?000B32022001500XX');
    expect(textos).toContain(ultimo());
  });
});

describe('roteiro depois da triagem r4b', () => {
  const enviados = (id: string) => roteiro(id)!.passos.flatMap((p) => ('enviar' in p ? [String(p.enviar)] : []));

  it('BANCADA-1710 (alvos recém-abertos) é o primeiro caso', () => {
    expect(selecionarRoteiros('todos')[0]!.id).toBe('BANCADA-1710');
  });

  it('DIFF-14/15 desligam o sensor e desbloqueiam o endereço 1 no fim', () => {
    for (const id of ['DIFF-14', 'DIFF-15']) expect(enviados(id).slice(-2)).toEqual([kk('&M04I'), kk('&M04L')]);
  });

  it('EQUIV-COMANDOS sem o modal segurado só no pump-sim; EQUIV-PENDENTES mede o nível com KK válido no 44', () => {
    expect(roteiro('EQUIV-COMANDOS')!.passos.some((p) => 'soPumpSim' in p && p.soPumpSim)).toBe(false);
    const q = enviados('EQUIV-PENDENTES');
    expect(q).toContain('>?000B320210015002F');
    expect(q).toContain(kk('&T44u'));
    const p55 = roteiro('EQUIV-PENDENTES')!.passos.find((p) => 'enviar' in p && p.enviar === '(?F00L31)');
    expect(p55 && 'esperado' in p55 ? p55.esperado : undefined).toBeNull();
  });

  it('DIFF-19 usa um preset que o 2.7.2 atinge em 15 s (R$ 5,00)', () => {
    expect(enviados('DIFF-19')).toContain(kk('&P08000500'));
  });
});
