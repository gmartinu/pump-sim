// Helpers shared by the screens: lookups over get_estado_simulador / get_displays results.
import { e, hex2 } from '../fmt.js';

export const lados = (app) => app.estado?.lados ?? [];
export const lado = (app, c, end) => lados(app).find((l) => l.canal === c && l.endereco === end);
export const display = (app, c, end) => (app.displays ?? []).find((d) => d.canal === c && d.endereco === end);
export const todosBicos = (app) => lados(app).flatMap((l) => l.bicos.map((b) => ({ ...b, lado: l })));
export const bicoPorCodigo = (app, cod) => todosBicos(app).find((b) => b.codigo === cod);
export const portasAbertas = (app) => (app.estado?.portas ?? []).map((p) => p.logica);
export const ehHorustechVisao = (app) => (app.estado?.perfil.canais ?? 8) > 8;
/**
 * Price of the nozzle at the side's level, in R$/L: the pending price when there is one, else the
 * current one — the core's `precoConfigurado`, which is what `&T U` replies and what the display shows
 * at rest (a fresh 2.7.2 nozzle 04 has 1120 current and 1123 pending: `(TU0400001123…)`, 1,123).
 */
export const precoBico = (b, nivel = 0) => (b.precosPendentes?.[nivel] ?? b.precos[nivel] ?? 0) / 10 ** (b.casas?.preco ?? 3);
export const rotuloBico = (b) => `Canal ${b.canal} · end ${b.endereco}${b.combustivel ? ` · combustível ${b.combustivel}` : ''}`;

/** The nozzle moved by the side's button: the lifted one, else the radio's (default 1st). */
export function bicoDoBotao(app, l) {
  const fora = l.bicos.find((b) => b.estado === 'retirado' || b.estado === 'abastecendo');
  if (fora) return { bico: fora, fora: true };
  const escolhido = app.ui.pista?.radio?.[`${l.canal}-${l.endereco}`];
  return { bico: l.bicos.find((b) => b.codigo === escolhido) ?? l.bicos[0], fora: false };
}

export function opcoesBicos(app, atual) {
  return todosBicos(app)
    .map((b) => `<option value="${b.codigo}"${b.codigo === atual ? ' selected' : ''}>${b.codigo} · ${e(rotuloBico(b))}</option>`)
    .join('');
}

export const cabecalho = (titulo, sub, direita = '') =>
  `<div class="row gap16"><div class="fx col gap4"><h1 class="h1">${titulo}</h1><div class="muted">${sub}</div></div>${direita ? `<div class="row gap8" style="margin-left:auto">${direita}</div>` : ''}</div>`;

export const seg = (opcoes, atual, act, extra = '') =>
  `<div class="seg"${extra}>${opcoes.map(([v, r]) => `<span class="${String(v) === String(atual) ? 'on' : ''}" data-act="${act}" data-v="${e(v)}">${r}</span>`).join('')}</div>`;

export const sw = (on, act, dados = '', dis = false) => `<span class="sw${on ? ' on' : ''}${dis ? ' dis' : ''}"${dis ? '' : ` data-act="${act}"`} ${dados}></span>`;

export const vazio = (ic, titulo, texto, extra = '') =>
  `<div class="empty"><span class="ms">${ic}</span><b class="t" style="color:var(--ink)">${titulo}</b><span class="small">${texto}</span>${extra}</div>`;

export const codigoHex = (n) => (typeof n === 'number' ? hex2(n) : n);
