import { codigoBico, decodificarBico, hex2 } from '../core/codigo-bico.js';

/**
 * Diff ACTION steps: the same abstract action (a click on the 2.7.2 UI) applied
 * to target A by the bench driver (`tools/driver-simuladorcbc`, `POST /acao`) and to
 * target B by the pump-sim control API. The names and parameters are those of the
 * bench driver contract (documented in `tools/driver-simuladorcbc/README.md` and `driver.ps1`).
 *
 * The 2.7.2 UI shows one channel at a time (tab 1..8) with two pump panels: the
 * left one is address 1 and the right one address 2 (bench 17/10: channel 1 = 04/05,
 * channel 2 = 08/09). Each panel has a button (Retirar Bico ↔ Abastecendo..) and two
 * radios: position 0 (04) and 1 (`alt`, 44). On the pump-sim side the executor keeps
 * this screen state (channel and radio of each side) to know which nozzle the button moves.
 */
export const TIPOS_ACAO = [
  'canal',
  'aba',
  'bico_radio',
  'retirar',
  'recolocar',
  'abastecer',
  'dip',
  'velocidade',
  'modelo',
  'automacao',
  'porta',
  'config_padrao',
  'fechar_modais',
] as const;
export type TipoAcao = (typeof TIPOS_ACAO)[number];
export type LadoTela = 'esquerdo' | 'direito';

export interface PassoAcao {
  acao: TipoAcao;
  params?: Record<string, unknown>;
  nota?: string;
  /** Label that `PassoEnviar.dependeDe` refers to (the step may be skipped on a target). */
  rotulo?: string;
}

/** 2.7.2 screen state the pump-sim side has to mirror. */
export interface EstadoUi {
  canal: number;
  alt: Record<LadoTela, boolean>;
}
export const estadoUiInicial = (): EstadoUi => ({ canal: 1, alt: { esquerdo: false, direito: false } });

/**
 * The panel button as the bench driver clicks it (`Invoke-Bico` in `driver.ps1`): read the caption,
 * click only if it is not already in the wanted state, then wait (up to 4 s) for the caption to
 * get there. `bico` is the nozzle the radio points at.
 */
export interface BotaoPainel {
  bico: string;
  canal: number;
  lado: LadoTela;
  retirar: boolean;
}

/** An item of the mapping to pump-sim: a control API command, a wait or a panel button click. */
export type ItemPumpSim = { comando: string; args: Record<string, unknown> } | { aguardar: number } | { botao: BotaoPainel };

/**
 * Panel captions the driver treats as "nozzle at rest" (bench diff r4b, §18: "Bicos Bloqueados"
 * is a blocked panel at rest; "Aguarda liberação" is a lifted nozzle waiting for release).
 * "Retira Bico" (no "r") is the caption of a freshly created 2.7.2 panel, at start or right after
 * "Carregar configuração padrão", until the next tick (bench 17/10); pump-sim never shows it, the set
 * matches the bench driver's. Any other caption ("Abastecendo..", "Aguarda liberação") counts as lifted.
 */
export const LEGENDAS_EM_REPOUSO = ['Retirar Bico', 'Retira Bico', 'Concluindo..', 'Bicos Bloqueados'] as const;
export const legendaRetirada = (legenda: string): boolean => !(LEGENDAS_EM_REPOUSO as readonly string[]).includes(legenda);

const VELOCIDADES = ['Lento', 'Normal', 'Rapido'] as const;
const MODELOS = ['CBC-02', 'CBC-05', 'CBC-06', 'Horustech'] as const;
const AUTOMACAO = ['Ligado', 'Desligado'] as const;
const PORTAS = [2001, 1771, 7002] as const;

const lado = (p: Record<string, unknown>): LadoTela => (p.lado === 'direito' ? 'direito' : 'esquerdo');
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Parameter errors of an action (empty = valid). */
export function validarAcao(p: PassoAcao): string[] {
  const a = p.params ?? {};
  const erros: string[] = [];
  const ladoOk = () => {
    if (a.lado !== undefined && a.lado !== 'esquerdo' && a.lado !== 'direito') erros.push(`lado inválido: ${String(a.lado)}`);
  };
  switch (p.acao) {
    case 'canal':
      if (!Number.isInteger(a.n) || (a.n as number) < 1 || (a.n as number) > 8) erros.push(`canal fora de 1..8: ${String(a.n)}`);
      break;
    case 'aba':
      if (typeof a.nome !== 'string' || !a.nome) erros.push('aba sem nome');
      break;
    case 'bico_radio':
      ladoOk();
      if (a.alt !== undefined && typeof a.alt !== 'boolean') erros.push('alt deve ser booleano');
      break;
    case 'retirar':
    case 'recolocar':
      ladoOk();
      break;
    case 'abastecer':
      ladoOk();
      if (a.segundos !== undefined && (typeof a.segundos !== 'number' || a.segundos < 0)) erros.push(`segundos inválido: ${String(a.segundos)}`);
      break;
    case 'dip':
      if (!Number.isInteger(a.n) || (a.n as number) < 1 || (a.n as number) > 4) erros.push(`dip fora de 1..4: ${String(a.n)}`);
      if (typeof a.ligado !== 'boolean') erros.push('dip sem `ligado` booleano');
      break;
    case 'velocidade':
      if (!VELOCIDADES.includes(semAcento(String(a.valor)) as (typeof VELOCIDADES)[number])) erros.push(`velocidade inválida: ${String(a.valor)}`);
      break;
    case 'modelo':
      if (!MODELOS.includes(a.valor as (typeof MODELOS)[number])) erros.push(`modelo inválido: ${String(a.valor)}`);
      break;
    case 'automacao':
      if (!AUTOMACAO.includes(a.valor as (typeof AUTOMACAO)[number])) erros.push(`automação inválida: ${String(a.valor)}`);
      break;
    case 'porta':
      if (!PORTAS.includes(Number(a.valor) as (typeof PORTAS)[number])) erros.push(`porta inválida: ${String(a.valor)}`);
      break;
    case 'config_padrao':
    case 'fechar_modais':
      break;
    default:
      erros.push(`ação desconhecida: ${String((p as { acao: unknown }).acao)}`);
  }
  return erros;
}

/** Nozzle the `lado` button moves with the screen in `ui`. */
export function bicoDaTela(ui: EstadoUi, l: LadoTela): string {
  return hex2(codigoBico(ui.canal, l === 'esquerdo' ? 1 : 2, ui.alt[l] ? 1 : 0));
}

/**
 * Translates the action to the pump-sim control API, updating `ui` (channel and radio
 * are only screen state in pump-sim: there is no command for them).
 */
export function acaoParaPumpSim(p: PassoAcao, ui: EstadoUi): ItemPumpSim[] {
  const a = p.params ?? {};
  const c = (comando: string, args: Record<string, unknown> = {}): ItemPumpSim => ({ comando, args });
  switch (p.acao) {
    case 'canal':
      ui.canal = Number(a.n);
      return [];
    case 'aba':
      return [];
    case 'bico_radio':
      ui.alt[lado(a)] = a.alt === true;
      return [];
    case 'retirar':
    case 'recolocar':
      return [{ botao: { bico: bicoDaTela(ui, lado(a)), canal: ui.canal, lado: lado(a), retirar: p.acao === 'retirar' } }];
    case 'abastecer': {
      const botao = { bico: bicoDaTela(ui, lado(a)), canal: ui.canal, lado: lado(a) };
      const ms = Math.round((typeof a.segundos === 'number' ? a.segundos : 3) * 1000);
      return [{ botao: { ...botao, retirar: true } }, { aguardar: ms }, { botao: { ...botao, retirar: false } }];
    }
    case 'dip':
      return [c('set_dip', { n: Number(a.n), on: a.ligado === true })];
    case 'velocidade':
      return [c('set_velocidade', { velocidade: semAcento(String(a.valor)).toLowerCase() })];
    case 'modelo':
      return [c('set_modelo', { modelo: String(a.valor) })];
    case 'automacao':
      return [c('set_automacao', { on: a.valor === 'Ligado' })];
    case 'porta':
      // On simulador-2.7.2, abrir_porta swaps the single port (drops the connections), like the radio.
      return [c('abrir_porta', { porta: Number(a.valor) })];
    case 'config_padrao':
      return [c('carregar_config_padrao')];
    case 'fechar_modais':
      return [c('liberar_travamento')];
  }
}

/** Text for the operator (interactive mode, target without control). */
export function descreverAcao(p: PassoAcao): string {
  const a = p.params ?? {};
  switch (p.acao) {
    case 'canal':
      return `Aba do canal ${String(a.n)}`;
    case 'aba':
      return `Aba "${String(a.nome)}"`;
    case 'bico_radio':
      return `Rádio do bico ${a.alt ? 'alternativo (44)' : 'da posição 0 (04)'} no painel ${lado(a)}`;
    case 'retirar':
      return `Clicar "Retirar Bico" no painel ${lado(a)}`;
    case 'recolocar':
      return `Clicar "Abastecendo.." (recolocar) no painel ${lado(a)}`;
    case 'abastecer':
      return `Retirar o bico do painel ${lado(a)}, esperar ${typeof a.segundos === 'number' ? a.segundos : 3} s e recolocar`;
    case 'dip':
      return `${a.ligado ? 'Marcar' : 'Desmarcar'} a DIP${String(a.n)}`;
    case 'velocidade':
      return `Velocidade → ${String(a.valor)}`;
    case 'modelo':
      return `Modelo → ${String(a.valor)}`;
    case 'automacao':
      return `Automação → ${String(a.valor)}`;
    case 'porta':
      return `Porta → ${String(a.valor)}`;
    case 'config_padrao':
      return 'Clicar "Carregar configuração padrão"';
    case 'fechar_modais':
      return 'Fechar os MessageBox abertos (OK)';
  }
}

// ───────────────────────── shortcuts for the script ─────────────────────────

export const acao = (tipo: TipoAcao, params: Record<string, unknown> = {}, nota?: string): PassoAcao =>
  nota ? { acao: tipo, params, nota } : { acao: tipo, params };

/** Channel, side and radio of nozzle `bb` on the 2.7.2 screen (only addresses 1–2 and positions 0–1). */
export function telaDoBico(bb: string): { canal: number; lado: LadoTela; alt: boolean } {
  const pos = decodificarBico(parseInt(bb, 16));
  if (!pos || pos.canal > 8 || pos.endereco > 2 || pos.posicao > 1) {
    throw new Error(`bico ${bb} não tem botão na tela do 2.7.2 (só canais 1–8, endereços 1–2, posições 0–1)`);
  }
  return { canal: pos.canal, lado: pos.endereco === 1 ? 'esquerdo' : 'direito', alt: pos.posicao === 1 };
}

/** Puts the panel and radio of nozzle `bb` on the screen. */
function mostrarBico(bb: string): { passos: PassoAcao[]; lado: LadoTela } {
  const t = telaDoBico(bb);
  return { passos: [acao('canal', { n: t.canal }), acao('bico_radio', { lado: t.lado, alt: t.alt })], lado: t.lado };
}

export function retirarBico(bb: string, nota?: string): PassoAcao[] {
  const m = mostrarBico(bb);
  return [...m.passos, acao('retirar', { lado: m.lado }, nota)];
}

export function recolocarBico(bb: string, nota?: string): PassoAcao[] {
  const m = mostrarBico(bb);
  return [...m.passos, acao('recolocar', { lado: m.lado }, nota)];
}

export function abastecerBico(bb: string, segundos: number, nota?: string): PassoAcao[] {
  const m = mostrarBico(bb);
  return [...m.passos, acao('abastecer', { lado: m.lado, segundos }, nota)];
}
