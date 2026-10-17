/**
 * Diff infrastructure: action steps (2.7.2 UI driver × pump-sim control API),
 * the `drenar` step, DIFF-17 with a configurable N, the fixed DIFF-13/16 frames and
 * replay with the recorded profile's framing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClienteTcp,
  DIFF17_N_PADRAO,
  Hub,
  ManualClock,
  type PassoAcao,
  type PerfilId,
  ROTEIROS,
  ServidorReplay,
  TIPOS_ACAO,
  acaoParaPumpSim,
  enquadramentoDaGravacao,
  estadoUiInicial,
  executarComando,
  executarDiff,
  roteiro,
  selecionarRoteiros,
  telaDoBico,
  validarAcao,
} from '../src/index.js';
import type { AlvoDiff, LinhaGravacao, RespostaDriver } from '../src/index.js';

const HOST = '127.0.0.1';
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

async function alvoSim(nome: string, perfil: PerfilId = 'simulador-2.7.2') {
  const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
  const hub = new Hub({ clock, host: HOST, mapa: { 2001: 0, 1771: 0, 857: 0, 7002: 0 } });
  fechar.push(() => hub.fechar());
  const rt = await hub.criar('default', perfil);
  const alvo: AlvoDiff = { nome, alvo: { host: HOST, porta: rt.servidor!.portas()[0]!.fisica } };
  return { hub, rt, clock, alvo };
}

const acoesDe = (ids: string[]) =>
  ids.flatMap((id) => roteiro(id)!.passos.filter((p): p is PassoAcao => 'acao' in p));

describe('ações (dados e mapeamento)', () => {
  it('toda ação do roteiro tem parâmetros válidos para o contrato do driver', () => {
    const erros = ROTEIROS.flatMap((c) => c.passos.filter((p): p is PassoAcao => 'acao' in p).flatMap((p) => validarAcao(p).map((e) => `${c.id}: ${e}`)));
    expect(erros).toEqual([]);
    expect(validarAcao({ acao: 'dip', params: { n: 5, ligado: true } })).toEqual(['dip fora de 1..4: 5']);
    expect(validarAcao({ acao: 'velocidade', params: { valor: 'Rápido' } })).toEqual([]);
  });

  it('os casos manuais da spec viraram ações (sem "interativo" onde o driver cobre)', () => {
    for (const id of ['DIFF-01', 'DIFF-05', 'DIFF-06', 'DIFF-07', 'DIFF-08', 'DIFF-09', 'DIFF-17', 'DIFF-18', 'DIFF-19', 'DIFF-20']) {
      const manuais = roteiro(id, { diff17N: 2 })!.passos.filter((p) => 'manual' in p);
      expect(manuais, id).toEqual([]);
    }
    // IDF/card through the UI is not in the driver: stays manual, with the reason.
    for (const id of ['DIFF-14', 'DIFF-15']) {
      const manuais = roteiro(id)!.passos.filter((p) => 'manual' in p);
      expect(manuais.length, id).toBeGreaterThan(0);
      for (const m of manuais) expect('semDriver' in m && m.semDriver, id).toMatch(/IDF/);
    }
    // config_padrao first: a fresh 2.7.2 opens with no nozzle configured (bench diff r6).
    expect(acoesDe(['DIFF-14']).map((a) => a.acao)).toEqual(['config_padrao', 'canal', 'bico_radio', 'retirar', 'canal', 'bico_radio', 'recolocar']);
  });

  it('bico → tela do 2.7.2: esquerdo = endereço 1, direito = 2, alt = posição 1', () => {
    expect(telaDoBico('04')).toEqual({ canal: 1, lado: 'esquerdo', alt: false });
    expect(telaDoBico('05')).toEqual({ canal: 1, lado: 'direito', alt: false });
    expect(telaDoBico('0C')).toEqual({ canal: 3, lado: 'esquerdo', alt: false });
    expect(telaDoBico('44')).toEqual({ canal: 1, lado: 'esquerdo', alt: true });
    expect(() => telaDoBico('06')).toThrow(/não tem botão/);
  });

  it('mapeamento para a API do pump-sim, com o estado de tela', () => {
    const ui = estadoUiInicial();
    const m = (acao: PassoAcao['acao'], params: Record<string, unknown> = {}) => acaoParaPumpSim({ acao, params }, ui);
    expect(m('retirar', { lado: 'esquerdo' })).toEqual([{ botao: { bico: '04', canal: 1, lado: 'esquerdo', retirar: true } }]);
    expect(m('canal', { n: 2 })).toEqual([]);
    expect(m('bico_radio', { lado: 'direito', alt: true })).toEqual([]);
    expect(m('recolocar', { lado: 'direito' })).toEqual([{ botao: { bico: '49', canal: 2, lado: 'direito', retirar: false } }]);
    expect(m('abastecer', { lado: 'esquerdo', segundos: 2 })).toEqual([
      { botao: { bico: '08', canal: 2, lado: 'esquerdo', retirar: true } },
      { aguardar: 2000 },
      { botao: { bico: '08', canal: 2, lado: 'esquerdo', retirar: false } },
    ]);
    expect(m('dip', { n: 3, ligado: false })).toEqual([{ comando: 'set_dip', args: { n: 3, on: false } }]);
    expect(m('velocidade', { valor: 'Rapido' })).toEqual([{ comando: 'set_velocidade', args: { velocidade: 'rapido' } }]);
    expect(m('modelo', { valor: 'Horustech' })).toEqual([{ comando: 'set_modelo', args: { modelo: 'Horustech' } }]);
    expect(m('automacao', { valor: 'Desligado' })).toEqual([{ comando: 'set_automacao', args: { on: false } }]);
    expect(m('porta', { valor: 1771 })).toEqual([{ comando: 'abrir_porta', args: { porta: 1771 } }]);
    expect(m('config_padrao')).toEqual([{ comando: 'carregar_config_padrao', args: {} }]);
    expect(m('fechar_modais')).toEqual([{ comando: 'liberar_travamento', args: {} }]);
    expect(m('aba', { nome: 'Comunicação' })).toEqual([]);
    expect(TIPOS_ACAO).toHaveLength(13);
  });
});

describe('quadros corrigidos', () => {
  it('DIFF-16 usa o 32 com preço de 6 dígitos do manual; DIFF-13 sem o (&CH0213)', () => {
    const quadros = (id: string) => roteiro(id)!.passos.flatMap((p) => ('enviar' in p ? [String(p.enviar)] : []));
    expect(quadros('DIFF-16')).toContain('>?000B320200011112C');
    expect(quadros('DIFF-16').some((q) => q.startsWith('>?000A32'))).toBe(false);
    expect(quadros('DIFF-13')).not.toContain('(&CH0213)');
  });
});

describe('executor: driver no A, pump-sim no B', () => {
  it('DIFF-05: a ação vai ao driver como {tipo, ...params}; os dois lados iguais', async () => {
    const a = await alvoSim('A');
    const b = await alvoSim('B');
    // Fake driver: records the body and applies it to hub A as the UI would.
    const corpos: Record<string, unknown>[] = [];
    const uiA = estadoUiInicial();
    const chamarDriver = async (url: string, corpo: Record<string, unknown>): Promise<RespostaDriver> => {
      expect(url).toBe('http://driver');
      corpos.push(corpo);
      const { tipo, ...params } = corpo;
      for (const it of acaoParaPumpSim({ acao: tipo as PassoAcao['acao'], params }, uiA)) {
        if ('comando' in it) await executarComando(a.hub, it.comando, it.args);
      }
      return { ok: true, modais_fechados: tipo === 'dip' ? [{ texto: 'Teste' }] : [] };
    };
    const rel = await executarDiff(
      selecionarRoteiros('DIFF-05'),
      { ...a.alvo, driver: 'http://driver' },
      { ...b.alvo, controle: 'B' },
      { timeoutMs: 120, ociosoMs: 30, chamarDriver, chamarControle: (_u, c, args) => executarComando(b.hub, c, args) },
    );
    const caso = rel.casos[0]!;
    expect(caso.pulados).toEqual([]);
    expect(caso.divergencias).toBe(0);
    expect(corpos).toEqual([{ tipo: 'config_padrao' }, { tipo: 'dip', n: 1, ligado: true }, { tipo: 'dip', n: 1, ligado: false }]);
    expect(caso.acoes.filter((x) => !x.ok)).toEqual([]);
    expect(caso.acoes.find((x) => x.alvo === 'A' && x.modais)?.modais).toEqual(['Teste']);
    expect(caso.acoes.filter((x) => x.passo === 'drenar').map((x) => x.detalhe)).toEqual(['0 registro(s) lido(s)', '0 registro(s) lido(s)']);
  }, 20_000);

  it('erro do driver vira ação falha no relatório, sem derrubar o diff', async () => {
    const a = await alvoSim('A');
    const b = await alvoSim('B');
    const rel = await executarDiff(
      selecionarRoteiros('DIFF-01'),
      { ...a.alvo, driver: 'http://driver' },
      { ...b.alvo, controle: 'B' },
      {
        timeoutMs: 120,
        ociosoMs: 30,
        chamarDriver: () => Promise.reject(new Error('driver fechar_modais: rota desconhecida')),
        chamarControle: (_u, c, args) => executarComando(b.hub, c, args),
      },
    );
    expect(rel.casos[0]!.acoes.filter((x) => !x.ok).map((x) => `${x.alvo} ${x.passo}`)).toEqual(['A config_padrao', 'A fechar_modais']);
  }, 20_000);

  it('manual: `soPumpSim` não faz nada no driver; IDF fica pulado com o motivo', async () => {
    const a = await alvoSim('A');
    const b = await alvoSim('B');
    const caso = {
      id: 'X',
      titulo: 'x',
      resolve: 'x',
      passos: [
        { manual: 'segurar o modal', controle: [{ comando: 'configurar_travamento', args: { ms: null } }], soPumpSim: true },
        { manual: 'cartão', controle: [{ comando: 'apresentar_cartao', args: { canal: 1, endereco: 1, codigo: '1122334455667788' } }], semDriver: 'sem IDF' },
        { enviar: '(&V)' },
      ],
    };
    const rel = await executarDiff([caso], { ...a.alvo, driver: 'http://driver' }, { ...b.alvo, controle: 'B' }, {
      timeoutMs: 120,
      ociosoMs: 30,
      chamarDriver: () => Promise.reject(new Error('não devia chamar')),
      chamarControle: (_u, c, args) => executarComando(b.hub, c, args),
    });
    expect(rel.casos[0]!.pulados).toEqual([{ alvo: 'A', texto: 'cartão [sem IDF]' }]);
    expect(b.rt.sim.conc.travamentoMs).toBeNull();
    expect(a.rt.sim.conc.travamentoMs).toBe(0);
  });
});

describe('drenar', () => {
  it('lê (&A)/(&I) até (0) e o caso começa sem registros', async () => {
    const a = await alvoSim('A');
    const b = await alvoSim('B');
    await executarComando(a.hub, 'gerar_abastecimentos', { bico: '04', quantidade: 3, volume: 100 });
    const caso = { id: 'X', titulo: 'x', resolve: 'x', passos: [{ drenar: true as const }, { enviar: '(&A)' }] };
    const rel = await executarDiff([caso], a.alvo, b.alvo, { timeoutMs: 120, ociosoMs: 30 });
    const c = rel.casos[0]!;
    expect(c.acoes.map((x) => `${x.alvo} ${x.detalhe}`)).toEqual(['A 3 registro(s) lido(s)', 'B 0 registro(s) lido(s)']);
    expect(c.passos[0]!.a.texto).toBe('(0)');
    expect(c.divergencias).toBe(0);
  });
});

describe('DIFF-17: loop de abastecer em Rápido', () => {
  it('N configurável; o padrão é 1001', () => {
    const n = (c: ReturnType<typeof roteiro>) => c!.passos.filter((p) => 'acao' in p && p.acao === 'abastecer').length;
    expect(n(roteiro('DIFF-17'))).toBe(DIFF17_N_PADRAO);
    expect(n(roteiro('DIFF-17', { diff17N: 5 }))).toBe(5);
    expect(selecionarRoteiros('todos', { diff17N: 2, incluirOpcionais: true }).find((c) => c.id === 'DIFF-17')!.titulo).toMatch(/^2 /);
    expect(() => roteiro('DIFF-17', { diff17N: 0 })).toThrow(/N inválido/);
  });

  it('N = 3 pela API do pump-sim (relógio manual): 3 registros nos dois lados, sem divergência', async () => {
    const a = await alvoSim('A');
    const b = await alvoSim('B');
    const porNome: Record<string, typeof a> = { A: a, B: b };
    const rel = await executarDiff(selecionarRoteiros('DIFF-17', { diff17N: 3 }), { ...a.alvo, controle: 'A' }, { ...b.alvo, controle: 'B' }, {
      timeoutMs: 120,
      ociosoMs: 30,
      chamarControle: (u, c, args) => executarComando(porNome[u]!.hub, c, args),
      esperar: async (ms, x) => {
        porNome[x.nome]!.clock.advance(ms);
        porNome[x.nome]!.rt.tick();
      },
    });
    const caso = rel.casos[0]!;
    expect(caso.pulados).toEqual([]);
    expect(caso.acoes.filter((x) => !x.ok)).toEqual([]);
    expect(caso.divergencias).toBe(0);
    expect(a.rt.sim.conc.buffer.todos()).toHaveLength(3);
    expect(caso.passos[0]!.a.texto).toMatch(/^\(TG/);
  }, 20_000);
});

describe('replay com o enquadramento do perfil gravado', () => {
  const gravacao = (meta: Record<string, unknown>): LinhaGravacao[] => {
    const hex = (s: string) => Buffer.from(s, 'latin1').toString('hex');
    return [
      { ts: 0, porta: 0, conexao: 0, dir: 'meta', bytes: '', meta: { formato: 'pump-sim/trafego@1', ...meta } },
      { ts: 1, porta: 2001, conexao: 1, dir: 'abre', bytes: '' },
      { ts: 2, porta: 2001, conexao: 1, dir: 'rx', bytes: hex('(&S)(&V)') },
      { ts: 3, porta: 2001, conexao: 1, dir: 'tx', bytes: hex('(SX)') },
      { ts: 4, porta: 2001, conexao: 1, dir: 'rx', bytes: hex('(&S') },
      { ts: 5, porta: 2001, conexao: 1, dir: 'tx', bytes: hex('(SY)') },
    ];
  };

  it('o modo sai do meta.enquadramento ou do Q1 do perfil gravado', () => {
    expect(enquadramentoDaGravacao(gravacao({ perfil: 'simulador-2.7.2' }))).toBe('leituraUnica');
    expect(enquadramentoDaGravacao(gravacao({ perfil: 'cbc-32' }))).toBe('fluxo');
    expect(enquadramentoDaGravacao(gravacao({ perfil: 'cbc-32', enquadramento: 'leituraUnica' }))).toBe('leituraUnica');
    expect(enquadramentoDaGravacao(gravacao({}))).toBe('fluxo');
  });

  async function respostas(linhas: LinhaGravacao[], op: { enquadramento?: 'fluxo' | 'leituraUnica' } = {}) {
    const srv = await ServidorReplay.abrir(linhas, { host: HOST, mapa: { '2001': 0 }, ...op });
    fechar.push(() => srv.fechar());
    const c = await ClienteTcp.conectar({ host: HOST, porta: srv.portas()[0]!.fisica });
    fechar.push(() => c.fechar());
    const out: string[] = [];
    for (const q of ['(&S)(&V)', '(&S']) out.push((await c.trocar([q], { timeoutMs: 150, ociosoMs: 30 })).bytes.toString('latin1'));
    return { srv, out };
  }

  it('2.7.2 gravado: cada leitura é um comando (só o 1º quadro, e o (&S sem `)` é atendido)', async () => {
    const { srv, out } = await respostas(gravacao({ perfil: 'simulador-2.7.2' }));
    expect(srv.enquadramento).toBe('leituraUnica');
    expect(out).toEqual(['(SX)', '(SY)']);
  });

  it('perfil real gravado: fluxo (o tx vai ao último quadro do rx; o (&S fica esperando o `)`)', async () => {
    const { srv, out } = await respostas(gravacao({ perfil: 'cbc-32' }));
    expect(srv.enquadramento).toBe('fluxo');
    expect(out).toEqual(['(SX)', '']);
  });

  it('a gravação nova leva o enquadramento no meta', async () => {
    const { rt } = await alvoSim('A');
    const g = rt.gravarInicio(null);
    expect(g.linhas[0]!.meta).toMatchObject({ perfil: 'simulador-2.7.2', enquadramento: 'leituraUnica' });
    rt.gravarFim();
  });
});
