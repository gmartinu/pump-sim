import { afterEach, describe, expect, it } from 'vitest';
import { CATALOGO, ErroComando, Hub, ManualClock, NOMES_HANDLERS, executarComando, type PerfilId } from '../src/index.js';
import { kk } from './util.js';

const hubs: Hub[] = [];
afterEach(async () => {
  await Promise.all(hubs.splice(0).map((h) => h.fechar()));
});

async function novoHub(perfil: PerfilId = 'simulador-2.7.2') {
  const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
  const hub = new Hub({ clock, semTcp: true });
  hubs.push(hub);
  await hub.criar('default', perfil);
  const cmd = <T = Record<string, unknown>>(nome: string, args: Record<string, unknown> = {}) => executarComando(hub, nome, args) as Promise<T>;
  const passo = async (ms: number) => cmd('avancar_tempo', { ms });
  return { hub, clock, cmd, passo, rt: hub.obter('default') };
}

/** Inventory of spec §5 + K18–K26: every tool must exist in the catalog. */
const INVENTARIO_SPEC = [
  // 5.1
  'get_status', 'get_visualizacao', 'get_abastecimento', 'list_abastecimentos', 'get_ponteiros', 'get_encerrante', 'get_precos',
  'get_config_bico', 'get_serie', 'get_ids_abastecimento', 'get_relogio', 'list_cartoes', 'get_cartao', 'list_cartoes_desconhecidos',
  'get_lista_negra', 'list_eventos', 'get_sensores', 'get_bombas', 'get_equipamento', 'get_estado_simulador', 'get_log_comunicacao',
  // 5.2
  'incrementar_ponteiro', 'set_modo', 'set_preco', 'preset', 'preset_identificado', 'gravar_cartao', 'excluir_cartao', 'limpar_cartoes',
  'lista_negra', 'set_relogio', 'configurar_endereco', 'configurar_sensor', 'gravar_encerrante', 'carregar_config_padrao', 'enviar_comando_cru',
  // 5.3
  'retirar_bico', 'recolocar_bico', 'abastecer', 'apresentar_cartao', 'set_falha_endereco', 'set_automacao', 'set_rede_ac', 'set_bateria',
  'set_dip', 'set_velocidade', 'set_relogio_simulado', 'injetar_falha', 'limpar_falhas', 'desconectar', 'set_quirk', 'set_perfil',
  'abrir_porta', 'fechar_porta', 'gravar_inicio', 'gravar_fim', 'replay', 'snapshot_salvar', 'snapshot_carregar', 'reset', 'diff_executar',
  'aguardar_estado',
  // K18–K26
  'set_ponteiro', 'list_conexoes', 'importar_simcnf', 'importar_log', 'injetar_evento', 'ciclo_energia', 'configurar_bico', 'get_displays',
  'set_modelo', 'set_firmware',
];

describe('catálogo', () => {
  it('cobre o inventário da spec §5 e K18–K26', () => {
    const nomes = new Set(CATALOGO.map((c) => c.nome));
    expect(INVENTARIO_SPEC.filter((n) => !nomes.has(n))).toEqual([]);
  });

  it('cada comando do catálogo tem handler, e vice-versa', () => {
    expect([...CATALOGO.map((c) => c.nome)].sort()).toEqual([...NOMES_HANDLERS].sort());
    expect(new Set(CATALOGO.map((c) => c.nome)).size).toBe(CATALOGO.length);
  });

  it('valida os argumentos pelo schema', async () => {
    const { cmd } = await novoHub();
    await expect(cmd('set_preco', { preco: 10 })).rejects.toThrow(/bico: obrigatório/);
    await expect(cmd('get_status', { formato: 'xyz' })).rejects.toThrow(/deve ser um de/);
    await expect(cmd('get_status', { foo: 1 })).rejects.toThrow(/parâmetro desconhecido/);
    await expect(cmd('nao_existe')).rejects.toBeInstanceOf(ErroComando);
    await expect(cmd('retirar_bico', { bico: '3F' })).rejects.toThrow(/bico inexistente/);
  });
});

describe('leitura', () => {
  it('get_status devolve o mesmo quadro do &S e as letras', async () => {
    const { cmd } = await novoHub();
    const r = await cmd<{ quadro: string; lados: { letra: string }[] }>('get_status');
    expect(r.quadro).toMatch(/^\(SLLFFLLFF/);
    expect(r.lados.every((l) => l.letra === 'L')).toBe(true);
  });

  it('bico aceita BB, {canal,endereco,posicao} e {numero}', async () => {
    const { cmd } = await novoHub();
    const a = await cmd<{ codigo: string }>('get_config_bico', { bico: '44' });
    const b = await cmd<{ codigo: string }>('get_config_bico', { bico: { canal: 1, endereco: 1, posicao: 2 } });
    const c = await cmd<{ codigo: string; numeroPista: number }>('get_config_bico', { bico: { numero: 2 } });
    expect([a.codigo, b.codigo, c.codigo]).toEqual(['44', '44', '44']);
  });

  it('get_encerrante/get_precos/get_ids/get_serie trazem o quadro do &T', async () => {
    const { cmd } = await novoHub();
    const e = await cmd<{ quadro: string }>('get_encerrante', { bico: '04', tipo: 'litros' });
    expect(e.quadro).toBe('(TL040000000084)');
    const p = await cmd<{ quadro: string; pendentes: (number | null)[] }>('get_precos', { bico: '04' });
    expect(p.quadro).toMatch(/^\(TU04/);
    expect(p.pendentes[0]).toBe(1123);
    const s = await cmd<{ numeroSerie: string }>('get_serie');
    expect(s.numeroSerie).toMatch(/^\d{8}$/);
  });

  it('get_estado_simulador traz perfil, quirks, ponteiros e lados', async () => {
    const { cmd } = await novoHub('cbc-32');
    const e = await cmd<{ perfil: { id: string }; quirks: Record<string, boolean>; ponteiros: { ponteiroUnico: boolean }; lados: unknown[] }>('get_estado_simulador');
    expect(e.perfil.id).toBe('cbc-32');
    expect(e.quirks.Q1).toBe(false);
    expect(e.ponteiros.ponteiroUnico).toBe(false);
    expect(e.lados).toHaveLength(16);
  });
});

describe('abastecimento e buffer', () => {
  it('abastecer com volume corta, recoloca e grava; get_abastecimento = &A', async () => {
    const { cmd, passo, rt } = await novoHub('cbc-32');
    await cmd('abastecer', { bico: '04', volume: 2000 });
    expect((await cmd<{ statusTexto: string }[] & { enderecos: { statusTexto: string }[] }>('get_displays', { canal: 1 })).enderecos[0]!.statusTexto).toBe('Aguarda liberação');
    await passo(30_000);
    const lista = await cmd<{ total: number; registros: { volumeMl: number }[] }>('list_abastecimentos');
    expect(lista.total).toBe(1);
    expect(lista.registros[0]!.volumeMl).toBe(2000);
    const ab = await cmd<{ quadro: string }>('get_abastecimento', { formato: 'a52' });
    expect(ab.quadro).toBe(rt.sim.pedir('(&A)'));
    const r = await cmd<{ quadro: string }>('get_abastecimento', { posicao: 0, formato: 'paf1' });
    expect(r.quadro).toMatch(/^\(a2/);
  });

  it('abastecer por duração recoloca pelo agendamento', async () => {
    const { cmd, passo } = await novoHub('cbc-32');
    await cmd('abastecer', { bico: '08', duracao_s: 3 });
    await passo(1500);
    expect((await cmd<{ status: string }>('get_config_bico', { bico: '08' })).status).toBe('A');
    await passo(5000);
    expect((await cmd<{ total: number }>('list_abastecimentos')).total).toBe(1);
  });

  it('K18: set_ponteiro sincroniza a leitura com a escrita da porta', async () => {
    const { cmd, rt } = await novoHub('cbc-32');
    await cmd('gerar_abastecimentos', { bico: '04', quantidade: 3, volume: 500 });
    expect(rt.sim.pedir('(&A)', 'tcp:2001')).not.toBe('(0)');
    await cmd('set_ponteiro', { porta: 2001 });
    expect(rt.sim.pedir('(&A)', 'tcp:2001')).toBe('(0)');
    expect(rt.sim.pedir('(&A)', 'tcp:1771')).not.toBe('(0)');
    const p = await cmd<{ leitura: Record<string, number>; escrita: number }>('get_ponteiros');
    expect(p.leitura['tcp:2001']).toBe(3);
    expect(p.leitura['tcp:1771']).toBe(0);
  });

  it('DIFF-17 no 2.7.2: 1001 abastecimentos sem &I descartam o mais antigo e voltam em 1000', async () => {
    const { cmd } = await novoHub();
    const r = await cmd<{ escrita: number }>('gerar_abastecimentos', { bico: '04', quantidade: 1001, volume: 100 });
    expect(r.escrita).toBe(3);
    const ev = await cmd<{ eventos: { tipo: string }[] }>('list_eventos');
    expect(ev.eventos.filter((e) => e.tipo === 'BEEP').length).toBeGreaterThan(0);
  });

  it('incrementar_ponteiro com ponteiro único (Q3) avança para todas as portas', async () => {
    const { cmd, rt } = await novoHub();
    await cmd('gerar_abastecimentos', { bico: '04', quantidade: 2 });
    await cmd('incrementar_ponteiro', { porta: 2001 });
    expect(rt.sim.conc.ponteiroLeitura('tcp:1771')).toBe(2);
  });
});

describe('comandos de protocolo e físicos', () => {
  it('set_preco vale no próximo abastecimento; set_modo bloqueia', async () => {
    const { cmd } = await novoHub('cbc-32');
    await cmd('set_preco', { bico: '04', preco: 5899, nivel: 0 });
    expect((await cmd<{ pendentes: number[] }>('get_precos', { bico: '04' })).pendentes[0]).toBe(5899);
    await cmd('set_modo', { bico: '04', modo: 'bloqueia' });
    expect((await cmd<{ quadro: string }>('get_status')).quadro.slice(1, 3)).toBe('SB');
  });

  it('cartões: gravar, ler, lista negra, apresentar desconhecido', async () => {
    const { cmd } = await novoHub();
    const g = await cmd<{ posicao: number }>('gravar_cartao', { codigo: 'ABCDEF0123456789', tipo: 7, permissao: 2 });
    expect(g.posicao).toBe(0);
    expect((await cmd<{ cartao: { controle: number } }>('get_cartao', { codigo: 'abcdef0123456789' })).cartao.controle).toBe(0x27);
    await cmd('lista_negra', { acao: 'poe', codigo: 'ABCDEF0123456789' });
    expect((await cmd<{ codigos: string[] }>('get_lista_negra')).codigos).toEqual(['ABCDEF0123456789']);
    await cmd('apresentar_cartao', { canal: 1, endereco: 1, codigo: '1122334455667788' });
    expect((await cmd<{ pendentes: { codigo: string }[] }>('list_cartoes_desconhecidos')).pendentes.map((p) => p.codigo)).toEqual(['1122334455667788']);
  });

  it('enviar_comando_cru = "Simular comando"; travar e liberar (o modal do 2.7.2 não cala o socket)', async () => {
    const { cmd } = await novoHub();
    expect((await cmd<{ resposta: string }>('enviar_comando_cru', { quadro: '(&T04L2A)' })).resposta).toBe('(TL040000000084)');
    await cmd('travar', {});
    // Verdict #8: the modal runs a nested loop and the socket keeps serving.
    expect((await cmd<{ resposta: string | null }>('enviar_comando_cru', { quadro: '(&S)' })).resposta).toMatch(/^\(S/);
    await cmd('liberar_travamento');
    // Without Q2 (real profiles) the freeze is the synthetic frozen-console fault.
    const real = await novoHub('cbc-32');
    await real.cmd('travar', {});
    expect((await real.cmd<{ resposta: string | null }>('enviar_comando_cru', { quadro: '(&S)' })).resposta).toBeNull();
    await real.cmd('liberar_travamento');
    expect((await real.cmd<{ resposta: string }>('enviar_comando_cru', { quadro: '(&S)' })).resposta).toMatch(/^\(S/);
  });

  it('configurar_travamento: o MessageBox do &U nível inválido segura o (U04) até o OK (prazo), e o &S segue', async () => {
    const { cmd, passo, rt } = await novoHub();
    await cmd('configurar_travamento', { ms: 2000 });
    const r = rt.sim.processarQuadro(kk('&U04201234'));
    expect(r.resposta).toBeNull();
    let depois: string | null = null;
    void r.adiada?.then((t) => (depois = t));
    expect((await cmd<{ resposta: string | null }>('enviar_comando_cru', { quadro: '(&S)' })).resposta).toMatch(/^\(S/);
    await Promise.resolve();
    expect(depois).toBeNull();
    await passo(2100);
    await Promise.resolve();
    expect(depois).toBe('(U04)');
  });

  it('set_falha_endereco → F; set_dip; set_bateria; set_relogio_simulado congelado', async () => {
    const { cmd, passo } = await novoHub();
    expect((await cmd<{ letra: string }>('set_falha_endereco', { canal: 1, endereco: 1, ativo: true })).letra).toBe('F');
    expect((await cmd<{ dips: boolean[] }>('set_dip', { n: 1, on: true })).dips[0]).toBe(true);
    await cmd('set_relogio_simulado', { datahora: '2027-01-02T03:04:05', congelado: true, fonte_data_registro: 'simulado' });
    await passo(5000);
    const r = await cmd<{ rtc: { ano: number; segundo: number }; dataRegistro: string }>('get_relogio');
    expect([r.rtc.ano, r.rtc.segundo, r.dataRegistro]).toEqual([2027, 5, 'simulado']);
  });

  it('K22: configurar_endereco e configurar_bico definem pista, combustível e tanque', async () => {
    const { cmd } = await novoHub('horustech-48');
    await cmd('configurar_endereco', { canal: 9, endereco: 1, n_bicos: 1, virgula: '3A', bicos: [{ posicao: 1, numero_pista: 40, combustivel: 3, tanque: 2 }] });
    const b = await cmd<{ codigo: string; numeroPista: number; combustivel: number; tanque: number }>('get_config_bico', { bico: { numero: 40 } });
    expect([b.codigo, b.combustivel, b.tanque]).toEqual(['24', 3, 2]);
  });

  it('K21: injetar_evento e ciclo_energia', async () => {
    const { cmd } = await novoHub();
    await cmd('injetar_evento', { tipo: 'WDT', texto: 'watchdog' });
    await cmd('ciclo_energia');
    const tipos = (await cmd<{ eventos: { tipo: string }[] }>('list_eventos', { limite: 3 })).eventos.map((e) => e.tipo);
    expect(tipos).toEqual(['WDT', 'OFF', 'ON']);
  });

  it('K25: get_displays pisca 888888 no início do abastecimento (Q6)', async () => {
    const { cmd, passo } = await novoHub();
    await cmd('retirar_bico', { bico: '04' });
    await passo(1100);
    const d = (await cmd<{ enderecos: { piscando: boolean; volume: string; statusTexto: string }[] }>('get_displays', { canal: 1 })).enderecos[0]!;
    // Bench diff r6 (DIFF-18, EQUIV-MOTOR #74; docs/DECISIONS.md §21 "r6 bench run"): on the 2.7.2
    // the caption only turns "Abastecendo.." when the flow starts, after the blinking ticks.
    // Before r6 this expected "Abastecendo.." while blinking.
    expect([d.piscando, d.volume, d.statusTexto]).toEqual([true, '888888', 'Retirar Bico']);
    await passo(800);
    const d2 = (await cmd<{ enderecos: { piscando: boolean; statusTexto: string }[] }>('get_displays', { canal: 1 })).enderecos[0]!;
    expect([d2.piscando, d2.statusTexto]).toEqual([false, 'Abastecendo..']);
  });
});

describe('perfil, quirks, snapshot e reset', () => {
  it('set_perfil mantém encerrantes e o buffer; set_quirk Q3 off dá ponteiro por porta', async () => {
    const { cmd, rt } = await novoHub();
    await cmd('gravar_encerrante', { bico: '04', valor: 123_450 });
    await cmd('gerar_abastecimentos', { bico: '08', quantidade: 2 });
    await cmd('set_perfil', { perfil: 'cbc-32' });
    expect(rt.perfil.id).toBe('cbc-32');
    expect((await cmd<{ encerranteMl: number }>('get_encerrante', { bico: '04', tipo: 'completo' })).encerranteMl).toBe(123_450);
    expect((await cmd<{ total: number }>('list_abastecimentos')).total).toBe(2);
    await cmd('set_perfil', { perfil: 'simulador-2.7.2' });
    await cmd('set_quirk', { nome: 'Q3', on: false });
    expect(rt.sim.conc.quirks.Q3).toBe(false);
    await cmd('incrementar_ponteiro', { porta: 2001 });
    expect(rt.sim.conc.ponteiroLeitura('tcp:1771')).not.toBe(rt.sim.conc.ponteiroLeitura('tcp:2001'));
  });

  it('K26: set_modelo e set_firmware', async () => {
    const { cmd } = await novoHub();
    expect((await cmd<{ tipoCbc: string }>('set_modelo', { modelo: 'CBC-05' })).tipoCbc).toBe('5');
    await cmd('set_firmware', { firmware: 'V9.1' });
    expect((await cmd<{ quadro: string }>('get_status')).quadro).toContain('V9.1');
  });

  it('snapshot volta ao estado salvo; reset manter_config guarda preços e cartões', async () => {
    const { cmd } = await novoHub('cbc-32');
    await cmd('set_preco', { bico: '04', preco: 777 });
    await cmd('gravar_cartao', { codigo: '1' });
    await cmd('snapshot_salvar', { nome: 'a' });
    await cmd('gerar_abastecimentos', { bico: '04', quantidade: 5 });
    await cmd('snapshot_carregar', { nome: 'a' });
    expect((await cmd<{ total: number }>('list_abastecimentos')).total).toBe(0);
    await cmd('gerar_abastecimentos', { bico: '04', quantidade: 1 });
    await cmd('reset', { manter_config: true });
    expect((await cmd<{ total: number }>('list_abastecimentos')).total).toBe(0);
    expect((await cmd<{ vigentes: number[] }>('get_precos', { bico: '04' })).vigentes[0]).toBe(777);
    expect((await cmd<{ quantidade: number }>('list_cartoes')).quantidade).toBe(1);
    await cmd('reset');
    expect((await cmd<{ quantidade: number }>('list_cartoes')).quantidade).toBe(0);
  });

  it('K20: importar_simcnf aplica &C, encerrantes/preço e cartões; importar_log', async () => {
    const { cmd } = await novoHub();
    const ini = [kk('&CW013A030100'), '[1,3,1](1234,5)(99,9)(5,899)(1234,5)(99,9);', 'C,00000000000000AA,27,0000,2359,,,N', 'lixo'].join('\r\n');
    const r = await cmd<{ enderecos: number; bicos: number; cartoes: number; ignoradas: string[] }>('importar_simcnf', { conteudo: ini });
    expect([r.enderecos, r.bicos, r.cartoes, r.ignoradas]).toEqual([1, 1, 1, ['lixo']]);
    const b = await cmd<{ encerranteMl: number; precos: number[] }>('get_config_bico', { bico: '06' });
    expect([b.encerranteMl, b.precos[0]]).toEqual([1_234_500, 5899]);
    const l = await cmd<{ configuracoes: number; eventos: number }>('importar_log', { conteudo: `[CONF]${kk('&CW023A030100')}\n[ON] CBC Ligou PWRON\n` });
    expect([l.configuracoes, l.eventos]).toEqual([1, 1]);
  });

  it('multi-instância: criar_sim e sim_id', async () => {
    const { cmd } = await novoHub();
    await cmd('criar_sim', { sim_id: 'b', perfil: 'horustech-48' });
    expect((await cmd<{ perfil: string }>('get_equipamento', { sim_id: 'b' })).perfil).toBe('horustech-48');
    expect((await cmd<{ sims: unknown[] }>('list_sims')).sims).toHaveLength(2);
    await cmd('remover_sim', { sim_id: 'b' });
    await expect(cmd('get_equipamento', { sim_id: 'b' })).rejects.toThrow(/inexistente/);
  });
});
