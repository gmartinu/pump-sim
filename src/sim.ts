import { Concentrador, type OpcoesConcentrador } from './core/concentrador.js';
import type { Clock } from './core/clock.js';
import { Framer, type ModoFramer } from './protocols/companytec/framer.js';
import { processarCompanytec } from './protocols/companytec/handlers.js';
import { processarHorustech } from './protocols/horustech/handlers.js';
import { processarIdentfid } from './protocols/identfid/handlers.js';
import { type Perfil, type PerfilId, type Quirks, obterPerfil } from './profiles/index.js';

export interface OpcoesSimulador extends Omit<OpcoesConcentrador, 'perfil'> {
  perfil: PerfilId | Perfil;
}

/** Result of any codec: `resposta` null = silence; `travar` = MessageBox (Q2). */
export interface ResultadoCodec {
  resposta: string | null;
  verbo: string | null;
  travar?: string;
  /** Reply that only goes out after the OK of the `travar` modal (E3). */
  aposOk?: string;
  erro?: string;
}

export interface ResultadoQuadro extends Partial<ResultadoCodec> {
  quadro: string;
  resposta: string | null;
  /** Reply held behind an open modal: resolves on OK (`liberarTravamento` or deadline). */
  adiada?: Promise<string>;
}

/** `?` branch frames the 2.7.2 parser matches by exact string, before anything else. */
const EXATOS_IDF_272 = new Set(['(?A80)', '(?V95)', '(?S92)']);
const FUNCOES_HORUSTECH_272 = new Set(['02', '06', '32']);

/**
 * DESPACHO_272 (behavioral equivalence, verdict #3/#5/#6/#7). The parser only tests `&` at char 2, so
 * the 1st char is free (`X&S)` answers as `&S`; the KK check rebuilds the frame with `(`, so
 * only the verbs without KK get through). Otherwise the `?` branch is entered when char 2 is
 * `?` with the CBC-06 model, or for any frame with the Horustech model. Inside it: the exact
 * `(?A80)`/`(?V95)`/`(?S92)`, then `?D` and `?I`, then **chars 7-8 = 02/06/32 → Horustech**
 * (also for `(?LF0006…)` and `(?C001020…)`), and only then `?F`/`?C`/`?LF`. `>!…` on CBC-06
 * is "ERRO CMD".
 */
function despachar272(c: Concentrador, porta: string, quadro: string): ResultadoCodec {
  if (quadro[1] === '&') return processarCompanytec(c, porta, quadro);
  const idf = c.perfil.identfid;
  const ramo = (quadro[1] === '?' && c.modelo === 'CBC-06') || c.modelo === 'Horustech';
  if (!ramo || !idf || (idf.modelos && !idf.modelos.includes(c.modelo))) {
    return { resposta: null, verbo: null, erro: 'ERRO CMD' };
  }
  if (EXATOS_IDF_272.has(quadro) || quadro[2] === 'D' || quadro[2] === 'I') return processarIdentfid(c, porta, quadro);
  if (FUNCOES_HORUSTECH_272.has(quadro.slice(6, 8))) return processarHorustech(c, porta, quadro);
  return processarIdentfid(c, porta, quadro);
}

/**
 * Facade: the core (`Concentrador`) + the codecs `(&…)`, Identfid `(?…)` and
 * Horustech `>?` (02/06/32). What each profile accepts is profile data.
 */
export class PumpSim {
  readonly conc: Concentrador;

  constructor(op: OpcoesSimulador) {
    const perfil = typeof op.perfil === 'string' ? obterPerfil(op.perfil) : op.perfil;
    this.conc = new Concentrador({ ...op, perfil });
  }

  get clock(): Clock {
    return this.conc.clock;
  }

  get quirks(): Quirks {
    return this.conc.quirks;
  }

  /** Framing that applies now: comes from the current state's Q1 (can change with the connection open). */
  modoFramer(): ModoFramer {
    return this.conc.quirks.Q1 ? 'leituraUnica' : 'fluxo';
  }

  novoFramer(): Framer {
    return new Framer(this.modoFramer());
  }

  /** Serves an already framed frame. `porta` = "tcp:2001", "serial:COM1"… */
  processarQuadro(quadro: string, porta = 'tcp:2001'): ResultadoQuadro {
    const c = this.conc;
    c.atualizar();
    c.registrarLog(porta, 'RX', quadro);
    // Q2 (2.7.2): the modal runs a nested message loop and the socket keeps serving
    // (verdict #8; bench error notes; bench modal 10053). Without Q2 the freeze
    // is the synthetic "frozen console" fault and silences everything.
    if (c.estaTravado() && !c.q('Q2')) {
      c.registrarLog(porta, 'INFO', `travado: ${c.travamento?.motivo ?? ''}`);
      return { quadro, resposta: null, erro: 'travado' };
    }
    let r: ResultadoCodec;
    if (c.q('DESPACHO_272')) {
      r = despachar272(c, porta, quadro);
    } else if (quadro.startsWith('(&')) {
      r = processarCompanytec(c, porta, quadro);
    } else if (quadro.startsWith('(?')) {
      r = processarIdentfid(c, porta, quadro);
    } else if (quadro.startsWith('>')) {
      r = processarHorustech(c, porta, quadro);
    } else {
      r = { resposta: null, verbo: null, erro: 'ERRO CMD' };
    }
    let adiada: Promise<string> | undefined;
    if (r.travar) {
      const m = c.travar(r.travar, r.aposOk ?? null);
      if (m.imediata) r = { ...r, resposta: m.imediata };
      adiada = m.adiada?.then((t) => {
        c.registrarLog(porta, 'TX', t);
        return t;
      });
    }
    if (r.erro === 'ERRO CMD') c.registrarLog(porta, 'ERRO', `ERRO CMD: ${quadro}`);
    if (r.resposta) c.registrarLog(porta, 'TX', r.resposta);
    return adiada ? { quadro, ...r, adiada } : { quadro, ...r };
  }

  /** "Simular comando": frames the text as if it had arrived in one read and returns the replies. */
  enviar(texto: string, porta = 'tcp:2001'): (string | null)[] {
    return this.novoFramer()
      .receber(texto)
      .map((q) => this.processarQuadro(q, porta).resposta);
  }

  /** Shortcut: one reply (or null) for a request. */
  pedir(texto: string, porta = 'tcp:2001'): string | null {
    return this.enviar(texto, porta)[0] ?? null;
  }

  atualizar(): void {
    this.conc.atualizar();
  }
}
