import type { DataHora } from './datahora.js';

/** Status letter (DT435 §3.8). */
export type LetraStatus = 'L' | 'B' | 'C' | 'A' | 'E' | 'F' | 'P';

/** Physical nozzle state (behavioral equivalence: 4 not configured, 2 at rest, 0 lifted, 1 fueling, 3 hung up). */
export type EstadoFisico = 'naoConfigurado' | 'repouso' | 'retirado' | 'abastecendo' | 'recolocado';

export interface AbastecimentoCorrente {
  encIniMl: number;
  volumeMl: number;
  /** Total in thousandths of a real. */
  totalMil: number;
  precoUnit: number;
  nivelPreco: number;
  inicioMs: number;
  /** Flow ticks already elapsed (n). */
  ticks: number;
  /** Remaining ticks blinking 888888 (Q6). */
  piscando: number;
  /** Paused by &M P (status E with the nozzle fueling). */
  pausado: boolean;
  cartao1: string | null;
  cartao2: string | null;
  /** VAZAO_272: the preset was reached; the volume stays frozen in A until hang-up or &M S. */
  congelado?: boolean;
  /**
   * VAZAO_272: sub-mL part of a volume frozen at preset/price (`volumeMl` holds the whole mL). The
   * 2.7.2 keeps that volume unrounded and adds it to the totalizer as it is (bench diff r7g, §23 B1).
   */
  volumeFracMl?: number;
}

/** MS_272: what the 2.7.2 leaves on the nozzle after storing (volume/total are not zeroed until the next start). */
export interface UltimoAbastecimento {
  encIniMl: number;
  volumeMl: number;
  totalMil: number;
  precoUnit: number;
  nivelPreco: number;
  inicioMs: number;
  /** VAZAO_272: sub-mL part of the volume (see {@link AbastecimentoCorrente.volumeFracMl}). */
  volumeFracMl?: number;
}

export interface Bico {
  codigo: number;
  canal: number;
  endereco: number;
  /** 0..3 */
  posicao: number;
  ativo: boolean;
  estado: EstadoFisico;
  status: LetraStatus;
  /** Current price per level (0..2), integer at the price-decimals scale. */
  precos: [number, number, number];
  /** Pending price per level: applies on the next fueling (behavioral equivalence, DT435 p.25). */
  precosPendentes: [number | null, number | null, number | null];
  /** Totalizer in liters, in mL. Wraps to 0 at 10,000,000.00 L. */
  encerranteMl: number;
  /**
   * VAZAO_272: sub-mL part of the totalizer, in [0, 1). The 2.7.2 sums unrounded preset volumes, so
   * 334 records of R$ 1,00 at 1,123 add 297,417 L, not 334 × 0,890 L (bench diff r7g, §23 B1).
   */
  encerranteFracMl?: number;
  /** Totalizer in value, in thousandths of a real. */
  encerranteValorMil: number;
  corrente: AbastecimentoCorrente | null;
  /** Last stored fueling (for &T I). */
  ultimosCartoes: { cartao1: string | null; cartao2: string | null };
  numeroPista: number;
  /** C_272: the 1st `&c` field, printed as the PAF `bb` (0 until a `&c`; the 2.7.2 has no lane number). */
  campoPista272?: number;
  combustivel: number;
  tanque: number;
  volumeTanque: number;
  /** BICO_272: the nozzle's pre-authorization (per nozzle on the 2.7.2, verdict #68). Cleared only at the end, on the 4 nozzles of the address. */
  preAut?: boolean;
  /** BICO_272: the nozzle's preset by value, in cents (per nozzle on the 2.7.2, verdict #73). */
  presetCentavos?: number | null;
  /** MS_272: volume/total left from the last fueling (&M S on an idle nozzle repeats them). */
  ultimo?: UltimoAbastecimento | null;
  /** Control (`abastecer` with value/volume): the "attendant" hangs up when the preset freezes (VAZAO_272). */
  recolocarNoPreset?: boolean;
  /** BLOQUEIO_272: the nozzle's block flag (per nozzle on the 2.7.2, verdict #24/#29). */
  bloqueio?: boolean;
  /** The `&C` wrote the BB code into the nozzle; 2.7.2 keeps it after n=0 (T_272, verdict #21). */
  codigoGravado?: boolean;
}

export interface Lado {
  canal: number;
  endereco: number;
  /** 4·(channel−1) + (address−1) */
  indice: number;
  configurado: boolean;
  tipoBomba: string;
  virgula: number;
  nBicos: number;
  /** Cb_End0x: address fault/absence → F. */
  falha: boolean;
  sensorIdf: boolean;
  /** Identification mode 01..14 (spec §3.3). */
  modoIdentificacao: number;
  bloqueado: boolean;
  preAutorizado: boolean;
  /** Preset by value, in cents. */
  presetCentavos: number | null;
  /** Preset by volume, in mL (?F P with H = V). Applies only to `bicoAutorizado`. */
  presetVolumeMl: number | null;
  /** Authorization restricted to one nozzle (?F P with preset by volume). null = the whole side. */
  bicoAutorizado: number | null;
  /** ?F P: instant the authorization expires if the nozzle is not lifted (DT432 p.18). */
  autorizacaoExpiraEm: number | null;
  /** Price level of the next fueling. */
  nivelPreco: number;
  /** Cards presented for the next fueling. */
  cartao1: string | null;
  cartao2: string | null;
  /**
   * C_272: what &C stored in the 2.7.2 configuration grid, raw (Tipo, C.V., Bicos).
   * &R lists one row per address with a grid, including with 0 nozzles (verdict #36).
   */
  gradeC?: { tipo: string; cv: string; bicos: string } | null;
  bicos: Bico[];
}

export interface Registro {
  /** Buffer position (= R). */
  posicao: number;
  numero: number;
  /** Identification read number (&A67 M4) on the real profile. */
  numeroIdentificacao: number;
  codigoBico: number;
  canal: number;
  endereco: number;
  totalMil: number;
  volumeMl: number;
  precoUnit: number;
  virgula: number;
  nivelPreco: number;
  duracaoS: number;
  data: DataHora;
  encIniMl: number;
  encFimMl: number;
  cartao1: string | null;
  cartao2: string | null;
  numeroPista: number;
  combustivel: number;
  tanque: number;
  volumeTanque: number;
  /**
   * DIP3 when the record was stored. With A36 the `&A` layout (52 × 36) is fixed at write time
   * (verdict #12, bench diff r4b DIFF-07: a record stored with DIP3 on still reads as 52 after
   * DIP3 goes off). Optional: records from older snapshots fall back to the current DIP3.
   */
  dip3NaGravacao?: boolean;
}

export interface Cartao {
  codigo: string; // 16 uppercase hex
  /** M99_272: Lista-Negra column of the 2.7.2 registry (`sim`/`nao`), stored by &M99. */
  listaNegra?: boolean;
  /** CC control byte: permission (high nibble) << 4 | type (low nibble). */
  controle: number;
  turnoA: { inicio: string; fim: string } | null; // hhmm
  turnoB: { inicio: string; fim: string } | null;
}

export interface Evento {
  t: number;
  tipo: string;
  texto: string;
}

export const CARTAO_VAZIO = '0000000000000000';
/** 10,000,000.00 L in mL: the totalizer wraps to zero here (behavioral equivalence). */
export const ENCERRANTE_VOLTA_ML = 10_000_000 * 1000;
