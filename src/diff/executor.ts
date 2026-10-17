import { type Alvo, ClienteTcp, type ConexaoTroca } from '../net/cliente-tcp.js';
import { primeiroByteDiferente } from '../recorder/replay.js';
import { type BotaoPainel, type EstadoUi, type PassoAcao, acaoParaPumpSim, descreverAcao, estadoUiInicial, legendaRetirada } from './acoes.js';
import { hashRoteiro } from './hash.js';
import { TIMEOUT_SILENCIO_PADRAO_MS, fimDaResposta } from './resposta.js';
import type { CasoDiff, Passo, PassoDrenar, PassoEnviar } from './roteiros.js';
import { anotarRoteiro } from './sensivel.js';
import { type CampoTolerado, type PlataformaA, compararComToleranciaWine } from './tolerancia.js';

export interface AlvoDiff {
  nome: string;
  alvo: Alvo;
  /** pump-sim control API URL (runs the `manual` steps and translates the `acao` steps). */
  controle?: string;
  /**
   * URL of the SimuladorCBC 2.7.2 UI driver (`tools/driver-simuladorcbc`, e.g.
   * http://127.0.0.1:7071): `acao` steps become `POST /acao`. `manual` steps with
   * `soPumpSim` do nothing; the others go to the operator or are skipped.
   */
  driver?: string;
  /**
   * The pump-sim behind `controle` runs on a manual clock (`--relogio-manual`): `aguardar` steps
   * become `avancar_tempo` instead of a real wait. Unset = asked once through
   * `get_estado_simulador` at the start of the run (only when `controle` is set, there is no
   * `driver` and no `OpcoesDiff.esperar`); a failed probe counts as a real clock.
   */
  relogioManual?: boolean;
  /**
   * Opens a connection to `porta` on this target instead of TCP to `alvo.host` (the recorded-oracle
   * replay: side A answers from a recording, side B is an in-memory pump-sim). `uso` says whether it
   * is for a case step or for a `drenar`. A rejection is reported like a TCP connection failure.
   */
  conectar?: (porta: number, ctx: { caso: string; uso: 'passo' | 'drenar' }) => Promise<ConexaoTroca>;
  /** Replaces the wait of `aguardar` steps on this target only (takes precedence over `OpcoesDiff.esperar`). */
  esperar?: (ms: number) => Promise<void>;
}

/** Reply of the driver's `POST /acao` (driver contract). */
export interface RespostaDriver {
  ok: boolean;
  erro?: string;
  detalhe?: string | null;
  estado?: unknown;
  modais_fechados?: { ts?: string; texto?: string }[] | null;
}

/** An action, a `manual` step with control, or a `drenar` applied to a target. */
export interface RegistroAcao {
  alvo: string;
  passo: string;
  ok: boolean;
  erro?: string;
  detalhe?: string;
  /** Texts of the MessageBoxes the driver closed before/after the action. */
  modais?: string[];
}

export interface OpcoesDiff {
  timeoutMs?: number;
  ociosoMs?: number;
  /**
   * How long a step whose reply is expected to be silence waits ({@link silencioEsperado}).
   * Default {@link TIMEOUT_SILENCIO_PADRAO_MS}; never more than `timeoutMs`.
   */
  timeoutSilencioMs?: number;
  /**
   * Gap after each `(&I)` of a `drenar` before the next `(&A)` (default {@link INTERVALO_DRENAR_MS};
   * `PassoDrenar.timeoutMs` wins).
   */
  intervaloDrenarMs?: number;
  /** Manual step without a control API: the operator does it and confirms. Without this, the step is skipped. */
  manual?: (texto: string, alvo: AlvoDiff) => Promise<void>;
  /** For tests: replaces the HTTP call to the control API. */
  chamarControle?: (url: string, comando: string, args: Record<string, unknown>) => Promise<unknown>;
  /** For tests: replaces the driver `POST /acao`. */
  chamarDriver?: (url: string, corpo: Record<string, unknown>) => Promise<RespostaDriver>;
  /** For tests: replaces the real wait of `aguardar` steps (e.g. advancing a manual clock). */
  esperar?: (ms: number, alvo: AlvoDiff) => Promise<void>;
  /** Called as soon as each case ends (e.g. to append it to a `.partial.jsonl`). */
  aoTerminarCaso?: (r: ResultadoCaso) => void;
  /** Results of an earlier, interrupted run: these cases are not run again and go into the report as they are. */
  anteriores?: ResultadoCaso[];
  /** Drains pending fuelings on target A before the first case (same step as `drenar`). */
  drenarAntes?: boolean;
  /**
   * What target A runs on. `wine` (the real 2.7.2 under Wine) compares the free-flow fields of the
   * `vazao-livre` steps with a ±10% tolerance (DECISIONS §26/§30, `TOLERANCIA_WINE`); default `windows`
   * keeps every step byte-exact. The recorded oracle never sets it.
   */
  plataformaA?: PlataformaA;
}

/** Marker of a case skipped because one side could not connect to a port it needs. */
export const PULADO_PORTA = 'pulado: porta indisponível';

/** Connection failure on a port a step needs (the case is skipped, the run goes on). */
export class PortaIndisponivel extends Error {
  constructor(
    readonly alvo: string,
    readonly endereco: string,
    causa: unknown,
  ) {
    super(`${alvo} ${endereco}: ${causa instanceof Error ? causa.message : String(causa)}`);
  }
}

export interface Resposta {
  texto: string;
  hex: string;
  latenciaMs: number | null;
  caiu: boolean;
  /**
   * Bytes (latin1) that arrived on this step's connection after the previous reply had been
   * declared complete and before this step was sent: a reply that went on after the executor
   * stopped listening. Not part of `texto`; shown as a warning in the report.
   */
  atrasados?: string;
}

export interface PassoComparado {
  indice: number;
  quadro: string;
  nota?: string;
  a: Resposta;
  b: Resposta;
  /** Masked bytes equal and the same late bytes ({@link Resposta.atrasados}) on both targets. */
  igual: boolean;
  /** 1st differing byte (−1 = equal). Kept on a step equal only under the Wine tolerance. */
  byte: number;
  /**
   * Equal only under the Wine free-flow tolerance (`OpcoesDiff.plataformaA` `wine`, §26): the
   * fields that differed within it. Reported as "igual (tolerância wine)".
   */
  tolerancia?: { alvo: 'wine'; campos: CampoTolerado[] };
  esperado?: string | null;
  aConfere?: boolean;
  bConfere?: boolean;
  /**
   * Set when the step depends (`dependeDe`) on a `manual`/`acao` step skipped on a target: the
   * replies are kept but the step counts neither as equal nor as a divergence.
   */
  pulado?: string;
}

export interface ResultadoCaso {
  id: string;
  titulo: string;
  comparacao: 'bytes' | 'informativo';
  passos: PassoComparado[];
  pulados: { alvo: string; texto: string }[];
  /** Actions, `manual` with control and `drenar`, per target, with the result. */
  acoes: RegistroAcao[];
  divergencias: number;
  /** Steps reported as skipped because they depend on a skipped step ({@link PassoComparado.pulado}). */
  passosPulados?: number;
  /** Set when the case was not compared (e.g. {@link PULADO_PORTA}). */
  pulado?: string;
  /** Why it was skipped (target, address and connection error). */
  motivo?: string;
  /** {@link hashRoteiro} of the script this case ran with (what a recorded oracle is keyed on). */
  roteiroHash?: string;
}

export interface RelatorioDiff {
  alvoA: string;
  alvoB: string;
  casos: ResultadoCaso[];
  total: { passos: number; iguais: number; divergencias: number; casosComDivergencia: string[]; pulados?: number; toleradosWine?: number };
  /** Set when target A ran under Wine (`OpcoesDiff.plataformaA`). */
  plataformaA?: 'wine';
}

export async function chamarControleHttp(url: string, comando: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await fetch(`${url.replace(/\/$/, '')}/api/comandos/${comando}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const corpo = (await r.json()) as { ok: boolean; erro?: string; resultado?: unknown };
  if (!corpo.ok) throw new Error(`${comando}: ${corpo.erro ?? r.status}`);
  return corpo.resultado;
}

export async function chamarDriverHttp(url: string, corpo: Record<string, unknown>): Promise<RespostaDriver> {
  const r = await fetch(`${url.replace(/\/$/, '')}/acao`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const resp = (await r.json()) as RespostaDriver;
  if (!resp.ok) throw new Error(`driver ${String(corpo.tipo)}: ${resp.erro ?? r.status}`);
  return resp;
}

/**
 * Masks the N chars before the last `)` (&S battery etc.) and the `[início, fim)` char ranges of
 * `faixas` (clock-derived fields: record duration and time, `&R`/`&KR1` time; see `roteiros.ts`).
 */
export function mascarar(b: Buffer, ignorarFim = 0, faixas: readonly (readonly [number, number])[] = []): Buffer {
  if (!ignorarFim && faixas.length === 0) return b;
  const c = Buffer.from(b);
  for (const [ini, fim] of faixas) if (ini < c.length) c.fill(0x3f, ini, Math.min(fim, c.length));
  if (!ignorarFim) return c;
  const fim = c.lastIndexOf(0x29);
  if (fim < ignorarFim) return c;
  c.fill(0x3f, fim - ignorarFim, fim);
  return c;
}

const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const nomeAcao = (p: PassoAcao) => `${p.acao}${p.params && Object.keys(p.params).length ? ' ' + JSON.stringify(p.params) : ''}`;
const msgErro = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Contexto {
  alvo: AlvoDiff;
  op: OpcoesDiff;
  pulados: ResultadoCaso['pulados'];
  acoes: RegistroAcao[];
  /** 2.7.2 screen mirrored on the pump-sim side (persists between cases, like target A's screen). */
  ui: EstadoUi;
  /** `aguardar` advances the target's virtual clock (`avancar_tempo`) instead of waiting. */
  relogioManual?: boolean;
  /** Labels (`rotulo`) of the steps skipped on this target in the current case. */
  rotulosPulados?: Set<string>;
  /** Id of the case being run (passed to {@link AlvoDiff.conectar}). */
  caso?: string;
}

const conectarAlvo = (ctx: Contexto, porta: number, uso: 'passo' | 'drenar'): Promise<ConexaoTroca> =>
  ctx.alvo.conectar ? ctx.alvo.conectar(porta, { caso: ctx.caso ?? '', uso }) : ClienteTcp.conectar({ host: ctx.alvo.alvo.host, porta });

const esperarNo = (ctx: Contexto, ms: number): Promise<void> => {
  if (ctx.alvo.esperar) return ctx.alvo.esperar(ms);
  if (ctx.op.esperar) return ctx.op.esperar(ms, ctx.alvo);
  const url = ctx.alvo.controle;
  if (ctx.relogioManual && url) {
    return (ctx.op.chamarControle ?? chamarControleHttp)(url, 'avancar_tempo', { ms }).then(() => undefined);
  }
  return espera(ms);
};

/**
 * Whether `aguardar` on this target can advance a virtual clock instead of waiting in real time
 * (see {@link AlvoDiff.relogioManual}).
 */
export async function detectarRelogioManual(alvo: AlvoDiff, op: OpcoesDiff = {}): Promise<boolean> {
  if (alvo.relogioManual !== undefined) return alvo.relogioManual;
  if (op.esperar || alvo.esperar || !alvo.controle || alvo.driver) return false;
  try {
    const r = (await (op.chamarControle ?? chamarControleHttp)(alvo.controle, 'get_estado_simulador', {})) as { relogio?: { manual?: boolean } };
    return r?.relogio?.manual === true;
  } catch {
    return false;
  }
}

async function aplicarAcao(p: PassoAcao, ctx: Contexto): Promise<void> {
  const { alvo, op } = ctx;
  const reg: RegistroAcao = { alvo: alvo.nome, passo: nomeAcao(p), ok: true };
  if (alvo.driver) {
    try {
      const r = await (op.chamarDriver ?? chamarDriverHttp)(alvo.driver, { tipo: p.acao, ...(p.params ?? {}) });
      if (r.detalhe) reg.detalhe = r.detalhe;
      const modais = (r.modais_fechados ?? []).map((m) => m.texto ?? '').filter(Boolean);
      if (modais.length) reg.modais = modais;
    } catch (e) {
      reg.ok = false;
      reg.erro = msgErro(e);
    }
  } else if (alvo.controle) {
    const chamar = op.chamarControle ?? chamarControleHttp;
    try {
      for (const item of acaoParaPumpSim(p, ctx.ui)) {
        if ('aguardar' in item) await esperarNo(ctx, item.aguardar);
        else if ('botao' in item) {
          const url = alvo.controle;
          reg.detalhe = await clicarBotaoPainel(item.botao, (c, a) => chamar(url, c, a), (ms) => esperarNo(ctx, ms));
        }
        else await chamar(alvo.controle, item.comando, item.args);
      }
    } catch (e) {
      reg.ok = false;
      reg.erro = msgErro(e);
    }
  } else if (op.manual) {
    await op.manual(descreverAcao(p), alvo);
    acaoParaPumpSim(p, ctx.ui);
  } else {
    ctx.pulados.push({ alvo: alvo.nome, texto: descreverAcao(p) });
    if (p.rotulo) ctx.rotulosPulados?.add(p.rotulo);
    return;
  }
  ctx.acoes.push(reg);
}

/**
 * The panel button on pump-sim with the bench driver's semantics (`Invoke-Bico`, driver.ps1):
 * idempotent by caption, waits for "Concluindo.." to end before lifting, clicks, then waits up
 * to 4 s (40 × 100 ms) for the caption. On the 2.7.2 profile the caption follows the state tick, so a lift
 * returns once the fueling started ("Abastecendo..") or a tick left it waiting ("Aguarda
 * liberação"), as on the bench (§18).
 */
export async function clicarBotaoPainel(
  bt: BotaoPainel,
  chamar: (comando: string, args: Record<string, unknown>) => Promise<unknown>,
  esperar: (ms: number) => Promise<void>,
): Promise<string> {
  const endereco = bt.lado === 'esquerdo' ? 1 : 2;
  const legenda = async (): Promise<string | null> => {
    const r = (await chamar('get_displays', { canal: bt.canal })) as { enderecos?: { endereco: number; statusTexto: string }[] };
    return r.enderecos?.find((x) => x.endereco === endereco)?.statusTexto ?? null;
  };
  const comando = bt.retirar ? 'retirar_bico' : 'recolocar_bico';
  const antes = await legenda();
  if (antes === null) {
    // Address without a panel (not configured): no caption to follow, the command decides.
    await chamar(comando, { bico: bt.bico });
    return `botão ${bt.lado} sem legenda`;
  }
  if (legendaRetirada(antes) !== bt.retirar) {
    if (antes === 'Concluindo..') {
      for (let k = 0; k < 40 && (await legenda()) === 'Concluindo..'; k++) await esperar(100);
    }
    await chamar(comando, { bico: bt.bico });
    for (let k = 0; k < 40 && legendaRetirada((await legenda()) ?? '') !== bt.retirar; k++) await esperar(100);
  }
  const depois = (await legenda()) ?? '';
  if (legendaRetirada(depois) !== bt.retirar) throw new Error(`botão do ${bt.lado} não chegou ao estado esperado em 4 s: '${antes}' -> '${depois}'`);
  return `botão ${bt.lado} '${antes}' -> '${depois}'`;
}

/**
 * Gap after each `(&I)` of a `drenar` (it has no reply): long enough for the target to read it as
 * its own segment before the next `(&A)` (the 2.7.2 serves only the first frame of a segment, Q1).
 * If the two still arrive together, the `(&A)` gets no reply and is sent again once.
 */
export const INTERVALO_DRENAR_MS = 50;

/**
 * `(&A)` until `(0)`, with `(&I)` between them, on its own connection (closed with FIN at the end).
 * One read and one acknowledge per record is the fewest the Companytec protocol allows without
 * relying on profile-specific pointer replies: the `(&A)` reply ends on its `)` (no idle tail) and
 * the silent `(&I)` only waits {@link INTERVALO_DRENAR_MS}.
 */
async function drenar(p: PassoDrenar, ctx: Contexto): Promise<void> {
  const { alvo, op } = ctx;
  const reg: RegistroAcao = { alvo: alvo.nome, passo: 'drenar', ok: true };
  const max = p.max ?? 10_010;
  const completo = fimDaResposta('(&A)');
  const intervaloI = p.timeoutMs ?? op.intervaloDrenarMs ?? INTERVALO_DRENAR_MS;
  let c: ConexaoTroca | null = null;
  let n = 0;
  try {
    c = await conectarAlvo(ctx, p.porta ?? alvo.alvo.porta, 'drenar');
    for (;;) {
      let r = await c.trocar(['(&A)'], { timeoutMs: op.timeoutMs, ociosoMs: op.ociosoMs, completo });
      // An `(&A)` read together with the `(&I)` before it is dropped by the 2.7.2 (Q1): ask again once.
      if (n > 0 && r.latenciaMs === null && !r.caiu) r = await c.trocar(['(&A)'], { timeoutMs: op.timeoutMs, ociosoMs: op.ociosoMs, completo });
      const txt = r.bytes.toString('latin1');
      if (txt === '(0)') break;
      if (r.latenciaMs === null || r.caiu) throw new Error(`(&A) sem resposta depois de ${n} registro(s)`);
      if (n >= max) throw new Error(`parou em ${max} registros sem chegar a (0)`);
      await c.trocar(['(&I)'], { timeoutMs: intervaloI, ociosoMs: op.ociosoMs, completo: fimDaResposta('(&I)') });
      n++;
    }
    reg.detalhe = `${n} registro(s) lido(s)`;
  } catch (e) {
    reg.ok = false;
    reg.erro = msgErro(e);
  } finally {
    c?.fechar();
  }
  ctx.acoes.push(reg);
}

/**
 * Whether the step at `i` waits only {@link OpcoesDiff.timeoutSilencioMs} for its reply: it is
 * expected to be silent (`silencio`, or `esperado: null`), has no explicit `timeoutMs` (the steps
 * that wait for a reply after a modal set one), and no `fechar_modais` comes after it before the
 * next `enviar` (a step that may open a modal keeps the full timeout, whatever it expects).
 */
export function silencioEsperado(passos: readonly Passo[], i: number): boolean {
  const p = passos[i];
  if (!p || !('enviar' in p)) return false;
  if (p.timeoutMs !== undefined) return false;
  if (p.silencio !== true && p.esperado !== null) return false;
  for (let k = i + 1; k < passos.length; k++) {
    const n = passos[k]!;
    if ('enviar' in n) break;
    if ('acao' in n && n.acao === 'fechar_modais') return false;
  }
  return true;
}

/** Wait of an expected-silence step: never longer than the normal timeout (`ClienteTcp` default 1000 ms). */
const timeoutSilencio = (op: OpcoesDiff): number => Math.min(op.timeoutSilencioMs ?? TIMEOUT_SILENCIO_PADRAO_MS, op.timeoutMs ?? 1000);

/** Runs a whole case against a target and returns the replies of each `enviar` step. */
interface RespostaPasso {
  passo: PassoEnviar;
  r: Resposta;
  /** The skipped label this step depends on, if any (see `PassoEnviar.dependeDe`). */
  dependenciaPulada?: string;
}

async function rodarCaso(caso: CasoDiff, ctx: Contexto): Promise<RespostaPasso[]> {
  const { alvo, op } = ctx;
  const conexoes = new Map<string, ConexaoTroca>();
  const out: RespostaPasso[] = [];
  ctx.rotulosPulados = new Set();
  ctx.caso = caso.id;
  const chamar = op.chamarControle ?? chamarControleHttp;
  try {
    for (const [i, p] of caso.passos.entries()) {
      if ('aguardar' in p) {
        await esperarNo(ctx, p.aguardar);
      } else if ('desconectar' in p) {
        const nome = `${p.conexao ?? 'principal'}@${p.porta ?? alvo.alvo.porta}`;
        const c = conexoes.get(nome);
        if (c) {
          if (p.desconectar === 'rst') c.fecharRst();
          else c.fechar();
          conexoes.delete(nome);
        }
      } else if ('drenar' in p) {
        await drenar(p, ctx);
      } else if ('acao' in p) {
        await aplicarAcao(p, ctx);
      } else if ('manual' in p) {
        if (alvo.controle && p.controle) {
          const reg: RegistroAcao = { alvo: alvo.nome, passo: p.controle.map((c) => c.comando).join(' + '), ok: true };
          try {
            for (const c of p.controle) await chamar(alvo.controle, c.comando, c.args ?? {});
          } catch (e) {
            reg.ok = false;
            reg.erro = msgErro(e);
          }
          ctx.acoes.push(reg);
        } else if (alvo.driver && p.soPumpSim) {
          // Only adjusts pump-sim (e.g. hold the modal); on the real 2.7.2 there is nothing to do.
        } else if (op.manual) {
          await op.manual(p.manual, alvo);
        } else {
          ctx.pulados.push({ alvo: alvo.nome, texto: p.semDriver ? `${p.manual} [${p.semDriver}]` : p.manual });
          if (p.rotulo) ctx.rotulosPulados?.add(p.rotulo);
        }
      } else {
        const nome = `${p.conexao ?? 'principal'}@${p.porta ?? alvo.alvo.porta}`;
        let c = conexoes.get(nome);
        if (!c || c.caiu) {
          const porta = p.porta ?? alvo.alvo.porta;
          try {
            c = await conectarAlvo(ctx, porta, 'passo');
          } catch (e) {
            throw new PortaIndisponivel(alvo.nome, `${alvo.alvo.host}:${porta}`, e);
          }
          conexoes.set(nome, c);
        }
        const pedacos = Array.isArray(p.enviar) ? p.enviar : [p.enviar];
        const enviado = pedacos.join('');
        const t = await c.trocar(pedacos, {
          intervaloMs: p.intervaloMs,
          timeoutMs: p.timeoutMs ?? (silencioEsperado(caso.passos, i) ? timeoutSilencio(op) : op.timeoutMs),
          ociosoMs: op.ociosoMs,
          terminador: p.terminaEm,
          // A fragmented send can be answered before its last chunk (the 2.7.2 serves `(&S` before the
          // `)`, DIFF-04): ending on that reply would send the next frame right behind the last chunk,
          // into the same segment. Fragmented steps keep the idle tail.
          completo: pedacos.length === 1 ? fimDaResposta(enviado) : undefined,
        });
        const dependenciaPulada = p.dependeDe?.find((r) => ctx.rotulosPulados?.has(r));
        const r: Resposta = { texto: t.bytes.toString('latin1'), hex: t.bytes.toString('hex'), latenciaMs: t.latenciaMs, caiu: t.caiu };
        if (t.atrasados?.length) r.atrasados = t.atrasados.toString('latin1');
        out.push({
          passo: p,
          r,
          ...(dependenciaPulada !== undefined ? { dependenciaPulada } : {}),
        });
      }
    }
  } finally {
    for (const c of conexoes.values()) c.fechar();
  }
  return out;
}

/**
 * Differential test: each case runs whole on target A and then on B (each with
 * new connections), and the replies of each `enviar` are compared byte by byte.
 * With `esperado` on the step, each target is also checked against it.
 */
export async function executarDiff(casos: CasoDiff[], a: AlvoDiff, b: AlvoDiff, op: OpcoesDiff = {}): Promise<RelatorioDiff> {
  const rel: RelatorioDiff = {
    alvoA: `${a.nome} ${a.alvo.host}:${a.alvo.porta}`,
    alvoB: `${b.nome} ${b.alvo.host}:${b.alvo.porta}`,
    casos: [],
    total: { passos: 0, iguais: 0, divergencias: 0, casosComDivergencia: [] },
    ...(op.plataformaA === 'wine' ? { plataformaA: 'wine' as const } : {}),
  };
  const uiA = estadoUiInicial();
  const uiB = estadoUiInicial();
  const manualA = await detectarRelogioManual(a, op);
  const manualB = await detectarRelogioManual(b, op);
  // A case skipped for an unavailable port is retried on resume.
  const anteriores = new Map((op.anteriores ?? []).filter((r) => !r.pulado).map((r) => [r.id, r]));
  const somar = (r: ResultadoCaso) => {
    rel.casos.push(r);
    rel.total.passos += r.passos.length;
    rel.total.iguais += r.passos.filter((p) => p.igual && !p.pulado).length;
    rel.total.divergencias += r.divergencias;
    const pulados = r.passos.filter((p) => p.pulado).length;
    if (pulados) rel.total.pulados = (rel.total.pulados ?? 0) + pulados;
    const tolerados = r.passos.filter((p) => p.tolerancia && !p.pulado).length;
    if (tolerados) rel.total.toleradosWine = (rel.total.toleradosWine ?? 0) + tolerados;
    if (r.divergencias > 0) rel.total.casosComDivergencia.push(r.id);
  };
  let drenarAntes = op.drenarAntes ?? false;
  for (const caso of casos) {
    const anterior = anteriores.get(caso.id);
    if (anterior) {
      somar(anterior);
      continue;
    }
    const pulados: ResultadoCaso['pulados'] = [];
    const acoes: RegistroAcao[] = [];
    if (drenarAntes) {
      drenarAntes = false;
      await drenar({ drenar: true }, { alvo: a, op, pulados, acoes, ui: uiA, relogioManual: manualA, caso: caso.id });
    }
    let ra: Awaited<ReturnType<typeof rodarCaso>>;
    let rb: Awaited<ReturnType<typeof rodarCaso>>;
    try {
      ra = await rodarCaso(caso, { alvo: a, op, pulados, acoes, ui: uiA, relogioManual: manualA });
      rb = await rodarCaso(caso, { alvo: b, op, pulados, acoes, ui: uiB, relogioManual: manualB });
    } catch (e) {
      if (!(e instanceof PortaIndisponivel)) throw e;
      const r: ResultadoCaso = {
        id: caso.id,
        titulo: caso.titulo,
        comparacao: caso.comparacao ?? 'bytes',
        passos: [],
        pulados,
        acoes,
        divergencias: 0,
        pulado: PULADO_PORTA,
        motivo: e.message,
        roteiroHash: hashRoteiro(caso),
      };
      somar(r);
      op.aoTerminarCaso?.(r);
      continue;
    }
    const comparacao = caso.comparacao ?? 'bytes';
    const notas = op.plataformaA === 'wine' ? anotarRoteiro(caso) : null;
    const passos: PassoComparado[] = ra.map((x, i) => {
      const y = rb[i]!;
      const ig = x.passo.ignorarFim ?? 0;
      const fx = x.passo.mascara ?? [];
      const ba = mascarar(Buffer.from(x.r.hex, 'hex'), ig, fx);
      const bb = mascarar(Buffer.from(y.r.hex, 'hex'), ig, fx);
      const byte = primeiroByteDiferente(ba, bb);
      const pc: PassoComparado = {
        indice: i,
        quadro: Array.isArray(x.passo.enviar) ? x.passo.enviar.join('') : x.passo.enviar,
        a: x.r,
        b: y.r,
        // Late bytes (`atrasados`) that differ between the targets are a divergence too: the reply
        // was cut on its frame and the rest of it (or a late reply to a step that listened for a
        // shortened silence) landed here, outside every compared reply (§25).
        igual: byte === -1 && (x.r.atrasados ?? '') === (y.r.atrasados ?? ''),
        byte,
      };
      if (!pc.igual && byte !== -1 && notas?.[i]?.sensivel.includes('vazao-livre') && (x.r.atrasados ?? '') === (y.r.atrasados ?? '')) {
        const campos = compararComToleranciaWine(pc.quadro, x.r.texto, y.r.texto, ba.toString('latin1'), bb.toString('latin1'));
        if (campos) {
          pc.igual = true;
          pc.tolerancia = { alvo: 'wine', campos };
        }
      }
      if (x.passo.nota) pc.nota = x.passo.nota;
      const dep = x.dependenciaPulada ?? y.dependenciaPulada;
      if (dep !== undefined) {
        const lado = x.dependenciaPulada !== undefined ? a.nome : b.nome;
        pc.pulado = `depende de "${dep}", pulado em ${lado}`;
      }
      if (x.passo.esperado !== undefined) {
        const esp = x.passo.esperado ?? '';
        pc.esperado = x.passo.esperado;
        const be = mascarar(Buffer.from(esp, 'latin1'), ig, fx);
        pc.aConfere = be.equals(ba);
        pc.bConfere = be.equals(bb);
      }
      return pc;
    });
    const div =
      comparacao === 'bytes' ? passos.filter((p) => !p.pulado && (!p.igual || p.aConfere === false || p.bConfere === false)).length : 0;
    const r: ResultadoCaso = { id: caso.id, titulo: caso.titulo, comparacao, passos, pulados, acoes, divergencias: div, roteiroHash: hashRoteiro(caso) };
    const nPulados = passos.filter((p) => p.pulado).length;
    if (nPulados) r.passosPulados = nPulados;
    somar(r);
    op.aoTerminarCaso?.(r);
  }
  return rel;
}

/** Reads a `.partial.jsonl` (one {@link ResultadoCaso} per line); a truncated last line is ignored. */
export function lerParcial(texto: string): ResultadoCaso[] {
  const out: ResultadoCaso[] = [];
  for (const l of texto.split('\n')) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l) as ResultadoCaso);
    } catch {
      // Line cut off by the process dying mid-write: that case runs again.
    }
  }
  return out;
}

/** Readable report (terminal). */
export function formatarRelatorio(r: RelatorioDiff): string {
  const linhas = [`A = ${r.alvoA}${r.plataformaA === 'wine' ? ' (2.7.2 no Wine: vazão livre com tolerância de ±10%)' : ''}`, `B = ${r.alvoB}`, ''];
  for (const c of r.casos) {
    if (c.pulado) {
      linhas.push(`${c.id} ${c.titulo} — ${c.pulado}${c.motivo ? ` (${c.motivo})` : ''}`);
      continue;
    }
    linhas.push(`${c.id} ${c.titulo} — ${c.comparacao === 'informativo' ? 'informativo' : c.divergencias === 0 ? 'IGUAL' : `${c.divergencias} divergência(s)`}`);
    for (const p of c.passos) {
      for (const [lado, r] of [['A', p.a], ['B', p.b]] as const) {
        if (r.atrasados) linhas.push(`  ! ${lado}: bytes atrasados antes de ${JSON.stringify(p.quadro)} (resto da resposta anterior): ${JSON.stringify(r.atrasados)}`);
      }
      const marca = p.pulado ? '  ~' : p.igual && p.aConfere !== false && p.bConfere !== false ? (p.tolerancia ? '  ≈' : '  =') : '  ≠';
      if (marca === '  =' && c.comparacao === 'bytes') continue;
      const tol = p.tolerancia
        ? ` [igual (tolerância wine): ${p.tolerancia.campos.map((t) => `${t.campo} ${t.a}→${t.b} ${t.desvio >= 0 ? '+' : ''}${(t.desvio * 100).toFixed(1)}%`).join(', ')}]`
        : '';
      linhas.push(`${marca} ${JSON.stringify(p.quadro)}${p.nota ? ` (${p.nota})` : ''}${p.pulado ? ` [pulado: ${p.pulado}]` : ''}${tol}`);
      linhas.push(`      A: ${JSON.stringify(p.a.texto)}${p.a.latenciaMs === null ? ' [silêncio]' : ` [${p.a.latenciaMs} ms]`}`);
      linhas.push(`      B: ${JSON.stringify(p.b.texto)}${p.b.latenciaMs === null ? ' [silêncio]' : ` [${p.b.latenciaMs} ms]`}`);
      if (p.byte >= 0) linhas.push(`      1º byte diferente: ${p.byte}`);
      if (p.esperado !== undefined) linhas.push(`      esperado: ${JSON.stringify(p.esperado)} (A ${p.aConfere ? 'ok' : 'não'}, B ${p.bConfere ? 'ok' : 'não'})`);
    }
    for (const s of c.pulados) linhas.push(`  ! pulado em ${s.alvo}: ${s.texto}`);
    for (const x of c.acoes) {
      if (!x.ok) linhas.push(`  ! ação falhou em ${x.alvo}: ${x.passo} — ${x.erro ?? ''}`);
      else if (x.passo === 'drenar' && x.detalhe) linhas.push(`  · drenar em ${x.alvo}: ${x.detalhe}`);
      for (const m of x.modais ?? []) linhas.push(`  · modal fechado em ${x.alvo} (${x.passo}): ${JSON.stringify(m)}`);
    }
  }
  linhas.push('', `${r.total.passos} passos, ${r.total.iguais} iguais${r.total.toleradosWine ? ` (${r.total.toleradosWine} pela tolerância wine)` : ''}${r.total.pulados ? `, ${r.total.pulados} pulado(s)` : ''}, ${r.total.divergencias} divergência(s)${r.total.casosComDivergencia.length ? ': ' + r.total.casosComDivergencia.join(', ') : ''}`);
  return linhas.join('\n');
}
