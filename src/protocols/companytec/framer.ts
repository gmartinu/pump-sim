/**
 * Server-side framing.
 *
 * - `leituraUnica` (Q1, 2.7.2, behavioral equivalence): each socket read is one command. If the
 *   chunk starts with `(`/`>` and has `)`, extracts up to the 1st `)` (only the 1st frame is
 *   served); otherwise the whole chunk goes to the parser (and falls into "ERRO CMD").
 *   Nothing stays pending between reads. A chunk without `)` goes whole to the parser, which
 *   dispatches by prefix the verbs without KK (`&I`, `&S`, `&R`, `&KW`, `&V`, `&H`, `&E`;
 *   behavioral equivalence, verdict #2): `(&S` is served in ~3 ms without waiting for the `)` (DIFF-04,
 *   step 9) and a `)` arriving later gets no reply. Verbs with KK
 *   (`(&T04L`, `(&T08L2E`) stay silent. `processarCompanytec` decides.
 * - `fluxo` (real profiles): accumulates bytes, discards garbage before `(`/`>`, closes the
 *   CBC frame at `)` and the Horustech one by the CCCC length (with no readable CCCC, at
 *   CR/LF or at the end of the chunk). Each complete frame is served, in order, and a
 *   frame split across several TCP segments is reassembled.
 */
export type ModoFramer = 'leituraUnica' | 'fluxo';

const LIMITE = 1024;

export class Framer {
  private acc = '';

  constructor(public modo: ModoFramer) {}

  /** Receives a chunk (already decoded as latin1) and returns the frames to serve. */
  receber(pedaco: string): string[] {
    return this.modo === 'leituraUnica' ? this.leituraUnica(pedaco) : this.fluxo(pedaco);
  }

  private leituraUnica(texto: string): string[] {
    if (texto.length === 0) return [];
    const ini = texto[0];
    if (ini === '(' || ini === '>') {
      const fim = texto.indexOf(')');
      if (fim >= 0) return [texto.slice(0, fim + 1)];
    }
    return [texto];
  }

  private fluxo(pedaco: string): string[] {
    this.acc += pedaco;
    const out: string[] = [];
    for (;;) {
      const ini = this.acc.search(/[(>]/);
      if (ini < 0) {
        this.acc = '';
        break;
      }
      if (ini > 0) this.acc = this.acc.slice(ini);
      if (this.acc[0] === '(') {
        const prox = this.acc.indexOf('(', 1);
        const fim = this.acc.indexOf(')');
        if (prox >= 0 && (fim < 0 || prox < fim)) {
          // new "(" before closing: resynchronizes (like the serial RxChar).
          this.acc = this.acc.slice(prox);
          continue;
        }
        if (fim < 0) break;
        out.push(this.acc.slice(0, fim + 1));
        this.acc = this.acc.slice(fim + 1);
      } else {
        // Horustech: CCCC gives the frame length (8 + CCCC); no terminator (DT214 p.3).
        const cab = /^>[?!]([0-9A-Fa-f]{4})/.exec(this.acc);
        if (cab) {
          const total = 8 + parseInt(cab[1]!, 16);
          if (this.acc.length < total) break;
          out.push(this.acc.slice(0, total));
          this.acc = this.acc.slice(total);
          continue;
        }
        if (this.acc.length < 6 && /^>[?!]?[0-9A-Fa-f]*$/.test(this.acc)) break; // incomplete header
        const m = /[\r\n(]/.exec(this.acc.slice(1));
        if (!m) {
          out.push(this.acc);
          this.acc = '';
          break;
        }
        const fim = m.index + 1;
        out.push(this.acc.slice(0, fim));
        this.acc = this.acc.slice(fim);
      }
    }
    if (this.acc.length > LIMITE) this.acc = '';
    return out.filter((q) => q.length > 0);
  }
}
