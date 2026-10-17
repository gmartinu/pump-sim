/**
 * 2.7.2 × pump-sim equivalence, slice 3 (engine): the DIFERENTE / SÓ NO 2.7.2 /
 * SÓ NO PUMP-SIM rows of the behavioral-equivalence verdict fixed on the `simulador-2.7.2` profile
 * (#13, #26, #27, #63, #64, #66, #68, #69, #72–#74, #89 and #92). The frames are the
 * verdict's, with the KK checked. Real profiles follow the manual: none of these quirks applies to them.
 */
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Hub,
  ManualClock,
  PERFIS,
  ServidorTcp,
  executarComando,
  executarDiff,
  selecionarRoteiros,
  statusTextual,
} from '../src/index.js';
import { kk, novo, passo } from './util.js';

const QUIRKS_NOVOS = ['BICO_272', 'VAZAO_272', 'MS_272'] as const;
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

/** Nozzle volume in &V (hundredths of a liter), or null if the nozzle does not show. */
function volumeV(v: string | null, bb: string): number | null {
  const corpo = (v ?? '').slice(1, -1);
  for (let i = 0; i + 8 <= corpo.length; i += 8) if (corpo.slice(i, i + 2) === bb) return Number(corpo.slice(i + 2, i + 8));
  return null;
}

describe('quirks da fatia 3', () => {
  it('ligados só no simulador-2.7.2', () => {
    for (const [id, p] of Object.entries(PERFIS))
      for (const q of QUIRKS_NOVOS) expect(p.quirks[q], `${id} ${q}`).toBe(id === 'simulador-2.7.2');
  });

  it('os quadros do veredito têm o KK certo', () => {
    expect([kk('&P04000100'), kk('&M04S'), kk('&M04B'), kk('&M04A')]).toEqual([
      '(&P04000100FB)',
      '(&M04S2A)',
      '(&M04B19)',
      '(&M04A18)',
    ]);
  });
});

describe('#72/#74: preset atingido congela em A, sem encerrar', () => {
  it('(&P04000100FB), retirar, 10 s: &S A, &V parado, &A (0); o registro só sai ao recolocar', () => {
    const { sim, clock } = novo();
    expect(sim.pedir('(&P04000100FB)')).toBe('(P04)');
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 10_000);
    expect(sim.pedir('(&S)')).toMatch(/^\(SA/);
    const v1 = volumeV(sim.pedir('(&V)'), '04');
    passo(sim, clock, 2000);
    expect(volumeV(sim.pedir('(&V)'), '04')).toBe(v1);
    expect(sim.pedir('(&A)')).toBe('(0)');
    const b = sim.conc.bico(0x04)!;
    expect(b.corrente!.totalMil).toBe(1000);
    expect(b.corrente!.volumeMl).toBe(Math.floor((1000 * 10 ** 3) / b.corrente!.precoUnit));
    sim.conc.recolocarBico(0x04);
    passo(sim, clock, 1000);
    const a = sim.pedir('(&A)')!;
    expect(a.slice(1, 7)).toBe('000100'); // total R$ 1.00
  });

  it('#74: com preset e 3 casas de volume o passo é 0,130 L; sem preset, 0,129 L', () => {
    const { sim, clock } = novo();
    sim.pedir(kk('&CW013E010200'));
    const vol = (preset: boolean) => {
      if (preset) expect(sim.pedir(kk('&P04009000'))).toBe('(P04)');
      sim.conc.retirarBico(0x04);
      passo(sim, clock, 1000); // start
      passo(sim, clock, 700); // 7 blinking ticks
      passo(sim, clock, 1000); // 10 flow ticks
      const ml = sim.conc.bico(0x04)!.corrente!.volumeMl;
      sim.conc.recolocarBico(0x04);
      passo(sim, clock, 2000);
      return ml;
    };
    expect(vol(true) % 130).toBe(0);
    expect(vol(false) % 129).toBe(0);
  });

  it('control `abastecer` com valor: o "frentista" recoloca quando congela', async () => {
    const hub = new Hub({ clock: new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0)), host: '127.0.0.1', mapa: { 2001: 0, 1771: 0, 7002: 0 } });
    fechar.push(() => hub.fechar());
    await hub.criar('default', 'simulador-2.7.2');
    await executarComando(hub, 'carregar_config_padrao', {});
    await executarComando(hub, 'abastecer', { bico: '04', valor: 100 });
    const rt = hub.obter('default');
    (hub.clock as ManualClock).advance(10_000);
    rt.sim.atualizar();
    expect(rt.sim.pedir('(&A)')!.slice(1, 7)).toBe('000100');
  });
});

describe('#73/#68/#66: preset e pré-autorização por bico, sem trava de lado', () => {
  it('&P no 04 e retirar o 44: o 44 passa de R$ 1,00 e o &S mostra A (bancada diff r4b, não o P do 04)', () => {
    const { sim, clock } = novo();
    sim.pedir('(&P04000100FB)');
    sim.conc.retirarBico(0x44);
    passo(sim, clock, 10_000);
    expect(sim.conc.bico(0x44)!.corrente!.totalMil).toBeGreaterThan(1000);
    // Bench diff r4b (EQUIV-MOTOR #68): `(SAP…)` while 44 fuels; 04 keeps its pre-authorization.
    expect(sim.pedir('(&S)')).toMatch(/^\(SA/);
    expect(sim.conc.bico(0x04)!.preAut).toBe(true);
    sim.conc.recolocarBico(0x44);
    passo(sim, clock, 2000);
    // The end clears the pre-authorization and the preset of the 4 nozzles.
    expect(sim.pedir('(&S)')).toMatch(/^\(SL/);
    expect([sim.conc.bico(0x04)!.preAut, sim.conc.bico(0x04)!.presetCentavos]).toEqual([false, null]);
  });

  it('(&M04A18) com o 44 abastecendo: o 04 segue P (o início não limpa a pré-autorização)', () => {
    const { sim, clock } = novo();
    expect(sim.pedir('(&M04A18)')).toBe('(M04)');
    sim.conc.retirarBico(0x44);
    passo(sim, clock, 3000);
    expect(sim.conc.bico(0x44)!.status).toBe('A');
    // The letter is A while 44 fuels (bench diff r4b); the pre-authorization of 04 is still there.
    expect(sim.pedir('(&S)')).toMatch(/^\(SA/);
    expect([sim.conc.bico(0x04)!.preAut, sim.conc.bico(0x04)!.status]).toEqual([true, 'P']);
  });

  it('#66: o 04 e o 44 (mesmo endereço) abastecem juntos', () => {
    const { sim, clock } = novo();
    sim.conc.retirarBico(0x04);
    sim.conc.retirarBico(0x44);
    passo(sim, clock, 3000);
    const v = sim.pedir('(&V)');
    expect(volumeV(v, '04')).toBeGreaterThan(0);
    expect(volumeV(v, '44')).toBeGreaterThan(0);
  });

  it('#89: sem prazo de autorização (o ?F P com N2 não expira)', () => {
    const { sim, clock } = novo();
    const r = sim.conc.presetIdentificado({
      codigo: 0x04,
      identificador: '1',
      tipoId: 'frentista',
      autoriza: true,
      valor: 0,
      segundos: 1,
      tipoPreset: '$',
    });
    expect(r).toBe('ok');
    passo(sim, clock, 5000);
    expect(sim.conc.bico(0x04)!.status).toBe('P');
  });
});

describe('#27: &M S em qualquer estado', () => {
  it('recém-aberto: (&M04S2A) e 1,5 s depois um registro de volume zero com R0001', () => {
    const { sim, clock } = novo();
    expect(sim.pedir('(&A)')).toBe('(0)');
    expect(sim.pedir('(&M04S2A)')).toBe('(M04)');
    expect(sim.conc.bico(0x04)!.status).toBe('C');
    passo(sim, clock, 1500);
    const a = sim.pedir('(&A)')!;
    expect(a.slice(1, 13)).toBe('000000000000'); // zero total and volume
    expect(a.slice(33, 37)).toBe('0001'); // R
  });

  it('depois de um abastecimento: repete o volume/total e soma de novo no encerrante', () => {
    const { sim, clock } = novo();
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 3000);
    sim.conc.recolocarBico(0x04);
    passo(sim, clock, 2000);
    const r1 = sim.pedir('(&A)')!;
    sim.pedir('(&I6F)');
    const enc1 = sim.conc.bico(0x04)!.encerranteMl;
    sim.pedir('(&M04S2A)');
    passo(sim, clock, 2000);
    const r2 = sim.pedir('(&A)')!;
    expect(r2.slice(1, 13)).toBe(r1.slice(1, 13));
    expect(sim.conc.bico(0x04)!.encerranteMl).toBe(enc1 * 2);
  });

  it('só o bico endereçado: o 44 abastecendo segue', () => {
    const { sim, clock } = novo();
    sim.conc.retirarBico(0x44);
    passo(sim, clock, 2000);
    sim.pedir('(&M04S2A)');
    expect(sim.conc.bico(0x44)!.estado).toBe('abastecendo');
  });
});

describe('#26/#64/#63: timer de vazão pelo status e sem gate', () => {
  it('&M B congela o abastecimento: &S vai a B (bancada diff r6/r7g, §23 B2), &V (0), o volume para', () => {
    const { sim, clock } = novo();
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 3000);
    const ml = sim.conc.bico(0x04)!.corrente!.volumeMl;
    expect(ml).toBeGreaterThan(0);
    expect(sim.pedir('(&M04B19)')).toBe('(M04)');
    // Bench diff r6/r7g (EQUIV-MOTOR #26, DECISIONS §23 B2; r4b had read `(SAP…)`): `(SB…)` with the
    // nozzle frozen; its status is B (out of &V).
    expect(sim.pedir('(&S)')).toMatch(/^\(SB/);
    expect(sim.conc.bico(0x04)!.status).toBe('B');
    expect(sim.pedir('(&V)')).toBe('(0)');
    passo(sim, clock, 3000);
    expect(sim.conc.bico(0x04)!.corrente!.volumeMl).toBe(ml);
    expect(sim.conc.bico(0x04)!.estado).toBe('abastecendo');
    sim.conc.recolocarBico(0x04);
    passo(sim, clock, 2000);
    expect(sim.conc.buffer.todos().at(-1)!.volumeMl).toBe(ml);
  });

  it('Automação desligada ou DIP4 desmarcada: o volume segue subindo (só o timer de estado para)', () => {
    const { sim, clock } = novo();
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 2500);
    sim.conc.automacao = false;
    const v1 = volumeV(sim.pedir('(&V)'), '04')!;
    passo(sim, clock, 1000);
    const v2 = volumeV(sim.pedir('(&V)'), '04')!;
    expect(v2).toBeGreaterThan(v1);
    sim.conc.automacao = true;
    sim.conc.dips[3] = false;
    passo(sim, clock, 1000);
    expect(volumeV(sim.pedir('(&V)'), '04')!).toBeGreaterThan(v2);
  });
});

describe('#69: Concluindo', () => {
  it('o botão mostra "Concluindo.." do recolocar até o tick que tira o C', () => {
    const { sim, clock } = novo();
    const l = sim.conc.lado(1, 1)!;
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 2000);
    expect(statusTextual(l)).toBe('Abastecendo..');
    sim.conc.recolocarBico(0x04);
    expect(statusTextual(l)).toBe('Concluindo..');
    passo(sim, clock, 1000); // stores the record, C stays
    expect([sim.conc.bico(0x04)!.status, statusTextual(l)]).toEqual(['C', 'Concluindo..']);
    passo(sim, clock, 1000);
    expect(statusTextual(l)).toBe('Retirar Bico');
  });
});

describe('#13: o bug do ponteiro de identificados', () => {
  it('em 10000 o ponteiro de escrita vai para 1 (não 0) e não dispara de novo', () => {
    const { sim } = novo();
    sim.conc.escritaId = 9999;
    sim.pedir('(&E0400001234)');
    expect(sim.conc.buffer.escrita).toBe(1);
    expect(sim.conc.escritaId).toBe(10000);
    sim.pedir('(&E0400001235)');
    expect([sim.conc.buffer.escrita, sim.conc.escritaId]).toEqual([2, 10001]);
  });
});

describe('#92: modal 10053 a cada RST do cliente; FIN não abre modal', () => {
  const abrir = async (perfil: 'simulador-2.7.2' | 'cbc-32') => {
    const { sim } = novo(perfil);
    const s = await ServidorTcp.abrir(sim, { host: '127.0.0.1', mapa: { 2001: 0, 1771: 0, 857: 0, 7002: 0 } });
    fechar.push(() => s.fechar());
    return { sim, porta: s.portas()[0]!.fisica };
  };
  const conectar = (porta: number) =>
    new Promise<net.Socket>((res) => {
      const c = net.connect({ host: '127.0.0.1', port: porta }, () => res(c));
    });
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const modais = (sim: { conc: { eventos: { tipo: string; texto: string }[] } }) =>
    sim.conc.eventos.filter((e) => e.tipo === 'MSG' && e.texto === 'Asynchronous socket error 10053.').length;

  it('2.7.2: RST → um evento MSG por queda; FIN → nenhum; o listener segue atendendo', async () => {
    const { sim, porta } = await abrir('simulador-2.7.2');
    for (let i = 0; i < 2; i++) {
      const c = await conectar(porta);
      c.write('(&S)');
      await espera(30);
      c.resetAndDestroy();
      await espera(50);
    }
    expect(modais(sim)).toBe(2);
    const f = await conectar(porta);
    f.write('(&S)');
    await espera(30);
    f.end();
    await espera(50);
    expect(modais(sim)).toBe(2);
    const c = await conectar(porta);
    const rx = new Promise<string>((res) => c.once('data', (b) => res(b.toString('latin1'))));
    c.write('(&S)');
    expect(await rx).toMatch(/^\(S/);
    c.destroy();
  });

  it('perfil real (cbc-32): RST não abre nada', async () => {
    const { sim, porta } = await abrir('cbc-32');
    const c = await conectar(porta);
    c.write('(&S)');
    await espera(30);
    c.resetAndDestroy();
    await espera(50);
    expect(modais(sim)).toBe(0);
  });
});

describe('perfis reais: o motor segue o manual', () => {
  it('cbc-32: preset atingido encerra; &M S parado não grava; lado ocupado; o timer de estado limpa a pré-autorização', () => {
    const { sim, clock } = novo('cbc-32');
    expect(sim.pedir('(&P04000100FB)')).toBe('(P04)');
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 10_000);
    expect(sim.conc.buffer.todos()).toHaveLength(1);
    expect(sim.pedir('(&M04S2A)')).toBe('(M04)');
    passo(sim, clock, 2000);
    expect(sim.conc.buffer.todos()).toHaveLength(1);
    sim.conc.retirarBico(0x04);
    sim.conc.retirarBico(0x44);
    passo(sim, clock, 3000);
    expect([sim.conc.bico(0x04)!.estado, sim.conc.bico(0x44)!.status]).toEqual(['abastecendo', 'E']);
    sim.conc.modo(0x04, 'B');
    passo(sim, clock, 1000);
    expect(sim.conc.bico(0x04)!.status).toBe('A');
  });
});

describe('roteiro EQUIV-MOTOR', () => {
  it('pump-sim × pump-sim sem divergência e os `esperado` conferem (relógio manual)', async () => {
    const hubs: Hub[] = [];
    const clocks: ManualClock[] = [];
    const alvo = async (nome: string) => {
      const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
      const hub = new Hub({ clock, host: '127.0.0.1', mapa: { 2001: 0, 1771: 0, 7002: 0 } });
      hubs.push(hub);
      clocks.push(clock);
      const rt = await hub.criar('default', 'simulador-2.7.2');
      return { nome, alvo: { host: '127.0.0.1', porta: rt.servidor!.portas()[0]!.fisica }, controle: nome };
    };
    fechar.push(async () => {
      for (const h of hubs) await h.fechar();
    });
    const a = await alvo('A');
    const b = await alvo('B');
    const porNome: Record<string, number> = { A: 0, B: 1 };
    const rel = await executarDiff(selecionarRoteiros('EQUIV-MOTOR'), a, b, {
      timeoutMs: 150,
      ociosoMs: 30,
      chamarControle: (url, c, args) => executarComando(hubs[porNome[url]!]!, c, args),
      esperar: async (ms, x) => {
        clocks[porNome[x.controle!]!]!.advance(ms);
        await new Promise((r) => setTimeout(r, 60)); // lets the socket close (RST/FIN)
      },
    });
    const caso = rel.casos[0]!;
    expect(caso.pulados).toEqual([]);
    expect(caso.passos.filter((p) => p.aConfere === false).map((p) => `${p.quadro} → ${p.a.texto}`)).toEqual([]);
    expect(rel.total.casosComDivergencia).toEqual([]);
    const txt = (q: string) => caso.passos.filter((p) => p.quadro === q).map((p) => p.a.texto);
    // #27: the 1st &A after &M S is the zero-volume ghost record with R0001.
    expect(txt('(&A)')[1]!.slice(33, 37)).toBe('0001');
    expect(hubs[0]!.obter('default').sim.conc.eventos.filter((e) => e.texto.includes('10053'))).toHaveLength(1);
  }, 40_000);
});
