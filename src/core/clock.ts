/**
 * Injectable clock. The domain never calls `Date.now()` directly: it receives a
 * `Clock` and asks it. Tests use `ManualClock`, which only moves when
 * the test tells it to.
 */
export interface Clock {
  /** Milliseconds since the Unix epoch (UTC). */
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class ManualClock implements Clock {
  private t: number;

  constructor(inicio: number | Date = Date.UTC(2026, 0, 1, 12, 0, 0)) {
    this.t = typeof inicio === 'number' ? inicio : inicio.getTime();
  }

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (ms < 0) throw new RangeError('ManualClock não anda para trás');
    this.t += ms;
  }

  set(ms: number | Date): void {
    this.t = typeof ms === 'number' ? ms : ms.getTime();
  }
}
