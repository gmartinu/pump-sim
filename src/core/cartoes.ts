import type { Cartao, Registro } from './modelo.js';
import type { DataHora } from './datahora.js';

/**
 * Positional identifier registry (?F G/A/L, ?LF). The position is 0-based,
 * as in the DT435 p.16 example (1st card stored at 000000). A delete leaves
 * a hole; the next write takes the first hole.
 */
export class CadastroCartoes {
  private readonly slots: (Cartao | null)[] = [];
  private readonly porCodigo = new Map<string, number>();

  constructor(readonly capacidade: number) {}

  get quantidade(): number {
    return this.porCodigo.size;
  }

  get(codigo: string): Cartao | undefined {
    const i = this.porCodigo.get(codigo.toUpperCase());
    return i === undefined ? undefined : (this.slots[i] ?? undefined);
  }

  posicaoDe(codigo: string): number | undefined {
    return this.porCodigo.get(codigo.toUpperCase());
  }

  em(posicao: number): Cartao | undefined {
    return this.slots[posicao] ?? undefined;
  }

  /** Stores or updates. Returns the position, or null when memory is full. */
  gravar(c: Cartao): number | null {
    const cod = c.codigo.toUpperCase();
    const atual = this.porCodigo.get(cod);
    const cartao = { ...c, codigo: cod };
    if (atual !== undefined) {
      this.slots[atual] = cartao;
      return atual;
    }
    if (this.porCodigo.size >= this.capacidade) return null;
    let pos = this.slots.indexOf(null);
    if (pos < 0) pos = this.slots.length;
    this.slots[pos] = cartao;
    this.porCodigo.set(cod, pos);
    return pos;
  }

  /** Deletes by code. Returns the freed position, or null if there was none. */
  excluir(codigo: string): number | null {
    const cod = codigo.toUpperCase();
    const pos = this.porCodigo.get(cod);
    if (pos === undefined) return null;
    this.slots[pos] = null;
    this.porCodigo.delete(cod);
    return pos;
  }

  limpar(): void {
    this.slots.length = 0;
    this.porCodigo.clear();
  }

  importar(lista: { posicao: number; cartao: Cartao }[]): void {
    this.limpar();
    for (const { posicao, cartao } of lista) {
      if (this.porCodigo.size >= this.capacidade) break;
      while (this.slots.length < posicao) this.slots.push(null);
      this.slots[posicao] = { ...cartao };
      this.porCodigo.set(cartao.codigo.toUpperCase(), posicao);
    }
  }

  todos(): { posicao: number; cartao: Cartao }[] {
    const out: { posicao: number; cartao: Cartao }[] = [];
    this.slots.forEach((c, posicao) => {
      if (c) out.push({ posicao, cartao: c });
    });
    return out;
  }
}

export interface IdPendente {
  posicao: number;
  codigo: string;
  codigoBico: number;
  data: DataHora;
}

export interface EstadoFilaIds {
  escrita: number;
  celulas: IdPendente[];
  grupos: Record<string, number>;
}

/**
 * Queue of unregistered identifiers (?A / ?I). Circular buffer with a write pointer
 * and one read pointer per group (port on the real ones; single on the 2.7.2).
 *
 * `porCelula` (quirk IDF_272): the read looks only at the pointer's cell (empty → (0))
 * and ?I always advances, wrapping to the start after the end (, 8192 → 1).
 */
export class FilaIdsPendentes {
  private readonly celulas = new Map<number, IdPendente>();
  escrita: number;
  private readonly grupos = new Map<string, { leitura: number }>();

  constructor(
    readonly posMin: number,
    readonly posMax: number,
    readonly porCelula: boolean,
  ) {
    this.escrita = posMin;
  }

  private proxima(p: number): number {
    return p >= this.posMax ? this.posMin : p + 1;
  }

  private grupo(id: string): { leitura: number } {
    let g = this.grupos.get(id);
    if (!g) {
      g = { leitura: this.posMin };
      this.grupos.set(id, g);
    }
    return g;
  }

  leitura(grupo: string): number {
    return this.grupo(grupo).leitura;
  }

  adicionar(codigo: string, codigoBico: number, data: DataHora): IdPendente {
    const posicao = this.escrita;
    const id = { posicao, codigo, codigoBico, data };
    this.celulas.set(posicao, id);
    this.escrita = this.proxima(posicao);
    if (!this.porCelula) {
      // Full: discards the oldest, like the fueling buffer.
      for (const g of this.grupos.values()) if (g.leitura === this.escrita) g.leitura = this.proxima(g.leitura);
    }
    return id;
  }

  /** The identifier at the group's pointer, or undefined (→ `(0)`). */
  atual(grupo: string): IdPendente | undefined {
    const g = this.grupo(grupo);
    if (this.porCelula) return this.celulas.get(g.leitura);
    if (g.leitura === this.escrita) return undefined;
    return this.celulas.get(g.leitura);
  }

  incrementar(grupo: string): void {
    const g = this.grupo(grupo);
    if (!this.porCelula && g.leitura === this.escrita) return;
    if (this.porCelula) this.celulas.delete(g.leitura);
    g.leitura = this.proxima(g.leitura);
  }

  todos(): IdPendente[] {
    return [...this.celulas.values()].sort((a, b) => a.posicao - b.posicao);
  }

  gruposLeitura(): Record<string, number> {
    return Object.fromEntries([...this.grupos].map(([id, g]) => [id, g.leitura]));
  }

  exportar(): EstadoFilaIds {
    return { escrita: this.escrita, celulas: this.todos().map((c) => structuredClone(c)), grupos: this.gruposLeitura() };
  }

  importar(e: EstadoFilaIds): void {
    const dentro = (p: number) => p >= this.posMin && p <= this.posMax;
    this.celulas.clear();
    for (const c of e.celulas) if (dentro(c.posicao)) this.celulas.set(c.posicao, structuredClone(c));
    this.escrita = dentro(e.escrita) ? e.escrita : this.posMin;
    for (const [id, l] of Object.entries(e.grupos)) this.grupo(id).leitura = dentro(l) ? l : this.escrita;
  }
}

/** Identifier of the record that ?V/Horustech show. */
export function cartaoPrincipal(r: Pick<Registro, 'cartao1' | 'cartao2'>): string | null {
  return r.cartao1 ?? r.cartao2;
}
