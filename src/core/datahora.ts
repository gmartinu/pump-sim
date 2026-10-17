import type { Clock } from './clock.js';

/** "Wall" date/time already in the concentrator's time zone. */
export interface DataHora {
  ano: number; // 4 digits
  mes: number; // 1..12
  dia: number; // 1..31
  hora: number;
  minuto: number;
  segundo: number;
  /** 1 = Sunday … 7 = Saturday (DT435 §3.6.2 convention). */
  diaSemana: number;
}

/** The 7 one-byte RTC fields of the 2.7.2. `ano` = 2 digits. */
export interface CamposRtc {
  ano: number;
  mes: number;
  dia: number;
  diaSemana: number;
  hora: number;
  minuto: number;
  segundo: number;
}

function camposDe(d: DataHora, diaSemana: number): CamposRtc {
  return { ano: d.ano % 100, mes: d.mes, dia: d.dia, diaSemana, hora: d.hora, minuto: d.minuto, segundo: d.segundo };
}

/**
 * 2.7.2 clock timer, `n` 1 s ticks. Each tick adds 1 to the second and then
 * tests, field by field and **by equality** (not by carry): second 60 → 0 and minute+1;
 * minute 60 → 0 and hour+1; hour 24 → 0 and day+1; day 32 → 1 and month+1; month 13 → 1 and year+1.
 * There is no calendar: every month has 31 days. The weekday never changes. The fields are
 * bytes: an out-of-range value (hour 25) only comes back after wrapping around 256.
 */
export function avancarCampos(c: CamposRtc, n: number): CamposRtc {
  const x = { ...c };
  let resta = n;
  while (resta > 0) {
    if (x.minuto !== 60 && x.hora !== 24 && x.dia !== 32 && x.mes !== 13) {
      // No test applies now: until the second reaches 60, a tick only adds to the second.
      const ate60 = (((60 - x.segundo) % 256) + 256) % 256 || 256;
      const pulo = Math.min(resta, ate60 - 1);
      if (pulo > 0) {
        x.segundo = (x.segundo + pulo) & 0xff;
        resta -= pulo;
        continue;
      }
    }
    x.segundo = (x.segundo + 1) & 0xff;
    if (x.segundo === 60) {
      x.segundo = 0;
      x.minuto = (x.minuto + 1) & 0xff;
    }
    if (x.minuto === 60) {
      x.minuto = 0;
      x.hora = (x.hora + 1) & 0xff;
    }
    if (x.hora === 24) {
      x.hora = 0;
      x.dia = (x.dia + 1) & 0xff;
    }
    if (x.dia === 32) {
      x.dia = 1;
      x.mes = (x.mes + 1) & 0xff;
    }
    if (x.mes === 13) {
      x.mes = 1;
      x.ano = (x.ano + 1) & 0xff;
    }
    resta--;
  }
  return x;
}

export function dataHoraDeEpoch(ms: number, offsetMinutos: number): DataHora {
  const d = new Date(ms + offsetMinutos * 60_000);
  return {
    ano: d.getUTCFullYear(),
    mes: d.getUTCMonth() + 1,
    dia: d.getUTCDate(),
    hora: d.getUTCHours(),
    minuto: d.getUTCMinutes(),
    segundo: d.getUTCSeconds(),
    diaSemana: d.getUTCDay() + 1,
  };
}

export function epochDeDataHora(dh: Omit<DataHora, 'diaSemana'>, offsetMinutos: number): number {
  return (
    Date.UTC(dh.ano, dh.mes - 1, dh.dia, dh.hora, dh.minuto, dh.segundo) - offsetMinutos * 60_000
  );
}

/**
 * Simulated concentrator clock (RTC). Stores only an offset over the
 * `Clock`, so it moves along with it and is deterministic in tests.
 */
export class RelogioSimulado {
  private deslocamentoMs = 0;
  /** Stopped RTC (control): simulated instant at which it froze. */
  private congeladoMs: number | null = null;
  /**
   * Quirk RTC_272: the 2.7.2 keeps the clock in 7 one-byte fields (clock timer, no
   * calendar). `campos` = the fields stored by &KW/&H and the (RTC) instant they
   * refer to; the clock timer advances them 1 s per tick from there (`avancarCampos`).
   * Without `campos`, the calendar applies with the stored weekday (`diaSemanaCampo`, which
   * starts at 00; DIFF-12, bench 17/10).
   */
  private campos: { c: CamposRtc; baseMs: number } | null = null;
  private diaSemanaCampo = 0;

  constructor(
    private readonly clock: Clock,
    readonly offsetMinutos: number,
  ) {}

  agora(): DataHora {
    return dataHoraDeEpoch(this.agoraMs(), this.offsetMinutos);
  }

  /** RTC instant in ms (Unix epoch, without the time zone). */
  agoraMs(): number {
    return this.congeladoMs ?? this.clock.now() + this.deslocamentoMs;
  }

  get congelado(): boolean {
    return this.congeladoMs !== null;
  }

  /** Stops (or releases) the RTC. Released, it goes on from where it stopped. */
  congelar(on: boolean): void {
    if (on && this.congeladoMs === null) this.congeladoMs = this.agoraMs();
    if (!on && this.congeladoMs !== null) {
      this.deslocamentoMs = this.congeladoMs - this.clock.now();
      this.congeladoMs = null;
    }
  }

  get deslocamento(): number {
    return this.deslocamentoMs;
  }

  /** Restores the RTC (snapshot). */
  definirDeslocamento(ms: number, congeladoMs: number | null = null): void {
    this.deslocamentoMs = ms;
    this.congeladoMs = congeladoMs;
  }

  /** Sets the RTC to an absolute instant (ms, Unix epoch). */
  definirInstante(ms: number): void {
    if (this.congeladoMs !== null) this.congeladoMs = ms;
    else this.deslocamentoMs = ms - this.clock.now();
  }

  get instanteCongelado(): number | null {
    return this.congeladoMs;
  }

  /** "PC" date/time (the injectable clock without the RTC offset). */
  agoraPc(): DataHora {
    return dataHoraDeEpoch(this.clock.now(), this.offsetMinutos);
  }

  ajustar(parcial: Partial<Omit<DataHora, 'diaSemana'>>): void {
    const atual = this.agora();
    const alvo = { ...atual, ...parcial };
    // Calendar adjustment (control, &H of the real profiles): the RTC_272 fields are dropped.
    this.campos = null;
    this.definirInstante(epochDeDataHora(alvo, this.offsetMinutos));
  }

  /** RTC_272: the date/time as the 2.7.2 keeps it (raw fields, advanced by the clock timer). */
  agoraPorCampos(): DataHora {
    const c = this.camposAgora();
    if (!c) return { ...this.agora(), diaSemana: this.diaSemanaCampo };
    return { ano: 2000 + c.ano, mes: c.mes, dia: c.dia, hora: c.hora, minuto: c.minuto, segundo: c.segundo, diaSemana: c.diaSemana };
  }

  /** RTC_272: the current 7 fields (null = still on the calendar). Advances the cache by the due ticks. */
  private camposAgora(): CamposRtc | null {
    if (!this.campos) return null;
    const ticks = Math.floor((this.agoraMs() - this.campos.baseMs) / 1000);
    if (ticks > 0) {
      this.campos = { c: avancarCampos(this.campos.c, ticks), baseMs: this.campos.baseMs + ticks * 1000 };
    }
    return { ...this.campos.c };
  }

  /**
   * RTC_272: stores fields (&KW/&H), without range validation. Missing ones come from the current value.
   * The 1st clock-timer tick after the write comes 1 s after it. The 2.7.2's clock timer runs at a
   * free phase (set when the app starts; `&KW` does not restart it, measured in DECISIONS §27), so its
   * 1st tick comes 0–1000 ms after the write; B's choice (phase = the write) is one admissible value,
   * and the diff scripts mask the seconds' units digit where the phase shows.
   */
  gravarCampos(parcial: Partial<CamposRtc>): void {
    const d = this.camposAgora() ?? camposDe(this.agora(), this.diaSemanaCampo);
    const c = { ...d };
    for (const [k, v] of Object.entries(parcial) as [keyof CamposRtc, number][]) c[k] = v & 0xff;
    this.campos = { c, baseMs: this.agoraMs() };
  }

  /** Snapshot (RTC_272). Accepts the old `{ano, mes, dia}` format (date outside the calendar). */
  definirCampos(campos: { c: CamposRtc; baseMs: number } | { ano: number; mes: number; dia: number } | null, diaSemana: number): void {
    this.diaSemanaCampo = diaSemana;
    if (!campos) this.campos = null;
    else if ('c' in campos) this.campos = { c: { ...campos.c }, baseMs: campos.baseMs };
    else this.campos = { c: { ...camposDe(this.agora(), diaSemana), ano: campos.ano % 100, mes: campos.mes, dia: campos.dia }, baseMs: this.agoraMs() };
  }

  get estadoCampos(): { campos: { c: CamposRtc; baseMs: number } | null; diaSemana: number } {
    this.camposAgora();
    return { campos: this.campos ? { c: { ...this.campos.c }, baseMs: this.campos.baseMs } : null, diaSemana: this.diaSemanaCampo };
  }

  /** Sets the RTC back to the PC clock. */
  sincronizarComPc(): void {
    this.deslocamentoMs = 0;
    this.congeladoMs = null;
    this.campos = null;
  }
}
