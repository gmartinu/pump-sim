import type { Perfil, Quirks, Modelo, QuirkId } from '../profiles/types.js';
import { BufferAbastecimentos, type EstadoBuffer } from './buffer.js';
import type { Clock } from './clock.js';
import { codigoBico, hex2, indiceLado } from './codigo-bico.js';
import { type CamposRtc, RelogioSimulado } from './datahora.js';
import { CadastroCartoes, type EstadoFilaIds, FilaIdsPendentes } from './cartoes.js';
import { MODOS_IDENTIFICACAO, validarCartao272, validarCartaoReal } from './identificacao.js';
import {
  type Bico,
  type Cartao,
  type Evento,
  type Lado,
  type LetraStatus,
  type Registro,
  ENCERRANTE_VOLTA_ML,
} from './modelo.js';
import { codificarVirgula, decodificarVirgula } from './virgula.js';

export interface OpcoesConcentrador {
  perfil: Perfil;
  clock: Clock;
  /** Concentrator time zone in minutes (e.g. −180 for Brasília). Default 0 (UTC). */
  fusoMinutos?: number;
  quirks?: Partial<Quirks>;
  /** Loads the 2.7.2 default configuration (8 channels × 2 addresses × 2 nozzles). */
  configPadrao?: boolean;
  /**
   * Q2: how long the "modal MessageBox" freezes the concentrator. `null` = until
   * `liberarTravamento()`. `0` = does not freeze (only the reply is suppressed).
   */
  travamentoMs?: number | null;
}

export interface EntradaLog {
  t: number;
  porta: string;
  dir: 'RX' | 'TX' | 'ERRO' | 'INFO';
  texto: string;
}

export interface Travamento {
  motivo: string;
  desde: number;
  ate: number | null;
}

/**
 * Serializable physical state of the concentrator (snapshot, profile switch, reset with
 * configuration). Does not include the profile or the communication log.
 */
export interface EstadoConcentrador {
  versao: 1;
  modelo: Modelo;
  dips: [boolean, boolean, boolean, boolean];
  automacao: boolean;
  redeAC: boolean;
  bateriaCv: number;
  tickVazaoMs: number;
  quirks: Quirks;
  travamentoMs: number | null;
  rtc: {
    deslocamentoMs: number;
    congeladoMs: number | null;
    /** RTC_272 (optional in older snapshots; `{ano, mes, dia}` is the previous format). */
    campos?: { c: CamposRtc; baseMs: number } | { ano: number; mes: number; dia: number } | null;
    diaSemanaCampo?: number;
  };
  lados: Lado[];
  buffer: EstadoBuffer;
  escritaId: number;
  contadorIdentificacao: number;
  cartoes: { posicao: number; cartao: Cartao }[];
  listaNegra: string[];
  idsPendentes: EstadoFilaIds;
  eventos: Evento[];
  /** MODELO_272 (optional in older snapshots). */
  tipoCbcRetido?: string;
  /** VAZAO_272: the speed radio that is checked (optional in older snapshots). */
  radioVelocidade?: RadioVelocidade | null;
  /** L_272: PC instant the simulator was opened (the `&LE` row 1 event; optional in older snapshots). */
  ligadoEmMs?: number;
}

export type RadioVelocidade = keyof typeof VELOCIDADES;

export type ResultadoComando = 'ok' | 'bicoInexistente' | 'modoInvalido' | 'falha' | 'abastecendo' | 'cheia' | 'naoCadastrado';

export type ModoOperacao = 'A' | 'B' | 'L' | 'S' | 'P' | 'H' | 'I';

export const VELOCIDADES = { lento: 450, normal: 300, rapido: 150 } as const;

const CAPACIDADE_LISTA_NEGRA = 20;
const CAPACIDADE_LOG = 5000;

/**
 * Protocol-agnostic core: concentrator → channels → sides (addresses) → nozzles.
 * The codecs (Companytec `&`, Identfid `?`, Horustech `>`) only read and drive this model.
 */
export class Concentrador {
  readonly perfil: Perfil;
  readonly clock: Clock;
  readonly rtc: RelogioSimulado;
  quirks: Quirks;
  modelo: Modelo;
  /** DIP1..DIP4 (indexes 0..3). */
  dips: [boolean, boolean, boolean, boolean];
  automacao = true;
  redeAC = true;
  /** Battery in centivolts (1200 = 12.00 V). */
  bateriaCv = 1200;
  private carregando = true;
  tickVazaoMs: number;
  readonly lados: Lado[];
  readonly buffer: BufferAbastecimentos;
  /** 2.7.2 identified-records pointer (write side; counts every record since the target opened, verdict #13). */
  escritaId: number;
  private contadorIdentificacao = 0;
  readonly cartoes: CadastroCartoes;
  readonly listaNegra: string[] = [];
  /** ?A queue (unregistered identifiers). */
  readonly idsPendentes: FilaIdsPendentes;
  readonly eventos: Evento[] = [];
  readonly log: EntradaLog[] = [];
  travamento: Travamento | null = null;
  travamentoMs: number | null;
  /** Replies held behind the open modal (ShowMessage in the parser): they go out on OK, last one first. */
  private aposOk: (() => void)[] = [];
  private proxEstado: number;
  private proxVazao: number;
  /** MODELO_272: char 39 left in the `&S` buffer while the combo is on CBC-02 (`0` = never written). */
  private tipoCbcRetido = '0';
  /**
   * VAZAO_272: the speed radio that is checked. The 2.7.2 opens with "Normal" checked and the
   * flow timer at its initial 100 ms (the radio's click handler does not run on load), and a click on the radio
   * that is already checked fires nothing either (bench diff r6, DIFF-18 and EQUIV-MOTOR #74).
   */
  radioVelocidade: RadioVelocidade | null = null;
  /** PC instant (ms) the simulator was opened: L_272 shows it in row 1 of the `&LE` grid. */
  ligadoEmMs: number;
  /** Observers (UI/MCP). */
  onEvento?: (e: Evento) => void;
  onLog?: (e: EntradaLog) => void;

  constructor(op: OpcoesConcentrador) {
    this.perfil = op.perfil;
    this.clock = op.clock;
    this.quirks = { ...op.perfil.quirks, ...(op.quirks ?? {}) };
    this.modelo = op.perfil.modelo;
    this.dips = [false, false, op.perfil.dip3Padrao, true];
    this.rtc = new RelogioSimulado(op.clock, op.fusoMinutos ?? 0);
    this.tickVazaoMs = op.perfil.tickVazaoMs;
    this.travamentoMs = op.travamentoMs === undefined ? 0 : op.travamentoMs;
    const pos = this.quirks.BUFFER_1000 ? { posMin: 1, posMax: 999 } : op.perfil.buffer;
    this.buffer = new BufferAbastecimentos({ ...pos, descartaMaisAntigo: this.quirks.Q4 });
    this.escritaId = this.buffer.escrita;
    this.cartoes = new CadastroCartoes(op.perfil.capacidadeCartoes);
    this.idsPendentes = new FilaIdsPendentes(
      op.perfil.idsPendentes.posMin,
      op.perfil.idsPendentes.posMax,
      this.quirks.IDF_272,
    );
    for (const p of op.perfil.portas) this.buffer.grupo(this.grupoPonteiroDe(`${p.tipo}:${p.porta}`));
    this.lados = [];
    for (let c = 1; c <= op.perfil.canais; c++) {
      for (let e = 1; e <= 4; e++) this.lados.push(this.novoLado(c, e));
    }
    const t = this.clock.now();
    this.ligadoEmMs = t;
    if (this.quirks.VAZAO_272) this.radioVelocidade = 'normal';
    this.proxEstado = t + op.perfil.tickEstadoMs;
    this.proxVazao = t + this.tickVazaoMs;
    this.registrarEvento('ON', 'CBC Ligou PWRON');
    if (op.configPadrao) this.carregarConfigPadrao();
  }

  private novoLado(canal: number, endereco: number): Lado {
    const bicos: Bico[] = [];
    for (let p = 0; p < 4; p++) {
      bicos.push({
        codigo: codigoBico(canal, endereco, p),
        canal,
        endereco,
        posicao: p,
        ativo: false,
        estado: 'naoConfigurado',
        status: 'F',
        precos: [0, 0, 0],
        precosPendentes: [null, null, null],
        encerranteMl: 0,
        encerranteValorMil: 0,
        corrente: null,
        ultimosCartoes: { cartao1: null, cartao2: null },
        numeroPista: 0,
        combustivel: 0,
        tanque: 0,
        volumeTanque: 0,
      });
    }
    return {
      canal,
      endereco,
      indice: indiceLado(canal, endereco),
      configurado: false,
      tipoBomba: 'W',
      virgula: 0x3a,
      nBicos: 0,
      falha: false,
      sensorIdf: false,
      modoIdentificacao: 1,
      bloqueado: false,
      preAutorizado: false,
      presetCentavos: null,
      presetVolumeMl: null,
      bicoAutorizado: null,
      autorizacaoExpiraEm: null,
      nivelPreco: 0,
      cartao1: null,
      cartao2: null,
      bicos,
    };
  }

  // ───────────────────────── queries ─────────────────────────

  q(id: QuirkId): boolean {
    return this.quirks[id];
  }

  /** Read-pointer group of the port: a single one with Q3, one per port without it. */
  grupoPonteiroDe(porta: string): string {
    return this.quirks.Q3 ? 'unico' : porta;
  }

  lado(canal: number, endereco: number): Lado | undefined {
    if (canal < 1 || canal > this.perfil.canais || endereco < 1 || endereco > 4) return undefined;
    return this.lados[indiceLado(canal, endereco)];
  }

  /** Active nozzle by numeric code. */
  bico(codigo: number): Bico | undefined {
    const baixo = codigo & 0x3f;
    if (baixo < 4) return undefined;
    const lado = this.lados[baixo - 4];
    const b = lado?.bicos[codigo >> 6];
    return b && b.ativo ? b : undefined;
  }

  /** Active nozzle by code text (string comparison, like the 2.7.2: "c4" ≠ "C4"). */
  bicoPorTexto(bb: string): Bico | undefined {
    if (!/^[0-9A-F]{2}$/.test(bb)) return undefined;
    const b = this.bico(parseInt(bb, 16));
    return b && hex2(b.codigo) === bb ? b : undefined;
  }

  /**
   * T_272 (verdict #21): nozzle by the BB code stored in it, active or not. A nozzle
   * unconfigured by `&C` n=0 keeps its code; one never configured has none.
   */
  bicoComCodigo(bb: string): Bico | undefined {
    if (!/^[0-9A-F]{2}$/.test(bb)) return undefined;
    const codigo = parseInt(bb, 16);
    const baixo = codigo & 0x3f;
    if (baixo < 4) return undefined;
    const b = this.lados[baixo - 4]?.bicos[codigo >> 6];
    return b && (b.ativo || b.codigoGravado) && hex2(b.codigo) === bb ? b : undefined;
  }

  ladoDoBico(b: Bico): Lado {
    return this.lados[indiceLado(b.canal, b.endereco)]!;
  }

  bicosAtivos(): Bico[] {
    return this.lados.flatMap((l) => l.bicos.filter((b) => b.ativo));
  }

  casasDoBico(b: Bico): { total: number; volume: number; preco: number } {
    return decodificarVirgula(this.ladoDoBico(b).virgula);
  }

  /**
   * Side letter in &S: fault → F; no active nozzle → F; otherwise the letter of the 1st
   * active nozzle whose status ≠ L (behavioral equivalence), or L.
   */
  letraDoLado(l: Lado): LetraStatus {
    if (l.falha) return 'F';
    const ativos = l.bicos.filter((b) => b.ativo);
    if (ativos.length === 0) return 'F';
    // BICO_272, bench diff r4b (§18, EQUIV-MOTOR #68): while a nozzle of the address is fueling
    // the letter is A, even with another nozzle in P. Not when the one fueling was frozen in B by
    // `&M B` (#26): bench r6 and r7g read `(SB…)` right after it and again a state tick later
    // (§23 B2; the r4b `(SA…)` is refuted), so the letter falls back to the first status ≠ L.
    if (this.quirks.BICO_272 && ativos.some((b) => b.estado === 'abastecendo' && b.status !== 'B')) return 'A';
    const diferente = ativos.find((b) => b.status !== 'L');
    return diferente ? diferente.status : 'L';
  }

  /** Configured price (pending one if any, otherwise the current one). */
  precoConfigurado(b: Bico, nivel: number): number {
    return b.precosPendentes[nivel] ?? b.precos[nivel] ?? 0;
  }

  /** Total in thousandths for `volumeMl` at price `precoUnit` with `casasPreco`. */
  totalMil(volumeMl: number, precoUnit: number, casasPreco: number): number {
    const num = volumeMl * precoUnit;
    const div = 10 ** casasPreco;
    return this.quirks.Q6 ? Math.floor(num / div) : Math.round(num / div);
  }

  /** Date of the records: PC clock (Q5) or the simulated one. */
  dataRegistro() {
    return this.quirks.Q5 ? this.rtc.agoraPc() : this.rtc.agora();
  }

  // ───────────────────────── configuration ─────────────────────────

  /** &C / "Configuração CBC". `nBicos = 0` unconfigures the address. */
  configurarEndereco(cfg: {
    canal: number;
    endereco: number;
    nBicos: number;
    tipoBomba?: string;
    virgula?: number;
  }): boolean {
    const l = this.lado(cfg.canal, cfg.endereco);
    if (!l || cfg.nBicos < 0 || cfg.nBicos > 4) return false;
    l.tipoBomba = cfg.tipoBomba ?? l.tipoBomba;
    l.virgula = cfg.virgula ?? l.virgula;
    l.nBicos = cfg.nBicos;
    l.configurado = cfg.nBicos > 0;
    l.gradeC = null; // &R builds the row from the state again (default config, control)
    const casas = decodificarVirgula(l.virgula).preco;
    l.bicos.forEach((b, i) => {
      const ativo = i < cfg.nBicos;
      if (ativo && !b.ativo) this.inicializarBico(b, i, casas);
      if (!ativo) {
        b.estado = 'naoConfigurado';
        b.status = 'F';
        b.corrente = null;
        b.numeroPista = 0;
      }
      b.ativo = ativo;
    });
    return true;
  }

  /** Nozzle (re)activated by &C: initial price, at rest, L. */
  private inicializarBico(b: Bico, i: number, casas: number): void {
    // behavioral equivalence: initial price = nozzle number + 0.12; the "next price" = nozzle number + 0.123.
    const n = i + 1;
    const atual = casas >= 3 ? n * 1000 + 120 : n * 10 ** casas + 12;
    const proximo = casas >= 3 ? n * 1000 + 123 : n * 10 ** casas + 12;
    // NIVEIS_PRECO_ZERO (DIFF-10, bench 17/10): on the 2.7.2 levels 1 and 2 start at 0000.
    b.precos = this.quirks.NIVEIS_PRECO_ZERO ? [atual, 0, 0] : [atual, atual, atual];
    b.precosPendentes = [proximo, null, null];
    b.estado = 'repouso';
    b.status = 'L';
    b.codigoGravado = true;
    // BLOQUEIO_272 (behavioral equivalence): the `&C` leaves the nozzle unblocked.
    b.bloqueio = false;
    if (b.numeroPista === 0) b.numeroPista = this.proximoNumeroPista();
  }

  /**
   * &C of the 2.7.2 (C_272, behavioral equivalence, verdict #43). `casasVolume` null = keep. Stores the
   * raw grid (&R lists it). n = 0 unconfigures the 4 nozzles and zeroes totalizers, cards and
   * the IDF. For i < n, **even if already active**, the nozzle goes back to L/at rest, unblocked and
   * with the initial price. Nozzles above n are **not** deactivated.
   */
  configurarEndereco272(cfg: {
    canal: number;
    endereco: number;
    nBicos: number;
    tipoBomba: string;
    casasPreco: number;
    casasVolume: number | null;
    grade: { tipo: string; cv: string; bicos: string };
  }): boolean {
    const l = this.lado(cfg.canal, cfg.endereco);
    if (!l) return false;
    l.tipoBomba = cfg.tipoBomba;
    const v = decodificarVirgula(l.virgula);
    l.virgula = codificarVirgula({ total: v.total, volume: cfg.casasVolume ?? v.volume, preco: cfg.casasPreco });
    l.gradeC = { ...cfg.grade };
    l.nBicos = cfg.nBicos;
    if (cfg.nBicos === 0) {
      for (const b of l.bicos) {
        b.ativo = false;
        b.estado = 'naoConfigurado';
        b.status = 'F';
        b.corrente = null;
        b.numeroPista = 0;
        b.campoPista272 = 0;
        b.encerranteMl = 0;
        b.encerranteFracMl = undefined;
        b.encerranteValorMil = 0;
        b.ultimosCartoes = { cartao1: null, cartao2: null };
      }
      l.cartao1 = null;
      l.cartao2 = null;
      l.sensorIdf = false;
    }
    const casas = decodificarVirgula(l.virgula).preco;
    for (let i = 0; i < Math.min(cfg.nBicos, 4); i++) {
      const b = l.bicos[i]!;
      b.corrente = null;
      b.ativo = false;
      this.inicializarBico(b, i, casas);
      b.ativo = true;
    }
    if (cfg.nBicos > 0) l.bloqueado = false;
    l.configurado = l.bicos.some((b) => b.ativo);
    if (this.quirks.BLOQUEIO_272) this.espelharBloqueio(l);
    return true;
  }

  /** &c of the 2.7.2 (C_272, behavioral equivalence): 3 fields of 2 chars per nozzle, read with the PAF (B: bb, cc, tt). */
  camposBico272(b: Bico, campos: [string, string, string]): void {
    // Bench diff r4b (§18, EQUIV-COMANDOS #44): `(&c00411223349)` comes out in the PAF as `113322`,
    // so cmd[8..9] lands where the PAF prints the tank and cmd[10..11] where it prints the fuel.
    const [bb, tt, cc] = campos;
    if (/^[0-9]{2}$/.test(bb)) {
      b.numeroPista = Number(bb);
      b.campoPista272 = Number(bb);
    }
    if (/^[0-9]{2}$/.test(cc)) b.combustivel = Number(cc);
    if (/^[0-9]{2}$/.test(tt)) b.tanque = Number(tt);
  }

  /** Lowest free lane nozzle number (≥ 1), stable across reconfigurations. */
  private proximoNumeroPista(): number {
    const usados = new Set(this.lados.flatMap((l) => l.bicos.filter((b) => b.ativo).map((b) => b.numeroPista)));
    let n = 1;
    while (usados.has(n)) n++;
    return n;
  }

  /** Active nozzle by lane number (Horustech: decimal nozzle 1..99). */
  bicoPorNumero(n: number): Bico | undefined {
    return this.bicosAtivos().find((b) => b.numeroPista === n);
  }

  /** Changes the lane number of a nozzle (HRS Console nozzle table). */
  definirNumeroPista(codigo: number, n: number): boolean {
    const b = this.bico(codigo);
    if (!b || n < 1 || n > 99) return false;
    if (this.bicosAtivos().some((x) => x !== b && x.numeroPista === n)) return false;
    b.numeroPista = n;
    return true;
  }

  /**
   * Identification mode 01–14 of the address (spec §3.3). On real profiles the DT435 §3.10
   * release rule applies; on the 2.7.2 (IDF_CC_BYTE) it is only a label.
   */
  definirModoIdentificacao(canal: number, endereco: number, modo: number): boolean {
    const l = this.lado(canal, endereco);
    if (!l || !Number.isInteger(modo) || modo < 1 || modo > MODOS_IDENTIFICACAO.length) return false;
    l.modoIdentificacao = modo;
    return true;
  }

  setSensorIdf(canal: number, endereco: number, ligado: boolean): boolean {
    const l = this.lado(canal, endereco);
    if (!l) return false;
    l.sensorIdf = ligado;
    this.atualizarRepouso(l);
    return true;
  }

  /**
   * `?C` (behavioral equivalence). With BLOQUEIO_272 (verdict #52) it turns on the IDF sensor **and the
   * block** of the 4 nozzles: at rest without a pre-authorization the nozzle goes to B.
   */
  configurarSensorIdf(canal: number, endereco: number): boolean {
    const l = this.lado(canal, endereco);
    if (!l) return false;
    if (this.quirks.BLOQUEIO_272) this.definirBloqueio(l, true);
    return this.setSensorIdf(canal, endereco, true);
  }

  /** BLOQUEIO_272: block flag of the 4 nozzles; `l.bloqueado` mirrors "any nozzle blocked" (UI/control). */
  private definirBloqueio(l: Lado, valor: boolean): void {
    for (const b of l.bicos) b.bloqueio = valor;
    this.espelharBloqueio(l);
  }

  private espelharBloqueio(l: Lado): void {
    l.bloqueado = l.bicos.some((b) => b.ativo && b.bloqueio === true);
  }

  /** 2.7.2 "Carregar configuração padrão" button: 8 channels × addresses 1–2 × 2 nozzles, comma 3A. */
  carregarConfigPadrao(): void {
    for (let c = 1; c <= Math.min(8, this.perfil.canais); c++) {
      for (let e = 1; e <= 2; e++) {
        const l = this.lado(c, e);
        if (this.quirks.PADRAO_272 && l) {
          // Bench diff r4b (§18, DIFF-05/07/10, EQUIV-LEITURA): like the 2.7.2 `&C` (C_272), the
          // button re-initializes the nozzles that are already active: initial price (the &U price
          // is lost), at rest, status L, unblocked. The pre-authorization flag stays, so a P comes
          // back on the next state tick (DIFF-05: L right after the click, P one tick later).
          // B: a nozzle lifted at the click goes back to rest without a record (not measured).
          for (const b of l.bicos.slice(0, 2)) {
            b.corrente = null;
            b.ativo = false;
          }
        }
        this.configurarEndereco({ canal: c, endereco: e, nBicos: 2, tipoBomba: 'W', virgula: 0x3a });
        if (this.quirks.PADRAO_272 && l && this.quirks.BLOQUEIO_272) this.espelharBloqueio(l);
      }
    }
    if (this.quirks.PADRAO_272) {
      // "Carregar configuração padrão" (behavioral equivalence, verdict #78): the write and read
      // pointers go back to the 1st position; the identified-records pointer (`escritaId`) is not
      // touched, so `&A67` and `&A` stop agreeing on "empty". The rows stay in the records grid
      // (B: the button does not clear it).
      this.buffer.definirEscrita(this.buffer.opcoes.posMin);
      for (const g of this.buffer.gruposIds()) this.buffer.definirLeitura(g, this.buffer.opcoes.posMin);
    }
  }

  setFalhaEndereco(canal: number, endereco: number, ativo: boolean): void {
    const l = this.lado(canal, endereco);
    if (l) l.falha = ativo;
  }

  setVelocidade(v: keyof typeof VELOCIDADES | number): void {
    if (typeof v !== 'number' && this.quirks.VAZAO_272) {
      // A click on the radio already checked changes nothing (no OnClick): a fresh 2.7.2 clicked
      // on "Normal" keeps the 100 ms tick (bench diff r6, DIFF-18: ~2,5 ticks per 255 ms sample).
      if (this.radioVelocidade === v) return;
      this.radioVelocidade = v;
    }
    this.tickVazaoMs = typeof v === 'number' ? v : VELOCIDADES[v];
    this.proxVazao = this.clock.now() + this.tickVazaoMs;
  }

  setModelo(m: Modelo): void {
    // MODELO_272 (flow timer, verdict #10): CBC-02 writes nothing over char 39 of `&S`;
    // the digit of the model before it stays.
    if (this.quirks.MODELO_272 && m === 'CBC-02') this.tipoCbcRetido = this.tipoCbc();
    this.modelo = m;
  }

  /** Char 39 of &S: on the 2.7.2 it comes from the model (6 CBC-06/Horustech, 5, 4, 0 on CBC-02). */
  tipoCbc(): string {
    if (!this.perfil.leituraRegistro.porModelo) return this.perfil.status.tipoCbc;
    if (this.quirks.MODELO_272 && this.modelo === 'CBC-02') return this.tipoCbcRetido;
    switch (this.modelo) {
      case 'CBC-06':
      case 'Horustech':
      case 'Concept':
        return '6';
      case 'CBC-05':
        return '5';
      case 'CBC-04':
        return '4';
      default:
        return '0';
    }
  }

  // ───────────────────────── physical actions ─────────────────────────

  /** 2.7.2 "Retira Bico" button: toggles lift / hang up / finish. */
  alternarBico(codigo: number): boolean {
    const b = this.bico(codigo);
    if (!b) return false;
    if (b.estado === 'repouso') return this.retirarBico(codigo);
    return this.recolocarBico(codigo);
  }

  retirarBico(codigo: number): boolean {
    const b = this.bico(codigo);
    if (!b || b.estado !== 'repouso') return false;
    b.estado = 'retirado';
    return true;
  }

  recolocarBico(codigo: number): boolean {
    const b = this.bico(codigo);
    if (!b) return false;
    if (b.estado === 'retirado') {
      b.estado = 'repouso';
      b.status = this.statusRepousoBico(b);
      return true;
    }
    if (b.estado === 'abastecendo') {
      this.encerrar(b);
      return true;
    }
    return false;
  }

  /**
   * IDF panel / side reader: presents a card. An unknown one goes to the ?A queue
   * with the lifted nozzle (or the side's 1st active nozzle) (DT432 p.15).
   */
  apresentarCartao(canal: number, endereco: number, codigo: string): ReturnType<typeof validarCartao272> {
    const l = this.lado(canal, endereco);
    if (!l) return { aceito: false, motivo: 'desconhecido' };
    const cod = codigo.toUpperCase().padStart(16, '0').slice(-16);
    const c = this.cartoes.get(cod);
    if (!c) {
      const b = l.bicos.find((x) => x.ativo && x.estado === 'retirado') ?? l.bicos.find((x) => x.ativo);
      this.idsPendentes.adicionar(cod, b?.codigo ?? 0, this.dataRegistro());
      this.registrarEvento('IDF', `Identificador não cadastrado ${cod}`);
      return { aceito: false, motivo: 'desconhecido' };
    }
    if (this.estaNaListaNegra(cod)) return { aceito: false, motivo: 'listaNegra' };
    const r = this.quirks.IDF_CC_BYTE
      ? validarCartao272(c, this.rtc.agoraPc())
      : validarCartaoReal(c, l.modoIdentificacao, this.rtc.agora(), l.cartao1 !== null || l.cartao2 !== null);
    if (!r.aceito) return r;
    l[r.campo] = cod;
    if (r.libera) this.autorizarLado(l);
    return r;
  }

  private autorizarLado(l: Lado, bico: number | null = null): void {
    l.bicoAutorizado = bico;
    const vale = (b: Bico) => bico === null || b.codigo === bico;
    const aguardando = l.bicos.find((b) => b.ativo && b.estado === 'retirado' && vale(b));
    if (aguardando && this.quirks.LIBERACAO_IMEDIATA) {
      if (this.quirks.BICO_272) aguardando.preAut = true;
      this.iniciar(aguardando);
      return;
    }
    if (this.quirks.BICO_272) {
      // behavioral equivalence (verdict #68, B4/B7): the pre-authorization belongs to the nozzle; with no nozzle in E,
      // &M A marks the 4 nozzles of the address.
      for (const b of l.bicos) {
        if (!b.ativo || !vale(b)) continue;
        b.preAut = true;
        if (b.estado === 'repouso' || b.estado === 'retirado') b.status = 'P';
      }
      return;
    }
    l.preAutorizado = true;
    if (aguardando) aguardando.status = 'P';
    for (const b of l.bicos) if (b.ativo && b.estado === 'repouso' && vale(b)) b.status = 'P';
  }

  /** Cancels a pending authorization (the ?F P time expired, or clear). */
  cancelarAutorizacao(l: Lado): void {
    l.preAutorizado = false;
    l.bicoAutorizado = null;
    l.autorizacaoExpiraEm = null;
    l.presetCentavos = null;
    l.presetVolumeMl = null;
    l.cartao1 = null;
    l.cartao2 = null;
    for (const b of l.bicos) {
      if (!b.ativo) continue;
      b.preAut = false;
      if (b.estado === 'repouso') b.status = this.statusRepousoBico(b);
      else if (b.estado === 'retirado') b.status = 'E';
    }
  }

  /**
   * ?F P — identified preset (DT435 p.29-30): binds the identifier to the side's next
   * fueling and, with `autoriza`, releases it. `$` = whole side capped by
   * value; `V` = only the nozzle, capped by volume. `segundos` = time to lift the
   * nozzle (0 = no deadline, B).
   */
  presetIdentificado(p: {
    codigo: number;
    identificador: string;
    tipoId: 'frentista' | 'cliente' | 'hodometro';
    autoriza: boolean;
    valor: number;
    segundos: number;
    tipoPreset: '$' | 'V';
  }): ResultadoComando {
    const b = this.bico(p.codigo);
    if (!b) return 'bicoInexistente';
    const l = this.ladoDoBico(b);
    if (l.falha) return 'falha';
    if (l.bicos.some((x) => x.estado === 'abastecendo' || x.estado === 'recolocado')) return 'abastecendo';
    const id = p.identificador.toUpperCase().padStart(16, '0').slice(-16);
    if (p.tipoId === 'frentista') l.cartao1 = id;
    else l.cartao2 = id;
    if (p.tipoPreset === '$') {
      l.presetCentavos = p.valor > 0 ? p.valor : null;
      l.presetVolumeMl = null;
    } else {
      const casasVol = decodificarVirgula(l.virgula).volume;
      l.presetVolumeMl = p.valor > 0 ? p.valor * 10 ** (3 - casasVol) : null;
      l.presetCentavos = null;
    }
    if (p.autoriza) {
      this.autorizarLado(l, p.tipoPreset === 'V' ? b.codigo : null);
      l.autorizacaoExpiraEm = p.segundos > 0 ? this.clock.now() + p.segundos * 1000 : null;
    }
    return 'ok';
  }

  // ───────────────────────── automation commands ─────────────────────────

  /** &M (behavioral equivalence / DT435 §3.9). */
  modo(codigo: number, m: string): ResultadoComando {
    const b = this.bico(codigo);
    if (!b) return 'bicoInexistente';
    if (!['A', 'B', 'L', 'S', 'P', 'H', 'I'].includes(m)) return 'modoInvalido';
    const l = this.ladoDoBico(b);
    if (l.falha && !this.quirks.ERROS_272) return 'falha';
    switch (m as ModoOperacao) {
      case 'A': {
        // BLOQUEIO_272 (behavioral equivalence / B7, verdict #24): a nozzle in E (status 4) gets its
        // block zeroed besides the pre-authorization, so its next fueling also goes out free.
        if (this.quirks.BLOQUEIO_272 && b.status === 'E') {
          b.bloqueio = false;
          this.espelharBloqueio(l);
        }
        if (b.estado === 'abastecendo' && b.corrente?.pausado) {
          b.corrente.pausado = false;
          b.status = 'A';
        } else if (b.estado === 'retirado' && b.status === 'E') {
          this.autorizarLado(l);
        } else {
          this.autorizarLado(l);
        }
        break;
      }
      case 'L':
        // BLOQUEIO_272 (B9, verdict #25): zeroes the block of the 4 nozzles, not the sensor.
        if (this.quirks.BLOQUEIO_272) this.definirBloqueio(l, false);
        else l.bloqueado = false;
        this.atualizarRepouso(l);
        break;
      case 'B':
        if (this.quirks.BLOQUEIO_272) this.definirBloqueio(l, true);
        else l.bloqueado = true;
        if (this.quirks.BICO_272) for (const x of l.bicos) x.preAut = false;
        if (this.quirks.VAZAO_272) {
          // equivalence B8 (verdict #26): status B on the 4 nozzles right away, including the one fueling.
          // The flow timer only advances with status A: the flow freezes with the nozzle still fueling.
          for (const x of l.bicos) if (x.ativo && x.estado !== 'recolocado') x.status = 'B';
        } else {
          this.atualizarRepouso(l);
        }
        break;
      case 'S':
        if (this.quirks.MS_272) {
          // equivalence B10 (verdict #27): only the addressed nozzle, in any state: state 3,
          // status C and the nozzle's preset turned off. The next state tick stores the record.
          if (b.estado === 'abastecendo') this.encerrar(b, 'bico');
          else if (b.ativo && b.estado !== 'naoConfigurado') {
            b.estado = 'recolocado';
            b.status = 'C';
            b.presetCentavos = null;
          }
          break;
        }
        for (const x of l.bicos) if (x.estado === 'abastecendo') this.encerrar(x);
        break;
      case 'P':
        if (this.quirks.BICO_272) b.presetCentavos = null;
        else l.presetCentavos = null;
        if (b.estado === 'abastecendo' && b.corrente) {
          b.corrente.pausado = true;
          b.status = 'E';
        } else {
          b.status = 'E';
        }
        break;
      case 'H':
        l.sensorIdf = true;
        this.atualizarRepouso(l);
        break;
      case 'I':
        l.sensorIdf = false;
        this.atualizarRepouso(l);
        break;
    }
    return 'ok';
  }

  /** &U: the price applies on the next fueling. */
  definirPreco(codigo: number, nivel: number, preco: number): ResultadoComando {
    const b = this.bico(codigo);
    if (!b) return 'bicoInexistente';
    if (nivel < 0 || nivel > 2) return 'modoInvalido';
    if (this.ladoDoBico(b).falha && !this.quirks.ERROS_272) return 'falha';
    b.precosPendentes[nivel] = preco;
    return 'ok';
  }

  /** &P: preset by value (cents) on the nozzle's side. */
  preset(codigo: number, centavos: number): ResultadoComando {
    const b = this.bico(codigo);
    if (!b) return 'bicoInexistente';
    const l = this.ladoDoBico(b);
    if (l.falha && !this.quirks.ERROS_272) return 'falha';
    if (l.bicos.some((x) => x.estado === 'abastecendo')) return 'abastecendo';
    l.presetCentavos = centavos;
    return 'ok';
  }

  /**
   * &P of the 2.7.2 (P_272, behavioral equivalence, verdict #35): refuses only with its **own** nozzle in A;
   * otherwise pre-authorizes the nozzle and sets P **before** converting the value. `centavos` null =
   * the value did not convert (E8): the nozzle stays marked, with no preset.
   */
  preset272(b: Bico, centavos: number | null): ResultadoComando {
    if (b.status === 'A') return 'abastecendo';
    const l = this.ladoDoBico(b);
    b.status = 'P';
    if (this.quirks.BICO_272) {
      // equivalence C1/C2 (verdict #72/#73): pre-authorization and preset of the nozzle itself.
      b.preAut = true;
      if (centavos !== null) b.presetCentavos = centavos;
      return 'ok';
    }
    if (!(l.preAutorizado && l.bicoAutorizado === null)) l.bicoAutorizado = b.codigo;
    l.preAutorizado = true;
    if (centavos !== null) l.presetCentavos = centavos;
    return 'ok';
  }

  /** Blacklist: a column of the registry on the 2.7.2 (M99_272), its own list on the real ones. */
  estaNaListaNegra(codigo: string): boolean {
    const cod = codigo.toUpperCase();
    if (this.quirks.M99_272) return this.cartoes.get(cod)?.listaNegra === true;
    return this.listaNegra.includes(cod);
  }

  codigosListaNegra(): string[] {
    if (this.quirks.M99_272) return this.cartoes.todos().filter((x) => x.cartao.listaNegra).map((x) => x.cartao.codigo);
    return [...this.listaNegra];
  }

  /**
   * &M99. On the real ones: a 20-position list. On the 2.7.2 (M99_272, behavioral equivalence, verdict #32):
   * the Lista-Negra column of the card registry, with no capacity; `b` marks `sim`, the
   * other ops mark `nao`; a card outside the registry → `naoCadastrado` (the `(M?f)`).
   * `c` only comes from the control ("clear"; the &M99 handler sends `l`): unmarks all.
   */
  listaNegraOp(op: 'c' | 'b' | 'l', codigo: string): ResultadoComando {
    const cod = codigo.toUpperCase();
    if (this.quirks.M99_272) {
      if (op === 'c') {
        for (const x of this.cartoes.todos()) x.cartao.listaNegra = false;
        return 'ok';
      }
      const c = this.cartoes.get(cod);
      if (!c) return 'naoCadastrado';
      c.listaNegra = op === 'b';
      return 'ok';
    }
    if (op === 'c') {
      this.listaNegra.length = 0;
      return 'ok';
    }
    const i = this.listaNegra.indexOf(cod);
    if (op === 'b') {
      if (i >= 0) return 'ok';
      if (this.listaNegra.length >= CAPACIDADE_LISTA_NEGRA) return 'cheia';
      this.listaNegra.push(cod);
      return 'ok';
    }
    if (i >= 0) this.listaNegra.splice(i, 1);
    return 'ok';
  }

  /** "Gravação de totais" / &E: stores the totalizer in liters (mL). */
  gravarEncerrante(codigo: number, ml: number): boolean {
    const b = this.bico(codigo);
    if (!b) return false;
    b.encerranteMl = ml % ENCERRANTE_VOLTA_ML;
    b.encerranteFracMl = undefined;
    this.registrarEvento('MEM', 'Encerrante Gravado');
    return true;
  }

  /**
   * 2.7.2 "Gravar totais" (E_272, the "Gravar totais" button, verdict #42/#80): the
   * totalizer in liters becomes the given value, with no decimals and no wraparound; if it changed, it creates
   * a zero-volume record (B: initial totalizer = final = the new one, price of level 0).
   */
  gravarEncerrante272(b: Bico, ml: number): void {
    const anterior = b.encerranteMl;
    // The 2.7.2 compares the unrounded totalizer (VAZAO_272 fraction, §23 B1).
    const mudou = anterior !== ml || (b.encerranteFracMl ?? 0) > 0;
    b.encerranteMl = ml;
    b.encerranteFracMl = undefined;
    this.registrarEvento('MEM', 'Encerrante Gravado');
    if (!mudou) return;
    // Bench diff r4b (§18, EQUIV-COMANDOS #42/#44): the record carries the old totalizer as the
    // initial one and the new one as the final, the configured level-0 price (the "next price"
    // 11,23 right after a `&C`, not the 11,20 in effect) and a non-zero duration. B: the
    // duration is taken from the nozzle's last start, as the &M S ghost record (MS_272) does.
    const u = b.ultimo;
    this.gravarRegistro(b, {
      encIniMl: anterior,
      encFimMl: ml,
      volumeMl: 0,
      totalMil: 0,
      precoUnit: this.precoConfigurado(b, 0),
      nivelPreco: 0,
      duracaoS: u ? Math.max(0, Math.floor((this.clock.now() - u.inicioMs) / 1000)) : 0,
      cartao1: null,
      cartao2: null,
    });
  }

  /** Stores (or updates) an identifier. Returns the position, or null when memory is full. */
  gravarCartao(c: Cartao): number | null {
    return this.cartoes.gravar(c);
  }

  excluirCartao(codigo: string): number | null {
    return this.cartoes.excluir(codigo);
  }

  limparCartoes(): void {
    this.cartoes.limpar();
  }

  // ───────────────────────── pointers ─────────────────────────

  ponteiroLeitura(porta: string): number {
    return this.buffer.grupo(this.grupoPonteiroDe(porta)).leitura;
  }

  incrementarPonteiro(porta: string): boolean {
    const g = this.grupoPonteiroDe(porta);
    if (this.buffer.vazio(g)) return false;
    this.buffer.incrementar(g);
    return true;
  }

  /** Empty for the identified read: on the 2.7.2 it compares with the identified-records pointer (Q3). */
  vazioIdentificado(porta: string): boolean {
    const leitura = this.ponteiroLeitura(porta);
    return this.quirks.Q3 ? leitura === this.escritaId : leitura === this.buffer.escrita;
  }

  // ───────────────────────── freeze (Q2) ─────────────────────────

  /**
   * Protocol MessageBox (Q2). `aposOk` = reply the handler only sends after the
   * OK (ShowMessage inside the parser, E3). With `travamentoMs = 0` the OK is immediate and the
   * reply goes out at once (`imediata`); otherwise it is held until the modal closes (`adiada`).
   * The modal does **not** silence the socket: the other frames are still served (verdict #8).
   */
  travar(motivo: string, aposOk: string | null = null): { imediata: string | null; adiada?: Promise<string> } {
    const agora = this.clock.now();
    this.registrarEvento('MSG', motivo);
    if (!this.quirks.Q2 || this.travamentoMs === 0) return { imediata: aposOk };
    this.travamento = { motivo, desde: agora, ate: this.travamentoMs === null ? null : agora + this.travamentoMs };
    if (aposOk === null) return { imediata: null };
    return { imediata: null, adiada: new Promise<string>((res) => this.aposOk.push(() => res(aposOk))) };
  }

  liberarTravamento(): void {
    this.travamento = null;
    this.soltarRespostas();
  }

  /** The OK of the modal(s): the innermost handler (the last one opened) continues first. */
  private soltarRespostas(): void {
    const fila = this.aposOk.reverse();
    this.aposOk = [];
    for (const f of fila) f();
  }

  estaTravado(): boolean {
    if (!this.travamento) return false;
    if (this.travamento.ate !== null && this.clock.now() >= this.travamento.ate) {
      this.liberarTravamento();
      return false;
    }
    return true;
  }

  // ───────────────────────── log and events ─────────────────────────

  registrarLog(porta: string, dir: EntradaLog['dir'], texto: string): void {
    const e = { t: this.clock.now(), porta, dir, texto };
    this.log.push(e);
    this.onLog?.(e);
    if (this.log.length > CAPACIDADE_LOG) this.log.splice(0, this.log.length - CAPACIDADE_LOG);
  }

  registrarEvento(tipo: string, texto: string): void {
    const e = { t: this.clock.now(), tipo, texto };
    this.eventos.push(e);
    const cap = Math.max(1, this.perfil.capacidadeEventos);
    if (this.eventos.length > cap) this.eventos.splice(0, this.eventos.length - cap);
    this.onEvento?.(e);
  }

  // ───────────────────────── tick engine ─────────────────────────

  /** Runs the due ticks up to `clock.now()`, in time order. */
  atualizar(): void {
    const agora = this.clock.now();
    this.estaTravado(); // closes the modal whose deadline passed (and releases the held replies)
    for (;;) {
      const prox = Math.min(this.proxEstado, this.proxVazao);
      if (prox > agora) break;
      if (this.proxVazao <= this.proxEstado) {
        this.tickVazao();
        this.proxVazao += this.tickVazaoMs;
      } else {
        this.tickEstado();
        this.proxEstado += this.perfil.tickEstadoMs;
      }
    }
  }

  private simulacaoAtiva(): boolean {
    return !this.quirks.Q7 || (this.automacao && this.dips[3]);
  }

  /** State tick (1 s): nozzle state machine + battery. */
  tickEstado(): void {
    this.tickBateria();
    if (!this.simulacaoAtiva()) return;
    const agora = this.clock.now();
    for (const l of this.lados) {
      if (!l.configurado || l.falha) continue;
      if (
        !this.quirks.BICO_272 &&
        l.autorizacaoExpiraEm !== null &&
        agora >= l.autorizacaoExpiraEm &&
        !l.bicos.some((x) => x.estado === 'abastecendo' || x.estado === 'recolocado')
      ) {
        this.cancelarAutorizacao(l);
      }
      for (const b of l.bicos) {
        if (!b.ativo) continue;
        switch (b.estado) {
          case 'retirado': {
            // BICO_272 (verdict #66): the 2.7.2 has no "side busy" lock.
            const ocupado = !this.quirks.BICO_272 && l.bicos.some((x) => x !== b && x.estado === 'abastecendo');
            const preAut = this.preAutDoBico(b);
            // BLOQUEIO_272 (equivalence B2, verdict #25/#29): only the nozzle's block holds it; the
            // IDF sensor alone does not (it raises the block at the start, see `iniciar`).
            const livre = this.quirks.BLOQUEIO_272 ? !b.bloqueio : !l.bloqueado && !l.sensorIdf;
            const autorizado = preAut || livre;
            if (autorizado && !ocupado) this.iniciar(b);
            else if (b.status !== 'P' || !preAut) b.status = 'E';
            break;
          }
          case 'recolocado':
            this.finalizar(b);
            break;
          case 'repouso':
            b.status = this.statusRepousoBico(b);
            break;
          case 'abastecendo':
            // VAZAO_272: the state tick does not touch the status of a nozzle that is fueling (&M B freezes it).
            if (!this.quirks.VAZAO_272) b.status = b.corrente?.pausado ? 'E' : 'A';
            break;
          default:
            break;
        }
      }
    }
  }

  private tickBateria(): void {
    if (!this.perfil.bateriaDinamica) return;
    if (this.redeAC && this.dips[3]) {
      if (this.carregando) {
        this.bateriaCv = Math.min(1360, this.bateriaCv + 2);
        if (this.bateriaCv >= 1360) this.carregando = false;
      } else {
        this.bateriaCv = Math.max(1160, this.bateriaCv - 2);
        if (this.bateriaCv <= 1160) this.carregando = true;
      }
    } else if (!this.redeAC) {
      this.bateriaCv = Math.max(0, this.bateriaCv - 2);
    }
  }

  /** Flow timer. */
  tickVazao(): void {
    // VAZAO_272 (equivalence A3, verdict #63): the 2.7.2 flow timer looks at neither Automation nor DIP4.
    const v272 = this.quirks.VAZAO_272;
    if (!v272 && !this.simulacaoAtiva()) return;
    for (const l of this.lados) {
      if (!l.configurado || l.falha) continue;
      for (const b of l.bicos) {
        const c = b.corrente;
        if (!b.ativo || b.estado !== 'abastecendo' || !c) continue;
        // VAZAO_272 (equivalence A4, verdict #64): the condition is status A, not the state.
        if (v272 ? b.status !== 'A' : c.pausado) continue;
        if (c.congelado) continue;
        if (c.piscando > 0) {
          c.piscando--;
          continue;
        }
        const casas = decodificarVirgula(l.virgula);
        const presetBico = this.quirks.BICO_272 ? (b.presetCentavos ?? null) : null;
        const presetCentavos = presetBico ?? l.presetCentavos;
        // VAZAO_272 (equivalence C4, verdict #74): with an active preset the step is 0.13 L even with 3 decimals.
        const comPreset = presetCentavos !== null || l.presetVolumeMl !== null;
        const vaz =
          casas.volume >= 3 && !(v272 && comPreset) ? this.perfil.vazaoMlPorTick.casas3 : this.perfil.vazaoMlPorTick.casas2;
        const proxVol = (c.ticks + 1) * vaz;
        const proxTotal = this.totalMil(proxVol, c.precoUnit, casas.preco);
        if (v272 && comPreset) {
          // equivalence C3 (verdict #72): reaching the preset fixes volume = preset/price and total = preset,
          // and the nozzle stays in A, without finishing. The record only goes out on hang-up or with &M S.
          const passou =
            presetCentavos !== null
              ? proxVol * c.precoUnit > presetCentavos * 10 * 10 ** casas.preco
              : proxVol > (l.presetVolumeMl ?? Infinity);
          if (passou) {
            if (presetCentavos !== null) {
              const presetMil = presetCentavos * 10;
              const exato = c.precoUnit > 0 ? (presetMil * 10 ** casas.preco) / c.precoUnit : proxVol;
              c.volumeMl = Math.floor(exato);
              // Bench diff r7g (§23 B1): the frozen volume stays unrounded for the totalizer.
              c.volumeFracMl = exato - c.volumeMl;
              c.totalMil = presetMil;
            } else {
              c.volumeMl = l.presetVolumeMl!;
              c.totalMil = this.totalMil(c.volumeMl, c.precoUnit, casas.preco);
            }
            c.congelado = true;
            if (b.recolocarNoPreset) this.encerrar(b);
            continue;
          }
        }
        if (!v272 && l.presetVolumeMl !== null && proxVol > l.presetVolumeMl) {
          c.volumeMl = l.presetVolumeMl;
          c.totalMil = this.totalMil(l.presetVolumeMl, c.precoUnit, casas.preco);
          this.encerrar(b);
          continue;
        }
        if (!v272 && l.presetCentavos !== null && proxTotal > l.presetCentavos * 10) {
          const presetMil = l.presetCentavos * 10;
          c.volumeMl = c.precoUnit > 0 ? Math.floor((presetMil * 10 ** casas.preco) / c.precoUnit) : proxVol;
          c.totalMil = presetMil;
          this.encerrar(b);
          continue;
        }
        c.ticks++;
        c.volumeMl = proxVol;
        c.totalMil = proxTotal;
      }
    }
  }

  statusRepouso(l: Lado): LetraStatus {
    if (l.preAutorizado) return 'P';
    if (l.bloqueado) return 'B';
    if (this.perfil.repousoComSensorBloqueado && l.sensorIdf) return 'B';
    return 'L';
  }

  /** Pre-authorization that applies to the nozzle: its own (BICO_272) or the side's. */
  preAutDoBico(b: Bico): boolean {
    if (this.quirks.BICO_272) return b.preAut === true;
    const l = this.ladoDoBico(b);
    return l.preAutorizado && (l.bicoAutorizado === null || l.bicoAutorizado === b.codigo);
  }

  /** Rest status of a nozzle: with BICO_272 the pre-authorization belongs to the nozzle (equivalence B6). */
  statusRepousoBico(b: Bico): LetraStatus {
    const l = this.ladoDoBico(b);
    if (this.quirks.BLOQUEIO_272) {
      // equivalence B6: P with the pre-authorization, B with the nozzle's block, otherwise L. The
      // per-tick card validation of a blocked nozzle (#70) is not modeled.
      if (this.preAutDoBico(b)) return 'P';
      if (b.bloqueio) return 'B';
      return this.perfil.repousoComSensorBloqueado && l.sensorIdf ? 'B' : 'L';
    }
    if (!this.quirks.BICO_272) return this.statusRepouso(l);
    if (b.preAut) return 'P';
    return this.statusRepouso({ ...l, preAutorizado: false });
  }

  private atualizarRepouso(l: Lado): void {
    for (const b of l.bicos) if (b.ativo && b.estado === 'repouso') b.status = this.statusRepousoBico(b);
  }

  iniciar(b: Bico): void {
    const l = this.ladoDoBico(b);
    for (let n = 0; n < 3; n++) {
      const p = b.precosPendentes[n];
      if (p !== null && p !== undefined) {
        b.precos[n] = p;
        b.precosPendentes[n] = null;
      }
    }
    const nivel = l.nivelPreco;
    b.corrente = {
      encIniMl: b.encerranteMl,
      volumeMl: 0,
      totalMil: 0,
      precoUnit: b.precos[nivel] ?? b.precos[0],
      nivelPreco: nivel,
      inicioMs: this.clock.now(),
      ticks: 0,
      piscando: this.quirks.Q6 ? this.perfil.ticksPiscando : 0,
      pausado: false,
      cartao1: l.cartao1,
      cartao2: l.cartao2,
    };
    b.estado = 'abastecendo';
    b.status = 'A';
    // BLOQUEIO_272 (equivalence B2, verdict #29): with the IDF sensor on, the start raises the block
    // of this nozzle for the next fueling.
    if (this.quirks.BLOQUEIO_272 && l.sensorIdf) {
      b.bloqueio = true;
      this.espelharBloqueio(l);
    }
    // BICO_272 (equivalence B4): the start does not clear the pre-authorization; it goes away at the end, on the 4 nozzles.
    if (this.quirks.BICO_272) return;
    l.preAutorizado = false;
    l.bicoAutorizado = null;
    l.autorizacaoExpiraEm = null;
  }

  /**
   * End of fueling (hang-up, &M S, end of preset): status C, stored on the next tick.
   * With BICO_272, hanging up turns off the preset of the 4 nozzles of the address (equivalence B1) and &M S only
   * the nozzle's (`escopo = 'bico'`, equivalence B10).
   */
  encerrar(b: Bico, escopo: 'endereco' | 'bico' = 'endereco'): void {
    if (b.estado !== 'abastecendo') return;
    b.estado = 'recolocado';
    b.status = 'C';
    const l = this.ladoDoBico(b);
    l.presetCentavos = null;
    l.presetVolumeMl = null;
    if (this.quirks.BICO_272) for (const x of escopo === 'bico' ? [b] : l.bicos) x.presetCentavos = null;
  }

  /**
   * Final totalizer after adding a fueling of `volumeMl` (+ `fracMl`, the sub-mL part a VAZAO_272
   * preset freeze keeps) to `baseMl`. The fraction is carried in `encerranteFracMl`: the 2.7.2 adds
   * the unrounded volume (bench diff r7g, DIFF-17R `&LR`: E10 15 cL above 334 × 0,890 L, §23 B1).
   */
  private somarEncerrante(b: Bico, baseMl: number, volumeMl: number, fracMl: number | undefined): number {
    if (!this.quirks.VAZAO_272 || (!fracMl && !b.encerranteFracMl)) return (baseMl + volumeMl) % ENCERRANTE_VOLTA_ML;
    const soma = (b.encerranteFracMl ?? 0) + (fracMl ?? 0);
    const inteiro = Math.floor(soma + 1e-9);
    b.encerranteFracMl = Math.max(0, soma - inteiro);
    return (baseMl + volumeMl + inteiro) % ENCERRANTE_VOLTA_ML;
  }

  private finalizar(b: Bico): void {
    const l = this.ladoDoBico(b);
    const c = b.corrente;
    if (!c && this.quirks.MS_272) {
      // equivalence B10 (verdict #27): the state tick stores with the volume/total left from the
      // last fueling (zero if it never fueled) and adds it again to the totalizer.
      const u = b.ultimo;
      const volumeMl = u?.volumeMl ?? 0;
      const totalMil = u?.totalMil ?? 0;
      const encFim = this.somarEncerrante(b, b.encerranteMl, volumeMl, u?.volumeFracMl);
      const encIniMl = u?.encIniMl ?? b.encerranteMl;
      b.encerranteMl = encFim;
      b.encerranteValorMil = (b.encerranteValorMil + totalMil) % 1_000_000_000;
      this.gravarRegistro(b, {
        encIniMl,
        encFimMl: encFim,
        volumeMl,
        totalMil,
        precoUnit: u?.precoUnit ?? b.precos[0],
        nivelPreco: u?.nivelPreco ?? 0,
        duracaoS: u ? Math.floor((this.clock.now() - u.inicioMs) / 1000) : 0,
        cartao1: null,
        cartao2: null,
      });
    }
    if (c) {
      b.ultimo = {
        encIniMl: c.encIniMl,
        volumeMl: c.volumeMl,
        totalMil: c.totalMil,
        precoUnit: c.precoUnit,
        nivelPreco: c.nivelPreco,
        inicioMs: c.inicioMs,
        ...(c.volumeFracMl !== undefined ? { volumeFracMl: c.volumeFracMl } : {}),
      };
      const encFim = this.somarEncerrante(b, c.encIniMl, c.volumeMl, c.volumeFracMl);
      b.encerranteMl = encFim;
      b.encerranteValorMil = (b.encerranteValorMil + c.totalMil) % 1_000_000_000;
      this.gravarRegistro(b, {
        encIniMl: c.encIniMl,
        encFimMl: encFim,
        volumeMl: c.volumeMl,
        totalMil: c.totalMil,
        precoUnit: c.precoUnit,
        nivelPreco: c.nivelPreco,
        duracaoS: Math.floor((this.clock.now() - c.inicioMs) / 1000),
        cartao1: c.cartao1,
        cartao2: c.cartao2,
      });
      b.ultimosCartoes = { cartao1: c.cartao1, cartao2: c.cartao2 };
    }
    b.corrente = null;
    l.cartao1 = null;
    l.cartao2 = null;
    l.presetCentavos = null;
    l.presetVolumeMl = null;
    b.recolocarNoPreset = false;
    // BICO_272 (equivalence B5): the end clears the pre-authorization of the 4 nozzles of the address.
    if (this.quirks.BICO_272) for (const x of l.bicos) x.preAut = false;
    b.estado = 'repouso';
    // CONCLUINDO_272 (behavioral equivalence + probe-abast 17/10): the record is stored on the 1st tick and the
    // status stays C ("Concluindo..") until the next tick, which sets L/P/B.
    if (!this.quirks.CONCLUINDO_272) b.status = this.statusRepousoBico(b);
  }

  /** Stores a record in the buffer (advances the write pointer and, on the 2.7.2, the identified-records pointer). */
  private gravarRegistro(
    b: Bico,
    c: {
      encIniMl: number;
      encFimMl: number;
      volumeMl: number;
      totalMil: number;
      precoUnit: number;
      nivelPreco: number;
      duracaoS: number;
      cartao1: string | null;
      cartao2: string | null;
    },
  ): void {
    const l = this.ladoDoBico(b);
    if (c.cartao1) this.contadorIdentificacao = (this.contadorIdentificacao % 9999) + 1;
    const numeroIdentificacao = this.contadorIdentificacao;
    const data = this.dataRegistro();
    const { duracaoS, encFimMl: encFim } = c;
    this.buffer.gravar(
      (posicao): Registro => ({
        posicao,
        numero: posicao,
        numeroIdentificacao,
        codigoBico: b.codigo,
        canal: b.canal,
        endereco: b.endereco,
        totalMil: c.totalMil,
        volumeMl: c.volumeMl,
        precoUnit: c.precoUnit,
        virgula: l.virgula,
        nivelPreco: c.nivelPreco,
        duracaoS,
        data,
        encIniMl: c.encIniMl,
        encFimMl: encFim,
        cartao1: c.cartao1,
        cartao2: c.cartao2,
        // C_272 (bench diff r6, DIFF-08 `&LC`): the 2.7.2 has no lane number of its own; the PAF
        // `bb` field is the 1st `&c` field, `00` until a `&c` writes it. The lane number stays for
        // the control API (`{numero}`) and the real profiles.
        numeroPista: this.quirks.C_272 ? (b.campoPista272 ?? 0) : b.numeroPista,
        combustivel: b.combustivel,
        tanque: b.tanque,
        volumeTanque: b.volumeTanque,
        dip3NaGravacao: this.dips[2] === true,
      }),
      (grupo) => this.registrarEvento('BEEP', `Buffer cheio: descartado o mais antigo (${grupo})`),
    );
    if (this.quirks.Q3) {
      this.escritaId++;
      // 2.7.2 bug (behavioral equivalence, D4, verdict #13): at 10000 it sets the write pointer to 1
      // instead of the identified-records pointer value, which goes on 10001, 10002… and the bug does
      // not fire again.
      if (this.escritaId === 10000) this.buffer.definirEscrita(1);
    } else {
      this.escritaId = this.buffer.escrita;
    }
  }

  ladoPorIndice(i: number): Lado | undefined {
    return this.lados[i];
  }

  // ───────────────────────── snapshot ─────────────────────────

  exportarEstado(): EstadoConcentrador {
    return structuredClone({
      versao: 1 as const,
      modelo: this.modelo,
      dips: this.dips,
      automacao: this.automacao,
      redeAC: this.redeAC,
      bateriaCv: this.bateriaCv,
      tickVazaoMs: this.tickVazaoMs,
      quirks: this.quirks,
      travamentoMs: this.travamentoMs,
      rtc: {
        deslocamentoMs: this.rtc.deslocamento,
        congeladoMs: this.rtc.instanteCongelado,
        campos: this.rtc.estadoCampos.campos,
        diaSemanaCampo: this.rtc.estadoCampos.diaSemana,
      },
      lados: this.lados,
      buffer: this.buffer.exportar(),
      escritaId: this.escritaId,
      contadorIdentificacao: this.contadorIdentificacao,
      cartoes: this.cartoes.todos(),
      listaNegra: this.listaNegra,
      idsPendentes: this.idsPendentes.exportar(),
      eventos: this.eventos,
      tipoCbcRetido: this.tipoCbcRetido,
      radioVelocidade: this.radioVelocidade,
      ligadoEmMs: this.ligadoEmMs,
    });
  }

  /**
   * Restores a state. With `manterQuirks` (profile switch) the quirks and the model
   * of the new profile win. Sides outside the profile's channels and records outside
   * the buffer positions are discarded.
   */
  importarEstado(e: EstadoConcentrador, op: { manterQuirks?: boolean } = {}): void {
    const est = structuredClone(e);
    if (!op.manterQuirks) {
      this.quirks = est.quirks;
      this.modelo = est.modelo;
    }
    this.dips = est.dips;
    this.automacao = est.automacao;
    this.redeAC = est.redeAC;
    this.bateriaCv = est.bateriaCv;
    this.setVelocidade(est.tickVazaoMs);
    if (est.radioVelocidade !== undefined) this.radioVelocidade = est.radioVelocidade;
    if (est.ligadoEmMs !== undefined) this.ligadoEmMs = est.ligadoEmMs;
    this.travamentoMs = est.travamentoMs;
    this.rtc.definirDeslocamento(est.rtc.deslocamentoMs, est.rtc.congeladoMs);
    this.rtc.definirCampos(est.rtc.campos ?? null, est.rtc.diaSemanaCampo ?? 0);
    for (const l of est.lados) {
      const alvo = this.lado(l.canal, l.endereco);
      if (alvo) Object.assign(alvo, l);
    }
    // Pointer groups: the new profile may have a single pointer (Q3) or one per port.
    const grupos = { ...est.buffer.grupos };
    const meus = this.buffer.gruposIds();
    const unico = grupos['unico'];
    for (const g of meus) {
      if (grupos[g] === undefined) grupos[g] = unico ?? Math.min(...Object.values(est.buffer.grupos), est.buffer.escrita);
    }
    for (const g of Object.keys(grupos)) if (!meus.includes(g)) delete grupos[g];
    this.buffer.importar({ ...est.buffer, grupos });
    this.escritaId = op.manterQuirks && !this.quirks.Q3 ? this.buffer.escrita : est.escritaId;
    this.contadorIdentificacao = est.contadorIdentificacao;
    this.cartoes.importar(est.cartoes);
    this.listaNegra.length = 0;
    this.listaNegra.push(...est.listaNegra);
    this.idsPendentes.importar(est.idsPendentes);
    this.eventos.length = 0;
    this.eventos.push(...est.eventos);
    this.tipoCbcRetido = est.tipoCbcRetido ?? '0';
  }

  /** Stores an event without going through a command (K21: ON/MEM/OFF/WDT). */
  injetarEvento(tipo: string, texto: string): void {
    this.registrarEvento(tipo, texto);
  }

  /**
   * Power cycle (K21): fuelings in progress are finished and stored,
   * and memory records OFF and ON ("CBC Ligou PWRON"). The buffer survives.
   */
  cicloEnergia(): void {
    for (const b of this.bicosAtivos()) {
      if (b.estado === 'abastecendo') this.encerrar(b);
      if (b.estado === 'recolocado') this.finalizar(b);
      if (b.estado === 'retirado') {
        b.estado = 'repouso';
        b.status = this.statusRepousoBico(b);
      }
    }
    this.registrarEvento('OFF', 'CBC Desligou');
    this.registrarEvento('ON', 'CBC Ligou PWRON');
  }
}
