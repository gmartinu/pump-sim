import net from 'node:net';
import { obterPerfil, IDS_PERFIS, type PerfilId } from '../profiles/index.js';
import { Framer, type ModoFramer } from '../protocols/companytec/framer.js';
import { type Alvo, ClienteTcp } from '../net/cliente-tcp.js';
import { type LinhaGravacao, type TrocaGravada, trocas } from './formato.js';

const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ───────────────────────── replay server ─────────────────────────

export interface OpcoesServidorReplay {
  host?: string;
  /** Recorded logical port → port to listen on (0 = ephemeral). Default: the same. */
  mapa?: Record<string, number>;
  /** 1 = honors the recorded latency; 0 = replies at once; 2 = twice as fast. */
  velocidade?: number;
  /** Forces the framing. Default: the recording's (`enquadramentoDaGravacao`). */
  enquadramento?: ModoFramer;
}

/**
 * Framing of the recorded profile: `meta.enquadramento` (new recordings) or, without it,
 * the one of `meta.perfil` (Q1 → `leituraUnica`, like the 2.7.2: each read is one command and
 * only the 1st of two glued frames is served). With neither, `fluxo`.
 */
export function enquadramentoDaGravacao(linhas: LinhaGravacao[]): ModoFramer {
  const meta = linhas.find((l) => l.dir === 'meta')?.meta ?? {};
  if (meta.enquadramento === 'leituraUnica' || meta.enquadramento === 'fluxo') return meta.enquadramento;
  const perfil = meta.perfil;
  if (typeof perfil === 'string' && (IDS_PERFIS as readonly string[]).includes(perfil)) {
    return obterPerfil(perfil as PerfilId).quirks.Q1 ? 'leituraUnica' : 'fluxo';
  }
  return 'fluxo';
}

interface Resposta {
  tx: Buffer;
  latenciaMs: number | null;
}

/**
 * Plays the recorded concentrator: for each frame arriving on a port,
 * returns the `tx` that followed the same frame in the recording, in recorded order
 * (repeats of the same frame consume the replies in sequence; once exhausted,
 * repeats the last one). A frame never seen = silence, counted in `naoEncontrados`.
 *
 * Matching is per frame, with the recorded profile's framing: in `fluxo`
 * (real profiles) it works even if the client fragments differently from the recording and, in a
 * recorded rx with several frames, the tx goes to the last of them; in `leituraUnica`
 * (2.7.2) each read is one command, as on the recorded console.
 */
export class ServidorReplay {
  private servidores: { porta: string; fisica: number; server: net.Server; sockets: Set<net.Socket> }[] = [];
  private readonly tabela = new Map<string, Map<string, { respostas: Resposta[]; cursor: number }>>();
  atendidos = 0;
  naoEncontrados: string[] = [];

  private constructor(
    linhas: LinhaGravacao[],
    private readonly velocidade: number,
    readonly enquadramento: ModoFramer,
  ) {
    const porConexao = new Map<number, Framer>();
    for (const t of trocas(linhas)) {
      let f = porConexao.get(t.conexao);
      if (!f) porConexao.set(t.conexao, (f = new Framer(enquadramento)));
      const quadros = f.receber(t.rx.toString('latin1'));
      if (quadros.length === 0) continue;
      const porta = String(t.porta);
      let mapa = this.tabela.get(porta);
      if (!mapa) this.tabela.set(porta, (mapa = new Map()));
      quadros.forEach((q, i) => {
        const ultima = i === quadros.length - 1;
        let e = mapa.get(q);
        if (!e) mapa.set(q, (e = { respostas: [], cursor: 0 }));
        e.respostas.push(ultima ? { tx: t.tx, latenciaMs: t.latenciaMs } : { tx: Buffer.alloc(0), latenciaMs: null });
      });
    }
  }

  static async abrir(linhas: LinhaGravacao[], op: OpcoesServidorReplay = {}): Promise<ServidorReplay> {
    const s = new ServidorReplay(linhas, op.velocidade ?? 0, op.enquadramento ?? enquadramentoDaGravacao(linhas));
    for (const porta of s.tabela.keys()) {
      const pedida = op.mapa?.[porta] ?? Number(porta);
      if (!Number.isInteger(pedida)) continue;
      await s.ouvir(porta, pedida, op.host ?? '0.0.0.0');
    }
    return s;
  }

  private ouvir(porta: string, pedida: number, host: string): Promise<void> {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((sock) => {
      sockets.add(sock);
      sock.setNoDelay(true);
      const framer = new Framer(this.enquadramento);
      let fila = Promise.resolve();
      sock.on('data', (b) => {
        for (const q of framer.receber(b.toString('latin1'))) {
          const r = this.responder(porta, q);
          if (!r || r.tx.length === 0) continue;
          const atraso = this.velocidade > 0 && r.latenciaMs ? r.latenciaMs / this.velocidade : 0;
          fila = fila.then(async () => {
            if (atraso) await espera(atraso);
            if (!sock.destroyed) sock.write(r.tx);
          });
        }
      });
      sock.on('close', () => sockets.delete(sock));
      sock.on('error', () => undefined);
    });
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(pedida, host, () => {
        const a = server.address();
        this.servidores.push({ porta, fisica: typeof a === 'object' && a ? a.port : pedida, server, sockets });
        resolve();
      });
    });
  }

  private responder(porta: string, quadro: string): Resposta | null {
    const e = this.tabela.get(porta)?.get(quadro);
    if (!e || e.respostas.length === 0) {
      this.naoEncontrados.push(quadro);
      return null;
    }
    const r = e.respostas[Math.min(e.cursor, e.respostas.length - 1)]!;
    e.cursor++;
    this.atendidos++;
    return r;
  }

  portas(): { porta: string; fisica: number }[] {
    return this.servidores.map(({ porta, fisica }) => ({ porta, fisica }));
  }

  async fechar(): Promise<void> {
    await Promise.all(
      this.servidores.map(
        (s) =>
          new Promise<void>((r) => {
            for (const k of s.sockets) k.destroy();
            s.server.close(() => r());
          }),
      ),
    );
    this.servidores = [];
  }
}

// ───────────────────────── replay client ─────────────────────────

export interface OpcoesClienteReplay {
  /** Recorded logical port → target. Without an entry, uses the default `host` and the same port. */
  alvos?: Record<string, Alvo>;
  host?: string;
  /** 1 = honors the recorded intervals between sends; 0 = as fast as possible. */
  velocidade?: number;
  timeoutMs?: number;
}

export interface DivergenciaReplay {
  indice: number;
  porta: string;
  conexao: number;
  rx: string;
  esperado: string;
  obtido: string;
  /** 1st differing byte (−1 = only the length differs). */
  byte: number;
}

export interface ResultadoReplay {
  trocas: number;
  iguais: number;
  divergencias: DivergenciaReplay[];
}

export function primeiroByteDiferente(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/**
 * Replays the client side of a recording against a target (the simulator or a
 * real concentrator): one connection per recorded connection, the same `rx` in the same
 * order, and compares the reply byte by byte with the recorded `tx`.
 */
export async function replayCliente(linhas: LinhaGravacao[], op: OpcoesClienteReplay = {}): Promise<ResultadoReplay> {
  const todas = trocas(linhas);
  const res: ResultadoReplay = { trocas: 0, iguais: 0, divergencias: [] };
  const conexoes = new Map<number, ClienteTcp>();
  const velocidade = op.velocidade ?? 0;
  let anterior: TrocaGravada | null = null;
  try {
    for (let i = 0; i < todas.length; i++) {
      const t = todas[i]!;
      if (anterior && velocidade > 0) {
        const dt = (t.ts - anterior.ts) / velocidade;
        if (dt > 0) await espera(Math.min(dt, 10_000));
      }
      anterior = t;
      let c = conexoes.get(t.conexao);
      if (!c) {
        const alvo = op.alvos?.[String(t.porta)] ?? { host: op.host ?? '127.0.0.1', porta: Number(t.porta) };
        c = await ClienteTcp.conectar(alvo);
        conexoes.set(t.conexao, c);
      }
      const r = await c.trocar([t.rx], { timeoutMs: op.timeoutMs ?? (t.tx.length ? 1000 : 300) });
      res.trocas++;
      const byte = primeiroByteDiferente(t.tx, r.bytes);
      if (byte === -1) res.iguais++;
      else
        res.divergencias.push({
          indice: i,
          porta: String(t.porta),
          conexao: t.conexao,
          rx: t.rx.toString('latin1'),
          esperado: t.tx.toString('latin1'),
          obtido: r.bytes.toString('latin1'),
          byte,
        });
    }
  } finally {
    for (const c of conexoes.values()) c.fechar();
  }
  return res;
}
