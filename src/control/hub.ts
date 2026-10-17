import type { Clock } from '../core/clock.js';
import { type PerfilId, obterPerfil } from '../profiles/index.js';
import type { ServidorReplay } from '../recorder/replay.js';
import { type OpcoesRuntime, SimRuntime } from './runtime.js';

export interface OpcoesHub {
  clock: Clock;
  host?: string;
  fusoMinutos?: number;
  mapa?: Record<number, number>;
  semTcp?: boolean;
  semente?: number;
  /** Folder of the UI's recordings (`list_gravacoes`, recordings started without a path). Default: `./gravacoes`. */
  dirGravacoes?: string;
}

/** The process instances (`sim_id`), plus the open replay servers. */
export class Hub {
  private readonly sims = new Map<string, SimRuntime>();
  readonly replays: ServidorReplay[] = [];

  constructor(private readonly op: OpcoesHub) {}

  get host(): string | undefined {
    return this.op.host;
  }

  get clock(): Clock {
    return this.op.clock;
  }

  get dirGravacoes(): string {
    return this.op.dirGravacoes ?? 'gravacoes';
  }

  adicionar(id: string, rt: SimRuntime): void {
    if (this.sims.has(id)) throw new Error(`sim_id já existe: ${id}`);
    this.sims.set(id, rt);
  }

  async criar(id: string, perfil: PerfilId, portas?: number[], extra: Partial<OpcoesRuntime> = {}): Promise<SimRuntime> {
    if (this.sims.has(id)) throw new Error(`sim_id já existe: ${id}`);
    obterPerfil(perfil);
    const rt = await SimRuntime.criar({
      perfil,
      clock: this.op.clock,
      host: this.op.host,
      fusoMinutos: this.op.fusoMinutos,
      mapa: this.op.mapa,
      semTcp: this.op.semTcp,
      semente: this.op.semente,
      portas,
      ...extra,
    });
    this.sims.set(id, rt);
    return rt;
  }

  tem(id: string): boolean {
    return this.sims.has(id);
  }

  obter(id: string): SimRuntime {
    const rt = this.sims.get(id);
    if (!rt) throw Object.assign(new Error(`sim_id inexistente: ${id}`), { status: 404 });
    return rt;
  }

  primeiro(): string {
    const id = this.sims.keys().next().value;
    if (id === undefined) throw new Error('nenhuma instância');
    return id;
  }

  async remover(id: string): Promise<void> {
    if (this.sims.size <= 1) throw new Error('não dá para remover a última instância');
    await this.obter(id).fechar();
    this.sims.delete(id);
  }

  listar(): { sim_id: string; perfil: string; portas: { logica: number; fisica: number }[] }[] {
    return [...this.sims].map(([id, rt]) => ({ sim_id: id, perfil: rt.perfil.id, portas: rt.servidor?.portas() ?? [] }));
  }

  todos(): [string, SimRuntime][] {
    return [...this.sims];
  }

  /** Advances all instances (the CLI calls it every 50 ms with the system clock). */
  tick(): void {
    for (const rt of this.sims.values()) rt.tick();
  }

  async fechar(): Promise<void> {
    await Promise.all([...this.sims.values()].map((rt) => rt.fechar()));
    await Promise.all(this.replays.splice(0).map((r) => r.fechar()));
    this.sims.clear();
  }
}
