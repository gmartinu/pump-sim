/**
 * A profile is DATA: each difference between SimuladorCBC 2.7.2 and the real consoles
 * (or between consoles) is a field here, never an `if (perfil === …)` scattered around.
 * The 2.7.2 bugs/quirks are `quirks`, on by default only in `simulador-2.7.2`.
 */

export type PerfilId =
  | 'simulador-2.7.2'
  | 'cbc-32'
  | 'cbc05-dip3'
  | 'cbc01'
  | 'horustech-cbc-36'
  | 'horustech-48'
  | 'concept-48';

/** `(&…)` verbs (spec §2.2). A verb outside `Perfil.verbos` = silence. */
export type VerboCompanytec =
  | 'A' // (&A)
  | 'A67' // (&AKK) identified
  | '@66' // (&@KK) double identification
  | 'A2' // PAF1
  | 'A3' // PAF2
  | 'A4' // extended TWC/MQTT
  | 'LC'
  | 'LR'
  | 'LE' // events (2.7.2, layout not recovered)
  | 'T99P'
  | 'T99N'
  | 'I'
  | 'V'
  | 'S'
  | 'T$'
  | 'TL'
  | 'Tl'
  | 'TN'
  | 'TU'
  | 'Tu'
  | 'TP'
  | 'TC'
  | 'TI'
  | 'U4'
  | 'U6'
  | 'P'
  | 'M'
  | 'M99'
  | 'R'
  | 'KR1'
  | 'H'
  | 'KW1'
  | 'F'
  | 'E'
  | 'C'
  | 'c';

/**
 * 2.7.2 quirks. Q1–Q8 are those of spec §2.5. The others are the simulator × manual
 * divergences from behavioral equivalence, which the decision treats as profile options.
 */
export type QuirkId =
  | 'Q1' // each socket read = one command (2 frames → only the 1st); without `)`, the verbs without KK (&I &S &R &KW &V &H &E) are served by prefix
  | 'Q2' // modal MessageBox becomes a configurable freeze
  | 'Q3' // single pointer for all ports + separate pointer of the identified records (with the 10000 bug)
  | 'Q4' // full buffer drops the oldest, pushing the read pointer
  | 'Q5' // record date/time = PC clock, not the simulated one
  | 'Q6' // truncation (no rounding), flow 0.13/0.129 L per tick, 7 ticks of 888888
  | 'Q7' // DIP4 + Automação "Ligado" = simulation gate
  | 'Q8' // simcnf.ini at a fixed path, buffer not persisted (no-op here: nothing is persisted)
  | 'A36' // &A with DIP3 off = 36 chars (ddhhmmMM) instead of 34
  | 'TG' // &T: default reply (TG BB write−1 read−1) for T99P, N, P, I, unknown nozzle/mode
  | 'ERROS_272' // only ?t/?f: nonexistent nozzle → ?t, invalid mode → silence
  | 'L_VAZIO_SILENCIO' // &LR/&LC at an empty position → silence (manual: FFFF…)
  | 'R_EXTRAS' // &R followed by (DHA …)(SOFT MONITOR …)(M …)×5(C0…)
  | 'PAF_G9' // PAF1/PAF2 with G99999999 instead of $+serial; PAF2 ends in 0000
  | 'A67_M_IGUAL_R' // &A67: "identification read number" repeats R
  | 'V_INCLUI_E' // &V includes nozzles in status E (besides A)
  | 'BUFFER_1000' // 999-position buffer (1..999), wraps to 1 at 1000
  | 'IDF_CC_BYTE' // modes 01–14 not simulated; card validated by the whole CC byte
  | 'CARTAO_VAZIO_ZEROS' // missing card comes out as 0000000000000000 (manual: FFFFFFFFFFFFFFFF)
  | 'LIBERACAO_IMEDIATA' // &M A on a nozzle in E starts fueling at once (without going through P)
  | 'IDF_272' // 2.7.2 Identfid: ?V with KK and only card 1, ?F len≠41 freezes, ?A per cell, unconditional ?I
  | 'HORUSTECH_272' // 2.7.2 >?: matches by chars 7-8 without validating KK/length, col10 layout, literal ack of 32
  | 'NIVEIS_PRECO_ZERO' // default config: price levels 1 and 2 start at 0000 (only level 0 has nozzle number + 0.12)
  | 'RTC_272' // 7-field RTC (clock timer: equality every second, 31-day month, 13 → January); &KW without KK and &H/&KW without range
  | 'CONCLUINDO_272' // status C lasts one more state tick after storing the record ("Concluindo..")
  | 'T_272' // &T without length test (only KK; mode = 6th char), Ts with the nozzle index (1–4), TU with FloatToStr and trailing zeros
  | 'L_272' // &LR/&LC without length test and position by StrToInt ($hex, spaces); &LE by the 7th char in hex
  | 'P_272' // &P without length test; pre-authorizes the nozzle and sets P; refuses only with its own nozzle in A
  | 'M99_272' // &M99 = Lista-Negra column of the card registry; free BB; (M?f) = card not registered
  | 'U_272' // &U: price in the 4 digits (cmd[9..12] in the 16-char one), level 1/2 into 0 with comma 2x, reply after the modal OK
  | 'C_272' // 2.7.2 &C/&c: no length, resets the nozzles, does not deactivate above n, n=0 zeroes totalizers, raw grid in &R
  | 'E_272' // &E: ((TL…KK), totalizer in whole liters, creates a record, replies without a nozzle
  | 'BICO_272' // pre-authorization and preset per nozzle, cleared at the end; no side-busy lock; no authorization deadline
  | 'VAZAO_272' // the flow timer without gate (Automação/DIP4) and by status A: &M B freezes; reached preset freezes without finishing; 0.13 L/tick with preset
  | 'MS_272' // &M S only on the nozzle, in any state; idle → ghost record repeating the last one
  | 'DESPACHO_272' // parser only tests `&` at char 2; `?` branch (CBC-06: char 2 is `?`; Horustech model: any frame) sends 02/06/32 at chars 7-8 to Horustech before ?F/?C/?LF
  | 'BLOQUEIO_272' // per-nozzle block: &M B sets it, &M L clears it, &M A on a nozzle in E clears it, &M H/I only touch the sensor (the block goes up at start), ?C sets sensor and block
  | 'MODELO_272' // Model combo on CBC-02 does not write &S char 39 (the previous digit stays)
  | 'PADRAO_272'; // "Carregar configuração padrão" resets the write and read pointers to the 1st position (identified-records pointer untouched)

/** Identfid `(?…)` verbs (spec §2.3). `S`/`D`/`C` only exist on the 2.7.2 (outside DT435). */
export type VerboIdentfid = 'V' | 'A' | 'FG' | 'FA' | 'FL' | 'FP' | 'I' | 'LF' | 'S' | 'D' | 'C';

/** v1 native Horustech functions: only the ones the 2.7.2 handles (spec §2.4). */
export type FuncaoHorustech = '02' | '06' | '32';

export type Quirks = Record<QuirkId, boolean>;

export const TODOS_QUIRKS: readonly QuirkId[] = [
  'Q1',
  'Q2',
  'Q3',
  'Q4',
  'Q5',
  'Q6',
  'Q7',
  'Q8',
  'A36',
  'TG',
  'ERROS_272',
  'L_VAZIO_SILENCIO',
  'R_EXTRAS',
  'PAF_G9',
  'A67_M_IGUAL_R',
  'V_INCLUI_E',
  'BUFFER_1000',
  'IDF_CC_BYTE',
  'CARTAO_VAZIO_ZEROS',
  'LIBERACAO_IMEDIATA',
  'IDF_272',
  'HORUSTECH_272',
  'NIVEIS_PRECO_ZERO',
  'RTC_272',
  'CONCLUINDO_272',
  'T_272',
  'L_272',
  'P_272',
  'M99_272',
  'U_272',
  'C_272',
  'E_272',
  'BICO_272',
  'VAZAO_272',
  'MS_272',
  'DESPACHO_272',
  'BLOQUEIO_272',
  'MODELO_272',
  'PADRAO_272',
];

export function quirksDesligados(): Quirks {
  return Object.fromEntries(TODOS_QUIRKS.map((q) => [q, false])) as Quirks;
}

export function quirksLigados(): Quirks {
  return Object.fromEntries(TODOS_QUIRKS.map((q) => [q, true])) as Quirks;
}

/** 2.7.2 "Modelo" combo; fixed on real profiles. */
export type Modelo = 'CBC-01' | 'CBC-02' | 'CBC-04' | 'CBC-05' | 'CBC-06' | 'Horustech' | 'Concept';

export type FormatoStatus =
  | 'cbc32' // S + X32 + FF + DD + C + V4 + M4 + P + T2
  | 'cbc36' // S + X36 + C + V4 + M4 + P + T2 (Horustech in CBC protocol)
  | 'h48'; // S + X48, no trailer (Horustech/Concept in Companytec protocol)

export type PortaTipo = 'tcp' | 'serial';

export interface PortaDef {
  tipo: PortaTipo;
  /** TCP port (2001, 1771, 857, 7002) or serial name ("COM1", "/dev/ttyS0"). */
  porta: number | string;
}

export function portaId(p: PortaDef): string {
  return p.tipo === 'tcp' ? `tcp:${p.porta}` : `serial:${p.porta}`;
}

export interface Perfil {
  id: PerfilId;
  nome: string;
  descricao: string;
  /** Initial model (on the 2.7.2 the combo can change it; fixed on the real ones). */
  modelo: Modelo;
  /** Firmware in the &S trailer and for the fw>2.3/5.3/6.7/8.0 gates (K7). E.g. "V3.7". */
  firmware: string;
  monitor: string;
  /** 8-digit serial number (&T N, PAF). */
  numeroSerie: string;
  /** Permission in &T N: G = gas, C = fuel. */
  permissaoSerie: 'G' | 'C';
  canais: number;
  status: {
    formato: FormatoStatus;
    /** Char 39 of &S (CBC type). Fixed on real profiles; on the 2.7.2 it comes from the model. */
    tipoCbc: string;
    /** DD field of &S (DIP state "in virtual mode"). Fixed — see K6. */
    dips: string;
  };
  verbos: ReadonlySet<VerboCompanytec>;
  /**
   * Firmware gates (K7): the verb only answers if `versaoFirmware(firmware)` is
   * GREATER than the limit. The 2.7.2 has no gates (answers &A39A with V3.7).
   */
  gatesFirmware: Readonly<Partial<Record<VerboCompanytec, number>>>;
  /** (&A) layout: 'dip3' = 52 with DIP3 on, 34 (or 36 with quirk A36) off. */
  formatoA: 'dip3' | 52 | 34;
  dip3Padrao: boolean;
  leituraRegistro: {
    /** &LR: 74 (CBC04/05/06) or 82 (Horustech). */
    lr: 74 | 82;
    /** &LC: 'cbc' (90-char CBC06 example) or 'paf1' (a2…, Horustech). */
    lc: 'cbc' | 'paf1';
    /**
     * 2.7.2: the &LR/&LC layout comes from the Modelo combo (CBC-06 → col8/col6,
     * Horustech → col7/col6, others → col3 = &A layout).
     */
    porModelo?: boolean;
  };
  /** &U success ack: `(UBB)` per the DT435 examples and the bench (V2). */
  ackPreco: 'U' | 'M';
  buffer: {
    /** Valid positions of the circular buffer (inclusive). */
    posMin: number;
    posMax: number;
  };
  /** Event memory capacity (K10). */
  capacidadeEventos: number;
  /** Identifier registry capacity (K10). */
  capacidadeCartoes: number;
  portas: readonly PortaDef[];
  /**
   * TCP listening. 'simultanea' (real ones): all TCP ports in `portas` at the same time,
   * each with its own pointer. 'umaPorVez' (2.7.2): a single TServerSocket, port
   * chosen among `opcoesPortaTcp` (radio 2001/1771/7002).
   */
  escutaTcp: 'simultanea' | 'umaPorVez';
  opcoesPortaTcp: readonly number[];
  /** Identfid `(?…)`: null = the console does not speak it (silence). */
  identfid: {
    verbos: ReadonlySet<VerboIdentfid>;
    /** 2.7.2: only with the Modelo combo on one of these. Absent = always. */
    modelos?: readonly Modelo[];
  } | null;
  /** Queue of unregistered identifiers (?A): valid positions. */
  idsPendentes: { posMin: number; posMax: number };
  /** Native Horustech `>?` (only 02/06/32 in v1). null = silence. */
  horustech: {
    funcoes: ReadonlySet<FuncaoHorustech>;
    modelos?: readonly Modelo[];
    /** Price levels accepted by 32. */
    niveisPreco: readonly string[];
  } | null;
  /** State machine tick (1 s state timer). */
  tickEstadoMs: number;
  /** Flow tick (100 ms flow timer). */
  tickVazaoMs: number;
  /** Liters per flow tick, in mL, for volume with 2 and with 3 decimals. */
  vazaoMlPorTick: { casas2: number; casas3: number };
  /** Ticks blinking 888888 before the flow starts. */
  ticksPiscando: number;
  /** Battery varies per tick (2.7.2) or stays fixed at 12.0 V. */
  bateriaDinamica: boolean;
  /** With the IDF sensor on, the side at rest is B (DT432 p.9: L→B via Identfid). */
  repousoComSensorBloqueado: boolean;
  quirks: Quirks;
}
