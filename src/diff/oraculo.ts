import fs from 'node:fs';
import path from 'node:path';
import { ManualClock } from '../core/clock.js';
import type { ConexaoTroca, OpcoesTroca, ResultadoTroca } from '../net/cliente-tcp.js';
import { executarComando } from '../control/comandos.js';
import { Hub } from '../control/hub.js';
import { type AlvoDiff, type PassoComparado, type RelatorioDiff, type ResultadoCaso, executarDiff } from './executor.js';
import { hashRoteiro } from './hash.js';
import { type CasoDiff, type PassoEnviar, ROTEIROS, roteiro } from './roteiros.js';
import { type SensivelTempo, anotarRoteiro } from './sensivel.js';

/**
 * Recorded 2.7.2 oracle (README "Recorded oracle", DECISIONS §24).
 *
 * The side-A replies of a real-bench diff run (the real SimuladorCBC 2.7.2) are stored per case in
 * `test/fixtures/oracle-2.7.2/<case>.json`, keyed on the hash of the case script they were recorded
 * with. The replay runs the same diff executor and action layer with side A answering from the
 * recording and side B = pump-sim `simulador-2.7.2` in process (in-memory connections, manual clock
 * advanced by `aguardar`), so CI compares pump-sim against the real 2.7.2 without the bench. A case
 * whose script changed since the recording is "stale: needs bench": neither a pass nor a failure.
 */

export const FORMATO_ORACULO = 'pump-sim/oraculo@1';
export const DIR_ORACULO_PADRAO = 'test/fixtures/oracle-2.7.2';
const MANIFESTO = 'manifest.json';

export type { SensivelTempo } from './sensivel.js';

export interface PassoOraculo {
  indice: number;
  quadro: string;
  /** Side-A reply in latin1 (bytes 0–255 one to one); `null` = silence. */
  a: string | null;
  /** The connection dropped during the exchange on A. */
  caiu?: true;
  /** Masks the case script compares this step with (copied for reading; the replay uses the script's). */
  ignorarFim?: number;
  mascara?: readonly (readonly [number, number])[];
  /** Why the reply depends on time; `vazao-livre` = a volume read after a fueling with no preset. */
  sensivel?: SensivelTempo[];
  /** Texts of the 2.7.2 MessageBoxes the driver closed in the actions right before this step. */
  modais?: string[];
  /** On the bench, B (the pump-sim of that day) differed here. */
  diferiuNaBancada?: true;
  /** On the bench, the step was reported as skipped (`dependeDe`). */
  puladoNaBancada?: string;
}

export interface AcaoOraculo {
  passo: string;
  ok: boolean;
  detalhe?: string;
  erro?: string;
  modais?: string[];
}

export interface CasoOraculo {
  formato: typeof FORMATO_ORACULO;
  caso: string;
  titulo: string;
  comparacao: 'bytes' | 'informativo';
  /** Session (bench run) this recording belongs to; see {@link SessaoOraculo}. */
  sessao: string;
  /** {@link hashRoteiro} of the script the bench ran; `null` = unknown (the case is stale). */
  roteiroHash: string | null;
  /** Where the hash came from, or why it is `null`. */
  origemHash: string;
  /** The bench skipped the case (e.g. a port side A does not listen on). */
  pulado?: string;
  motivo?: string;
  passos: PassoOraculo[];
  /** Side-A actions as the driver reported them (the drain before the run included). */
  acoesA: AcaoOraculo[];
}

/** One bench run: its cases ran in this order on one freshly opened 2.7.2. */
export interface SessaoOraculo {
  id: string;
  fonte: string;
  alvoA: string;
  /** Wall time of the run's start (no time zone): side B's manual clock starts here. */
  inicioRelogio: string;
  /** Logical port side B listened on (the 2.7.2 radio). */
  portaLogica: number;
  /** The run drained side A before the first case (`--drenar-antes`). */
  drenarAntes: boolean;
  /**
   * Case order of the run. A case whose recording now belongs to a later session still runs here
   * (with the current script, not compared) so the state the next cases start from is kept.
   */
  casos: string[];
}

export interface ManifestoOraculo {
  formato: typeof FORMATO_ORACULO;
  perfil: 'simulador-2.7.2';
  sessoes: SessaoOraculo[];
}

export interface Oraculo {
  manifesto: ManifestoOraculo;
  casos: Map<string, CasoOraculo>;
}

// ───────────────────────── building fixtures from a bench report ─────────────────────────

const quadrosDoRoteiro = (c: CasoDiff): string[] =>
  c.passos.filter((p): p is PassoEnviar => 'enviar' in p).map((p) => (Array.isArray(p.enviar) ? p.enviar.join('') : p.enviar));

export interface OpcoesConstruir {
  /** Session id (default: the report file's base name). */
  sessao: string;
  /** Report file name, for the record. */
  fonte: string;
  /** Wall time the run started (`2026-10-17T14:35:32`). */
  inicioRelogio: string;
  portaLogica?: number;
  /**
   * Reports recorded before the executor wrote `roteiroHash`: cases whose script is known to have
   * changed after the run (id → why). They get `roteiroHash: null` (stale) instead of the current hash.
   */
  alterados?: Record<string, string>;
  /** Current scripts (default {@link roteiro}). */
  roteiros?: (id: string) => CasoDiff | undefined;
}

export interface ResultadoConstrucao {
  sessao: SessaoOraculo;
  casos: CasoOraculo[];
  avisos: string[];
}

/** Builds the oracle fixtures of one bench run from its diff report (`--json`). */
export function construirOraculo(rel: RelatorioDiff, op: OpcoesConstruir): ResultadoConstrucao {
  const buscar = op.roteiros ?? ((id: string) => roteiro(id));
  const avisos: string[] = [];
  const casos: CasoOraculo[] = [];
  const nomeA = rel.alvoA.split(' ')[0] ?? 'A';
  let drenarAntes = false;
  rel.casos.forEach((r, i) => {
    const atual = buscar(r.id);
    const acoesA = r.acoes.filter((x) => x.alvo === nomeA);
    const quadros = r.passos.map((p) => p.quadro);
    const iguaisAoRoteiro = atual !== undefined && !r.pulado && JSON.stringify(quadrosDoRoteiro(atual)) === JSON.stringify(quadros);
    let roteiroHash: string | null;
    let origemHash: string;
    if (r.roteiroHash) {
      roteiroHash = r.roteiroHash;
      origemHash = 'relatório da bancada';
    } else if (op.alterados?.[r.id] !== undefined) {
      roteiroHash = null;
      origemHash = `roteiro alterado depois da corrida: ${op.alterados[r.id]}`;
    } else if (!atual) {
      roteiroHash = null;
      origemHash = 'caso não existe no roteiro atual';
    } else if (r.pulado) {
      roteiroHash = hashRoteiro(atual);
      origemHash = 'roteiro atual na importação (relatório sem hash; caso pulado na bancada)';
    } else if (!iguaisAoRoteiro) {
      roteiroHash = null;
      origemHash = 'relatório sem hash e os quadros do roteiro atual não são os gravados';
    } else {
      roteiroHash = hashRoteiro(atual);
      origemHash = 'roteiro atual na importação (relatório sem hash; quadros conferidos)';
    }
    const notas = iguaisAoRoteiro ? anotarRoteiro(atual!) : null;
    // `--drenar-antes`: one more A drain than the first case's script has.
    if (i === 0 && atual && notas) {
      const drenos = atual.passos.filter((p) => 'drenar' in p).length;
      drenarAntes = acoesA.filter((x) => x.passo === 'drenar').length > drenos;
    }
    const deslocamento = i === 0 && drenarAntes ? 1 : 0;
    const passos = r.passos.map((p, k): PassoOraculo => {
      const texto = p.a.latenciaMs === null && p.a.hex === '' ? null : p.a.texto;
      if (p.a.atrasados) {
        avisos.push(`${r.id} passo ${k}: bytes atrasados em A ${JSON.stringify(p.a.atrasados)} (resto de uma resposta anterior, fora da gravação)`);
      }
      if (texto !== null && Buffer.from(texto, 'latin1').toString('hex') !== p.a.hex) {
        avisos.push(`${r.id} passo ${k}: o texto latin1 não reproduz o hex gravado`);
      }
      const n = notas?.[k];
      const modais: string[] = [];
      if (n) {
        // Actions between the previous step and this one (the first step also takes the run's drain).
        const de = k === 0 ? 0 : notas![k - 1]!.acoesAntes + deslocamento;
        for (const x of acoesA.slice(de, n.acoesAntes + deslocamento)) modais.push(...(x.modais ?? []));
      }
      return {
        indice: p.indice,
        quadro: p.quadro,
        a: texto,
        ...(p.a.caiu ? { caiu: true as const } : {}),
        ...(n?.ignorarFim ? { ignorarFim: n.ignorarFim } : {}),
        ...(n?.mascara ? { mascara: n.mascara } : {}),
        ...(n?.sensivel.length ? { sensivel: n.sensivel } : {}),
        ...(modais.length ? { modais } : {}),
        ...(r.comparacao === 'bytes' && !p.igual && !p.pulado ? { diferiuNaBancada: true as const } : {}),
        ...(p.pulado ? { puladoNaBancada: p.pulado } : {}),
      };
    });
    if (!notas && !r.pulado) {
      const semModal = acoesA.flatMap((x) => x.modais ?? []);
      if (semModal.length) avisos.push(`${r.id}: modais ${JSON.stringify(semModal)} ficam só em acoesA (roteiro diferente do gravado)`);
    }
    casos.push({
      formato: FORMATO_ORACULO,
      caso: r.id,
      titulo: r.titulo,
      comparacao: r.comparacao,
      sessao: op.sessao,
      roteiroHash,
      origemHash,
      ...(r.pulado ? { pulado: r.pulado } : {}),
      ...(r.motivo ? { motivo: r.motivo } : {}),
      passos,
      acoesA: acoesA.map((x) => ({
        passo: x.passo,
        ok: x.ok,
        ...(x.detalhe ? { detalhe: x.detalhe } : {}),
        ...(x.erro ? { erro: x.erro } : {}),
        ...(x.modais?.length ? { modais: x.modais } : {}),
      })),
    });
  });
  const sessao: SessaoOraculo = {
    id: op.sessao,
    fonte: op.fonte,
    alvoA: rel.alvoA,
    inicioRelogio: op.inicioRelogio,
    portaLogica: op.portaLogica ?? 7002,
    drenarAntes,
    casos: rel.casos.map((r) => r.id),
  };
  return { sessao, casos, avisos };
}

/**
 * Merges a new session into an oracle: its cases replace the recordings of the same id, sessions
 * left with no recording of their own are dropped (`substituir` drops all the older ones).
 */
export function mesclarOraculo(atual: Oraculo | null, novo: ResultadoConstrucao, substituir = false): Oraculo {
  const casos = new Map(substituir || !atual ? [] : atual.casos);
  for (const c of novo.casos) casos.set(c.caso, c);
  const anteriores = substituir || !atual ? [] : atual.manifesto.sessoes.filter((s) => s.id !== novo.sessao.id);
  const sessoes = [...anteriores, novo.sessao].filter((s) => s.casos.some((id) => casos.get(id)?.sessao === s.id));
  return { manifesto: { formato: FORMATO_ORACULO, perfil: 'simulador-2.7.2', sessoes }, casos };
}

const nomeArquivo = (id: string) => `${id}.json`;

export function lerOraculo(dir: string): Oraculo {
  const manifesto = JSON.parse(fs.readFileSync(path.join(dir, MANIFESTO), 'utf8')) as ManifestoOraculo;
  if (manifesto.formato !== FORMATO_ORACULO) throw new Error(`${dir}/${MANIFESTO}: formato ${String(manifesto.formato)} (esperado ${FORMATO_ORACULO})`);
  const casos = new Map<string, CasoOraculo>();
  for (const f of fs.readdirSync(dir).sort()) {
    if (f === MANIFESTO || !f.endsWith('.json')) continue;
    const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as CasoOraculo;
    if (c.formato !== FORMATO_ORACULO) throw new Error(`${dir}/${f}: formato ${String(c.formato)}`);
    casos.set(c.caso, c);
  }
  return { manifesto, casos };
}

/** Writes the manifest and one file per case; removes case files no longer in the oracle. */
export function gravarOraculo(dir: string, o: Oraculo): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) {
    if (f !== MANIFESTO && f.endsWith('.json') && !o.casos.has(f.slice(0, -5))) fs.rmSync(path.join(dir, f));
  }
  for (const c of o.casos.values()) fs.writeFileSync(path.join(dir, nomeArquivo(c.caso)), formatarJsonCaso(c));
  fs.writeFileSync(path.join(dir, MANIFESTO), JSON.stringify(o.manifesto, null, 2) + '\n');
}

/** One step per line: readable diffs in review, compact on disk. */
function formatarJsonCaso(c: CasoOraculo): string {
  const { passos, acoesA, ...cab } = c;
  const linhas = Object.entries(cab).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const lista = (k: string, xs: unknown[]) => `  ${JSON.stringify(k)}: [${xs.length ? '\n' + xs.map((x) => `    ${JSON.stringify(x)}`).join(',\n') + '\n  ' : ''}]`;
  return `{\n${[...linhas, lista('acoesA', acoesA), lista('passos', passos)].join(',\n')}\n}\n`;
}

// ───────────────────────── replay ─────────────────────────

/**
 * `pulado`: the bench skipped the case (e.g. DIFF-30 needs ports the 2.7.2 does not listen on), so
 * there is no oracle for it; like `stale`, it is listed and never counts as a pass.
 */
export type EstadoOraculo = 'igual' | 'diferente' | 'stale' | 'pulado' | 'informativo';

export interface ResultadoCasoOraculo {
  id: string;
  sessao: string;
  estado: EstadoOraculo;
  /** Why it is stale (or why it failed outside the comparison). */
  motivo?: string;
  hashGravado: string | null;
  hashAtual: string | null;
  passos: number;
  divergencias: number;
  /** The differing steps (A = recording, B = pump-sim now). */
  diferentes: PassoComparado[];
  passosPulados?: number;
}

export interface RelatorioOraculo {
  casos: ResultadoCasoOraculo[];
  total: { casos: number; iguais: number; diferentes: number; stale: number; pulados: number; informativos: number; passos: number; divergencias: number };
  stale: { id: string; motivo: string }[];
  /** Cases the bench skipped (no oracle). */
  pulados: { id: string; motivo: string }[];
  falhas: string[];
  /** The executor's reports, one per session (A = recording). */
  relatorios: RelatorioDiff[];
}

/** Side A of a case: the recorded replies, in step order across the case's connections. */
class CursorGravacao {
  private i = 0;
  /** Set when the script sent a frame the recording does not have at that position. */
  foraDoRoteiro: string | null = null;
  constructor(private readonly passos: PassoOraculo[]) {}
  /** Recorded steps the script never sent (a recording longer than its script). */
  get restantes(): number {
    return Math.max(0, this.passos.length - this.i);
  }
  proximo(quadro: string): PassoOraculo | null {
    const p = this.passos[this.i++];
    if (!p) {
      this.foraDoRoteiro ??= `passo ${this.i - 1} ${JSON.stringify(quadro)} além da gravação (${this.passos.length} passos)`;
      return null;
    }
    if (p.quadro !== quadro) this.foraDoRoteiro ??= `passo ${this.i - 1}: roteiro envia ${JSON.stringify(quadro)}, gravação tem ${JSON.stringify(p.quadro)}`;
    return p;
  }
}

class ConexaoGravada implements ConexaoTroca {
  caiu = false;
  constructor(private readonly cursor: CursorGravacao | null) {}
  async trocar(pedacos: (string | Buffer)[], _op?: OpcoesTroca): Promise<ResultadoTroca> {
    const quadro = pedacos.map((p) => (typeof p === 'string' ? p : p.toString('latin1'))).join('');
    // No cursor = the drain connection: the recording already starts drained.
    if (!this.cursor) return { bytes: Buffer.from('(0)', 'latin1'), latenciaMs: 0, caiu: false };
    const p = this.cursor.proximo(quadro);
    if (p?.caiu) this.caiu = true;
    const bytes = Buffer.from(p?.a ?? '', 'latin1');
    return { bytes, latenciaMs: p?.a == null ? null : 0, caiu: this.caiu };
  }
  fechar(): void {}
  fecharRst(): void {}
}

/** `2026-10-17T14:35:32` (wall time) → ms for a clock with `fusoMinutos: 0`. */
function inicioMs(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`inicioRelogio inválido: ${s} (use 2026-10-17T14:35:32)`);
  const [, a, me, d, h, mi, se] = m.map(Number) as number[];
  return Date.UTC(a!, me! - 1, d!, h!, mi!, se!);
}

export interface OpcoesReplay {
  /** Current scripts (default {@link roteiro}). */
  roteiros?: (id: string) => CasoDiff | undefined;
  /** Every current non-optional case (default {@link ROTEIROS}): those with no recording are listed as stale. */
  todos?: CasoDiff[];
}

/** Runs one session: side A = recording, side B = a fresh in-process pump-sim on a manual clock. */
async function rodarSessao(s: SessaoOraculo, o: Oraculo, buscar: (id: string) => CasoDiff | undefined): Promise<{ rel: RelatorioDiff; cursores: Map<string, CursorGravacao> }> {
  const clock = new ManualClock(inicioMs(s.inicioRelogio));
  const hub = new Hub({ clock, host: '127.0.0.1', fusoMinutos: 0, mapa: { [s.portaLogica]: 0 } });
  try {
    await hub.criar('default', 'simulador-2.7.2', [s.portaLogica], { configPadrao: true });
    const casos = s.casos.map((id) => buscar(id)).filter((c): c is CasoDiff => c !== undefined);
    const cursores = new Map<string, CursorGravacao>();
    const a: AlvoDiff = {
      nome: 'A',
      alvo: { host: 'gravacao', porta: s.portaLogica },
      driver: 'gravacao',
      esperar: async () => {},
      conectar: async (porta, ctx) => {
        if (ctx.uso === 'drenar') return new ConexaoGravada(null);
        const f = o.casos.get(ctx.caso);
        if (f?.pulado) throw new Error(f.motivo ?? f.pulado);
        if (!f || f.sessao !== s.id) return new ConexaoGravada(null);
        let c = cursores.get(ctx.caso);
        if (!c) cursores.set(ctx.caso, (c = new CursorGravacao(f.passos)));
        return new ConexaoGravada(c);
      },
    };
    const b: AlvoDiff = {
      nome: 'B',
      alvo: { host: 'memoria', porta: s.portaLogica },
      controle: 'memoria',
      relogioManual: true,
      conectar: async (porta) => {
        const sv = hub.obter('default').servidor;
        if (!sv) throw new Error('pump-sim sem servidor');
        return sv.conectarMemoria(porta);
      },
    };
    const rel = await executarDiff(casos, a, b, {
      chamarControle: (_url, comando, args) => executarComando(hub, comando, args),
      chamarDriver: async () => ({ ok: true }),
      drenarAntes: s.drenarAntes,
    });
    return { rel, cursores };
  } finally {
    await hub.fechar();
  }
}

/**
 * Replays the oracle: per session, the recorded side A against pump-sim `simulador-2.7.2` (side B)
 * through {@link executarDiff}. A case is `stale` when its script hash is not the recorded one (or
 * unknown), when the bench skipped it, or when it has no recording; `diferente` when any non-skipped
 * step differs; `informativo` cases are not compared.
 */
export async function executarOraculo(o: Oraculo, op: OpcoesReplay = {}): Promise<RelatorioOraculo> {
  const buscar = op.roteiros ?? ((id: string) => roteiro(id));
  const out: RelatorioOraculo = {
    casos: [],
    total: { casos: 0, iguais: 0, diferentes: 0, stale: 0, pulados: 0, informativos: 0, passos: 0, divergencias: 0 },
    stale: [],
    pulados: [],
    falhas: [],
    relatorios: [],
  };
  const somar = (r: ResultadoCasoOraculo) => {
    out.casos.push(r);
    out.total.casos++;
    if (r.estado === 'igual') out.total.iguais++;
    else if (r.estado === 'diferente') {
      out.total.diferentes++;
      out.falhas.push(r.id);
    } else if (r.estado === 'stale') {
      out.total.stale++;
      out.stale.push({ id: r.id, motivo: r.motivo ?? '' });
    } else if (r.estado === 'pulado') {
      out.total.pulados++;
      out.pulados.push({ id: r.id, motivo: r.motivo ?? '' });
    } else out.total.informativos++;
    out.total.passos += r.passos;
    out.total.divergencias += r.divergencias;
  };
  for (const s of o.manifesto.sessoes) {
    const { rel, cursores } = await rodarSessao(s, o, buscar);
    out.relatorios.push(rel);
    const porId = new Map<string, ResultadoCaso>(rel.casos.map((r) => [r.id, r]));
    for (const id of s.casos) {
      const f = o.casos.get(id);
      if (!f || f.sessao !== s.id) continue; // run only to keep the state; compared in its own session
      const atual = buscar(id);
      const hashAtual = atual ? hashRoteiro(atual) : null;
      const r = porId.get(id);
      const base = { id, sessao: s.id, hashGravado: f.roteiroHash, hashAtual, passos: r?.passos.length ?? 0, divergencias: 0, diferentes: [] as PassoComparado[] };
      if (f.pulado) {
        somar({ ...base, estado: 'pulado', motivo: `pulado na bancada, sem oráculo (${f.pulado}${f.motivo ? `: ${f.motivo}` : ''})` });
        continue;
      }
      let motivo: string | null = null;
      if (!atual) motivo = 'caso não existe no roteiro atual';
      else if (f.roteiroHash === null) motivo = `hash desconhecido: ${f.origemHash}`;
      else if (f.roteiroHash !== hashAtual) motivo = `roteiro mudou (${f.roteiroHash} gravado, ${hashAtual} atual)`;
      if (motivo) {
        somar({ ...base, estado: 'stale', motivo: `${motivo}: precisa de bancada` });
        continue;
      }
      const cursor = cursores.get(id);
      if (!r || r.pulado || cursor?.foraDoRoteiro || (cursor?.restantes ?? 0) > 0 || (cursor === undefined && f.passos.length > 0)) {
        // Same hash but the replay did not walk the recording: the fixture does not match its own hash.
        const m = r?.pulado
          ? `${r.pulado}: ${r.motivo ?? ''}`
          : (cursor?.foraDoRoteiro ?? (cursor?.restantes ? `${cursor.restantes} passo(s) gravado(s) além do roteiro` : 'gravação não percorrida'));
        somar({ ...base, estado: 'diferente', motivo: `gravação não confere com o roteiro de mesmo hash: ${m}`, divergencias: 1 });
        continue;
      }
      const diferentes = r.passos.filter((p) => !p.pulado && (!p.igual || p.aConfere === false || p.bConfere === false));
      if (r.comparacao === 'informativo') {
        somar({ ...base, estado: 'informativo' });
        continue;
      }
      somar({
        ...base,
        estado: r.divergencias === 0 ? 'igual' : 'diferente',
        divergencias: r.divergencias,
        diferentes,
        ...(r.passosPulados ? { passosPulados: r.passosPulados } : {}),
      });
    }
  }
  const gravados = new Set(o.casos.keys());
  for (const c of op.todos ?? ROTEIROS.filter((x) => !x.opcional)) {
    if (gravados.has(c.id)) continue;
    somar({ id: c.id, sessao: '', estado: 'stale', motivo: 'sem gravação: precisa de bancada', hashGravado: null, hashAtual: hashRoteiro(c), passos: 0, divergencias: 0, diferentes: [] });
  }
  return out;
}

/** Terminal report (same marks as the live diff). */
export function formatarRelatorioOraculo(r: RelatorioOraculo): string {
  const linhas: string[] = [];
  for (const c of r.casos) {
    const rotulo = { igual: 'IGUAL', diferente: `${c.divergencias} divergência(s)`, stale: 'STALE', pulado: 'PULADO', informativo: 'informativo' }[c.estado];
    linhas.push(`${c.id} — ${rotulo}${c.passosPulados ? ` (${c.passosPulados} pulado(s))` : ''}${c.motivo ? ` — ${c.motivo}` : ''}`);
    for (const p of c.diferentes) {
      linhas.push(`  ≠ [${p.indice}] ${JSON.stringify(p.quadro)}${p.nota ? ` (${p.nota})` : ''}`);
      linhas.push(`      A (2.7.2 gravado): ${JSON.stringify(p.a.texto)}${p.a.latenciaMs === null ? ' [silêncio]' : ''}`);
      linhas.push(`      B (pump-sim):      ${JSON.stringify(p.b.texto)}${p.b.latenciaMs === null ? ' [silêncio]' : ''}`);
      if (p.byte >= 0) linhas.push(`      1º byte diferente: ${p.byte}`);
    }
  }
  const t = r.total;
  linhas.push(
    '',
    `${t.casos} casos: ${t.iguais} iguais, ${t.diferentes} diferentes, ${t.stale} stale, ${t.pulados} pulado(s), ${t.informativos} informativo(s); ${t.passos} passos, ${t.divergencias} divergência(s)`,
  );
  if (r.stale.length) linhas.push(`stale (precisa de bancada): ${r.stale.map((s) => s.id).join(', ')}`);
  if (r.pulados.length) linhas.push(`pulados na bancada (sem oráculo): ${r.pulados.map((s) => s.id).join(', ')}`);
  if (r.falhas.length) linhas.push(`diferentes: ${r.falhas.join(', ')}`);
  return linhas.join('\n');
}
