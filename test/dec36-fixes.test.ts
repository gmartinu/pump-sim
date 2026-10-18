import { afterEach, describe, expect, it } from 'vitest';
import {
  CATALOGO,
  ClienteTcp,
  ErroComando,
  Hub,
  InjetorFalhas,
  ManualClock,
  NOMES_HANDLERS,
  type PerfilId,
  executarComando,
  letraErro,
  quadroErro,
} from '../src/index.js';
import { kk } from './util.js';

/**
 * DECISIONS §36 (posto bench run 1 fixes): P1 `erro` fault frame, P2 `reiniciar_processo`, P3 `set_perfil`
 * ports, F1 communication log of fired faults, F3 `reset manter_config` on the 2.7.2.
 */

const EFEMERAS = { 2001: 0, 1771: 0, 857: 0, 7002: 0 };
const HOST = '127.0.0.1';
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

type Log = { t: number; porta: string; dir: 'RX' | 'TX' | 'ERRO' | 'INFO'; texto: string };

async function novo(perfil: PerfilId = 'simulador-2.7.2') {
  const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
  const hub = new Hub({ clock, host: HOST, mapa: EFEMERAS });
  fechar.push(() => hub.fechar());
  const rt = await hub.criar('default', perfil);
  const cmd = <T = Record<string, unknown>>(nome: string, args: Record<string, unknown> = {}) => executarComando(hub, nome, args) as Promise<T>;
  const conectar = async (logica = rt.servidor!.portas()[0]!.logica) => {
    const c = await ClienteTcp.conectar({ host: HOST, porta: rt.servidor!.fisica(logica)! });
    fechar.push(() => c.fechar());
    return c;
  };
  const txt = async (c: ClienteTcp, q: string, timeoutMs = 150) => (await c.trocar([q], { timeoutMs, ociosoMs: 40 })).bytes.toString('latin1');
  const log = async () => (await cmd<{ log: Log[] }>('get_log_comunicacao')).log;
  /** The log entries (dir, texto) written by `fn`. */
  const delta = async (fn: () => Promise<unknown>) => {
    const antes = (await log()).length;
    await fn();
    // Connection bookkeeping lines are not what the fault wrote.
    return (await log()).slice(antes).filter((e) => !/^(conectou|desconectou)/.test(e.texto)).map((e) => [e.dir, e.texto] as const);
  };
  return { hub, rt, clock, cmd, conectar, txt, log, delta };
}

const portasLogicas = (rt: Awaited<ReturnType<typeof novo>>['rt']) => rt.servidor!.portas().map((p) => p.logica);

// ───────────────────────── P1: erro ─────────────────────────
describe('P1: o frame da falha erro (letraErro/quadroErro)', () => {
  it('letraErro: letra do verbo; &U usa o ackPreco do perfil; Identfid; Horustech e desconhecido sem letra', () => {
    expect(letraErro('(&M04B19)')).toBe('M');
    expect(letraErro('(&T04L2A)')).toBe('T');
    expect(letraErro('(&U04001234XX)')).toBe('U');
    expect(letraErro('(&U04001234XX)', 'M')).toBe('M');
    expect(letraErro('(&M04B19)', 'M')).toBe('M');
    expect(letraErro('(?F27GB32800000000012300)')).toBe('F');
    expect(letraErro('(?LF000002F3)')).toBe('L');
    expect(letraErro('>?00020263')).toBe('');
    expect(letraErro('lixo')).toBe('');
    expect(letraErro('')).toBe('');
  });

  it('quadroErro: "(" + letra + código + ")"; código sem "?" sai literal; sem código = ?t', () => {
    expect(quadroErro('(&M04B19)', '?r')).toBe('(M?r)');
    expect(quadroErro('(&U04001234XX)', '?t')).toBe('(U?t)');
    expect(quadroErro('(&U04001234XX)', '?t', 'M')).toBe('(M?t)');
    expect(quadroErro('(?F27GB3280)', '?b')).toBe('(F?b)');
    expect(quadroErro('>?00020263', '?b')).toBe('(?b)');
    expect(quadroErro('(&M04B19)')).toBe('(M?t)');
    expect(quadroErro('(&M04B19)', 'XYZ')).toBe('(XYZ)');
    expect(quadroErro('(&M04B19)', 'M?r')).toBe('(M?r)');
  });

  it('2.7.2: (&M04B19) + ?r responde (M?r) e NÃO aplica o bloqueio', async () => {
    const { rt, cmd, conectar, txt } = await novo();
    const c = await conectar();
    await cmd('injetar_falha', { tipo: 'erro', verbo: '&M', param: { codigo: '?r' } });
    expect(await txt(c, '(&M04B19)')).toBe('(M?r)');
    expect(rt.sim.conc.bico(4)!.bloqueio).toBeFalsy();
    // One shot: the next one is the natural reply and applies.
    expect(await txt(c, '(&M04B19)')).toBe('(M04)');
    expect(rt.sim.conc.bico(4)!.bloqueio).toBe(true);
  });

  it('aplicar:true aplica o comando mas troca a resposta natural pelo erro', async () => {
    const { rt, cmd, conectar, txt } = await novo();
    const c = await conectar();
    await cmd('injetar_falha', { tipo: 'erro', verbo: '&M', param: { codigo: '?r', aplicar: true } });
    expect(await txt(c, '(&M04B19)')).toBe('(M?r)');
    expect(rt.sim.conc.bico(4)!.bloqueio).toBe(true);
  });

  it('código sem "?" sai verbatim entre parênteses', async () => {
    const { cmd, conectar, txt } = await novo();
    const c = await conectar();
    await cmd('injetar_falha', { tipo: 'erro', verbo: '&T', param: { codigo: 'XYZ' } });
    expect(await txt(c, '(&T04L2A)')).toBe('(XYZ)');
  });

  it('&U num perfil real: a letra é o ackPreco do perfil ((U?t))', async () => {
    const { rt, cmd, conectar, txt } = await novo('cbc-32');
    const c = await conectar();
    await cmd('injetar_falha', { tipo: 'erro', verbo: '&U', param: { codigo: '?t' } });
    expect(await txt(c, kk('&U04001234'))).toBe(`(${rt.perfil.ackPreco}?t)`);
    expect(rt.perfil.ackPreco).toBe('U');
  });

  it('Identfid (?F…) → (F?b); o cadastro não é aplicado', async () => {
    const { cmd, conectar, txt } = await novo('cbc-32');
    const c = await conectar();
    await cmd('injetar_falha', { tipo: 'erro', verbo: '?F', param: { codigo: '?b' } });
    expect(await txt(c, '(?F27GB32800000000012300000000000000005A)')).toBe('(F?b)');
    expect((await cmd<{ quantidade: number }>('list_cartoes')).quantidade).toBe(0);
  });

  it('Horustech: sem letra ((?b))', async () => {
    const { cmd, conectar, txt } = await novo('horustech-48');
    const c = await conectar(2001);
    await cmd('injetar_falha', { tipo: 'erro', verbo: '>', param: { codigo: '?b' } });
    expect(await txt(c, '>?00020263')).toBe('(?b)');
  });
});

// ───────────────────────── F1: communication log ─────────────────────────
describe('F1: toda falha dispara aparece no get_log_comunicacao', () => {
  it('frame sem regra: exatamente RX + TX, como antes', async () => {
    const { conectar, txt, delta } = await novo();
    const c = await conectar();
    const d = await delta(() => txt(c, '(&T04L2A)'));
    expect(d).toEqual([
      ['RX', '(&T04L2A)'],
      ['TX', '(TL040000000084)'],
    ]);
  });

  it('erro (padrão): RX + INFO "não aplicado" + TX do erro', async () => {
    const { cmd, conectar, txt, delta } = await novo();
    const c = await conectar();
    const f = (await cmd<{ id: number }>('injetar_falha', { tipo: 'erro', verbo: '&M', param: { codigo: '?r' } })).id;
    const d = await delta(() => txt(c, '(&M04B19)'));
    expect(d).toEqual([
      ['RX', '(&M04B19)'],
      ['INFO', `falha erro #${f} (simulador: não aplicado)`],
      ['TX', '(M?r)'],
    ]);
  });

  it('erro aplicar:true: o simulador viu o frame, o INFO traz a resposta natural que não saiu e só o erro tem TX', async () => {
    const { cmd, conectar, txt, delta } = await novo();
    const c = await conectar();
    const f = (await cmd<{ id: number }>('injetar_falha', { tipo: 'erro', verbo: '&M', param: { codigo: '?r', aplicar: true } })).id;
    const d = await delta(() => txt(c, '(&M04B19)'));
    expect(d).toEqual([
      ['RX', '(&M04B19)'],
      ['INFO', `falha erro #${f} (simulador: (M04))`],
      ['TX', '(M?r)'],
    ]);
  });

  it('aplicar:false (atraso): RX + INFO "não aplicado" e nenhum TX', async () => {
    const { cmd, conectar, txt, delta } = await novo();
    const c = await conectar();
    const f = (await cmd<{ id: number }>('injetar_falha', { tipo: 'atraso', verbo: '&T', param: { ms: 20, aplicar: false } })).id;
    const d = await delta(() => txt(c, '(&T04L2A)'));
    expect(d[0]).toEqual(['RX', '(&T04L2A)']);
    expect(d[1]).toEqual(['INFO', `falha atraso #${f} 20 ms (simulador: não aplicado)`]);
    expect(d.filter(([dir]) => dir === 'TX')).toEqual([]);
  });

  it('sem_resposta: INFO com a resposta do simulador, INFO "sem resposta" e nenhum TX', async () => {
    const { cmd, conectar, txt, delta } = await novo();
    const c = await conectar();
    const f = (await cmd<{ id: number }>('injetar_falha', { tipo: 'sem_resposta', verbo: '&T' })).id;
    const d = await delta(() => txt(c, '(&T04L2A)'));
    expect(d).toEqual([
      ['RX', '(&T04L2A)'],
      ['INFO', `falha sem_resposta #${f} (simulador: (TL040000000084))`],
      ['INFO', 'falha sem_resposta: sem resposta'],
    ]);
  });

  it('fragmentar: um TX por parte e as partes remontam a resposta', async () => {
    const { cmd, conectar, txt, delta } = await novo();
    const c = await conectar();
    const base = await txt(c, '(&T04L2A)');
    await cmd('injetar_falha', { tipo: 'fragmentar', verbo: '&T', param: { partes: 3, ms: 10 } });
    const d = await delta(() => txt(c, '(&T04L2A)', 300));
    const tx = d.filter(([dir]) => dir === 'TX').map(([, t]) => t);
    expect(tx).toHaveLength(3);
    expect(tx.join('')).toBe(base);
    expect(d.filter(([dir]) => dir === 'INFO')[0]![1]).toMatch(/^falha fragmentar #\d+ 10 ms \(simulador: \(TL040000000084\)\)$/);
  });

  it('resposta_dupla: dois TX iguais', async () => {
    const { cmd, conectar, txt, delta } = await novo();
    const c = await conectar();
    const base = await txt(c, '(&T04L2A)');
    await cmd('injetar_falha', { tipo: 'resposta_dupla', verbo: '&T' });
    const d = await delta(() => txt(c, '(&T04L2A)'));
    expect(d.filter(([dir]) => dir === 'TX')).toEqual([
      ['TX', base],
      ['TX', base],
    ]);
  });

  it('truncado, frame_corrompido e checksum_errado: o TX logado são os bytes alterados que saíram', async () => {
    const { cmd, conectar, txt, delta } = await novo();
    const c = await conectar();
    const base = await txt(c, '(&T04L2A)');
    await cmd('injetar_falha', { tipo: 'truncado', verbo: '&T', param: { bytes: 3 } });
    const t = await delta(() => txt(c, '(&T04L2A)'));
    expect(t.filter(([dir]) => dir === 'TX')).toEqual([['TX', base.slice(0, -3)]]);

    await cmd('injetar_falha', { tipo: 'frame_corrompido', verbo: '&T', param: { bytes: 2 } });
    const fc = await delta(() => txt(c, '(&T04L2A)'));
    const txFc = fc.filter(([dir]) => dir === 'TX').map(([, x]) => x);
    expect(txFc).toHaveLength(1);
    expect(txFc[0]).toHaveLength(base.length);
    expect(txFc[0]).toContain('##');
    expect(txFc[0]).not.toBe(base);

    await cmd('injetar_falha', { tipo: 'checksum_errado', verbo: '&T' });
    const ck = await delta(() => txt(c, '(&T04L2A)'));
    const txCk = ck.filter(([dir]) => dir === 'TX').map(([, x]) => x);
    expect(txCk).toHaveLength(1);
    expect(txCk[0]).not.toBe(base);
    expect(txCk[0]!.slice(0, -3)).toBe(base.slice(0, -3));
  });

  it('atraso: o TX é logado quando a falha dispara, não quando a resposta sai', async () => {
    const { cmd, conectar, delta, txt } = await novo();
    const c = await conectar();
    const base = await txt(c, '(&T04L2A)');
    await cmd('injetar_falha', { tipo: 'atraso', verbo: '&T', param: { ms: 400 } });
    // The client gives up after 40 ms, long before the 400 ms delay.
    const d = await delta(() => txt(c, '(&T04L2A)', 40));
    expect(d.filter(([dir]) => dir === 'TX')).toEqual([['TX', base]]);
    expect(d.some(([dir, t]) => dir === 'INFO' && /^falha atraso #\d+ 400 ms \(simulador: /.test(t))).toBe(true);
    await new Promise((r) => setTimeout(r, 450));
  });

  it('desconectar: INFO "conexão derrubada (rst)" e nenhum TX', async () => {
    const { cmd, conectar, delta } = await novo();
    const c = await conectar();
    await cmd('injetar_falha', { tipo: 'desconectar', verbo: '&S', param: { modo: 'rst' } });
    const d = await delta(async () => {
      await c.trocar(['(&S)'], { timeoutMs: 200 });
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(d.some(([dir, t]) => dir === 'INFO' && t === 'falha desconectar: conexão derrubada (rst)')).toBe(true);
    expect(d.filter(([dir]) => dir === 'TX')).toEqual([]);
  });

  it('travamento: o frame não chega ao simulador (RX + INFO "não aplicado") e nenhum TX', async () => {
    const { cmd, conectar, txt, delta } = await novo();
    const c = await conectar();
    const f = (await cmd<{ id: number }>('injetar_falha', { tipo: 'travamento', verbo: '&V' })).id;
    const d = await delta(() => txt(c, '(&V)'));
    expect(d[0]).toEqual(['RX', '(&V)']);
    expect(d).toContainEqual(['INFO', `falha travamento #${f} (simulador: não aplicado)`]);
    expect(d.filter(([dir]) => dir === 'TX')).toEqual([]);
  });

  it('Q2: a resposta adiada pelo modal sob uma falha ainda aparece como TX quando o modal fecha', async () => {
    const { cmd, conectar, txt, delta } = await novo();
    const c = await conectar();
    await cmd('configurar_travamento', { ms: 2000 });
    await cmd('injetar_falha', { tipo: 'sem_resposta', verbo: '&U' });
    const d = await delta(async () => {
      expect(await txt(c, kk('&U04201234'))).toBe('');
      expect((await cmd<{ log: Log[] }>('get_log_comunicacao')).log.at(-1)!.dir).not.toBe('TX');
      await cmd('avancar_tempo', { ms: 2100 });
      await new Promise((r) => setTimeout(r, 30));
    });
    const tx = d.filter(([dir]) => dir === 'TX');
    expect(tx).toEqual([['TX', '(U04)']]);
    expect(d.some(([dir, t]) => dir === 'INFO' && /^falha sem_resposta #\d+ \(simulador: sem resposta\)$/.test(t))).toBe(true);
  });

  it('unitário: InjetorFalhas sem registrar não quebra e logTx:false é passado ao processar', () => {
    const inj = new InjetorFalhas(1);
    inj.adicionar({ tipo: 'erro', vezes: 1, param: { codigo: '?t' } });
    const visto: (boolean | undefined)[] = [];
    const out = inj.atender(2001, '(&M04B19)', (op) => {
      visto.push(op?.logTx);
      return { quadro: '(&M04B19)', resposta: '(M04)' };
    });
    // erro default does not even call the simulator.
    expect(visto).toEqual([]);
    expect(out).toHaveLength(1);
    inj.adicionar({ tipo: 'sem_resposta', vezes: 1 });
    inj.atender(2001, '(&S)', (op) => {
      visto.push(op?.logTx);
      return { quadro: '(&S)', resposta: '(S)' };
    });
    expect(visto).toEqual([false]);
  });
});

// ───────────────────────── P3: set_perfil ports ─────────────────────────
describe('P3: set_perfil e as portas abertas', () => {
  it('cbc-32 [1771, 2001] → simulador-2.7.2 mantém só a 2001 (ordem numérica, não de string)', async () => {
    const { rt, cmd } = await novo('cbc-32');
    expect([...portasLogicas(rt)].sort((a, b) => a - b)).toEqual([1771, 2001]);
    await cmd('set_perfil', { perfil: 'simulador-2.7.2' });
    expect(portasLogicas(rt)).toEqual([2001]);
  });

  it('o perfil de uma porta guarda a primeira das suas opções que está aberta (1771 sem 2001)', async () => {
    const { rt, cmd } = await novo('cbc-32');
    await cmd('fechar_porta', { porta: 2001 });
    expect(portasLogicas(rt)).toEqual([1771]);
    await cmd('set_perfil', { perfil: 'simulador-2.7.2' });
    expect(portasLogicas(rt)).toEqual([1771]);
  });

  it('nenhuma opção aberta: cai no padrão do perfil', async () => {
    const { rt, cmd } = await novo('cbc-32');
    await cmd('abrir_porta', { porta: 857 });
    await cmd('fechar_porta', { porta: 2001 });
    await cmd('fechar_porta', { porta: 1771 });
    expect(portasLogicas(rt)).toEqual([857]);
    await cmd('set_perfil', { perfil: 'simulador-2.7.2' });
    expect(portasLogicas(rt)).toEqual([2001]);
  });

  it('perfis simultâneos abrem todas as suas portas, como antes', async () => {
    const { rt, cmd } = await novo();
    await cmd('set_perfil', { perfil: 'horustech-48' });
    expect([...portasLogicas(rt)].sort((a, b) => a - b)).toEqual([857, 1771, 2001]);
  });
});

// ───────────────────────── P2: reiniciar_processo ─────────────────────────
describe('P2: reiniciar_processo (simulador-2.7.2)', () => {
  const par = (rt: Awaited<ReturnType<typeof novo>>['rt'], bico: number) => {
    const b = rt.sim.conc.bico(bico)!;
    return structuredClone([b.precos, b.precosPendentes]);
  };

  it('está no catálogo (ferramenta MCP) e tem handler', () => {
    const d = CATALOGO.find((x) => x.nome === 'reiniciar_processo');
    expect(d).toBeDefined();
    expect(d!.grupo).toBe('controle');
    expect(NOMES_HANDLERS).toContain('reiniciar_processo');
  });

  it.each(['cbc-32', 'horustech-48', 'cbc01'] as PerfilId[])('perfil real %s: 409 e aponta para ciclo_energia', async (perfil) => {
    const { cmd } = await novo(perfil);
    const e = await cmd('reiniciar_processo').then(
      () => null,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(ErroComando);
    expect((e as ErroComando).status).toBe(409);
    expect((e as ErroComando).message).toContain('ciclo_energia');
  });

  it('R e o ponteiro de leitura voltam a 1 e o &A responde (0)', async () => {
    const { rt, cmd, conectar, txt } = await novo();
    await cmd('gerar_abastecimentos', { bico: '08', quantidade: 3 });
    const c = await conectar();
    expect(rt.sim.conc.buffer.escrita).toBeGreaterThan(1);
    expect(await txt(c, '(&A)')).not.toBe('(0)');
    await cmd('reiniciar_processo');
    expect(rt.sim.conc.buffer.escrita).toBe(1);
    expect(rt.sim.conc.ponteiroLeitura('tcp:2001')).toBe(1);
    const c2 = await conectar();
    expect(await txt(c2, '(&A)')).toBe('(0)');
    expect((await cmd<{ total: number }>('list_abastecimentos')).total).toBe(0);
  });

  it('o resultado traz a escrita 1, as portas reabertas e os preços vigentes/pendentes dos bicos ativos', async () => {
    const { cmd } = await novo();
    const r = await cmd<{ escrita: number; portas: { logica: number }[]; precos: { bico: string; vigentes: number[]; pendentes: unknown[] }[] }>('reiniciar_processo');
    expect(r.escrita).toBe(1);
    expect(r.portas.map((p) => p.logica)).toEqual([2001]);
    expect(r.precos.length).toBeGreaterThan(0);
    expect(r.precos[0]).toHaveProperty('vigentes');
    expect(r.precos[0]).toHaveProperty('pendentes');
  });

  it('o preço do &U e do set_preco em runtime se perde (volta ao da configuração)', async () => {
    const { rt, cmd, conectar, txt } = await novo();
    const inicial = par(rt, 4);
    const c = await conectar();
    expect(await txt(c, kk('&U04001234'))).toBe('(U04)');
    await cmd('set_preco', { bico: '08', preco: 777 });
    expect(par(rt, 4)).not.toEqual(inicial);
    const inicial8 = (() => {
      const b = rt.sim.conc.bico(8)!;
      return structuredClone([b.precos, b.precosPendentes]);
    })();
    await cmd('reiniciar_processo');
    expect(par(rt, 4)).toEqual(inicial);
    expect(par(rt, 8)).not.toEqual(inicial8);
    expect(rt.sim.conc.bico(8)!.precos[0]).not.toBe(777);
    expect(rt.sim.conc.bico(8)!.precosPendentes[0]).not.toBe(777);
  });

  it('a base de preços é retomada por importar_simcnf', async () => {
    const { rt, cmd } = await novo();
    const ini = [kk('&CW013A030100'), '[1,3,1](1234,5)(99,9)(5,899)(1234,5)(99,9);'].join('\r\n');
    await cmd('importar_simcnf', { conteudo: ini });
    const importado = par(rt, 6);
    expect(importado[0]![0]).toBe(5899);
    await cmd('set_preco', { bico: '06', preco: 777 });
    await cmd('reiniciar_processo');
    expect(par(rt, 6)).toEqual(importado);
  });

  it('a base de preços é retomada por reset (as duas formas)', async () => {
    const { rt, cmd } = await novo();
    await cmd('set_preco', { bico: '04', preco: 777 });
    // manter_config keeps 777 as the configuration's price, so the restart keeps it too.
    await cmd('reset', { manter_config: true });
    const mantido = par(rt, 4);
    expect(JSON.stringify(mantido)).toContain('777');
    await cmd('set_preco', { bico: '04', preco: 888 });
    await cmd('reiniciar_processo');
    expect(par(rt, 4)).toEqual(mantido);
    // reset without manter_config reloads the default configuration.
    await cmd('reset');
    const padrao = par(rt, 4);
    expect(JSON.stringify(padrao)).not.toContain('777');
    await cmd('set_preco', { bico: '04', preco: 999 });
    await cmd('reiniciar_processo');
    expect(par(rt, 4)).toEqual(padrao);
  });

  it('a base de preços é retomada por carregar_config_padrao', async () => {
    const { rt, cmd } = await novo();
    const inicial = par(rt, 4);
    await cmd('set_preco', { bico: '04', preco: 777 });
    await cmd('carregar_config_padrao');
    expect(par(rt, 4)).toEqual(inicial);
    await cmd('set_preco', { bico: '04', preco: 888 });
    await cmd('reiniciar_processo');
    expect(par(rt, 4)).toEqual(inicial);
  });

  it('a base de preços é retomada por snapshot_carregar', async () => {
    const { rt, cmd } = await novo();
    await cmd('set_preco', { bico: '04', preco: 777 });
    const com777 = par(rt, 4);
    await cmd('snapshot_salvar', { nome: 'a' });
    await cmd('set_preco', { bico: '04', preco: 888 });
    await cmd('snapshot_carregar', { nome: 'a' });
    expect(par(rt, 4)).toEqual(com777);
    await cmd('set_preco', { bico: '04', preco: 999 });
    await cmd('reiniciar_processo');
    expect(par(rt, 4)).toEqual(com777);
  });

  it('encerrantes, cartões, lista negra, perfil/quirks e configurar_travamento ficam; endereços e bicos idem', async () => {
    const { rt, cmd } = await novo();
    await cmd('gravar_encerrante', { bico: '04', valor: 123_450 });
    await cmd('gravar_cartao', { codigo: '00000000000000AA' });
    await cmd('lista_negra', { acao: 'poe', codigo: '00000000000000AA' });
    await cmd('set_quirk', { nome: 'Q1', on: false });
    await cmd('configurar_travamento', { ms: 3000 });
    const lados = rt.sim.conc.lados.filter((l) => l.configurado).map((l) => [l.canal, l.endereco, l.bicos.filter((b) => b.ativo).map((b) => b.codigo)]);
    const cartoes = (await cmd<{ quantidade: number }>('list_cartoes')).quantidade;
    const negra = await cmd('get_lista_negra');
    await cmd('reiniciar_processo');
    expect((await cmd<{ encerranteMl: number }>('get_encerrante', { bico: '04', tipo: 'completo' })).encerranteMl).toBe(123_450);
    expect((await cmd<{ quantidade: number }>('list_cartoes')).quantidade).toBe(cartoes);
    expect(cartoes).toBe(1);
    expect(await cmd('get_lista_negra')).toEqual(negra);
    expect(rt.perfil.id).toBe('simulador-2.7.2');
    expect(rt.sim.conc.quirks.Q1).toBe(false);
    expect(rt.sim.conc.travamentoMs).toBe(3000);
    expect(rt.sim.conc.lados.filter((l) => l.configurado).map((l) => [l.canal, l.endereco, l.bicos.filter((b) => b.ativo).map((b) => b.codigo)])).toEqual(lados);
  });

  it('abastecimento em curso é descartado e o encerrante não se move', async () => {
    const { rt, cmd } = await novo();
    await cmd('gravar_encerrante', { bico: '04', valor: 50_000 });
    await cmd('retirar_bico', { bico: '04' });
    await cmd('avancar_tempo', { ms: 4000 });
    const b = () => rt.sim.conc.bico(4)!;
    expect(b().estado).not.toBe('repouso');
    await cmd('reiniciar_processo');
    expect(b().estado).toBe('repouso');
    expect(b().status).toBe('L');
    expect(b().corrente).toBeNull();
    expect((await cmd<{ encerranteMl: number }>('get_encerrante', { bico: '04', tipo: 'completo' })).encerranteMl).toBe(50_000);
  });

  it('autorizações, preset, bloqueio e modal são de um processo novo', async () => {
    const { rt, cmd, conectar, txt } = await novo();
    const c = await conectar();
    expect(await txt(c, '(&P05000500030)')).toBe('(P05)');
    expect(await txt(c, '(&M04B19)')).toBe('(M04)');
    await cmd('configurar_travamento', { ms: 60_000 });
    rt.sim.processarQuadro(kk('&U04201234'));
    expect(rt.sim.conc.estaTravado()).toBe(true);
    await cmd('reiniciar_processo');
    const b4 = rt.sim.conc.bico(4)!;
    const b5 = rt.sim.conc.bico(5)!;
    expect(b4.bloqueio).toBe(false);
    expect(b5.preAut).toBe(false);
    expect(b5.presetCentavos).toBeNull();
    expect([b4.status, b5.status]).toEqual(['L', 'L']);
    expect(rt.sim.conc.estaTravado()).toBe(false);
  });

  it('o &LE linha 1 é o instante do reinício', async () => {
    const { clock, cmd, conectar, txt, rt } = await novo();
    const c = await conectar();
    const antes = await txt(c, '(&LE00148)');
    clock.advance(65 * 60_000);
    await cmd('reiniciar_processo');
    const d = new Date(clock.now() + rt.sim.conc.rtc.offsetMinutos * 60_000);
    const esperado = [d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCHours(), d.getUTCMinutes()].map((n) => String(n).padStart(2, '0')).join('');
    const c2 = await conectar();
    const depois = await txt(c2, '(&LE00148)');
    expect(depois).toBe(`(${esperado}${'0'.repeat(24)})`);
    expect(depois).not.toBe(antes);
  });

  it('as conexões caem e a mesma porta lógica reabre e atende', async () => {
    const { rt, cmd, conectar, txt } = await novo();
    const c = await conectar();
    expect(await txt(c, '(&S)')).toMatch(/^\(S/);
    const antes = portasLogicas(rt);
    await cmd('reiniciar_processo');
    expect((await c.trocar(['(&S)'], { timeoutMs: 200 })).caiu).toBe(true);
    expect(portasLogicas(rt)).toEqual(antes);
    const c2 = await conectar();
    expect(await txt(c2, '(&S)')).toMatch(/^\(S/);
  });

  it('a porta escolhida (1771) reabre a mesma, não a padrão', async () => {
    const { rt, cmd, conectar, txt } = await novo();
    await cmd('fechar_porta', { porta: 2001 });
    await cmd('abrir_porta', { porta: 1771 });
    expect(portasLogicas(rt)).toEqual([1771]);
    await cmd('reiniciar_processo');
    expect(portasLogicas(rt)).toEqual([1771]);
    expect(await txt(await conectar(1771), '(&S)')).toMatch(/^\(S/);
  });
});

// ───────────────────────── F3: reset manter_config ─────────────────────────
describe('F3: reset manter_config limpa o estado por bico do 2.7.2', () => {
  it('após preset, bloqueio e pré-autorização o bico volta a L sem preset', async () => {
    const { rt, cmd, conectar, txt, clock } = await novo();
    const c = await conectar();
    expect(await txt(c, '(&P05000500030)')).toBe('(P05)');
    expect(await txt(c, '(&M04B19)')).toBe('(M04)');
    await cmd('abastecer', { bico: '08', volume: 1000, duracao_s: 1 });
    await cmd('avancar_tempo', { ms: 5000 });
    clock.advance(0);
    const antes = (n: number) => rt.sim.conc.bico(n)!;
    expect(antes(5).preAut).toBe(true);
    expect(antes(5).presetCentavos).not.toBeNull();
    expect(antes(4).bloqueio).toBe(true);
    expect(antes(8).ultimo).toBeTruthy();
    antes(8).recolocarNoPreset = true;
    await cmd('reset', { manter_config: true });
    for (const n of [4, 5, 8]) {
      const b = rt.sim.conc.bico(n)!;
      expect([n, b.status, b.preAut, b.presetCentavos ?? null, b.bloqueio, b.ultimo ?? null, b.recolocarNoPreset ?? false]).toEqual([n, 'L', false, null, false, null, false]);
    }
    expect(rt.sim.conc.bico(5)!.presetCentavos).toBeNull();
  });

  it('perfil real (cbc-32): o reset não cria as chaves do 2.7.2 (preAut/ultimo/recolocarNoPreset ausentes)', async () => {
    const { rt, cmd } = await novo('cbc-32');
    await cmd('reset', { manter_config: true });
    const bicos = rt.sim.conc.exportarEstado().lados.flatMap((l) => l.bicos);
    expect(bicos.length).toBeGreaterThan(0);
    for (const b of bicos) {
      expect(b).not.toHaveProperty('preAut');
      expect(b).not.toHaveProperty('ultimo');
      expect(b).not.toHaveProperty('recolocarNoPreset');
    }
  });
});
