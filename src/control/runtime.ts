import { EventEmitter } from 'node:events';
import type { Clock } from '../core/clock.js';
import type { EntradaLog, EstadoConcentrador } from '../core/concentrador.js';
import type { Evento } from '../core/modelo.js';
import { type Perfil, type PerfilId, obterPerfil } from '../profiles/index.js';
import { Gravador } from '../recorder/gravador.js';
import { PumpSim } from '../sim.js';
import { type GanchosTcp, type PortaEscuta, ServidorTcp, saidaPadrao } from '../transport/tcp.js';
import { InjetorFalhas } from './falhas.js';

export interface OpcoesRuntime {
  perfil: PerfilId | Perfil;
  clock: Clock;
  fusoMinutos?: number;
  configPadrao?: boolean;
  travamentoMs?: number | null;
  /** No TCP (API core tests). */
  semTcp?: boolean;
  host?: string;
  /** Logical ports; default: the profile's. */
  portas?: number[];
  /** Logical → physical (0 = ephemeral). */
  mapa?: Record<number, number>;
  /** JSONL file to record traffic from the start. */
  gravar?: string;
  /** PRNG seed for faults with `probabilidade`. */
  semente?: number;
  /**
   * A taken port (EADDRINUSE) at startup does not abort: the simulator runs with no port open,
   * `erroPorta` says why, and `abrir_porta` retries (the UI's "porta ocupada" state).
   */
  tolerarPortaOcupada?: boolean;
}

/** Last failure to open a TCP port (startup or `abrir_porta`); cleared when a port opens. */
export interface ErroPorta {
  porta: number;
  codigo: string;
  mensagem: string;
}

/** One socket read (`rx`) or write (`tx`), as the recorder sees it, pushed live to the UI. */
export interface QuadroTrafego {
  ts: number;
  porta: number;
  conexao: number;
  dir: 'rx' | 'tx' | 'abre' | 'fecha';
  texto: string;
}

export interface Snapshot {
  nome: string;
  perfil: Perfil;
  estado: EstadoConcentrador;
  ts: number;
}

interface Agendado {
  em: number;
  fn: () => void;
}

/**
 * A controllable simulator instance: the `PumpSim`, the TCP ports, the fault
 * injector, the recorder and the scheduled actions (`abastecer` by duration). The whole control
 * API and the MCP go through here. Time comes from the injected `Clock`.
 */
export class SimRuntime extends EventEmitter {
  sim: PumpSim;
  servidor: ServidorTcp | null = null;
  readonly falhas: InjetorFalhas;
  gravador: Gravador | null = null;
  recusarConexoes = false;
  erroPorta: ErroPorta | null = null;
  readonly snapshots = new Map<string, Snapshot>();
  private readonly precosConfig = new Map<number, { precos: [number, number, number]; pendentes: [number | null, number | null, number | null] }>();
  private agenda: Agendado[] = [];
  private readonly op: OpcoesRuntime;

  private constructor(op: OpcoesRuntime) {
    super();
    this.op = op;
    this.sim = this.novoSim(typeof op.perfil === 'string' ? obterPerfil(op.perfil) : op.perfil, op.configPadrao ?? true);
    this.falhas = new InjetorFalhas(op.semente ?? 1, (ms) => this.travar('falha injetada', ms));
    this.falhas.aoDisparar = (regra, porta, quadro) => this.emit('falha', { ts: this.clock.now(), porta, quadro, regra });
    this.falhas.registrar = (porta, dir, texto) => this.sim.conc.registrarLog(`tcp:${porta}`, dir, texto);
    this.falhas.ackPreco = () => this.perfil.ackPreco;
    this.guardarPrecosConfig();
  }

  static async criar(op: OpcoesRuntime): Promise<SimRuntime> {
    const rt = new SimRuntime(op);
    if (op.gravar) rt.gravarInicio(op.gravar);
    if (!op.semTcp) {
      const opTcp = { host: op.host, portas: op.portas, mapa: op.mapa, ganchos: rt.ganchos() };
      try {
        rt.servidor = await ServidorTcp.abrir(rt.sim, opTcp);
      } catch (e) {
        const codigo = (e as { code?: unknown }).code;
        if (!op.tolerarPortaOcupada || codigo !== 'EADDRINUSE') throw e;
        // The error carries the physical port; the UI retries with the logical one (`mapa` maps them).
        const fisica = Number((e as { port?: unknown }).port);
        const p = rt.perfil;
        const candidatas = op.portas?.length ? op.portas : p.escutaTcp === 'umaPorVez' ? [p.opcoesPortaTcp[0] ?? 2001] : p.portas.filter((x) => x.tipo === 'tcp').map((x) => Number(x.porta));
        const logica = candidatas.find((l) => (op.mapa?.[l] ?? l) === fisica) ?? candidatas[0] ?? fisica;
        rt.erroPorta = { porta: logica, codigo: 'EADDRINUSE', mensagem: (e as Error).message };
        rt.servidor = ServidorTcp.vazio(rt.sim, opTcp);
      }
    }
    return rt;
  }

  /** Records (or clears, with null) the last port-open failure. */
  registrarErroPorta(porta: number, e: unknown): void {
    const codigo = String((e as { code?: unknown }).code ?? 'ERRO');
    this.erroPorta = { porta, codigo, mensagem: e instanceof Error ? e.message : String(e) };
  }

  get clock(): Clock {
    return this.op.clock;
  }

  get perfil(): Perfil {
    return this.sim.conc.perfil;
  }

  private novoSim(perfil: Perfil, configPadrao: boolean): PumpSim {
    const sim = new PumpSim({
      perfil,
      clock: this.op.clock,
      fusoMinutos: this.op.fusoMinutos,
      configPadrao,
      travamentoMs: this.op.travamentoMs,
    });
    sim.conc.onEvento = (e: Evento) => this.emit('evento', e);
    sim.conc.onLog = (e: EntradaLog) => this.emit('log', e);
    return sim;
  }

  private trafego(i: { id: number; logica: number }, dir: QuadroTrafego['dir'], b?: Buffer): void {
    if (this.listenerCount('trafego') === 0) return;
    const q: QuadroTrafego = { ts: this.clock.now(), porta: i.logica, conexao: i.id, dir, texto: b ? b.toString('latin1') : '' };
    this.emit('trafego', q);
  }

  /** Transport hooks: refusal, recording, faults and the live traffic stream. */
  private ganchos(): GanchosTcp {
    return {
      aceitar: () => !this.recusarConexoes,
      aoConectar: (i) => {
        this.gravador?.registrar(i, 'abre');
        this.trafego(i, 'abre');
        this.emit('conexao', { ...i, evento: 'abre' });
      },
      aoFechar: (i) => {
        this.gravador?.registrar(i, 'fecha');
        this.trafego(i, 'fecha');
        this.emit('conexao', { ...i, evento: 'fecha' });
      },
      aoReceber: (i, b) => {
        this.gravador?.registrar(i, 'rx', b);
        this.trafego(i, 'rx', b);
      },
      aoEnviar: (i, b) => {
        this.gravador?.registrar(i, 'tx', b);
        this.trafego(i, 'tx', b);
      },
      atender: (i, quadro, processar) => {
        this.tick();
        return this.falhas ? this.falhas.atender(i.logica, quadro, processar) : saidaPadrao(processar());
      },
    };
  }

  /** Advances the simulator to `clock.now()` and runs the due scheduled actions. */
  tick(): void {
    const agora = this.clock.now();
    for (;;) {
      this.sim.atualizar();
      const i = this.agenda.findIndex((a) => a.em <= agora);
      if (i < 0) break;
      const [a] = this.agenda.splice(i, 1);
      a!.fn();
    }
  }

  agendar(emMs: number, fn: () => void): void {
    this.agenda.push({ em: this.clock.now() + emMs, fn });
    this.agenda.sort((a, b) => a.em - b.em);
  }

  agendados(): number {
    return this.agenda.length;
  }

  /** Configurable modal MessageBox: `ms` null = until `liberarTravamento`. */
  travar(motivo: string, ms: number | null): void {
    const agora = this.clock.now();
    this.sim.conc.registrarEvento('MSG', motivo);
    this.sim.conc.travamento = { motivo, desde: agora, ate: ms === null ? null : agora + ms };
  }

  liberarTravamento(): void {
    this.sim.conc.liberarTravamento();
  }

  // ───────────────────────── profile, reset, snapshot ─────────────────────────

  /**
   * Switches the profile (or derives it: firmware, model). The physical state (nozzles,
   * totalizers, buffer, cards, RTC) carries over to the new profile; the quirks and the
   * codec are the new profile's. Ports are reopened only if they change.
   */
  async trocarPerfil(perfil: Perfil): Promise<void> {
    const estado = this.sim.conc.exportarEstado();
    const novo = this.novoSim(perfil, false);
    novo.conc.importarEstado(estado, { manterQuirks: true });
    const antigo = this.sim;
    this.sim = novo;
    antigo.conc.onEvento = undefined;
    antigo.conc.onLog = undefined;
    this.agenda = [];
    if (this.servidor) {
      // Numeric sort: the default `.sort()` compares as strings, so [2001, 1771] became [1771, 2001]
      // and a single-port profile kept 1771 instead of its default 2001 (posto bench run 1, P3).
      const numerica = (a: number, b: number) => a - b;
      const atuais = this.servidor.portas().map((p) => p.logica).sort(numerica);
      const querem =
        perfil.escutaTcp === 'umaPorVez'
          ? // The profile's own order (its default first) decides which open port the single socket keeps.
            [perfil.opcoesPortaTcp.find((p) => atuais.includes(p)) ?? perfil.opcoesPortaTcp[0] ?? 2001]
          : perfil.portas.filter((p) => p.tipo === 'tcp').map((p) => Number(p.porta)).sort(numerica);
      if (JSON.stringify(atuais) === JSON.stringify(querem)) {
        this.servidor.usarSim(novo);
      } else {
        await this.servidor.fechar();
        this.servidor = await ServidorTcp.abrir(novo, {
          host: this.op.host,
          portas: querem,
          mapa: this.op.mapa,
          ganchos: this.ganchos(),
        });
      }
    }
    this.emit('perfil', perfil.id);
  }

  /**
   * Restarts the concentrator on the same profile. `manterConfig`: keeps the configuration
   * of the addresses (nozzles, comma, type, prices, lane number, sensor, identification
   * mode), the cards and the blacklist; zeroes buffer, totalizers, events and log.
   */
  reset(manterConfig = false): void {
    this.trocarSim(manterConfig ? this.simComConfig(false) : this.novoSim(this.perfil, true));
    this.guardarPrecosConfig();
    this.emit('reset', { manterConfig });
  }

  /**
   * 2.7.2 process restart (DECISIONS §36, Windows bench 2026-10-18): a fresh process that reads back
   * only what c:\simcnf.ini holds (Q8). The record counter R and the read pointer go back to 1 (the
   * buffer is not persisted), the prices go back to the configuration's ({@link guardarPrecosConfig}:
   * a runtime `&U`/`set_preco` is lost), the totalizers, addresses, cards and blacklist are kept, and
   * the TCP connections drop and the port reopens. Everything else is a fresh process.
   */
  async reiniciarProcesso(): Promise<PortaEscuta[]> {
    const travamentoMs = this.sim.conc.travamentoMs;
    const novo = this.simComConfig(true);
    for (const b of novo.conc.lados.flatMap((l) => l.bicos)) {
      const cfg = this.precosConfig.get(b.codigo);
      if (!cfg) continue;
      b.precos = [...cfg.precos];
      b.precosPendentes = [...cfg.pendentes];
    }
    // A harness setting (`configurar_travamento`), not 2.7.2 state.
    novo.conc.travamentoMs = travamentoMs;
    const portas = this.servidor?.portas().map((p) => p.logica) ?? [];
    this.trocarSim(novo);
    if (this.servidor) {
      const p = this.perfil;
      const reabrir = portas.length ? portas : p.escutaTcp === 'umaPorVez' ? [p.opcoesPortaTcp[0] ?? 2001] : p.portas.filter((x) => x.tipo === 'tcp').map((x) => Number(x.porta));
      await this.servidor.fechar();
      for (const l of reabrir) {
        try {
          await this.servidor.abrirPorta(l);
        } catch (e) {
          this.registrarErroPorta(l, e);
          throw e;
        }
      }
      this.erroPorta = null;
    }
    this.emit('reset', { manterConfig: true, processo: true });
    return this.servidor?.portas() ?? [];
  }

  /**
   * Prices of the last configuration load (startup, `reset`, `carregar_config_padrao`, `importar_simcnf`,
   * `snapshot_carregar`): what a 2.7.2 restart reads back. Nozzles activated later (`&C`) are not in it and
   * keep their price on a restart.
   */
  guardarPrecosConfig(): void {
    this.precosConfig.clear();
    for (const b of this.sim.conc.lados.flatMap((l) => l.bicos)) {
      if (b.ativo) this.precosConfig.set(b.codigo, { precos: [...b.precos], pendentes: [...b.precosPendentes] });
    }
  }

  /**
   * A new simulator with the current addresses, nozzles, cards and blacklist, every side and nozzle at
   * rest. `manterEncerrantes` keeps the totalizers (process restart); otherwise they are zeroed (`reset`).
   */
  private simComConfig(manterEncerrantes: boolean): PumpSim {
    const anterior = this.sim.conc.exportarEstado();
    const novo = this.novoSim(this.perfil, false);
    const e = novo.conc.exportarEstado();
    e.lados = anterior.lados.map((l) => ({
      ...l,
      falha: false,
      bloqueado: false,
      preAutorizado: false,
      presetCentavos: null,
      presetVolumeMl: null,
      bicoAutorizado: null,
      autorizacaoExpiraEm: null,
      cartao1: null,
      cartao2: null,
      bicos: l.bicos.map((b) => ({
        ...b,
        estado: b.ativo ? 'repouso' : 'naoConfigurado',
        status: b.ativo ? 'L' : 'F',
        // The 2.7.2's per-nozzle runtime state (BICO_272, BLOQUEIO_272, MS_272): authorization, preset,
        // block and last fueling. Cleared by both forms (DECISIONS §36 F3).
        // Only fields the nozzle carries: real profiles never set them, and their state stays byte-identical.
        ...(b.preAut !== undefined && { preAut: false }),
        ...(b.presetCentavos !== undefined && { presetCentavos: null }),
        ...(b.bloqueio !== undefined && { bloqueio: false }),
        ...(b.ultimo !== undefined && { ultimo: null }),
        ...(b.recolocarNoPreset !== undefined && { recolocarNoPreset: false }),
        ...(manterEncerrantes ? {} : { encerranteMl: 0, encerranteFracMl: undefined, encerranteValorMil: 0 }),
        corrente: null,
        ultimosCartoes: { cartao1: null, cartao2: null },
      })),
    }));
    e.cartoes = anterior.cartoes;
    e.listaNegra = anterior.listaNegra;
    novo.conc.importarEstado(e);
    return novo;
  }

  private trocarSim(novo: PumpSim): void {
    this.sim.conc.onEvento = undefined;
    this.sim.conc.onLog = undefined;
    this.sim = novo;
    this.agenda = [];
    this.servidor?.usarSim(novo);
  }

  snapshotSalvar(nome: string): Snapshot {
    const s: Snapshot = { nome, perfil: this.perfil, estado: this.sim.conc.exportarEstado(), ts: this.clock.now() };
    this.snapshots.set(nome, s);
    return s;
  }

  async snapshotCarregar(nome: string): Promise<void> {
    const s = this.snapshots.get(nome);
    if (!s) throw new Error(`snapshot inexistente: ${nome}`);
    if (s.perfil.id !== this.perfil.id) await this.trocarPerfil(s.perfil);
    this.sim.conc.importarEstado(s.estado);
    this.guardarPrecosConfig();
  }

  // ───────────────────────── recording ─────────────────────────

  gravarInicio(arquivo: string | null = null): Gravador {
    this.gravador?.parar();
    this.gravador = new Gravador(this.clock, arquivo, { perfil: this.perfil.id, enquadramento: this.sim.modoFramer() });
    return this.gravador;
  }

  gravarFim(): { arquivo: string | null; linhas: number } | null {
    const g = this.gravador;
    this.gravador = null;
    return g ? g.parar() : null;
  }

  async fechar(): Promise<void> {
    this.gravarFim();
    await this.servidor?.fechar();
    this.servidor = null;
    this.removeAllListeners();
  }
}
