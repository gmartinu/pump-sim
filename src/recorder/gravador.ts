import fs from 'node:fs';
import type { Clock } from '../core/clock.js';
import type { GanchosTcp, InfoConexao } from '../transport/tcp.js';
import { type LinhaGravacao, linha, serializar } from './formato.js';

/**
 * Records all raw traffic of the TCP server as JSONL (format in `formato.ts`).
 * Without `arquivo`, keeps it in memory only (`linhas`). Writing is synchronous per line:
 * the file stays consistent even if the process dies.
 */
export class Gravador {
  readonly linhas: LinhaGravacao[] = [];
  private ativo = true;
  /** Start instant (simulator clock). */
  readonly inicio: number;
  /** rx + tx lines written so far. */
  quadros = 0;
  /** Raw bytes of rx + tx written so far. */
  bytes = 0;

  constructor(
    private readonly clock: Clock,
    readonly arquivo: string | null = null,
    meta: Record<string, unknown> = {},
    private readonly guardarEmMemoria = arquivo === null,
  ) {
    this.inicio = clock.now();
    if (arquivo) fs.writeFileSync(arquivo, '');
    this.escrever({ ts: clock.now(), porta: 0, conexao: 0, dir: 'meta', bytes: '', meta: { formato: 'pump-sim/trafego@1', ...meta } });
  }

  get gravando(): boolean {
    return this.ativo;
  }

  private escrever(l: LinhaGravacao): void {
    if (!this.ativo) return;
    if (this.guardarEmMemoria) this.linhas.push(l);
    if (this.arquivo) fs.appendFileSync(this.arquivo, serializar(l) + '\n');
  }

  registrar(info: Pick<InfoConexao, 'id' | 'logica'>, dir: 'rx' | 'tx' | 'abre' | 'fecha', bytes: Buffer = Buffer.alloc(0)): void {
    if (this.ativo && (dir === 'rx' || dir === 'tx')) {
      this.quadros++;
      this.bytes += bytes.length;
    }
    this.escrever(linha(this.clock.now(), info.logica, info.id, dir, bytes));
  }

  /** Transport hooks that feed this recorder. */
  ganchos(): Required<Pick<GanchosTcp, 'aoConectar' | 'aoFechar' | 'aoReceber' | 'aoEnviar'>> {
    return {
      aoConectar: (i) => this.registrar(i, 'abre'),
      aoFechar: (i) => this.registrar(i, 'fecha'),
      aoReceber: (i, b) => this.registrar(i, 'rx', b),
      aoEnviar: (i, b) => this.registrar(i, 'tx', b),
    };
  }

  parar(): { arquivo: string | null; linhas: number } {
    this.ativo = false;
    const n = this.arquivo ? fs.readFileSync(this.arquivo, 'utf8').split('\n').filter(Boolean).length : this.linhas.length;
    return { arquivo: this.arquivo, linhas: n };
  }
}
