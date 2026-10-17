import fs from 'node:fs';
import path from 'node:path';
import { ManualClock } from '../core/clock.js';
import { hex2 } from '../core/codigo-bico.js';
import type { Concentrador, ModoOperacao } from '../core/concentrador.js';
import { MODOS_IDENTIFICACAO, classeDoTipo } from '../core/identificacao.js';
import type { Bico, Lado, LetraStatus, Registro } from '../core/modelo.js';
import { decodificarVirgula } from '../core/virgula.js';
import { executarDiff } from '../diff/executor.js';
import { ROTEIROS, selecionarRoteiros } from '../diff/roteiros.js';
import type { AlvoDiff } from '../diff/executor.js';
import { ClienteTcp, lerAlvo } from '../net/cliente-tcp.js';
import { type Modelo, type PerfilId, type QuirkId, IDS_PERFIS, TODOS_QUIRKS, derivePerfil, obterPerfil } from '../profiles/index.js';
import { comKK } from '../protocols/companytec/checksum.js';
import * as F from '../protocols/companytec/formatos.js';
import { processarCompanytec } from '../protocols/companytec/handlers.js';
import { processarHorustech } from '../protocols/horustech/handlers.js';
import { processarIdentfid } from '../protocols/identfid/handlers.js';
import { lerGravacao } from '../recorder/formato.js';
import { ServidorReplay, replayCliente } from '../recorder/replay.js';
import { CATALOGO, defComando, schemaComSimId } from './catalogo.js';
import type { NovaFalha } from './falhas.js';
import type { Hub } from './hub.js';
import type { SimRuntime } from './runtime.js';
import { validar } from './validar.js';

export class ErroComando extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type Args = Record<string, unknown>;
type Handler = (rt: SimRuntime, a: Args, hub: Hub) => unknown;

// ───────────────────────── utilities ─────────────────────────

const s = (a: Args, k: string): string | undefined => (a[k] === undefined ? undefined : String(a[k]));
const n = (a: Args, k: string): number | undefined => (a[k] === undefined || a[k] === null ? undefined : Number(a[k]));
const b = (a: Args, k: string): boolean | undefined => (a[k] === undefined ? undefined : Boolean(a[k]));

export function resolverBico(conc: Concentrador, v: unknown): Bico {
  let bico: Bico | undefined;
  if (typeof v === 'string') bico = conc.bicoPorTexto(v.toUpperCase());
  else if (v && typeof v === 'object') {
    const o = v as { canal?: number; endereco?: number; posicao?: number; numero?: number };
    if (o.numero !== undefined) bico = conc.bicoPorNumero(o.numero);
    else bico = conc.lado(o.canal ?? 0, o.endereco ?? 0)?.bicos[(o.posicao ?? 0) - 1];
    if (bico && !bico.ativo) bico = undefined;
  }
  if (!bico) throw new ErroComando(`bico inexistente ou inativo: ${JSON.stringify(v)}`, 404);
  return bico;
}

function lado(conc: Concentrador, a: Args): Lado {
  const l = conc.lado(n(a, 'canal') ?? 0, n(a, 'endereco') ?? 0);
  if (!l) throw new ErroComando(`endereço inexistente: canal ${String(a.canal)} endereço ${String(a.endereco)}`, 404);
  return l;
}

/** "2026-10-16T14:30:00" → fields. */
function lerDataHora(txt: string): { ano: number; mes: number; dia: number; hora: number; minuto: number; segundo: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(txt.trim());
  if (!m) throw new ErroComando(`datahora inválida: ${txt} (use 2026-10-16T14:30:00)`);
  const [ano, mes, dia, hora, minuto, segundo] = m.slice(1).map((x) => Number(x ?? 0)) as [number, number, number, number, number, number];
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59 || segundo > 59) throw new ErroComando(`datahora fora da faixa: ${txt}`);
  return { ano, mes, dia, hora, minuto, segundo };
}

/** Logical port → core port id ("tcp:2001"). */
export function portaDoRuntime(rt: SimRuntime, porta?: number): string {
  if (porta !== undefined) return `tcp:${porta}`;
  const aberta = rt.servidor?.portas()[0]?.logica;
  if (aberta !== undefined) return `tcp:${aberta}`;
  const p = rt.perfil;
  const primeira = p.escutaTcp === 'umaPorVez' ? p.opcoesPortaTcp[0] : p.portas.find((x) => x.tipo === 'tcp')?.porta;
  return `tcp:${String(primeira ?? 2001)}`;
}

/** Runs a read frame through the codec, with no log or socket. */
function codec(rt: SimRuntime, quadro: string, porta?: number): string | null {
  rt.tick();
  const c = rt.sim.conc;
  const p = portaDoRuntime(rt, porta);
  if (quadro.startsWith('(&')) return processarCompanytec(c, p, quadro).resposta;
  if (quadro.startsWith('(?')) return processarIdentfid(c, p, quadro).resposta;
  if (quadro.startsWith('>')) return processarHorustech(c, p, quadro).resposta;
  return null;
}

export function resumoBico(conc: Concentrador, x: Bico) {
  const casas = decodificarVirgula(conc.ladoDoBico(x).virgula);
  return {
    codigo: hex2(x.codigo),
    canal: x.canal,
    endereco: x.endereco,
    posicao: x.posicao + 1,
    estado: x.estado,
    status: x.status,
    precos: [...x.precos],
    precosPendentes: [...x.precosPendentes],
    casas,
    encerranteMl: x.encerranteMl,
    encerranteValorMil: x.encerranteValorMil,
    numeroPista: x.numeroPista,
    combustivel: x.combustivel,
    tanque: x.tanque,
    volumeTanque: x.volumeTanque,
    corrente: x.corrente ? { ...x.corrente } : null,
    ultimosCartoes: { ...x.ultimosCartoes },
    // BICO_272: the nozzle's pre-authorization and preset (on the 2.7.2 they do not belong to the side).
    preAut: conc.preAutDoBico(x),
    presetCentavos: x.presetCentavos ?? null,
  };
}

function resumoLado(conc: Concentrador, l: Lado) {
  return {
    canal: l.canal,
    endereco: l.endereco,
    configurado: l.configurado,
    letra: conc.letraDoLado(l),
    tipoBomba: l.tipoBomba,
    virgula: hex2(l.virgula),
    nBicos: l.nBicos,
    falha: l.falha,
    sensorIdf: l.sensorIdf,
    modoIdentificacao: l.modoIdentificacao,
    bloqueado: l.bloqueado,
    preAutorizado: l.preAutorizado,
    presetCentavos: l.presetCentavos,
    presetVolumeMl: l.presetVolumeMl,
    nivelPreco: l.nivelPreco,
    cartao1: l.cartao1,
    cartao2: l.cartao2,
    bicos: l.bicos.filter((x) => x.ativo).map((x) => resumoBico(conc, x)),
  };
}

/** Text status of the address on the 2.7.2 (K25). */
export function statusTextual(l: Lado, legendaPorTick = false): string {
  if (!l.configurado) return '';
  if (l.falha) return 'Falha';
  const ativos = l.bicos.filter((x) => x.ativo);
  // 2.7.2 (`legendaPorTick`): "Abastecendo.." only once the flow started, after the blinking ticks.
  // Bench diff r6 (DIFF-18, EQUIV-MOTOR #26/#74): the driver returns at that caption and the 2.7.2
  // volume was already rising (2 ticks in the 1st 255 ms sample, 28 ticks in the next 3 s); the
  // mirror returned at the state-tick start and its flow came 7 ticks later. Before that the panel keeps
  // its rest caption.
  if (ativos.some((x) => x.estado === 'abastecendo' && (!legendaPorTick || (x.corrente?.piscando ?? 0) === 0))) return 'Abastecendo..';
  // "Concluindo.." from hang-up until the tick that clears C (CONCLUINDO_272; driver test log, 2026-10-17).
  if (ativos.some((x) => x.estado === 'recolocado' || x.status === 'C')) return 'Concluindo..';
  // The caption follows the state timer (bench diff r4b, §18): a lifted nozzle only shows "Aguarda
  // liberação" once a tick left it in E; before that tick the panel keeps its rest caption, and
  // an authorized one goes straight from "Retirar Bico" to "Abastecendo.." (driver test log, 2026-10-17).
  // Only with `legendaPorTick` (2.7.2, CONCLUINDO_272); the real-profile mirror is unchanged.
  if (ativos.some((x) => x.estado === 'retirado' && (!legendaPorTick || x.status === 'E'))) return 'Aguarda liberação';
  if (l.bloqueado) return 'Bicos Bloqueados';
  return 'Retirar Bico';
}

function displays(conc: Concentrador, l: Lado) {
  const casas = decodificarVirgula(l.virgula);
  const b1 = l.bicos.find((x) => x.ativo && x.corrente) ?? l.bicos.find((x) => x.ativo);
  const c = b1?.corrente;
  const piscando = Boolean(c && c.piscando > 0);
  const fmt = (v: number, d: number) => (v / 10 ** d).toFixed(d);
  return {
    canal: l.canal,
    endereco: l.endereco,
    statusTexto: statusTextual(l, conc.q('CONCLUINDO_272')),
    bico: b1 ? hex2(b1.codigo) : null,
    piscando,
    total: piscando ? '888888' : fmt(Math.floor((c?.totalMil ?? 0) / 10 ** (3 - casas.total)), casas.total),
    volume: piscando ? '888888' : fmt(Math.floor((c?.volumeMl ?? 0) / 10 ** (3 - casas.volume)), casas.volume),
    preco: piscando ? '888888' : fmt(c?.precoUnit ?? (b1 ? conc.precoConfigurado(b1, l.nivelPreco) : 0), casas.preco),
    encerranteLitros: b1 ? (b1.encerranteMl / 1000).toFixed(2) : null,
    encerranteValor: b1 ? (b1.encerranteValorMil / 1000).toFixed(2) : null,
  };
}

function formatoRegistro(conc: Concentrador, formato: string): (c: Concentrador, r: Registro) => string {
  const p = conc.perfil;
  const mapa: Record<string, (c: Concentrador, r: Registro) => string> = {
    a52: F.a52,
    a34: F.a34,
    a36: F.a36,
    a67: F.a67,
    dupla: F.a66,
    paf1: F.paf1,
    paf2: F.paf2,
    a4: F.a4,
    lr: p.leituraRegistro.lr === 82 ? F.lr82 : F.lr74,
    lc: p.leituraRegistro.lc === 'paf1' ? F.paf1 : F.lcCbc,
  };
  const f = mapa[formato];
  if (!f) throw new ErroComando(`formato ${formato} não disponível na v1 (h02a1/h02a2 = Horustech completo, v1.1)`);
  return f;
}

function lerArquivoOuConteudo(a: Args): string {
  if (typeof a.conteudo === 'string') return a.conteudo;
  if (typeof a.arquivo === 'string') return fs.readFileSync(a.arquivo, 'latin1');
  throw new ErroComando('informe conteudo ou arquivo');
}

/** "5,899" / "5.899" → number. */
function lerFloat(txt: string): number {
  const t = txt.trim();
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
}

const MODOS: Record<string, ModoOperacao> = {
  libera: 'L',
  bloqueia: 'B',
  autoriza: 'A',
  stop: 'S',
  pausa: 'P',
  idf_on: 'H',
  idf_off: 'I',
};

function exigirOk(r: string, oque: string): void {
  if (r !== 'ok') throw new ErroComando(`${oque}: ${r}`, 409);
}

const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ───────────────────────── handlers ─────────────────────────

const H: Record<string, Handler> = {
  // ─── reads ───
  get_status(rt, a) {
    const c = rt.sim.conc;
    const formato = s(a, 'formato') ?? 'cbc';
    if (formato === 'horustech') throw new ErroComando('status Horustech (função 01) é v1.1');
    const quadro = formato === 'companytec48' ? codec(rt, '(?S92)') : codec(rt, '(&S)');
    return { quadro, lados: c.lados.filter((l) => l.configurado || l.falha).map((l) => ({ canal: l.canal, endereco: l.endereco, letra: c.letraDoLado(l) })) };
  },
  get_visualizacao(rt, a) {
    const c = rt.sim.conc;
    const quadro = b(a, 'identificada') ? codec(rt, '(?V95)') : codec(rt, '(&V)');
    const emCurso = c.bicosAtivos().filter((x) => x.corrente).map((x) => resumoBico(c, x));
    return { quadro, abastecendo: emCurso };
  },
  get_abastecimento(rt, a) {
    rt.tick();
    const c = rt.sim.conc;
    const porta = portaDoRuntime(rt, n(a, 'porta'));
    const pos = n(a, 'posicao') ?? c.ponteiroLeitura(porta);
    let formato = s(a, 'formato');
    if (formato === 'h02') {
      if (a.posicao !== undefined) throw new ErroComando('h02 só lê a posição do ponteiro (use sem posicao)');
      return { posicao: pos, quadro: codec(rt, '>?00020263', n(a, 'porta')) };
    }
    const r = c.buffer.ler(pos);
    if (!formato) {
      const f = c.perfil.formatoA;
      formato = (r ? F.usarA52(c, r) : f === 52 || (f === 'dip3' && c.dips[2])) ? 'a52' : c.q('A36') ? 'a36' : 'a34';
    }
    const fn = formatoRegistro(c, formato);
    return { posicao: pos, vazio: !r, formato, quadro: r ? fn(c, r) : null, registro: r ?? null };
  },
  list_abastecimentos(rt, a) {
    const c = rt.sim.conc;
    const de = n(a, 'de');
    const ate = n(a, 'ate');
    const codigo = a.bico !== undefined ? resolverBico(c, a.bico).codigo : undefined;
    let lista = c.buffer.todos().filter((r) => (de === undefined || r.posicao >= de) && (ate === undefined || r.posicao <= ate) && (codigo === undefined || r.codigoBico === codigo));
    const lim = n(a, 'limite');
    if (lim) lista = lista.slice(-lim);
    if (!b(a, 'com_quadro')) return { total: lista.length, registros: lista };
    // The same layout get_abastecimento picks for a stored record (A36: the DIP3 of when it was stored).
    const comQuadro = lista.map((r) => {
      const formato = F.usarA52(c, r) ? 'a52' : c.q('A36') ? 'a36' : 'a34';
      return { ...r, formato, quadro: formatoRegistro(c, formato)(c, r) };
    });
    return { total: comQuadro.length, registros: comQuadro };
  },
  get_ponteiros(rt, a) {
    rt.tick();
    const c = rt.sim.conc;
    const grupos = Object.fromEntries(c.buffer.gruposIds().map((g) => [g, c.buffer.grupo(g).leitura]));
    const porta = a.porta !== undefined ? portaDoRuntime(rt, n(a, 'porta')) : undefined;
    return {
      escrita: c.buffer.escrita,
      escritaIdentificada: c.escritaId,
      ponteiroUnico: c.quirks.Q3,
      leitura: porta ? c.ponteiroLeitura(porta) : grupos,
      idsPendentes: { escrita: c.idsPendentes.escrita, leitura: c.idsPendentes.gruposLeitura() },
      capacidade: c.buffer.capacidade,
    };
  },
  get_encerrante(rt, a) {
    const c = rt.sim.conc;
    const x = resolverBico(c, a.bico);
    const bb = hex2(x.codigo);
    const modo = { litros: 'L', litros10: 'l', valor: '$' }[s(a, 'tipo') ?? 'completo'];
    return {
      bico: bb,
      encerranteMl: x.encerranteMl,
      encerranteValorMil: x.encerranteValorMil,
      quadro: modo ? codec(rt, comKK(`&T${bb}${modo}`)) : null,
    };
  },
  get_precos(rt, a) {
    const c = rt.sim.conc;
    const x = resolverBico(c, a.bico);
    const bb = hex2(x.codigo);
    return { bico: bb, vigentes: [...x.precos], pendentes: [...x.precosPendentes], casas: c.casasDoBico(x).preco, quadro: codec(rt, comKK(`&T${bb}u`)) };
  },
  get_config_bico(rt, a) {
    const c = rt.sim.conc;
    const x = resolverBico(c, a.bico);
    const l = c.ladoDoBico(x);
    return { ...resumoBico(c, x), tipoBomba: l.tipoBomba, virgula: hex2(l.virgula), nBicos: l.nBicos, quadro: codec(rt, comKK(`&T${hex2(x.codigo)}C`)) };
  },
  get_serie(rt, a) {
    const c = rt.sim.conc;
    const quadro = a.bico !== undefined ? codec(rt, comKK(`&T${hex2(resolverBico(c, a.bico).codigo)}N`)) : codec(rt, '(&T99N3A)');
    return { numeroSerie: c.perfil.numeroSerie, permissao: c.perfil.permissaoSerie, quadro };
  },
  get_ids_abastecimento(rt, a) {
    const c = rt.sim.conc;
    const x = resolverBico(c, a.bico);
    const atual = x.corrente ? { cartao1: x.corrente.cartao1, cartao2: x.corrente.cartao2 } : null;
    return { bico: hex2(x.codigo), corrente: atual, ultimo: { ...x.ultimosCartoes }, quadro: codec(rt, comKK(`&T${hex2(x.codigo)}I`)) };
  },
  get_relogio(rt) {
    const c = rt.sim.conc;
    return { rtc: c.rtc.agora(), pc: c.rtc.agoraPc(), congelado: c.rtc.congelado, dataRegistro: c.quirks.Q5 ? 'pc' : 'simulado', quadroR: codec(rt, '(&R)'), quadroKR1: codec(rt, '(&KR1F4)') };
  },
  list_cartoes(rt, a) {
    const c = rt.sim.conc;
    const pos = n(a, 'posicao');
    // classe/listaNegra: derived for display (the same rule the core uses), so the UI holds no copy of it.
    const todos = c.cartoes.todos().map((x) => ({ ...x, classe: classeDoTipo(x.cartao.controle & 0x0f), listaNegra: c.estaNaListaNegra(x.cartao.codigo) }));
    if (pos === undefined) return { quantidade: c.cartoes.quantidade, capacidade: c.cartoes.capacidade, cartoes: todos };
    return { cartao: c.cartoes.em(pos) ?? null, quadro: codec(rt, comKK(`?LF${String(pos).padStart(6, '0')}`)) };
  },
  get_cartao(rt, a) {
    const c = rt.sim.conc;
    const codigo = String(a.codigo).toUpperCase();
    const cartao = c.cartoes.get(codigo);
    if (!cartao) throw new ErroComando(`cartão não cadastrado: ${codigo}`, 404);
    return { posicao: c.cartoes.posicaoDe(codigo), cartao, listaNegra: c.estaNaListaNegra(codigo) };
  },
  list_cartoes_desconhecidos(rt, a) {
    const c = rt.sim.conc;
    let lista = c.idsPendentes.todos();
    const lim = n(a, 'limite');
    if (lim) lista = lista.slice(-lim);
    const porta = portaDoRuntime(rt, n(a, 'porta'));
    return { escrita: c.idsPendentes.escrita, leitura: c.idsPendentes.leitura(c.grupoPonteiroDe(porta)), pendentes: lista };
  },
  get_lista_negra(rt) {
    // M99_272: the blacklist is the card registry column, with no capacity of its own.
    const c = rt.sim.conc;
    return { capacidade: c.q('M99_272') ? null : 20, codigos: c.codigosListaNegra() };
  },
  list_eventos(rt, a) {
    const ev = rt.sim.conc.eventos;
    const lim = n(a, 'limite');
    return { capacidade: rt.perfil.capacidadeEventos, eventos: lim ? ev.slice(-lim) : [...ev] };
  },
  get_sensores(rt) {
    const c = rt.sim.conc;
    return {
      quadro: codec(rt, comKK('?D')),
      enderecos: c.lados.filter((l) => l.configurado).map((l) => ({ canal: l.canal, endereco: l.endereco, sensorIdf: l.sensorIdf, modoIdentificacao: l.modoIdentificacao, modo: MODOS_IDENTIFICACAO[l.modoIdentificacao - 1] })),
    };
  },
  get_bombas(rt) {
    const c = rt.sim.conc;
    return { quadro: codec(rt, '(&F)'), enderecos: c.lados.filter((l) => l.configurado).map((l) => ({ canal: l.canal, endereco: l.endereco, tipoBomba: l.tipoBomba, nBicos: l.nBicos })) };
  },
  get_equipamento(rt) {
    const c = rt.sim.conc;
    const p = c.perfil;
    return {
      perfil: p.id,
      modelo: c.modelo,
      tipoCbc: c.tipoCbc(),
      firmware: p.firmware,
      monitor: p.monitor,
      numeroSerie: p.numeroSerie,
      canais: p.canais,
      dips: [...c.dips],
      automacao: c.automacao,
      redeAC: c.redeAC,
      bateriaVolts: c.bateriaCv / 100,
    };
  },
  get_estado_simulador(rt) {
    rt.tick();
    const c = rt.sim.conc;
    const p = c.perfil;
    return {
      perfil: { id: p.id, nome: p.nome, descricao: p.descricao, canais: p.canais, escutaTcp: p.escutaTcp, portas: p.portas, opcoesPortaTcp: p.opcoesPortaTcp, buffer: p.buffer },
      quirks: { ...c.quirks },
      equipamento: H.get_equipamento!(rt, {}, undefined as unknown as Hub),
      relogio: { agora: rt.clock.now(), rtc: c.rtc.agora(), congelado: c.rtc.congelado, manual: rt.clock instanceof ManualClock },
      timers: { tickEstadoMs: p.tickEstadoMs, tickVazaoMs: c.tickVazaoMs, agendados: rt.agendados() },
      portas: rt.servidor?.portas() ?? [],
      conexoes: rt.servidor?.listarConexoes() ?? [],
      recusarConexoes: rt.recusarConexoes,
      travamento: c.estaTravado() ? c.travamento : null,
      travamentoMs: c.travamentoMs,
      gravando: rt.gravador ? (rt.gravador.arquivo ?? 'memória') : null,
      gravacao: rt.gravador ? { arquivo: rt.gravador.arquivo, inicio: rt.gravador.inicio, quadros: rt.gravador.quadros, bytes: rt.gravador.bytes } : null,
      erroPorta: rt.erroPorta,
      falhas: rt.falhas.listar(),
      ponteiros: H.get_ponteiros!(rt, {}, undefined as unknown as Hub),
      registros: c.buffer.todos().length,
      cartoes: c.cartoes.quantidade,
      listaNegra: c.codigosListaNegra(),
      lados: c.lados.filter((l) => l.configurado || l.falha).map((l) => resumoLado(c, l)),
    };
  },
  get_log_comunicacao(rt, a) {
    const porta = a.porta !== undefined ? `tcp:${String(a.porta)}` : undefined;
    const desde = n(a, 'desde');
    let log = rt.sim.conc.log.filter((e) => (!porta || e.porta === porta) && (desde === undefined || e.t >= desde));
    const lim = n(a, 'limite');
    if (lim) log = log.slice(-lim);
    return { log };
  },
  list_conexoes(rt) {
    return { recusarConexoes: rt.recusarConexoes, conexoes: rt.servidor?.listarConexoes() ?? [] };
  },
  get_displays(rt, a) {
    rt.tick();
    const c = rt.sim.conc;
    const canal = n(a, 'canal');
    return { enderecos: c.lados.filter((l) => l.configurado && (canal === undefined || l.canal === canal)).map((l) => displays(c, l)) };
  },
  list_falhas(rt) {
    return { falhas: rt.falhas.listar() };
  },
  list_snapshots(rt) {
    return { snapshots: [...rt.snapshots.values()].map((x) => ({ nome: x.nome, perfil: x.perfil.id, ts: x.ts })) };
  },
  list_perfis() {
    return { perfis: IDS_PERFIS.map((id) => ({ id, descricao: obterPerfil(id).descricao })) };
  },
  list_sims(_rt, _a, hub) {
    return { sims: hub.listar() };
  },
  list_gravacoes(_rt, a, hub) {
    const dir = path.resolve(s(a, 'dir') ?? hub.dirGravacoes);
    if (!fs.existsSync(dir)) return { dir, existe: false, gravacoes: [] };
    const gravacoes = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((nome) => {
        const arq = path.join(dir, nome);
        const tamanho = fs.statSync(arq).size;
        try {
          const linhas = lerGravacao(fs.readFileSync(arq, 'utf8'));
          const meta = linhas.find((l) => l.dir === 'meta')?.meta ?? {};
          const tss = linhas.map((l) => l.ts);
          return {
            nome,
            arquivo: arq,
            tamanho,
            perfil: typeof meta.perfil === 'string' ? meta.perfil : null,
            inicio: tss.length ? Math.min(...tss) : null,
            fim: tss.length ? Math.max(...tss) : null,
            quadros: linhas.filter((l) => l.dir === 'rx' || l.dir === 'tx').length,
          };
        } catch (e) {
          return { nome, arquivo: arq, tamanho, erro: e instanceof Error ? e.message : String(e) };
        }
      })
      .sort((x, y) => ('inicio' in y ? (y.inicio ?? 0) : 0) - ('inicio' in x ? (x.inicio ?? 0) : 0) || x.nome.localeCompare(y.nome));
    return { dir, existe: true, gravacoes };
  },
  list_roteiros_diff() {
    return { casos: ROTEIROS.map((c) => ({ id: c.id, titulo: c.titulo, resolve: c.resolve, comparacao: c.comparacao ?? 'bytes', passos: c.passos.length })) };
  },

  // ─── protocol ───
  incrementar_ponteiro(rt, a) {
    rt.tick();
    const c = rt.sim.conc;
    const porta = portaDoRuntime(rt, n(a, 'porta'));
    if (s(a, 'alvo') === 'id') {
      c.idsPendentes.incrementar(c.grupoPonteiroDe(porta));
      return { leitura: c.idsPendentes.leitura(c.grupoPonteiroDe(porta)) };
    }
    const avancou = c.incrementarPonteiro(porta);
    return { avancou, leitura: c.ponteiroLeitura(porta), escrita: c.buffer.escrita };
  },
  set_ponteiro(rt, a) {
    const c = rt.sim.conc;
    const porta = portaDoRuntime(rt, n(a, 'porta'));
    const g = c.grupoPonteiroDe(porta);
    if (s(a, 'alvo') === 'id') {
      const e = c.idsPendentes.exportar();
      e.grupos[g] = n(a, 'valor') ?? c.idsPendentes.escrita;
      c.idsPendentes.importar(e);
      return { leitura: c.idsPendentes.leitura(g) };
    }
    const v = n(a, 'valor');
    if (v !== undefined && (v < c.buffer.opcoes.posMin || v > c.buffer.opcoes.posMax)) throw new ErroComando(`ponteiro fora do buffer (${c.buffer.opcoes.posMin}..${c.buffer.opcoes.posMax})`);
    c.buffer.definirLeitura(g, v);
    return { grupo: g, leitura: c.ponteiroLeitura(porta), escrita: c.buffer.escrita };
  },
  set_modo(rt, a) {
    const c = rt.sim.conc;
    const modo = String(a.modo);
    if (modo === 'clear') {
      c.listaNegraOp('c', '');
      return { ok: true };
    }
    const x = resolverBico(c, a.bico);
    exigirOk(c.modo(x.codigo, MODOS[modo]!), `set_modo ${modo}`);
    return resumoLado(c, c.ladoDoBico(x));
  },
  set_preco(rt, a) {
    const c = rt.sim.conc;
    const x = resolverBico(c, a.bico);
    exigirOk(c.definirPreco(x.codigo, n(a, 'nivel') ?? 0, Number(a.preco)), 'set_preco');
    return { bico: hex2(x.codigo), vigentes: [...x.precos], pendentes: [...x.precosPendentes] };
  },
  preset(rt, a) {
    const c = rt.sim.conc;
    const x = resolverBico(c, a.bico);
    const l = c.ladoDoBico(x);
    if (a.valor === undefined && a.volume === undefined) throw new ErroComando('informe valor ou volume');
    if (a.valor !== undefined && c.q('P_272')) exigirOk(c.preset272(x, Number(a.valor)), 'preset');
    else if (a.valor !== undefined) exigirOk(c.preset(x.codigo, Number(a.valor)), 'preset');
    else {
      if (l.bicos.some((y) => y.estado === 'abastecendo')) throw new ErroComando('preset: abastecendo', 409);
      l.presetVolumeMl = Number(a.volume) * 10 ** (3 - decodificarVirgula(l.virgula).volume);
      l.presetCentavos = null;
    }
    if (s(a, 'alvo') === 'bico') l.bicoAutorizado = x.codigo;
    if (a.nivel !== undefined) l.nivelPreco = Number(a.nivel);
    return resumoLado(c, l);
  },
  preset_identificado(rt, a) {
    const c = rt.sim.conc;
    const x = resolverBico(c, a.bico);
    const porVolume = a.volume !== undefined;
    exigirOk(
      c.presetIdentificado({
        codigo: x.codigo,
        identificador: String(a.cartao),
        tipoId: (s(a, 'tipo') ?? 'frentista') as 'frentista' | 'cliente' | 'hodometro',
        autoriza: b(a, 'autoriza') ?? true,
        valor: Number(porVolume ? a.volume : (a.valor ?? 0)),
        segundos: n(a, 'segundos_retirada') ?? 0,
        tipoPreset: porVolume ? 'V' : '$',
      }),
      'preset_identificado',
    );
    return resumoLado(c, c.ladoDoBico(x));
  },
  gravar_cartao(rt, a) {
    const c = rt.sim.conc;
    const codigo = String(a.codigo).toUpperCase();
    if (!/^[0-9A-F]{1,16}$/.test(codigo)) throw new ErroComando('codigo: até 16 hex');
    const turno = (t: unknown) => (t ? { inicio: String((t as Args).inicio), fim: String((t as Args).fim) } : null);
    const pos = c.gravarCartao({
      codigo: codigo.padStart(16, '0'),
      controle: ((n(a, 'permissao') ?? 2) << 4) | (n(a, 'tipo') ?? 1),
      turnoA: turno(a.turnoA),
      turnoB: turno(a.turnoB),
    });
    if (pos === null) throw new ErroComando('memória de cartões cheia', 409);
    return { posicao: pos };
  },
  excluir_cartao(rt, a) {
    const pos = rt.sim.conc.excluirCartao(String(a.codigo).toUpperCase().padStart(16, '0'));
    if (pos === null) throw new ErroComando('cartão não cadastrado', 404);
    return { posicao: pos };
  },
  limpar_cartoes(rt) {
    rt.sim.conc.limparCartoes();
    return { ok: true };
  },
  lista_negra(rt, a) {
    const c = rt.sim.conc;
    const op = ({ poe: 'b', tira: 'l', limpa: 'c' } as const)[String(a.acao) as 'poe' | 'tira' | 'limpa'];
    if (op !== 'c' && !a.codigo) throw new ErroComando('codigo obrigatório');
    exigirOk(c.listaNegraOp(op, String(a.codigo ?? '').toUpperCase().padStart(16, '0')), 'lista_negra');
    return { codigos: c.codigosListaNegra() };
  },
  set_relogio(rt, a) {
    rt.sim.conc.rtc.ajustar(lerDataHora(String(a.datahora)));
    return { rtc: rt.sim.conc.rtc.agora() };
  },
  configurar_endereco(rt, a) {
    const c = rt.sim.conc;
    const l = lado(c, a);
    const virgula = a.virgula !== undefined ? parseInt(String(a.virgula), 16) : undefined;
    if (!c.configurarEndereco({ canal: l.canal, endereco: l.endereco, nBicos: Number(a.n_bicos), tipoBomba: s(a, 'tipo_bomba'), virgula })) throw new ErroComando('configuração inválida');
    for (const cfg of (a.bicos as Args[] | undefined) ?? []) {
      const x = l.bicos[Number(cfg.posicao) - 1];
      if (!x?.ativo) throw new ErroComando(`bico ${String(cfg.posicao)} não está ativo no endereço`);
      aplicarCamposBico(c, x, cfg);
    }
    return resumoLado(c, l);
  },
  configurar_bico(rt, a) {
    const c = rt.sim.conc;
    const x = resolverBico(c, a.bico);
    aplicarCamposBico(c, x, a);
    return resumoBico(c, x);
  },
  configurar_sensor(rt, a) {
    const c = rt.sim.conc;
    const l = lado(c, a);
    c.setSensorIdf(l.canal, l.endereco, b(a, 'ligado') ?? true);
    if (a.modo_identificacao !== undefined && !c.definirModoIdentificacao(l.canal, l.endereco, Number(a.modo_identificacao))) throw new ErroComando('modo_identificacao inválido');
    return { sensorIdf: l.sensorIdf, modoIdentificacao: l.modoIdentificacao, modo: MODOS_IDENTIFICACAO[l.modoIdentificacao - 1], rotulo: c.quirks.IDF_CC_BYTE };
  },
  gravar_encerrante(rt, a) {
    const c = rt.sim.conc;
    const x = resolverBico(c, a.bico);
    if (b(a, 'painel') && c.q('E_272')) {
      // The 2.7.2 "Gravar totais" button (the same routine its &E calls): liters only, and a
      // zero-volume record when the totalizer changed. Its "Dinheiro" radio is silent (not modeled).
      if (s(a, 'unidade') === 'valor') throw new ErroComando('no simulador-2.7.2 o "Dinheiro" do Gravar totais não grava nada', 409);
      c.gravarEncerrante272(x, Number(a.valor));
      return { encerranteMl: x.encerranteMl, encerranteValorMil: x.encerranteValorMil, escrita: c.buffer.escrita };
    }
    if (s(a, 'unidade') === 'valor') x.encerranteValorMil = Number(a.valor);
    else c.gravarEncerrante(x.codigo, Number(a.valor));
    return { encerranteMl: x.encerranteMl, encerranteValorMil: x.encerranteValorMil };
  },
  carregar_config_padrao(rt) {
    rt.sim.conc.carregarConfigPadrao();
    return { enderecos: rt.sim.conc.lados.filter((l) => l.configurado).length };
  },
  enviar_comando_cru(rt, a) {
    rt.tick();
    const respostas = rt.sim.enviar(String(a.quadro), portaDoRuntime(rt, n(a, 'porta')));
    return { respostas, resposta: respostas[0] ?? null };
  },

  async enviar_pela_porta(rt, a, hub) {
    if (!rt.servidor) throw new ErroComando('sem servidor TCP', 409);
    const logica = n(a, 'porta') ?? rt.servidor.portas()[0]?.logica;
    const fisica = logica === undefined ? undefined : rt.servidor.fisica(logica);
    if (logica === undefined || fisica === undefined) throw new ErroComando(`porta ${String(logica ?? '')} não está aberta`, 409);
    const h = hub.host;
    const host = !h || h === '0.0.0.0' || h === '::' ? '127.0.0.1' : h;
    const cli = await ClienteTcp.conectar({ host, porta: fisica });
    try {
      const r = await cli.trocar([String(a.quadro)], { timeoutMs: n(a, 'timeout_ms') ?? 1000 });
      return { porta: logica, resposta: r.bytes.length ? r.bytes.toString('latin1') : null, latenciaMs: r.latenciaMs, caiu: r.caiu };
    } finally {
      cli.fechar();
    }
  },

  // ─── physical control ───
  retirar_bico(rt, a) {
    const c = rt.sim.conc;
    const x = resolverBico(c, a.bico);
    if (!c.retirarBico(x.codigo)) throw new ErroComando(`bico ${hex2(x.codigo)} não está em repouso (${x.estado})`, 409);
    return resumoBico(c, x);
  },
  recolocar_bico(rt, a) {
    const c = rt.sim.conc;
    const x = resolverBico(c, a.bico);
    if (!c.recolocarBico(x.codigo)) throw new ErroComando(`bico ${hex2(x.codigo)} não está fora do descanso (${x.estado})`, 409);
    return resumoBico(c, x);
  },
  alternar_bico(rt, a) {
    const c = rt.sim.conc;
    const x = resolverBico(c, a.bico);
    c.alternarBico(x.codigo);
    return resumoBico(c, x);
  },
  abastecer(rt, a) {
    rt.tick();
    const c = rt.sim.conc;
    const x = resolverBico(c, a.bico);
    const l = c.ladoDoBico(x);
    if (x.estado !== 'repouso') throw new ErroComando(`bico ${hex2(x.codigo)} não está em repouso (${x.estado})`, 409);
    if (a.cartao1 !== undefined) l.cartao1 = String(a.cartao1).toUpperCase().padStart(16, '0');
    if (a.cartao2 !== undefined) l.cartao2 = String(a.cartao2).toUpperCase().padStart(16, '0');
    if (a.nivel_preco !== undefined) l.nivelPreco = Number(a.nivel_preco);
    const casas = decodificarVirgula(l.virgula);
    if (a.vazao_l_s !== undefined) {
      const mlTick = casas.volume >= 3 ? c.perfil.vazaoMlPorTick.casas3 : c.perfil.vazaoMlPorTick.casas2;
      c.setVelocidade(Math.max(1, Math.round(mlTick / Number(a.vazao_l_s))));
    }
    if (a.volume !== undefined) {
      l.presetVolumeMl = Number(a.volume);
      l.presetCentavos = null;
    } else if (a.valor !== undefined) {
      l.presetCentavos = Number(a.valor);
      l.presetVolumeMl = null;
    }
    if (l.bloqueado || l.sensorIdf) c.modo(x.codigo, 'A');
    c.retirarBico(x.codigo);
    const dur = n(a, 'duracao_s');
    // VAZAO_272: the reached preset freezes without finishing; without `duracao_s`, the "attendant" hangs up there.
    if (dur === undefined && (a.volume !== undefined || a.valor !== undefined)) x.recolocarNoPreset = true;
    if (dur !== undefined) {
      const ateVazar = c.perfil.tickEstadoMs + (c.quirks.Q6 ? c.perfil.ticksPiscando * c.tickVazaoMs : 0);
      const recolocar = b(a, 'recolocar_ao_fim') ?? true;
      rt.agendar(ateVazar + dur * 1000, () => {
        if (recolocar) c.recolocarBico(x.codigo);
        else if (x.estado === 'abastecendo') c.modo(x.codigo, 'P');
      });
    }
    return { bico: hex2(x.codigo), presetVolumeMl: l.presetVolumeMl, presetCentavos: l.presetCentavos, tickVazaoMs: c.tickVazaoMs };
  },
  gerar_abastecimentos(rt, a) {
    rt.tick();
    const c = rt.sim.conc;
    const x = resolverBico(c, a.bico);
    const vol = n(a, 'volume') ?? 1000;
    const qtd = Number(a.quantidade);
    const casas = decodificarVirgula(c.ladoDoBico(x).virgula);
    for (let i = 0; i < qtd; i++) {
      if (x.estado !== 'repouso') throw new ErroComando(`bico ${hex2(x.codigo)} não está em repouso (${x.estado}) no ${i + 1}º`, 409);
      c.retirarBico(x.codigo);
      c.iniciar(x);
      const cor = x.corrente!;
      cor.volumeMl = vol;
      cor.totalMil = c.totalMil(vol, cor.precoUnit, casas.preco);
      cor.piscando = 0;
      c.encerrar(x);
      c.tickEstado();
      if (x.estado !== 'repouso') throw new ErroComando('a simulação está parada (Q7: Automação/DIP4)', 409);
    }
    return { gravados: qtd, escrita: c.buffer.escrita };
  },
  limpar_buffer(rt) {
    const c = rt.sim.conc;
    c.buffer.limpar();
    return { escrita: c.buffer.escrita };
  },
  apresentar_cartao(rt, a) {
    const c = rt.sim.conc;
    const l = lado(c, a);
    return c.apresentarCartao(l.canal, l.endereco, String(a.codigo));
  },
  set_falha_endereco(rt, a) {
    const c = rt.sim.conc;
    const l = lado(c, a);
    c.setFalhaEndereco(l.canal, l.endereco, Boolean(a.ativo));
    return { letra: c.letraDoLado(l) };
  },
  set_automacao(rt, a) {
    rt.sim.conc.automacao = Boolean(a.on);
    return { automacao: rt.sim.conc.automacao };
  },
  set_rede_ac(rt, a) {
    rt.sim.conc.redeAC = Boolean(a.ligada);
    return { redeAC: rt.sim.conc.redeAC };
  },
  set_bateria(rt, a) {
    rt.sim.conc.bateriaCv = Math.round(Number(a.volts) * 100);
    return { bateriaVolts: rt.sim.conc.bateriaCv / 100 };
  },
  set_dip(rt, a) {
    const c = rt.sim.conc;
    c.dips[Number(a.n) - 1] = Boolean(a.on);
    return { dips: [...c.dips] };
  },
  set_velocidade(rt, a) {
    const v = a.velocidade;
    rt.sim.conc.setVelocidade(typeof v === 'number' ? v : (String(v) as 'lento' | 'normal' | 'rapido'));
    return { tickVazaoMs: rt.sim.conc.tickVazaoMs };
  },
  set_relogio_simulado(rt, a) {
    const c = rt.sim.conc;
    if (a.datahora !== undefined) c.rtc.ajustar(lerDataHora(String(a.datahora)));
    if (a.congelado !== undefined) c.rtc.congelar(Boolean(a.congelado));
    if (a.fonte_data_registro !== undefined) c.quirks.Q5 = a.fonte_data_registro === 'pc';
    return { rtc: c.rtc.agora(), congelado: c.rtc.congelado, dataRegistro: c.quirks.Q5 ? 'pc' : 'simulado' };
  },
  avancar_tempo(rt, a) {
    if (!(rt.clock instanceof ManualClock)) throw new ErroComando('avancar_tempo só com relógio manual (--relogio-manual)', 409);
    const ms = Number(a.ms);
    const passo = Math.min(rt.perfil.tickEstadoMs, rt.sim.conc.tickVazaoMs);
    for (let t = 0; t < ms; t += passo) {
      rt.clock.advance(Math.min(passo, ms - t));
      rt.tick();
    }
    return { agora: rt.clock.now() };
  },
  injetar_evento(rt, a) {
    rt.sim.conc.injetarEvento(String(a.tipo), s(a, 'texto') ?? '');
    return { eventos: rt.sim.conc.eventos.length };
  },
  ciclo_energia(rt) {
    rt.tick();
    rt.sim.conc.cicloEnergia();
    return { eventos: rt.sim.conc.eventos.slice(-2) };
  },
  async set_quirk(rt, a) {
    const nome = String(a.nome) as QuirkId;
    if (!TODOS_QUIRKS.includes(nome)) throw new ErroComando(`quirk desconhecido: ${nome} (${TODOS_QUIRKS.join(', ')})`);
    // Derives the profile: structural quirks (BUFFER_1000, Q4, IDF_272) rebuild the buffer/queue without losing state.
    await rt.trocarPerfil(derivePerfil(rt.perfil, { quirks: { [nome]: Boolean(a.on) } }));
    return { quirks: { ...rt.sim.conc.quirks } };
  },
  set_modelo(rt, a) {
    rt.sim.conc.setModelo(String(a.modelo) as Modelo);
    return { modelo: rt.sim.conc.modelo, tipoCbc: rt.sim.conc.tipoCbc() };
  },
  async set_firmware(rt, a) {
    await rt.trocarPerfil(derivePerfil(rt.perfil, { firmware: String(a.firmware) }));
    return { firmware: rt.perfil.firmware };
  },

  // ─── faults and infrastructure ───
  injetar_falha(rt, a) {
    return rt.falhas.adicionar(a as unknown as NovaFalha);
  },
  limpar_falhas(rt, a) {
    return { removidas: rt.falhas.limpar(n(a, 'id')) };
  },
  desconectar(rt, a) {
    if (a.recusar_conexoes !== undefined) rt.recusarConexoes = Boolean(a.recusar_conexoes);
    const quedas = a.recusar_conexoes !== undefined && a.porta === undefined && a.cliente === undefined ? 0 : (rt.servidor?.desconectar({ id: n(a, 'cliente'), porta: n(a, 'porta'), modo: s(a, 'modo') as 'rst' | 'fin' | undefined }) ?? 0);
    return { derrubadas: quedas, recusarConexoes: rt.recusarConexoes };
  },
  travar(rt, a) {
    rt.travar(s(a, 'motivo') ?? 'MessageBox', n(a, 'ms') ?? null);
    return { travamento: rt.sim.conc.travamento };
  },
  liberar_travamento(rt) {
    rt.liberarTravamento();
    return { ok: true };
  },
  configurar_travamento(rt, a) {
    rt.sim.conc.travamentoMs = a.ms === null ? null : Number(a.ms);
    return { travamentoMs: rt.sim.conc.travamentoMs };
  },
  async set_perfil(rt, a) {
    const id = String(a.perfil) as PerfilId;
    if (!IDS_PERFIS.includes(id)) throw new ErroComando(`perfil desconhecido: ${id}`);
    await rt.trocarPerfil(obterPerfil(id));
    return { perfil: id, portas: rt.servidor?.portas() ?? [] };
  },
  async abrir_porta(rt, a) {
    if (!rt.servidor) throw new ErroComando('sem servidor TCP', 409);
    try {
      await rt.servidor.abrirPorta(Number(a.porta));
    } catch (e) {
      rt.registrarErroPorta(Number(a.porta), e);
      throw new ErroComando(e instanceof Error ? e.message : String(e), 409);
    }
    rt.erroPorta = null;
    return { portas: rt.servidor.portas() };
  },
  async fechar_porta(rt, a) {
    if (!rt.servidor) throw new ErroComando('sem servidor TCP', 409);
    await rt.servidor.fecharPorta(Number(a.porta));
    return { portas: rt.servidor.portas() };
  },
  gravar_inicio(rt, a, hub) {
    let arquivo = s(a, 'arquivo') ?? null;
    if (arquivo === null && b(a, 'na_pasta')) {
      const dir = path.resolve(hub.dirGravacoes);
      fs.mkdirSync(dir, { recursive: true });
      const carimbo = new Date(rt.clock.now()).toISOString().slice(0, 19).replace(/:/g, '-');
      arquivo = path.join(dir, `trafego-${carimbo}.jsonl`);
    }
    const g = rt.gravarInicio(arquivo);
    return { arquivo: g.arquivo };
  },
  gravar_fim(rt) {
    const g = rt.gravador;
    const r = rt.gravarFim();
    if (!r) throw new ErroComando('não estava gravando', 409);
    return { ...r, linhas_memoria: g && !g.arquivo ? g.linhas : undefined };
  },
  async replay(_rt, a, hub) {
    const linhas = lerGravacao(fs.readFileSync(String(a.arquivo), 'utf8'));
    const velocidade = n(a, 'velocidade') ?? 0;
    if (a.modo === 'servidor') {
      const srv = await ServidorReplay.abrir(linhas, { mapa: a.portas as Record<string, number> | undefined, velocidade, host: hub.host });
      hub.replays.push(srv);
      return { portas: srv.portas(), enquadramento: srv.enquadramento };
    }
    const alvo = a.alvo ? lerAlvo(String(a.alvo)) : undefined;
    const portas = [...new Set(linhas.filter((l) => l.dir === 'rx').map((l) => String(l.porta)))];
    return replayCliente(linhas, { alvos: alvo ? Object.fromEntries(portas.map((p) => [p, alvo])) : undefined, velocidade });
  },
  async replay_parar(_rt, _a, hub) {
    const n = hub.replays.length;
    await Promise.all(hub.replays.splice(0).map((r) => r.fechar()));
    return { fechados: n };
  },
  snapshot_salvar(rt, a) {
    const x = rt.snapshotSalvar(String(a.nome));
    return { nome: x.nome, perfil: x.perfil.id, ts: x.ts };
  },
  async snapshot_carregar(rt, a) {
    await rt.snapshotCarregar(String(a.nome));
    return { ok: true, perfil: rt.perfil.id };
  },
  reset(rt, a) {
    rt.reset(b(a, 'manter_config') ?? false);
    return { ok: true };
  },
  async diff_executar(_rt, a) {
    const casos = selecionarRoteiros(a.roteiro as string | string[]);
    const alvo = (nome: 'A' | 'B', padrao: 'driver' | 'pump-sim'): AlvoDiff => {
      const x = nome.toLowerCase();
      const base: AlvoDiff = { nome, alvo: lerAlvo(String(a[`alvo_${x}`])) };
      const url = s(a, `controle_${x}`);
      if (!url) return base;
      return (s(a, `tipo_controle_${x}`) ?? padrao) === 'driver' ? { ...base, driver: url } : { ...base, controle: url };
    };
    return executarDiff(casos, alvo('A', 'driver'), alvo('B', 'pump-sim'), {
      timeoutMs: n(a, 'timeout_ms'),
      drenarAntes: b(a, 'drenar_antes') ?? false,
      ...(s(a, 'plataforma_a') === 'wine' ? { plataformaA: 'wine' as const } : {}),
    });
  },
  async aguardar_estado(rt, a) {
    const c = rt.sim.conc;
    const x = resolverBico(c, a.bico);
    const alvo = String(a.status) as LetraStatus;
    const limite = n(a, 'timeout_ms') ?? 10_000;
    let gasto = 0;
    for (;;) {
      rt.tick();
      if (x.status === alvo) return { ok: true, status: x.status, esperouMs: gasto };
      if (gasto >= limite) return { ok: false, status: x.status, esperouMs: gasto };
      await espera(20);
      gasto += 20;
    }
  },
  importar_simcnf(rt, a) {
    return importarSimcnf(rt, lerArquivoOuConteudo(a));
  },
  importar_log(rt, a) {
    const c = rt.sim.conc;
    let conf = 0;
    let eventos = 0;
    for (const linha of lerArquivoOuConteudo(a).split(/\r?\n/)) {
      const m = /^\[CONF\](\(&C.*\))\s*$/.exec(linha.trim());
      if (m) {
        processarCompanytec(c, portaDoRuntime(rt), m[1]!);
        conf++;
        continue;
      }
      const ev = /^\[([^\]]+)\]\s*(.*)$/.exec(linha.trim());
      if (ev) {
        c.injetarEvento(ev[1]!, ev[2]!);
        eventos++;
      }
    }
    return { configuracoes: conf, eventos };
  },
  async criar_sim(_rt, a, hub) {
    const id = String(a.sim_id);
    await hub.criar(id, String(a.perfil) as PerfilId, a.portas as number[] | undefined);
    return { sims: hub.listar() };
  },
  async remover_sim(_rt, a, hub) {
    await hub.remover(String(a.sim_id));
    return { sims: hub.listar() };
  },
};

function aplicarCamposBico(c: Concentrador, x: Bico, a: Args): void {
  if (a.numero_pista !== undefined && !c.definirNumeroPista(x.codigo, Number(a.numero_pista))) throw new ErroComando(`numero_pista inválido ou em uso: ${String(a.numero_pista)}`, 409);
  if (a.combustivel !== undefined) x.combustivel = Number(a.combustivel);
  if (a.tanque !== undefined) x.tanque = Number(a.tanque);
  if (a.volume_tanque !== undefined) x.volumeTanque = Number(a.volume_tanque);
}

/**
 * K20: c:\simcnf.ini (behavioral equivalence). `(&C…)` lines go to the codec; `[c,e,b](encLit)(encVal)(preço)…;`
 * store totalizers and price (b = position 1..4, numbers in the Windows locale);
 * `C,` + 7 columns = card (code, CC hex, T1 start, T1 end, T2 start, T2 end,
 * blacklist S/N — the column order is an inference, B).
 */
function importarSimcnf(rt: SimRuntime, txt: string) {
  const c = rt.sim.conc;
  const r = { enderecos: 0, bicos: 0, cartoes: 0, ignoradas: [] as string[] };
  for (const bruta of txt.split(/\r?\n/)) {
    const linha = bruta.trim();
    if (!linha) continue;
    if (linha.startsWith('(&C')) {
      processarCompanytec(c, portaDoRuntime(rt), linha);
      r.enderecos++;
      continue;
    }
    const mb = /^\[(\d+),(\d+),(\d+)\]\(([^)]*)\)\(([^)]*)\)\(([^)]*)\)/.exec(linha);
    if (mb) {
      const [can, end, pos] = [Number(mb[1]), Number(mb[2]), Number(mb[3])];
      const x = c.lado(can, end)?.bicos[pos - 1];
      if (!x?.ativo) {
        r.ignoradas.push(linha);
        continue;
      }
      const casas = c.casasDoBico(x);
      x.encerranteMl = Math.round(lerFloat(mb[4]!) * 1000);
      x.encerranteFracMl = undefined;
      x.encerranteValorMil = Math.round(lerFloat(mb[5]!) * 1000);
      const preco = Math.round(lerFloat(mb[6]!) * 10 ** casas.preco);
      x.precos = [preco, preco, preco];
      x.precosPendentes = [null, null, null];
      r.bicos++;
      continue;
    }
    if (linha.startsWith('C,')) {
      const col = linha.slice(2).split(',');
      if (col.length < 7) {
        r.ignoradas.push(linha);
        continue;
      }
      const [codigo, cc, a1, a2, b1, b2, ln] = col.map((x) => x.trim()) as [string, string, string, string, string, string, string];
      c.gravarCartao({
        codigo: codigo.toUpperCase().padStart(16, '0'),
        controle: parseInt(cc, 16) || 0,
        turnoA: a1 && a2 ? { inicio: a1, fim: a2 } : null,
        turnoB: b1 && b2 ? { inicio: b1, fim: b2 } : null,
      });
      if (/^(s|1|sim|true)$/i.test(ln)) c.listaNegraOp('b', codigo.toUpperCase().padStart(16, '0'));
      r.cartoes++;
      continue;
    }
    r.ignoradas.push(linha);
  }
  return r;
}

// ───────────────────────── execution ─────────────────────────

export const NOMES_HANDLERS = Object.keys(H);

/** Process commands (not of an instance): `sim_id` is an argument, not a selector. */
const DO_HUB = new Set(['criar_sim', 'remover_sim', 'list_sims', 'list_perfis', 'replay', 'replay_parar', 'diff_executar', 'list_gravacoes', 'list_roteiros_diff']);

/** Validates and runs a catalog command on an instance. */
export async function executarComando(hub: Hub, nome: string, args: Args = {}): Promise<unknown> {
  const def = defComando(nome);
  const h = H[nome];
  if (!def || !h) throw new ErroComando(`comando desconhecido: ${nome}`, 404);
  const erros = validar(schemaComSimId(def), args);
  if (erros.length) throw new ErroComando(erros.join('; '));
  if (DO_HUB.has(nome)) return await h(hub.obter(hub.primeiro()), args, hub);
  const { sim_id, ...resto } = args;
  return await h(hub.obter(String(sim_id ?? 'default')), resto, hub);
}

export function catalogoCompleto() {
  return CATALOGO.map((c) => ({ ...c, params: schemaComSimId(c) }));
}
