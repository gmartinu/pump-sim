import { codigoBico, hex2 } from '../core/codigo-bico.js';
import { comKK } from '../protocols/companytec/checksum.js';
import { type PassoAcao, abastecerBico, acao, recolocarBico, retirarBico } from './acoes.js';

/**
 * Differential test script (spec §6, DIFF-01..20 and DIFF-30) as data.
 *
 * Each case assumes a freshly opened target, model CBC-06 and "Carregar configuração
 * padrão" (8 channels × addresses 1–2 × 2 nozzles: 04/44, 05/45, 08/48…). The steps:
 *
 * - `enviar`: raw frame(s). A list = writes separated by `intervaloMs`
 *   (fragmentation). The reply is everything that arrives until `timeoutMs` of silence.
 *   `conexao` names the connection (default "principal"); `porta` switches the target's port.
 *   `esperado` (optional) = bytes known from the bench (null = silence).
 * - `aguardar`: ms.
 * - `acao`: a click on the 2.7.2 UI (`acoes.ts`). On a target with a driver it becomes
 *   `POST /acao`; on a target with the pump-sim control API it becomes the equivalent
 *   commands; with neither, it asks the operator or is skipped.
 * - `manual`: what the driver does not cover (IDF/card through the UI, pump-sim-only commands).
 *   Against the pump-sim control API it runs `controle`; against the driver it does
 *   nothing if `soPumpSim`, otherwise asks the operator or is skipped (with `semDriver`).
 * - `drenar`: `(&A)`/`(&I)` until `(0)`, to start with no records from earlier rounds.
 *
 * Cases marked `comparacao: 'informativo'` measure time and do not compare bytes.
 */

export interface PassoEnviar {
  enviar: string | string[];
  intervaloMs?: number;
  timeoutMs?: number;
  conexao?: string;
  porta?: number;
  esperado?: string | null;
  /**
   * Ignores the N chars before the final `)` in the comparison (e.g. 2 = the battery
   * T byte in the &S trailer, which on the 2.7.2 changes every tick).
   */
  ignorarFim?: number;
  /**
   * `[início, fim)` char ranges of the reply ignored in the comparison. Only for fields the
   * clock writes (record duration and hh:mm, `&R`/`&KR1` time, and the KK that covers them):
   * they depend on when each target ran the step, not on behavior (§18).
   */
  mascara?: readonly (readonly [number, number])[];
  /**
   * The reply ends as soon as its last byte is this char (e.g. `)`), instead of after the idle
   * silence (`ociosoMs`, 150 ms by default). For the long protocol-only loops (DIFF-17R/13R).
   */
  terminaEm?: string;
  /**
   * Labels (`rotulo`) of earlier `manual`/`acao` steps this reply depends on. When one of them was
   * skipped on either target (no driver for it), the step is reported as skipped, not compared:
   * its difference would only restate the skip (bench diff r7g, §23).
   */
  dependeDe?: readonly string[];
  /**
   * The reply is expected to be silence: the bench recorded none (oracle `a: null`). The executor
   * then waits only `OpcoesDiff.timeoutSilencioMs` (400 ms by default) instead of `timeoutMs`,
   * unless the step sets `timeoutMs` or a `fechar_modais` follows it (a reply after a modal can take
   * ~0,4–0,8 s on the bench). `esperado: null` counts the same. A listening hint only: what is sent
   * and compared does not change, so it stays out of the script hash (`hash.ts`), and
   * `test/diff-tempo.test.ts` checks every flagged step against the recorded oracle.
   */
  silencio?: boolean;
  nota?: string;
}
export interface PassoAguardar {
  aguardar: number;
}
export interface PassoManual {
  manual: string;
  controle?: { comando: string; args?: Record<string, unknown> }[];
  /** Only adjusts pump-sim (e.g. hold the modal until OK); against the driver it does nothing. */
  soPumpSim?: boolean;
  /** Why the driver does not cover the step (shown in the report when it is skipped). */
  semDriver?: string;
  /** Label that `PassoEnviar.dependeDe` refers to. */
  rotulo?: string;
}
/** Reads and discards the records (`(&A)` + `(&I)` until `(0)`) on its own connection. */
export interface PassoDrenar {
  drenar: true;
  /** Record cap (default 10010). */
  max?: number;
  /** Wait after each `(&I)`, which has no reply (default `INTERVALO_DRENAR_MS` in `executor.ts`). */
  timeoutMs?: number;
  porta?: number;
}
/** Closes the named connection: `fin` (normal close) or `rst` (abrupt drop). */
export interface PassoDesconectar {
  desconectar: 'fin' | 'rst';
  conexao?: string;
  porta?: number;
}
export type Passo = PassoEnviar | PassoAguardar | PassoManual | PassoDesconectar | PassoAcao | PassoDrenar;

export interface CasoDiff {
  id: string;
  titulo: string;
  resolve: string;
  comparacao?: 'bytes' | 'informativo';
  /**
   * Opt-in case: left out of `todos` (and of a plain run), only runs when named in `--casos`
   * (or with `OpcoesRoteiro.incluirOpcionais`). The text says why.
   */
  opcional?: string;
  passos: Passo[];
}

const k = comKK;
const e = (q: string | string[], extra: Omit<PassoEnviar, 'enviar'> = {}): PassoEnviar => ({ enviar: q, ...extra });
const ctl = (comando: string, args: Record<string, unknown> = {}) => ({ comando, args });
const cartao = (n: number) => n.toString(16).toUpperCase().padStart(16, '0');

const drenar: PassoDrenar = { drenar: true };

/**
 * Short fueling on nozzle `bb` through the screen (channel, radio, lift, flow `ms`, hang up).
 * The final `aguardar` covers "Concluindo.." (C until the 2nd state tick, CONCLUINDO_272).
 *
 * By default it first sets a R$ 1,00 preset (`&P`), so the record is the same on both targets:
 * with VAZAO_272 the flow freezes at preset/price and the hang-up stores exactly that (bench diff
 * r4b, §18: a free 3 s fueling gave 1,17 L on the 2.7.2 and 0,91 L on pump-sim, only because the
 * flow starts at a different moment of each target's state timer). `presetCentavos: null` = free flow.
 */
function abastecimento(bb: string, op: { ms?: number; presetCentavos?: number | null } = {}): Passo[] {
  const preset = op.presetCentavos === undefined ? 100 : op.presetCentavos;
  const ms = op.ms ?? (preset === null ? 3000 : 5000);
  const p = preset === null ? [] : [e(k(`&P${bb}${String(preset).padStart(6, '0')}`), { nota: `preset de R$ ${(preset / 100).toFixed(2)} (registro igual nos dois alvos)` })];
  return [...p, ...retirarBico(bb), vazao(ms), ...recolocarBico(bb), concluindo()];
}

/**
 * Totalizers of `bicos` back to 0 with the 2.7.2 `&E` (E_272, whole liters; replies `((TL…`),
 * then a drain of the zero-volume records it stores. The totalizers carry every earlier round
 * (bench diff r4b: `(TL08…1924…)` × `(TL08…1326…)`), so a case that reads them starts here.
 */
function zerarEncerrantes(...bicos: string[]): Passo[] {
  return [...bicos.map((bb) => e(`(&E${bb}00000000)`, { nota: `normaliza o encerrante do ${bb}` })), drenar];
}

/**
 * Clock fields of a record reply whose T6 starts at char `1 + d` (0 for `&A`/`&LR`, 1 for the
 * `A`/`@` of `&A67`/`&@66`, 11 for the `a2G99999999` of PAF1/`&LC`): the duration C4, the hh:mm
 * of DHMN and the KK that covers them. Values the clock writes, not behavior (§18).
 */
const relogioRegistro = (d = 0): Omit<PassoEnviar, 'enviar'> => ({
  mascara: [
    [19 + d, 23 + d],
    [27 + d, 31 + d],
  ],
  ignorarFim: 2,
});
/** PAF2 (`&A39A`, `a3G99999999`): C4 and the hh:mm:ss of YYMMDDhhmmss, plus the KK. */
const relogioPaf2: Omit<PassoEnviar, 'enviar'> = {
  mascara: [
    [30, 34],
    [42, 48],
  ],
  ignorarFim: 2,
};
/**
 * Horustech `02` in the 2.7.2 col10 layout (`>!006B` + 107 + KK): the hex duration C4, the hh:mm of
 * the date and the final KK (no `)` to anchor `ignorarFim`). Values the clock writes (§18).
 */
const relogioHorustech02: Omit<PassoEnviar, 'enviar'> = {
  mascara: [
    [39, 43],
    [49, 53],
    [113, 115],
  ],
};
/** `(REL hh:mm:ss dd/mm/yy)…` of `&R`: the time (the date is set by `acertarRelogio`). */
const RELOGIO_R: readonly (readonly [number, number])[] = [[5, 13]];
/**
 * `(KR1yymmddwwhhmmssKK)` of `&KR1`: the units digit of the seconds and the KK that covers it. Only on
 * reads that come after the 2.7.2's clock timer may have ticked: its phase is free (set when the app
 * starts, not restarted by `&KW`), so the 1st tick after a write comes 0–1000 ms later and a fixed wait
 * reads N or N+1 seconds (§27). The tens digit and the date stay compared.
 */
const SEGUNDO_KR1: readonly (readonly [number, number])[] = [[17, 20]];
/** RTC to a known valid date (16/10/26, friday, 14:30:00) before a case reads `&R`/`&KR1`. */
const acertarRelogio = (): PassoEnviar => e(k('&KW126101606143000'), { nota: 'acerta o relógio (estado de rodadas anteriores)' });
const configPadrao = acao('config_padrao');
const fecharMessageBox = acao('fechar_modais');
const modelo = (valor: string) => acao('modelo', { valor });
const dip = (n: number, ligado: boolean) => acao('dip', { n, ligado });
/** IDF/card panel: no HWND in the 2.7.2 UI (driver contract, "fora do contrato"). */
const SEM_IDF = 'IDF/cartão pela UI do 2.7.2: sem controle com HWND, fora do driver';
/** Two nozzles of the same address at the same time: the UI has one button per panel (the radio picks the nozzle). */
const UM_BOTAO_POR_LADO = 'a UI do 2.7.2 tem um botão por painel: não retira 04 e 44 juntos';

/**
 * 2.7.2 state timer (1 s): status letters, "Concluindo..", the panel captions, the start of a
 * fueling and the store of `&M S` ghost records all move on its tick (a bit later with I3).
 */
export const TICK_ESTADO_MS = 1000;
/** 2.7.2 clock timer (1 s, free-running phase, RTC_272): `&KW` dates roll over on its tick. */
export const TICK_RELOGIO_MS = 1000;
/** Margin over the ticks waited for, for the drift of the 2.7.2 timers. */
export const MARGEM_TICK_MS = 500;
/**
 * 2.7.2 flow timer as the scripts wait for it (100 ms asked; 100 ms under Wine, 109.375 ms on Windows,
 * §29: the `simulador-2.7.2` profile ticks at 109.375; the waits keep 100 so the script hashes and the
 * recorded oracle stay valid). After `&P` and after `&M B` on a
 * fueling nozzle the 2.7.2 shows the new `&S` letter only on a later tick of a ~100 ms timer with a
 * free phase (measured under Wine: 4–107 ms after the frame; `&M S` → C is at once), §28.
 */
export const TICK_VAZAO_MS = 100;
/** Wait until the `&S` letter set by `&P` / `&M B` is visible on the 2.7.2 (§28 L1). */
const letraAssentada = (): PassoAguardar => ticks(2, TICK_VAZAO_MS, 100);

/** Wait for `n` ticks of a timer (`tickMs`) plus `margemMs`. */
const ticks = (n: number, tickMs: number, margemMs = 0): PassoAguardar => ({ aguardar: n * tickMs + margemMs });
/** "Concluindo.." after a hang-up: C until the 2nd state tick (CONCLUINDO_272). */
const concluindo = (): PassoAguardar => ticks(2, TICK_ESTADO_MS, MARGEM_TICK_MS);
/**
 * Flow: the nozzle stays out while the flow timer runs, until the preset freezes the volume (or for
 * a fixed free-flow sample). The time covers the start (state tick + the blinks) and the flow
 * ticks to the preset with a margin, as calibrated on the bench; it is kept in ms because it is not
 * a whole number of ticks of any one timer, and changing it would make the recorded oracle stale.
 */
const vazao = (ms: number): PassoAguardar => ({ aguardar: ms });

/** How many fuelings DIFF-17 does by default (the spec case: 1001, one more than the 2.7.2 memory). */
export const DIFF17_N_PADRAO = 1001;

/**
 * DIFF-17: N fuelings without `&I`, in Rápido, through the screen (the 2.7.2 has no button to
 * generate fuelings). 3 s with the nozzle out: the start waits for the state tick (≤ 1 s) and the
 * 7 blinks (~0.8 s), and with 1–2 s the record may come out with zero volume. Each cycle takes
 * ~6–7 s; N = 1001 ≈ 2 h.
 */
export function diff17(n = DIFF17_N_PADRAO): CasoDiff {
  if (!Number.isInteger(n) || n < 1) throw new Error(`DIFF-17: N inválido: ${n}`);
  return {
    id: 'DIFF-17',
    titulo: `${n} abastecimentos sem &I`,
    resolve: 'Descarte e beep (Q4); volta em 1000',
    opcional: `~2 h na bancada (${n} abastecimentos pela tela, ~6–7 s cada); DIFF-17R cobre o mesmo em minutos`,
    passos: [
      drenar,
      acao('velocidade', { valor: 'Rapido' }),
      ...abastecerBico('04', 3).slice(0, 2),
      ...Array.from({ length: n }, (): Passo[] => [acao('abastecer', { lado: 'esquerdo', segundos: 3 }), concluindo()]).flat(),
      acao('velocidade', { valor: 'Normal' }),
      e('(&T99P3C)'),
      e('(&A)'),
    ],
  };
}

/**
 * Wait after each round of `&M S` (verdict #27, MS_272): the 2.7.2 only sets C at once and the next
 * state tick (1 s, a bit more with I3) stores the ghost record. A second `&M S` on the same nozzle
 * before that tick finds it already in C and stores nothing, so each round addresses each nozzle once
 * and waits a whole tick plus margin. The state timer stores every nozzle in C on the same tick.
 */
export const TICK_FANTASMA_MS = TICK_ESTADO_MS + MARGEM_TICK_MS;

/** `&M bb S` on a stopped nozzle: C at once, ghost record on the next state tick (verdict #27). */
const fantasma = (bb: string, nota?: string): PassoEnviar =>
  e(k(`&M${bb}S`), { esperado: `(M${bb})`, terminaEm: ')', ...(nota ? { nota } : {}) });

/**
 * `n` ghost records over `bicos`: rounds of one `&M S` per nozzle (each waits for its reply), then
 * one state tick ({@link TICK_FANTASMA_MS}). The last round only addresses the nozzles still needed.
 */
export function fantasmas(n: number, bicos: readonly string[], nota?: string): Passo[] {
  if (!Number.isInteger(n) || n < 0) throw new Error(`fantasmas: N inválido: ${n}`);
  if (bicos.length === 0) throw new Error('fantasmas: sem bicos');
  const out: Passo[] = [];
  for (let feitos = 0; feitos < n; feitos += bicos.length) {
    const rodada = bicos.slice(0, Math.min(bicos.length, n - feitos));
    out.push(...rodada.map((bb, i) => fantasma(bb, feitos === 0 && i === 0 ? nota : undefined)), { aguardar: TICK_FANTASMA_MS });
  }
  return out;
}

/** Records DIFF-17R writes in all (the spec case: one more than the 2.7.2 memory, as DIFF-17). */
export const DIFF17R_TOTAL = 1001;
/** Nozzles DIFF-17R fuels for real (one each, before and after the ghosts) and repeats in the ghosts. */
export const DIFF17R_BICOS = ['04', '44', '05'] as const;

/**
 * DIFF-17R: DIFF-17's buffer wrap in minutes. Three real R$ 1,00 fuelings (04, 44, 05, through the
 * screen) give each nozzle a known last fueling; `&M S` ghosts repeating them (verdict #27) fill the
 * buffer, then three more real fuelings cross the wrap. Total = {@link DIFF17R_TOTAL} records, so on
 * the 2.7.2 (999 cells, BUFFER_1000 + Q4) the write pointer wraps and pushes the read pointer.
 * The totalizers are zeroed and "Carregar configuração padrão" puts the pointers at 1 first, so the
 * positions and the contents are the same on both targets. It ends with that button again: pointers
 * back at 1, so the next case does not drain ~1000 records.
 */
export function diff17r(): CasoDiff {
  const reais = DIFF17R_BICOS.length * 2;
  const n = DIFF17R_TOTAL - reais;
  return {
    id: 'DIFF-17R',
    titulo: `Buffer cheio em minutos: ${DIFF17R_BICOS.length} + ${n} &M S + ${DIFF17R_BICOS.length} abastecimentos sem &I`,
    resolve: 'Descarte e beep (Q4); volta em 1000 (DIFF-17 sem as 2 h)',
    passos: [
      drenar,
      ...zerarEncerrantes(...DIFF17R_BICOS),
      configPadrao,
      e('(&T99P3C)', { nota: 'ponteiros em 1 depois do botão' }),
      ...DIFF17R_BICOS.flatMap((bb) => abastecimento(bb)),
      ...fantasmas(n, DIFF17R_BICOS, `#27: ${n} registros fantasma (rodadas de ${DIFF17R_BICOS.length}, um tick cada)`),
      ...DIFF17R_BICOS.flatMap((bb) => abastecimento(bb)),
      e('(&T99P3C)', { nota: 'depois da volta: escrita 3, leitura empurrada para 4 (Q4); o 2.7.2 responde TG (escrita − 1, leitura − 1)' }),
      e(k('&LR0999'), { ...relogioRegistro(), nota: 'última célula: o 1º real do 2º lote' }),
      e(k('&LR0001'), { ...relogioRegistro(), nota: 'a volta: o 2º real do 2º lote sobrescreveu a linha 1' }),
      e(k('&LR0002'), { ...relogioRegistro(), nota: 'o 3º real do 2º lote (registro 1001)' }),
      e(k('&LR0003'), { ...relogioRegistro(), nota: 'o 3º real do 1º lote, já descartado da leitura' }),
      e('(&A)', { ...relogioRegistro(), nota: 'o mais antigo que sobrou: o 1º fantasma' }),
      e(k('&I'), { esperado: null }),
      e('(&A)', relogioRegistro()),
      e('(&T99P3C)'),
      e('>?00020667', { nota: 'Horustech 06: avança a leitura e devolve os ponteiros' }),
      configPadrao,
    ],
  };
}

/** Records needed for the 2.7.2 identified-records counter (1 on a freshly opened target) to reach 10000. */
export const DIFF13R_ATE_O_BUG = 9999;

/** The 32 nozzles of "Carregar configuração padrão": channels 1–8 × addresses 1–2 × positions 0–1. */
const BICOS_PADRAO: readonly string[] = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((c) => [1, 2].flatMap((a) => [0, 1].map((p) => hex2(codigoBico(c, a, p)))));

/**
 * DIFF-13R (verdict #13, Q3): at identified-records pointer = 10000 the 2.7.2 sets the write pointer to 1, not to that value.
 * That pointer counts every record since the target opened and nothing resets it (not `&I`, not the
 * button), so the case needs both targets FRESHLY OPENED and run alone: 9998 ghosts, the
 * pointers, the 9999th ghost (identified-records pointer = 10000), the pointers, one more ghost and the pointers again.
 * Ghosts of nozzles that never fueled (zero records) on the 32 default nozzles, 32 per state
 * tick; only pointers are compared. Long but protocol-only: the only screen action is the
 * "Carregar configuração padrão" button at the start and at the end.
 */
export function diff13r(): CasoDiff {
  return {
    id: 'DIFF-13R',
    titulo: `ponteiro de identificados em 10000: ${DIFF13R_ATE_O_BUG + 1} &M S (registros fantasma)`,
    resolve: '#13 (Q3): a escrita vai para 1, não para 0',
    opcional: `longo mas só protocolo (~${DIFF13R_ATE_O_BUG + 1} quadros &M S, ~${Math.ceil((DIFF13R_ATE_O_BUG + 1) / BICOS_PADRAO.length)} ticks); exige os dois alvos recém-abertos e rodar sozinho`,
    passos: [
      drenar,
      configPadrao,
      e('(&T99P3C)', { nota: 'ponteiros em 1 (alvo recém-aberto: ponteiro de identificados = 1)' }),
      ...fantasmas(DIFF13R_ATE_O_BUG - 1, BICOS_PADRAO, `${DIFF13R_ATE_O_BUG - 1} fantasmas, ${BICOS_PADRAO.length} por tick`),
      e('(&T99P3C)', { nota: `${DIFF13R_ATE_O_BUG - 1} registros: escrita ainda na volta normal` }),
      ...fantasmas(1, ['04'], `registro ${DIFF13R_ATE_O_BUG}: ponteiro de identificados = 10000`),
      e('(&T99P3C)', { nota: '#13: a escrita foi para 1 (não 0, nem a próxima da volta)' }),
      ...fantasmas(1, ['04'], 'ponteiro de identificados = 10001: o bug não dispara de novo'),
      e('(&T99P3C)', { nota: '#13: escrita 2' }),
      e('>?00020667', { nota: 'Horustech 06: avança a leitura e devolve os ponteiros' }),
      configPadrao,
    ],
  };
}

export const ROTEIROS: readonly CasoDiff[] = [
  {
    id: 'BANCADA-1710',
    titulo: 'Bancada Windows 17/10 (2.7.2 real, estado recém-aberto)',
    // First in the list: it assumes freshly opened targets (no drenar), so a full run must start
    // with it (bench diff r4b ran it after DIFF-20 and every totalizer/pointer differed, §18).
    resolve: 'V1–V4 e KK errado',
    passos: [
      e('(&S)', { esperado: '(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFFFFDD6V3.7M1.0G81)', ignorarFim: 2, nota: 'T da bateria varia' }),
      e('(&U040058991E)', { esperado: '(U04)' }),
      e('(&T01l47)', { esperado: '(TG01000000007C)' }),
      e('(&T01L27)', { esperado: '(TG01000000007C)' }),
      e('(&T04l4A)', { esperado: '(Tl04000000000004)' }),
      e('(&T08l4E)', { esperado: '(Tl08000000000008)' }),
      e('(&T04L2A)', { esperado: '(TL040000000084)' }),
      e('(&T08L2E)', { esperado: '(TL080000000088)' }),
      e('(&A)', { esperado: '(0)' }),
      e('(&A67)', { esperado: '(0)' }),
      e('(&T04L00)', { esperado: null, timeoutMs: 1500 }),
    ],
  },
  {
    id: 'DIFF-01',
    titulo: 'Ack do &U e MessageBox do nível',
    resolve: 'Ack U04×M04, MessageBox (C26/C27, D1)',
    passos: [
      drenar,
      // Normalizes nozzle state left by earlier rounds (bench diff r4b: pump-sim started with 04
      // still fueling and the 2.7.2 with 05 in P); with PADRAO_272 both re-initialize (§18).
      configPadrao,
      e('(&U0400123409)'),
      e('(&U08000012346D)'),
      e(k('&U04201234'), { nota: 'nível 2 no &U de 4 dígitos → MessageBox no 2.7.2' }),
      fecharMessageBox,
      e('(&S)', { ignorarFim: 2, nota: 'confirma que voltou a responder' }),
    ],
  },
  {
    id: 'DIFF-02',
    titulo: 'Erros reais do &M',
    resolve: 'C29/C30',
    passos: [
      drenar,
      e(k('&M04Z'), { silencio: true, nota: 'modo inválido' }),
      e(k('&M3FA'), { nota: 'bico inexistente' }),
      // (M?f) = card outside the registry (behavioral equivalence, verdict #32), not "list full":
      // the 2.7.2 blacklist is the card registry column, with no capacity of its own.
      ...Array.from({ length: 21 }, (_, i) => e(k('&M99b' + cartao(i + 1)), { nota: i === 0 ? 'cadastro vazio → (M?f) em todos' : undefined })),
      e(k('&M99c' + '0'.repeat(16)), { nota: 'forma longa: `c` só marca "nao" num cartão cadastrado' }),
    ],
  },
  {
    id: 'DIFF-03',
    titulo: 'Silêncio × erro',
    resolve: 'C40',
    passos: [
      drenar,
      ...zerarEncerrantes('08'),
      configPadrao,
      e('(&S)', { ignorarFim: 2 }),
      e(k('&S'), { ignorarFim: 2, nota: '&S com KK' }),
      e('(&T08L2e)', { silencio: true, nota: 'kk minúsculo' }),
      e('(&T08L00)', { nota: 'KK errado', esperado: null }),
      e('(&X)', { silencio: true, nota: 'verbo inexistente' }),
      e('(&T08L2E', { silencio: true, nota: 'sem )' }),
      e('(&T08L2E)', { nota: 'o mesmo quadro, completo' }),
    ],
  },
  {
    id: 'DIFF-04',
    titulo: 'Fragmentação e quadros colados',
    resolve: 'Q1, fragmentação do TServerSocket',
    passos: [
      drenar,
      configPadrao,
      e(['(&S', ')'], { ignorarFim: 2, intervaloMs: 5, nota: '(&S) em 2 writes com 5 ms' }),
      e('(&S)(&V)', { ignorarFim: 2, nota: 'dois quadros num write' }),
      e('(&S)\r\n', { ignorarFim: 2, nota: 'CR LF no fim' }),
    ],
  },
  {
    id: 'DIFF-05',
    titulo: 'F × L no repouso',
    resolve: 'C16, D13; DD das DIPs (K6)',
    passos: [
      drenar,
      configPadrao,
      e('(&S)', { ignorarFim: 2 }),
      e(k('&CW013A030200'), { silencio: true, nota: 'canal 1 endereço 3 com 2 bicos' }),
      e('(&S)', { ignorarFim: 2 }),
      e(k('&CW013A030000'), { silencio: true, nota: 'endereço 3 sem bomba' }),
      e('(&S)', { ignorarFim: 2 }),
      dip(1, true),
      e('(&S)', { ignorarFim: 2, nota: 'K6: o DD muda com a DIP?' }),
      dip(1, false),
    ],
  },
  {
    id: 'DIFF-06',
    titulo: '&V com 3 bicos',
    resolve: 'Concatenação, volume×valor (C15)',
    passos: [
      drenar,
      configPadrao,
      // R$ 0,50 on each nozzle: the flow freezes at preset/price (VAZAO_272), so &V does not depend
      // on how long each lift took (bench diff r4b: 3,77/2,47/1,17 on the 2.7.2, the driver lifts one
      // panel at a time, × 0,91 on pump-sim).
      e(k('&P04000050')),
      e(k('&P08000050')),
      e(k('&P0C000050')),
      ...retirarBico('04'),
      ...retirarBico('08'),
      ...retirarBico('0C'),
      vazao(4000),
      e('(&V)'),
      ...recolocarBico('04'),
      ...recolocarBico('08'),
      ...recolocarBico('0C'),
      concluindo(),
    ],
  },
  {
    id: 'DIFF-07',
    titulo: 'Layouts do registro',
    resolve: 'C01–C07, data do PC (Q5)',
    passos: [
      drenar,
      ...zerarEncerrantes('04'),
      configPadrao,
      e('(&c00411223349)', { esperado: null, nota: 'campos bb/cc/tt do PAF do 04 num valor conhecido' }),
      ...abastecimento('04'),
      e('(&A)', relogioRegistro()),
      e('(&A67)', relogioRegistro(1)),
      e('(&@66)', relogioRegistro(1)),
      e('(&A299)', relogioRegistro(11)),
      e('(&A39A)', relogioPaf2),
      e('(&A49B)', { silencio: true }),
      dip(3, false),
      // #12 (bench diff r4b): the layout is fixed by DIP3 when the record is stored → still 52.
      e('(&A)', { ...relogioRegistro(), nota: 'DIP3 desligada depois de gravar: o layout é o da gravação (52)' }),
      dip(3, true),
    ],
  },
  {
    id: 'DIFF-08',
    titulo: '&LR/&LC em posição vazia e cheia',
    resolve: 'C08/C09, K1 (changelog 1.1.07)',
    // Position 0500 is only empty on freshly opened targets: once the 999-cell buffer wrapped
    // (bench diff r4b: 998 records drained on the 2.7.2) every cell holds an old record (§18).
    passos: [
      drenar,
      ...zerarEncerrantes('04'),
      configPadrao,
      ...abastecimento('04'),
      e(k('&LR0001'), relogioRegistro()),
      e(k('&LR0500'), { silencio: true, nota: 'posição vazia (só com os alvos recém-abertos)' }),
      e(k('&LC0001'), relogioRegistro(11)),
      e(k('&LC0500'), { silencio: true, nota: 'posição vazia (só com os alvos recém-abertos)' }),
      modelo('Horustech'),
      e('(&S)', { ignorarFim: 2, nota: 'etapa 12: o Modelo não muda o &S (…DD6V…)' }),
      e('(?S92)', { ignorarFim: 2, nota: 'etapa 12: nem o ?S (…DD0v…)' }),
      e(k('&LR0001'), relogioRegistro()),
      e(k('&LR0500'), { silencio: true }),
      e(k('&LC0001'), relogioRegistro(11)),
      e(k('&LC0500'), { silencio: true }),
      modelo('CBC-06'),
    ],
  },
  {
    id: 'DIFF-09',
    titulo: 'Resposta padrão TG do &T',
    resolve: 'C11/C12/C20/C23/C25',
    // configPadrao: a fresh 2.7.2 opens with no nozzle configured (bench diff r6); the bench clicks
    // the button right after opening, but a case run alone must not depend on that.
    passos: [drenar, configPadrao, ...abastecimento('04'), e('(&T99P3C)'), e('(&I)', { silencio: true }), e('(&T99P3C)'), e('(&T99N3A)'), e('(&T08P32)'), e('(&T08N30)'), e('(&TB0I35)')],
  },
  {
    id: 'DIFF-10',
    titulo: 'Layouts Ts/u com preço de 3 casas',
    resolve: 'C22/C24',
    passos: [drenar, configPadrao, e('(&T08C25)'), e('(&T08u57)'), e('(&T08U37)')],
  },
  {
    id: 'DIFF-11',
    titulo: 'Eco BB do &T',
    resolve: 'Base hex×decimal (C2/D5)',
    // `configPadrao` after the zeroing: the TG reply of `&T0A`/`&TC4` carries write−1/read−1, and the
    // `&E` stores a record only when the totalizer changed (E_272). The 2.7.2 reloads its totalizers
    // from c:\simcnf.ini (Q8), so its `&E44` stored one and pump-sim's did not (bench diff r5:
    // `(TG0A000100018E)` × `(TG0A000000008C)`). The rewind puts both pointers at 1 (PADRAO_272).
    passos: [drenar, ...zerarEncerrantes('44', 'C4'), configPadrao, e(k('&T0AL')), e(k('&T44L')), e(k('&TC4L'))],
  },
  {
    id: 'DIFF-12',
    titulo: 'Relógio',
    resolve: 'C31/C32/C34',
    passos: [
      drenar,
      // Addresses 1–2 come from the default configuration (a fresh 2.7.2 opens with none, bench diff r6).
      configPadrao,
      // The `(C…)` rows of `&R` are the raw `&C` texts in the 2.7.2 grid (C_272, #36), and the 2.7.2
      // reloads them from c:\simcnf.ini (Q8): bench diff r5 listed `(C01F0A040000)`-style rows for
      // addresses 3–4 that no frame of the run wrote. "Carregar configuração padrão" does not touch
      // addresses 3–4, so the case writes them itself (0 nozzles: `&S` stays `FF` there, DIFF-05).
      ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((c) => [3, 4].map((a) => e(k(`&CW0${c}3A0${a}0000`), { silencio: true, nota: a === 3 && c === 1 ? 'endereços 3–4 num texto conhecido (estado de rodadas anteriores)' : undefined }))),
      acertarRelogio(),
      e('(&KR1F4)', { mascara: SEGUNDO_KR1, nota: 'logo depois do &KW: o 1º tick do relógio pode cair no meio (r8: segundo 01)' }),
      e(k('&KW126101606143000'), { nota: 'válido (sexta = 6)' }),
      e(k('&KW126131606143000'), { nota: 'mês 13' }),
      // Bench diff r6: the 2.7.2 `&R` 1 ms after this `&KW` already read `14:30:01 16/01/27`, so its
      // The clock timer ticked within ~150 ms of the write (free-running phase; pump-sim ticks 1 s after it,
      // RTC_272). After 1,5 s both rolled month 13 into January; the time (1 or 2 ticks) is masked.
      ticks(1, TICK_RELOGIO_MS, MARGEM_TICK_MS),
      e('(&R)', { mascara: RELOGIO_R, nota: 'mês 13 virou 01/27 depois do tick' }),
    ],
  },
  {
    id: 'DIFF-13',
    titulo: 'Verbos fora do DT435',
    resolve: 'C10/C35/C36/C39/I09/I10, K5',
    // Without (&CH0213): &CH does not exist on the 2.7.2, it is a &C with type H (verdict #45), and that
    // frame only reads past the end (E6). The &C with type H is in EQUIV-COMANDOS.
    passos: [drenar, configPadrao, e(k('&LE0001'), { silencio: true }), e(k('&c'), { silencio: true }), e('(&F)'), e(k('?D')), e('(?S92)', { ignorarFim: 2 }), e(k('&S01'), { ignorarFim: 2, nota: 'K5: &S com parâmetro' })],
  },
  {
    id: 'DIFF-14',
    titulo: 'Identfid byte a byte',
    resolve: 'I01–I08',
    passos: [
      drenar,
      configPadrao,
      e(k('?F27G' + 'ABCDEF0123456789' + '0000235900002359'), { nota: '?F G grava' }),
      e(k('?LF000000')),
      e(k('?F00A' + 'ABCDEF0123456789' + '00' + '000000' + '00000000'), { nota: '?F A exclui' }),
      e(k('?F00L' + '0'.repeat(32)), { silencio: true, nota: '?F00L limpa' }),
      {
        manual: 'Painel IDF do endereço 1: "Informar manualmente" o cartão 1122334455667788',
        controle: [ctl('apresentar_cartao', { canal: 1, endereco: 1, codigo: '1122334455667788' })],
        semDriver: SEM_IDF,
        rotulo: 'idf',
      },
      e('(?A80)', { dependeDe: ['idf'], nota: 'cartão informado pelo painel IDF (pulado sem driver para ele)' }),
      e(k('?F27G' + '1122334455667788' + '0000235900002359')),
      { manual: 'Ligar o IDF do endereço 1', controle: [ctl('configurar_sensor', { canal: 1, endereco: 1, ligado: true })], semDriver: SEM_IDF, rotulo: 'idf' },
      { manual: 'Apresentar o cartão 1122334455667788 no endereço 1', controle: [ctl('apresentar_cartao', { canal: 1, endereco: 1, codigo: '1122334455667788' })], semDriver: SEM_IDF, rotulo: 'idf' },
      ...retirarBico('04'),
      ticks(2, TICK_ESTADO_MS),
      e('(?V95)', { dependeDe: ['idf'], nota: 'sensor e cartão pelo painel IDF (pulados sem driver para ele)' }),
      ...recolocarBico('04'),
      concluindo(),
      // The IDF sensor (pump-sim only, above) raises the block at the start (#29): turn it off and
      // unblock, or the next cases cannot fuel on address 1 (bench diff r4b, DIFF-18/20).
      e(k('&M04I'), { nota: 'desliga o sensor IDF' }),
      e(k('&M04L'), { nota: 'desbloqueia o endereço 1' }),
    ],
  },
  {
    id: 'DIFF-15',
    titulo: '?C e permissão no byte inteiro',
    resolve: '§3.3 (modo descartado; CC 27 × 67 fora do turno)',
    passos: [
      drenar,
      configPadrao,
      e(k('?C0010101' + '00'), { silencio: true, nota: 'campos 9-12 = 01/00' }),
      e(k('?C0010107' + '00'), { silencio: true }),
      e(k('?C0010114' + '01'), { silencio: true }),
      e(k('?F27G' + '0000000000000027' + '0000000100000001'), { nota: 'CC 27, turno 00:00–00:01' }),
      e(k('?F67G' + '0000000000000067' + '0000000100000001'), { nota: 'CC 67, turno 00:00–00:01' }),
      { manual: 'Apresentar o cartão ...27 no endereço 1', controle: [ctl('apresentar_cartao', { canal: 1, endereco: 1, codigo: '0000000000000027' })], semDriver: SEM_IDF },
      e('(&S)', { ignorarFim: 2 }),
      { manual: 'Apresentar o cartão ...67 no endereço 1', controle: [ctl('apresentar_cartao', { canal: 1, endereco: 1, codigo: '0000000000000067' })], semDriver: SEM_IDF },
      e('(&S)', { ignorarFim: 2 }),
      // ?C left sensor and block on in the 4 nozzles of address 1 (#52): on the bench the panel
      // stayed "Bicos Bloqueados" and DIFF-18/20 could not fuel 04 (diff r4b, §18).
      e(k('&M04I'), { nota: 'desliga o sensor IDF' }),
      e(k('&M04L'), { nota: 'desbloqueia o endereço 1' }),
    ],
  },
  {
    id: 'DIFF-16',
    titulo: 'Horustech parcial e terminador',
    resolve: '§2.4',
    // Bench diff r5 (M1 of DECISIONS §20): the 2.7.2 `02` has no "empty" test and reads the grid
    // cell at the read pointer, so with read = write it serves the stale record left there. The case
    // makes that cell known on both targets: two R$ 1,00 fuelings (rows 1–2), the rewind of
    // "Carregar configuração padrão" (pointers back to 1, rows kept), one more fueling (row 1 again)
    // and a drain: read = write = 2 and row 2 holds the 2nd fueling. Totalizer of 04 zeroed first
    // (it comes from c:\simcnf.ini on the 2.7.2, Q8).
    passos: [
      drenar,
      ...zerarEncerrantes('04'),
      configPadrao,
      ...abastecimento('04'),
      ...abastecimento('04'),
      configPadrao,
      ...abastecimento('04'),
      e('>?00020263', { ...relogioHorustech02, nota: 'read 1 × write 2: lê a linha 1 (ponteiro de leitura; M1b, não medido com read ≠ write)' }),
      drenar,
      e('>?00020263', { ...relogioHorustech02, nota: 'read = write = 2: a linha 2 velha, sem teste de vazio' }),
      e('>?00020263\n', relogioHorustech02),
      e('>?00020667'),
      e('>?00020667\n'),
      // Function 32 with the manual's 6-digit price (DT214): nozzle 02, level 0, 001111, KK 2C.
      // The `>?000A3202000111FA` of the 17/10 round had only 4 digits and the KK in the field (modal '1,11F').
      e('>?000B320200011112C', { nota: '32: preço de 6 dígitos (manual)' }),
      e('>?000B320200011112C\n'),
      e('>?00020200', { ...relogioHorustech02, nota: 'KK errado' }),
    ],
  },
  diff17(),
  diff17r(),
  diff13r(),
  {
    id: 'DIFF-18',
    titulo: 'Intervalo dos ticks de vazão (Normal)',
    resolve: 'Normal 100×300 ms',
    comparacao: 'informativo',
    passos: [
      drenar,
      configPadrao,
      acao('velocidade', { valor: 'Normal' }),
      ...retirarBico('04'),
      ...Array.from({ length: 30 }, (): Passo[] => [e('(&V)', { timeoutMs: 300 }), /* sampling period of the measurement */ { aguardar: 100 }]).flat(),
      ...recolocarBico('04'),
      concluindo(),
    ],
  },
  {
    id: 'DIFF-19',
    titulo: 'Preset com preço de 3 casas',
    resolve: 'Corte e truncamento (C28, Q6); K1 (1.1.45/52/53)',
    passos: [
      drenar,
      ...zerarEncerrantes('08'),
      configPadrao,
      // R$ 5,00: R$ 10,00 at 11,23/L (0,89 L) is not reached in 15 s at Normal (bench diff r4b:
      // 0,624 L on the 2.7.2), so the cut never happened. 0,445 L takes ~10 s.
      e(k('&P08000500'), { nota: 'R$ 5,00 no bico 08' }),
      ...retirarBico('08', 'esperar o corte'),
      vazao(15000),
      e('(&V)', { nota: 'volume congelado no corte' }),
      ...recolocarBico('08'),
      concluindo(),
      e('(&A)', relogioRegistro()),
    ],
  },
  {
    id: 'DIFF-20',
    titulo: 'Duas conexões na 2001',
    resolve: 'Ponteiro compartilhado (Q3)',
    passos: [
      drenar,
      ...zerarEncerrantes('04', '05'),
      configPadrao,
      ...abastecimento('04'),
      ...abastecimento('05'),
      e('(&A)', { conexao: 'b', ...relogioRegistro() }),
      e('(&I)', { conexao: 'a', silencio: true }),
      // Bench diff r7g: the hh:mm differed (14:49 × 14:46, B on a manual clock); clock fields only.
      e('(&A)', { conexao: 'b', ...relogioRegistro() }),
      e('(&T99P3C)', { conexao: 'b' }),
    ],
  },
  {
    id: 'DIFF-30',
    titulo: 'Console real: ponteiro por porta (2001/1771/857)',
    resolve: 'Perfis reais, ponteiro por porta (só com console real)',
    passos: [
      drenar,
      ...abastecimento('04', { presetCentavos: null }),
      e('(&A)', { porta: 2001, conexao: 'p2001' }),
      e('(&A)', { porta: 1771, conexao: 'p1771' }),
      e('(&I)', { porta: 2001, conexao: 'p2001' }),
      e('(&A)', { porta: 2001, conexao: 'p2001' }),
      e('(&A)', { porta: 1771, conexao: 'p1771' }),
      e('(&T99P3C)', { porta: 857, conexao: 'p857' }),
      e('>?00020263', { porta: 1771, conexao: 'p1771' }),
    ],
  },
  {
    id: 'EQUIV-LEITURA',
    titulo: 'Equivalência fatia 1 (leitura): sem `)`, &T sem tamanho, Ts/TU, &LR/&LC/&LE',
    resolve: 'equivalência comportamental #2, #17, #19, #20, #22, #23 e o &LR 74/82 pelo Modelo',
    passos: [
      drenar,
      ...zerarEncerrantes('04'),
      configPadrao,
      acertarRelogio(),
      e('(&V', { esperado: '(0)', nota: '#2: verbo sem KK, sem `)`' }),
      e('(&R', { mascara: RELOGIO_R, nota: '#2: &R sem `)` responde' }),
      ...abastecimento('04'),
      e('(&T99P3C)', { nota: 'ponteiros antes do (&I partido' }),
      e('(&I', { esperado: null, nota: '#2: (&I sem `)` avança o ponteiro' }),
      e('(&T99P3C)', { nota: 'o R−1 do TG subiu 1' }),
      e('(&T04LX82)', { nota: '#17: 10 chars → TL' }),
      e('(&T04DE)', { nota: '#17: modo = D (do KK) → TG' }),
      e('(&T09C26)', { esperado: '(Ts09023A0102C9)', nota: '#19: índice do bico, não o endereço' }),
      e('(&T48C29)', { esperado: '(Ts48023A0202CD)', nota: '#19: bico 2 do endereço 1' }),
      e('(&LR000185)', { ...relogioRegistro(), nota: 'CBC-06: 74 chars' }),
      e('(&LR00010B5)', { ...relogioRegistro(), nota: '#22: 11 chars, posição 0001' }),
      e('(&LR$00179)', { ...relogioRegistro(), nota: '#22: StrToInt aceita $hex' }),
      e('(&LC000176)', relogioRegistro(11)),
      modelo('Horustech'),
      e('(&LR000185)', { ...relogioRegistro(), nota: 'Horustech: 82 chars' }),
      modelo('CBC-06'),
      // Row 1 = DDMMhhmm of the PC clock when the simulator was opened (bench diff r4b `16101956`,
      // r6 `17101322` on a fresh 2.7.2): the hh:mm is masked as a clock field, the day/month compared.
      e('(&LE00148)', { mascara: [[5, 9]], nota: '#23: n=1 → 4 células de 8; a 1ª é o evento de abertura (DDMMhhmm)' }),
      e(k('&LE00C'), { esperado: '(' + '0'.repeat(32) + ')', nota: '#23: n=12 → coluna 2, linhas 13–16: 4 × 00000000' }),
      e(k('&LE000'), { esperado: null, nota: '#23: n=0 → mudo (bancada: (&LE000178))' }),
      e('(&CW012A010200B7)', { silencio: true, nota: 'endereço 1 com vírgula 2A' }),
      e(k('&U04000549'), { esperado: '(U04)' }),
      e(k('&T04U'), { esperado: k('TU0400005490'), nota: '#20: 5,49 → 5490 (FloatToStr, zeros à direita)' }),
      configPadrao,
    ],
  },
  {
    id: 'EQUIV-COMANDOS',
    titulo: 'Equivalência fatia 2 (comandos): relógio, &P, &M99, &C/&c/&CH, &U, &E e o modal',
    resolve: 'equivalência comportamental #8, #32–#36, #38–#40, #42–#45 e o E3 (resposta depois do OK)',
    passos: [
      drenar,
      configPadrao,
      // Clock (#38–#40). Invalid dates open E10 (1 modal/s) on the 2.7.2 until &KW sets it back.
      e('(&KW126131606143000BA)', { esperado: '(KW12613160614300094)', nota: '#40: mês 13 aceito' }),
      e('(&KR1F4)', { nota: '#40: antes do 1º tick do relógio o mês ainda é 13' }),
      ticks(2, TICK_RELOGIO_MS),
      e('(&KR1F4)', { mascara: SEGUNDO_KR1, nota: '#40: rolou para 01/27 (o segundo depende da fase do relógio)' }),
      e('(&KW126043006235958CE)', { nota: '#40: 30/04 23:59:59' }),
      ticks(3, TICK_RELOGIO_MS),
      e('(&KR1F4)', { mascara: SEGUNDO_KR1, nota: '#40: todo mês tem 31 dias → 31/04 (E10 no 2.7.2)' }),
      e('(&KW126101606143000B8)', { nota: '#39: KK errado (B8 × B7) → aplica e responde' }),
      e(k('&KW126101606250000'), { nota: '#39: hora 25 aceita' }),
      e('(&KR1F4)', { mascara: SEGUNDO_KR1, nota: '#39: o KR1 mostra 25 (E10 no 2.7.2)' }),
      e('(&KW1261016XX143000BA)', { esperado: null, nota: '#39: não numérico → E9 e silêncio (não responde a hora atual)' }),
      fecharMessageBox,
      e('(&H012500)', { esperado: '(&H)', nota: '#38: &H sem faixa (hora 25)' }),
      e(k('&KW126101606143000'), { nota: 'relógio de volta a uma data válida' }),
      fecharMessageBox,
      // &P (#35)
      e('(&P04000500FF)', { esperado: '(P04)' }),
      letraAssentada(),
      e('(&S)', { ignorarFim: 2, nota: '#35: o &P pré-autoriza e põe P (1ª letra P)' }),
      e(k('&P050005000'), { esperado: '(P05)', nota: '#35: sem teste de tamanho (15 chars)' }),
      configPadrao,
      // &M99 (#32)
      e('(?F01G1234567890ABCDEF0000000000000000CF)', { nota: 'cadastra o cartão' }),
      e('(&M99b1234567890ABCDEFE9)', { esperado: '(M99)', nota: '#32: cartão cadastrado → (M99)' }),
      e('(&M12b1234567890ABCDEFDA)', { esperado: '(M99)', nota: '#32: BB livre' }),
      e(k('&M99b' + 'FEDCBA0987654321'), { esperado: '(M?f)', nota: '#32: (M?f) = não cadastrado' }),
      e('(?F00L31)', { silencio: true, nota: 'limpa o cadastro' }),
      // &C (#43, #36) and &CH (#45)
      e('(&CW013A010400BA)', { silencio: true }),
      e('(&CW013A010200B8)', { silencio: true }),
      e('(&TC4L3D)', { nota: '#43: reduzir não desativa: o bico C4 ainda responde TL' }),
      e(k('&U04005899'), { esperado: '(U04)' }),
      e('(&CW013A010200B8)', { silencio: true, nota: '#43: reenviar reinicia o preço' }),
      e(k('&T04U'), { nota: '#43: o nível 0 volta para o inicial' }),
      e('(&E0400001234)'),
      e('(&CW013A010000B6)', { silencio: true, nota: '#43: n=0 zera os encerrantes' }),
      e('(&R)', { mascara: RELOGIO_R, nota: '#36: a linha (C01W3A010000) segue no &R' }),
      e('(&CW013A010200B8)', { silencio: true }),
      e('(&T04L2A)', { nota: '#43: encerrante zerado' }),
      e('(&CH013A010200A9)', { silencio: true, nota: '#45: &CH = &C com tipo H' }),
      e('(&F)', { nota: '#45: RH61 no 1º grupo' }),
      e('(&CW013A010200B8)', { silencio: true }),
      // &c (#44)
      e('(&c00411223349)', { esperado: null }),
      ...abastecimento('04'),
      e('(&A299)', { ...relogioRegistro(11), nota: '#44: o (&c…112233) sai 113322 no PAF; o registro do &E traz o encerrante antigo e o preço 11,23' }),
      // &E (#42)
      e('(&E0400001234)', { esperado: '((TL0400001234B6)', nota: '#42: moldura ((TL e KK com o (' }),
      e('(&T04L2A)', { nota: '#42: litros inteiros → 00123400' }),
      e('(&A)', { ...relogioRegistro(), nota: '#42: gerou um registro' }),
      e('(&E7700001234)', { esperado: '((TL7700001234C0)', nota: '#42: responde sem bico' }),
      e('(&E04000012X4)', { esperado: null, nota: '#42: E8, sem resposta' }),
      fecharMessageBox,
      // &U 14/16 (#33, #34), modal × socket (#8) and the reply after OK (E3). On the bench the modal
      // watcher closes each MessageBox within ~0,4–0,8 s, so the reply held until the OK arrives
      // inside the step (diff r4b: (U04) at 834 ms, (U?t) at 384 ms). pump-sim answers at once
      // (travamentoMs = 0): holding the modal on pump-sim only (as before) made B silent (§18).
      e('(&U0420058917)', { esperado: '(U04)', timeoutMs: 1500, nota: '#33: nível 2 no &U 14 → modal; o (U04) sai no OK' }),
      e('(&S)', { ignorarFim: 2, nota: '#8: o socket segue atendendo' }),
      fecharMessageBox,
      e(k('&T04U'), { nota: 'E3: o preço não mudou' }),
      e('(&CW012A010200B7)', { silencio: true, nota: 'vírgula 2A' }),
      e('(&U04100012346A)', { esperado: '(U04)', nota: '#34: &U 16, nível 1' }),
      e('(&T04u53)', { nota: '#34: com 2x o nível 1 cai no 0 (1234), e o preço vem de cmd[9..12]' }),
      e(k('&U0420000012'), { esperado: '(U04)', nota: '#34: &U 16 com nível 2 válido (com 2x cai no nível 0)' }),
      e(k('&U0430000012'), { esperado: '(U?t)', timeoutMs: 1500, nota: '#34: &U 16 nível 3 → modal, (U?t) no OK' }),
      fecharMessageBox,
      e('(&S)', { ignorarFim: 2 }),
      modelo('Horustech'),
      // E3, bench diff r4b: the 2.7.2 converts the KK with StrToInt('$' + KK) first → E9 modal
      // "''$XX'' is not a valid integer value.", no reply and no price (§18).
      e('>?000B32022001500XX', { esperado: null, timeoutMs: 1500, nota: 'E3: KK não-hex → E9, sem resposta' }),
      fecharMessageBox,
      e('(&S)', { ignorarFim: 2 }),
      // Not measured yet (re-measure, §18): with a valid KK, level 2 should open the level modal and
      // the ack go out on the OK (the watcher closes it inside the timeout).
      e('>?000B3202200150030', { timeoutMs: 1500, nota: 'E3: KK válido, nível 2 → modal de nível; o ack sai no OK (medir)' }),
      fecharMessageBox,
      e('(&S)', { ignorarFim: 2 }),
      modelo('CBC-06'),
      configPadrao,
    ],
  },
  {
    id: 'EQUIV-MOTOR',
    titulo: 'Equivalência fatia 3 (motor): preset, &M S/B, timer de vazão sem gate, pré-autorização por bico, 0,13 L, Concluindo e o 10053',
    resolve: 'equivalência comportamental #26, #27, #63, #64, #66, #68, #69, #72–#74, #89 e #92 (#13 só em teste: 9999 registros)',
    passos: [
      drenar,
      ...zerarEncerrantes('04', '44'),
      configPadrao,
      // #27 repeats the last fueling of 04: a R$ 1,00 one here, so it does not come from the case
      // before (bench diff r4b: 1,30 L on the 2.7.2 × 0,013 L on pump-sim). configPadrao again puts
      // the pointers back at 1, as the steps below expect.
      ...abastecimento('04'),
      e('(&I6F)', { esperado: null }),
      configPadrao,
      // The button leaves address 2 in L until the next state tick brings its P back (F1 of §18);
      // bench diff r6 read `(SCP…)` on the 2.7.2 (the tick had come) × `(SCL…)`. Wait for it.
      ticks(1, TICK_ESTADO_MS, MARGEM_TICK_MS),
      // #27: &M S on an idle nozzle stores a record repeating the last one.
      e('(&A)', { esperado: '(0)', nota: 'ponteiros na 1ª posição: (0)' }),
      e('(&M04S2A)', { esperado: '(M04)' }),
      e('(&S)', { ignorarFim: 2, nota: '#27: C no 1º grupo logo depois do &M S (o 2º grupo L até o próximo tick)' }),
      ticks(2, TICK_ESTADO_MS, MARGEM_TICK_MS),
      e('(&A)', { ...relogioRegistro(), nota: '#27: registro fantasma do bico 04 (R$ 1,00 do anterior), R0001' }),
      e('(&I6F)', { esperado: null }),
      // #72: reached preset freezes in A, with no record; it only goes out on hang-up.
      e(k('&P04000100'), { esperado: '(P04)', nota: 'R$ 1,00' }),
      ...retirarBico('04'),
      vazao(6000),
      e('(&S)', { ignorarFim: 2, nota: '#72: segue A com o preset atingido' }),
      e('(&V)', { nota: '#72: volume congelado = preset/preço' }),
      vazao(1000),
      e('(&V)', { nota: '#72: o mesmo volume' }),
      e('(&A)', { esperado: '(0)', nota: '#72: não encerrou, nenhum registro' }),
      ...recolocarBico('04'),
      e('(&S)', { ignorarFim: 2, nota: '#69: C ("Concluindo..")' }),
      concluindo(),
      e('(&A)', { ...relogioRegistro(), nota: '#72: registro de R$ 1,00' }),
      e('(&I6F)', { esperado: null }),
      e('(&M04S2A)', { esperado: '(M04)', nota: '#27: &M S de novo no 04 parado' }),
      ticks(2, TICK_ESTADO_MS, MARGEM_TICK_MS),
      e('(&A)', { ...relogioRegistro(), nota: '#27: registro fantasma repetindo o volume e o total do anterior' }),
      e('(&T04L2A)', { nota: '#27: o encerrante soma o volume de novo' }),
      e('(&I6F)', { esperado: null }),
      // #73/#68: preset and pre-authorization belong to the nozzle. 44 gets its own R$ 2,00, so it
      // freezes there and not at the R$ 1,00 of 04 (deterministic; bench diff r4b: the free 44 gave
      // 0,260 × 0,156 L). The letter is A while 44 fuels (bench, not P as the verdict said).
      e(k('&P04000100'), { esperado: '(P04)' }),
      e(k('&P44000200'), { esperado: '(P44)' }),
      ...retirarBico('44'),
      vazao(6000),
      e('(&S)', { ignorarFim: 2, nota: '#68: 1º grupo A com o 44 abastecendo e o 04 em P (bancada)' }),
      e('(&V)', { nota: '#73: o 44 congela no próprio preset (R$ 2,00), não no R$ 1,00 do 04' }),
      ...recolocarBico('44'),
      concluindo(),
      e('(&S)', { ignorarFim: 2, nota: '#68: o fim limpa a pré-autorização dos 4 bicos → L' }),
      e('(&I6F)', { esperado: null }),
      // #26/#64: &M B freezes the fueling in progress (status B, out of &V).
      ...retirarBico('04'),
      vazao(2500),
      e(k('&M04B'), { esperado: '(M04)' }),
      letraAssentada(),
      e('(&S)', { ignorarFim: 2, nota: '#26: o 1º grupo vai a B com o bico congelado pelo &M B (bancada r6/r7g)' }),
      e('(&V)', { esperado: '(0)', nota: '#26: status B não sai no &V' }),
      // Bench diff r6 and r7g: `(SBP…)` right after &M B and again after a state tick (r4b had read
      // `(SAP…)`); the 2nd read stays as a regression check (§23 B2). The 1st read waits for the
      // ~100 ms letter deferral first (Wine r9 read `(SAP…)` at once, §28 L1).
      ticks(1, TICK_ESTADO_MS, 200),
      e('(&S)', { ignorarFim: 2, nota: '#26: depois de um tick de estado (re-medição da letra)' }),
      e(k('&M04L'), { esperado: '(M04)' }),
      ...recolocarBico('04'),
      concluindo(),
      e('(&A)', { ...relogioRegistro(), nota: '#26: o registro traz o volume de quando o &M B congelou' }),
      e('(&I6F)', { esperado: null }),
      // The #26 record is free flow (± 1–2 ticks between targets, §21): zero the totalizer of 04 so
      // the E10 of the #74 record does not carry that difference (bench diff r7g, §23).
      ...zerarEncerrantes('04'),
      // #63: The flow timer does not look at Automação. With a R$ 1,00 preset and Automação off right after
      // the start, the flow still reaches the preset: a value that does not depend on when each target
      // started (bench diff r4b: 1,43/1,95 × 0,13/0,65 L, the same 0,52 L/s on both).
      e(k('&P04000100'), { esperado: '(P04)' }),
      ...retirarBico('04'),
      acao('automacao', { valor: 'Desligado' }),
      vazao(6000),
      e('(&V)', { nota: '#63: com a Automação desligada o volume chegou ao preset (0,089 L)' }),
      acao('automacao', { valor: 'Ligado' }),
      ...recolocarBico('04'),
      concluindo(),
      e('(&I6F)', { esperado: null }),
      // #74: with preset and 3 volume decimals the step is 13 (not 12.9). Bench diff r6 measured it on
      // the 2.7.2 with free flow (`(04000364)` = 28 ticks, golden in test/diff-r6.test.ts); a free-flow
      // sample is not byte-stable across targets, so the case now waits for the R$ 3,00 preset
      // (0,267 L: 21 ticks, 2,1 s at 100 ms, 6,3 s at 300 ms) and compares the frozen volume.
      e(k('&CW013E010200'), { nota: 'vírgula 3E: volume com 3 casas' }),
      e(k('&P04000300'), { esperado: '(P04)' }),
      ...retirarBico('04'),
      vazao(8000),
      e('(&V)', { nota: '#74/#72: volume congelado no preset com 3 casas (0,267 L)' }),
      ...recolocarBico('04'),
      concluindo(),
      e('(&A)', { ...relogioRegistro(), nota: '#74: volume do registro' }),
      e('(&I6F)', { esperado: null }),
      e('(&CW013A010200B8)'),
      // #89: no authorization deadline on the 2.7.2. ?F P with N = 02 s pre-authorizes 04; 5 s
      // later the 2.7.2 stays P (on real profiles the deadline expires and it goes back to L). The fueling
      // consumes the authorization so no P is left over for the next case.
      e(k('?F04P' + cartao(1) + '0S00100002$00000'), { esperado: '(F04)', nota: '#89: ?F P, R$ 10,00, N = 02 s' }),
      ticks(5, TICK_ESTADO_MS),
      e('(&S)', { ignorarFim: 2, nota: '#89: 1º grupo segue P depois do prazo' }),
      ...abastecimento('04', { presetCentavos: null }),
      e('(&I6F)', { esperado: null }),
      // #92: RST opens modal 10053 (the socket keeps serving); FIN opens nothing.
      e('(&S)', { conexao: 'rst', ignorarFim: 2 }),
      { desconectar: 'rst', conexao: 'rst' },
      // Not a timer: the 2.7.2 opens the 10053 modal asynchronously after the RST, and the next step
      // only means "the socket serves with the modal open" once it is open. Kept (FIN likewise: no
      // modal may have opened by then).
      { aguardar: 500 },
      e('(&S)', { ignorarFim: 2, nota: '#92: modal 10053 aberto (watcher) e o socket atende' }),
      fecharMessageBox,
      e('(&S)', { conexao: 'fin', ignorarFim: 2 }),
      { desconectar: 'fin', conexao: 'fin' },
      { aguardar: 500 },
      e('(&S)', { ignorarFim: 2, nota: '#92: FIN não abre modal (watcher sem 10053)' }),
      // #66: two nozzles of the same address fuel together. Last in the case (bench diff r7g, §23): the
      // 2.7.2 UI cannot do it, so A skips it, and any later record number or totalizer would carry the skip.
      { manual: 'Retirar os bicos 04 e 44', controle: [ctl('retirar_bico', { bico: '04' }), ctl('retirar_bico', { bico: '44' })], semDriver: UM_BOTAO_POR_LADO, rotulo: '#66' },
      vazao(3000),
      e('(&V)', { dependeDe: ['#66'], nota: '#66: o &V lista o 04 e o 44' }),
      { manual: 'Recolocar os bicos 04 e 44', controle: [ctl('recolocar_bico', { bico: '04' }), ctl('recolocar_bico', { bico: '44' })], semDriver: UM_BOTAO_POR_LADO, rotulo: '#66' },
      concluindo(),
      configPadrao,
    ],
  },
  {
    id: 'EQUIV-PENDENTES',
    titulo: 'Equivalência: pontos abertos medidos na bancada (#55, E3 com KK não-hex, fonte do nível do 32)',
    resolve: 'equivalência comportamental #55 e #59/E3 (só medição: nenhum quadro tem esperado fixo)',
    passos: [
      drenar,
      configPadrao,
      // The button leaves address 2 in L until the next state tick brings back the P it carries from
      // EQUIV-MOTOR (F1 of §18). Bench diff r7g read `(SLP…)` on the 2.7.2 × `(SLL…)` on a pump-sim
      // with a manual clock (no tick without an `aguardar`). Wait for it (§23).
      ticks(1, TICK_ESTADO_MS, MARGEM_TICK_MS),
      // #55, bench diff r4b: silent (no reply in 1,5 s) and the socket keeps answering.
      e('(?F00L31)', { esperado: null, timeoutMs: 1500, nota: '#55: estado recém-aberto, sem cartão cadastrado → mudo (bancada)' }),
      e('(&S)', { ignorarFim: 2, nota: '#55: o socket segue atendendo' }),
      // E3, bench diff r4b: a non-hex KK is an E9 ("''$XX'' is not a valid integer value."), no
      // reply and no price on any level, whatever the level.
      modelo('Horustech'),
      e('>?000B32022001500XX', { esperado: null, timeoutMs: 1500, nota: 'E3: KK não-hex → E9, sem resposta (bancada)' }),
      fecharMessageBox,
      e('(&S)', { ignorarFim: 2, timeoutMs: 1500, nota: 'E3: nada chega depois do OK' }),
      // #59 level source, still open: the same frame with a VALID KK (the E9 above hid it). Nozzle
      // n = 02 is 44 in the 32 table (1→04, 2→44); cmd[10] = 1. See which level of 44 became 15,00.
      e('>?000B320210015002F', { timeoutMs: 1500, nota: '#59: KK válido; nível vem de cmd[10] (1)? (medir)' }),
      fecharMessageBox,
      modelo('CBC-06'),
      e(k('&T44U'), { timeoutMs: 1500, nota: '#59: preço do nível 0 do bico 44' }),
      e(k('&T44u'), { timeoutMs: 1500, nota: '#59: preços dos níveis do bico 44 (bancada r6: nenhum virou 1500)' }),
      // Bench diff r6: the 32 acked and stored nothing on 44. These read the nozzles a different
      // table would pick (04 = 1st nozzle; 08 = address 2 if n were the address): 15,00 on either
      // means the price went elsewhere.
      e(k('&T04u'), { timeoutMs: 1500, nota: '#59: o 32 não gravou no 04' }),
      e(k('&T08u'), { timeoutMs: 1500, nota: '#59: nem no 08' }),
      configPadrao,
    ],
  },
];

export interface OpcoesRoteiro {
  /** How many fuelings DIFF-17 does (default `DIFF17_N_PADRAO`). */
  diff17N?: number;
  /** `todos` also takes the opt-in cases ({@link CasoDiff.opcional}). */
  incluirOpcionais?: boolean;
}

export function roteiro(id: string, op: OpcoesRoteiro = {}): CasoDiff | undefined {
  const c = ROTEIROS.find((x) => x.id === id.toUpperCase());
  return c?.id === 'DIFF-17' && op.diff17N !== undefined ? diff17(op.diff17N) : c;
}

/** Ids (or "todos", which leaves out the opt-in cases unless `incluirOpcionais`) → cases. Unknown id = error. */
export function selecionarRoteiros(ids: string | string[], op: OpcoesRoteiro = {}): CasoDiff[] {
  const lista = Array.isArray(ids) ? ids : ids.split(',');
  if (lista.length === 1 && lista[0]!.trim().toLowerCase() === 'todos') {
    return ROTEIROS.filter((c) => op.incluirOpcionais || !c.opcional).map((c) => roteiro(c.id, op)!);
  }
  return lista.map((i) => {
    const c = roteiro(i.trim(), op);
    if (!c) throw new Error(`caso de diff desconhecido: ${i} (conhecidos: ${ROTEIROS.map((x) => x.id).join(', ')})`);
    return c;
  });
}
