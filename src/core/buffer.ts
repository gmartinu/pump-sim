import type { Registro } from './modelo.js';

/**
 * Circular fueling buffer with one write pointer and N read-pointer
 * groups (one per port on real profiles, a single one on the 2.7.2).
 *
 * Convention: a record stored at position `escrita` gets R = `escrita`, and the
 * write pointer advances. Empty for a reader ⇔ read == write (DT432 p.4).
 */
export interface PonteirosLeitura {
  leitura: number;
}

export interface OpcoesBuffer {
  posMin: number;
  posMax: number;
  /** Q4: on reaching a read pointer, the write pointer pushes the read pointer (drops the oldest). */
  descartaMaisAntigo: boolean;
}

export interface EstadoBuffer {
  escrita: number;
  registros: Registro[];
  /** group → read pointer */
  grupos: Record<string, number>;
}

export class BufferAbastecimentos {
  private readonly registros = new Map<number, Registro>();
  escrita: number;
  private readonly grupos = new Map<string, PonteirosLeitura>();

  constructor(readonly opcoes: OpcoesBuffer) {
    this.escrita = opcoes.posMin;
  }

  get capacidade(): number {
    return this.opcoes.posMax - this.opcoes.posMin + 1;
  }

  proxima(pos: number): number {
    return pos >= this.opcoes.posMax ? this.opcoes.posMin : pos + 1;
  }

  grupo(id: string): PonteirosLeitura {
    let g = this.grupos.get(id);
    if (!g) {
      g = { leitura: this.opcoes.posMin };
      this.grupos.set(id, g);
    }
    return g;
  }

  gruposIds(): string[] {
    return [...this.grupos.keys()];
  }

  /** Stores and returns the position used. Discard events go to `onDescarte`. */
  gravar(montar: (posicao: number) => Registro, onDescarte?: (grupo: string) => void): Registro {
    const pos = this.escrita;
    const reg = montar(pos);
    this.registros.set(pos, reg);
    this.escrita = this.proxima(pos);
    if (this.opcoes.descartaMaisAntigo) {
      for (const [id, g] of this.grupos) {
        if (g.leitura === this.escrita) {
          g.leitura = this.proxima(g.leitura);
          onDescarte?.(id);
        }
      }
    }
    return reg;
  }

  ler(pos: number): Registro | undefined {
    return this.registros.get(pos);
  }

  vazio(grupo: string): boolean {
    return this.grupo(grupo).leitura === this.escrita;
  }

  /** &I: advances the read pointer if not empty. Returns true if it advanced. */
  incrementar(grupo: string): boolean {
    const g = this.grupo(grupo);
    if (g.leitura === this.escrita) return false;
    g.leitura = this.proxima(g.leitura);
    return true;
  }

  /** K18: synchronizes (read = write) or sets a value. */
  definirLeitura(grupo: string, valor: number = this.escrita): void {
    this.grupo(grupo).leitura = valor;
  }

  /** Forces the write pointer (the 2.7.2 identified-records pointer bug, verdict #13). */
  definirEscrita(valor: number): void {
    this.escrita = valor;
  }

  todos(): Registro[] {
    return [...this.registros.values()].sort((a, b) => a.posicao - b.posicao);
  }

  /** Serializable state (snapshot / profile switch). */
  exportar(): EstadoBuffer {
    return {
      escrita: this.escrita,
      registros: this.todos().map((r) => structuredClone(r)),
      grupos: Object.fromEntries([...this.grupos].map(([id, g]) => [id, g.leitura])),
    };
  }

  /** Restores what fits in this buffer's positions (the rest is discarded). */
  importar(e: EstadoBuffer): void {
    const dentro = (p: number) => p >= this.opcoes.posMin && p <= this.opcoes.posMax;
    this.registros.clear();
    for (const r of e.registros) if (dentro(r.posicao)) this.registros.set(r.posicao, structuredClone(r));
    this.escrita = dentro(e.escrita) ? e.escrita : this.opcoes.posMin;
    for (const [id, leitura] of Object.entries(e.grupos)) this.grupo(id).leitura = dentro(leitura) ? leitura : this.escrita;
  }

  limpar(): void {
    this.registros.clear();
    this.escrita = this.opcoes.posMin;
    for (const g of this.grupos.values()) g.leitura = this.opcoes.posMin;
  }
}
