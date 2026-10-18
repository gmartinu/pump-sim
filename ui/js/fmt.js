// Formatting and small protocol helpers for display only. The simulator stays the source of truth:
// nothing here decides behavior; it only renders what the control API returned.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** HTML-escapes any value. */
export const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** JSON for a data attribute. */
export const dj = (v) => e(JSON.stringify(v));

export const pad = (n, w) => String(n).padStart(w, '0');
export const hex2 = (n) => pad(Number(n).toString(16).toUpperCase(), 2);

/** pt-BR number: thousands with ".", decimals with ",". */
export function num(v, d = 2) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const [i, f] = Math.abs(Number(v)).toFixed(d).split('.');
  const s = (Number(v) < 0 ? '−' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return f ? `${s},${f}` : s;
}

/** "1234.56" (dot decimal, as get_displays returns) → "1.234,56"; non-numeric (888888) as is. */
export function numTxt(t) {
  if (t === null || t === undefined) return '—';
  const s = String(t);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return s;
  const d = s.includes('.') ? s.length - s.indexOf('.') - 1 : 0;
  return num(Number(s), d);
}

/** "6,390" / "6.390" / "6390" → number. */
export function lerNum(t) {
  const s = String(t ?? '').trim().replace(/\s/g, '');
  if (!s) return NaN;
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  return Number(s);
}

/** Companytec KK (DT435 p.3): 8-bit sum of the chars, 2 uppercase hex digits. Preview only. */
export function kk(corpo) {
  let s = 0;
  for (let i = 0; i < corpo.length; i++) s = (s + corpo.charCodeAt(i)) & 0xff;
  return hex2(s);
}

/** Verbs whose request carries no KK (DT435): the console shows "sem KK" for them. */
const SEM_KK = /^\((&[SAVIRH]|&KW|&E|&F|\?A80|\?V95|\?S92)/;

/**
 * Replies that carry a KK (the recorded 2.7.2 oracle, test/fixtures/oracle-2.7.2: `&T` replies, `&F`,
 * `&KR`/`&KW`, `LF`, the `&A`/`&@`/`a<n>` record reads and the bare `&A` 52). `(S…)`, `(M04)`, `(U04)`,
 * `(C01…)` and the other acks carry none.
 */
const TX_COM_KK = /^\(\(?(?:T[A-Za-z$]|F[AGNR]|K[RW]|LF|[aA@][0-9A-F])|^\([0-9A-F]{50}\)$/;

/**
 * Checksum column of the traffic console: `ok` when the 2 chars before `)` are the KK of the rest,
 * `bad` for a frame that should carry one and does not match (a request whose verb carries a KK, or
 * a reply of a KK-carrying shape), `na` otherwise (no KK). `falha` is the injected fault tied to the
 * frame: a `checksum_errado` reply is always `bad`, whatever its shape (the fault rewrites the two chars
 * before the `)` even on a reply with no KK, such as the `&S` one).
 */
export function classeKK(quadro, dir, falha) {
  const m = /^\((.*)([0-9A-Fa-f]{2})\)$/.exec(quadro);
  if (dir === 'tx' && falha === 'checksum_errado') return 'bad';
  if (m && kk(m[1]) === m[2]) return 'ok';
  if (dir === 'rx' && /^\([&?]/.test(quadro) && !SEM_KK.test(quadro) && quadro.length > 5) return 'bad';
  if (dir === 'tx' && TX_COM_KK.test(quadro)) return 'bad';
  return 'na';
}

/** Verb of a frame ("&S", "&T", "?A", ">?"), for the console filter. */
export function verbo(quadro) {
  const m = /^\(?([&?][A-Z@a-z]|>\?)/.exec(quadro);
  return m ? m[1] : '';
}

/** hh:mm:ss.mmm of a simulator-clock instant (ms). */
export function horaMs(ms, comMs = false) {
  if (ms === null || ms === undefined) return '—';
  const d = new Date(ms);
  const s = `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}`;
  return comMs ? `${s}.${pad(d.getMilliseconds(), 3)}` : s;
}
export const diaHoraMs = (ms) => {
  if (ms === null || ms === undefined) return '—';
  const d = new Date(ms);
  return `${pad(d.getDate(), 2)}/${pad(d.getMonth() + 1, 2)} ${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`;
};
export function duracao(ms) {
  if (ms === null || ms === undefined || ms < 0) return '—';
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${pad(m, 2)}:${pad(s, 2)}` : `${pad(m, 2)}:${pad(s, 2)}`;
}
export function tamanho(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${num(b / 1024, 0)} KB`;
  return `${num(b / 1024 / 1024, 1)} MB`;
}

/** DataHora of the CBC (RTC) → "17/10 14:32:08". */
export const rtcCurto = (r) => (r ? `${pad(r.dia, 2)}/${pad(r.mes, 2)} ${pad(r.hora, 2)}:${pad(r.minuto, 2)}:${pad(r.segundo, 2)}` : '—');

/** Side state by the `&S` letter (design-spec "Side state → color map"). */
export const ESTADOS = {
  L: { id: 'livre', rot: 'Livre', ic: 'radio_button_unchecked' },
  P: { id: 'pronta', rot: 'Pronta', ic: 'lock_open' },
  A: { id: 'abastecendo', rot: 'Abastecendo', ic: 'local_gas_station' },
  C: { id: 'concluiu', rot: 'Concluiu', ic: 'task_alt' },
  B: { id: 'bloqueada', rot: 'Bloqueada', ic: 'lock' },
  E: { id: 'espera', rot: 'Espera', ic: 'hourglass_top' },
  F: { id: 'falha', rot: 'Falha', ic: 'error' },
};
export const estadoDe = (letra) => ESTADOS[letra] ?? ESTADOS.L;
export const chip = (letra, extra = '') => {
  const s = estadoDe(letra);
  return `<span class="st st-${s.id}"${extra}><span class="ms">${s.ic}</span>${s.rot}</span>`;
};

/** Panel captions the 2.7.2 shows with the nozzle at rest (src/diff/acoes.ts LEGENDAS_EM_REPOUSO). */
export const LEGENDAS_EM_REPOUSO = ['Retirar Bico', 'Retira Bico', 'Concluindo..', 'Bicos Bloqueados'];
export const legendaRetirada = (l) => !LEGENDAS_EM_REPOUSO.includes(l);

/** Comma byte (DT435 §3.7) → decimals of total/volume/price. */
export function casasVirgula(v) {
  const c = typeof v === 'string' ? parseInt(v, 16) : v;
  return { total: c & 3, volume: (c >> 2) & 3, preco: (c >> 4) & 3 };
}

/** `&A` 52 decode for the console (layout of src/protocols/companytec/formatos.ts a52). */
export function decodificarA52(q) {
  if (!/^\([0-9A-F]{50}\)$/.test(q)) return null;
  const s = q.slice(1, -1);
  const c = casasVirgula(s.slice(16, 18));
  const n = (a, b) => Number(s.slice(a, b));
  return [
    ['T total', `${s.slice(0, 6)} · R$ ${num(n(0, 6) / 10 ** c.total, c.total)}`],
    ['L volume', `${s.slice(6, 12)} · ${num(n(6, 12) / 10 ** c.volume, c.volume)} L`],
    ['P preço', `${s.slice(12, 16)} · ${num(n(12, 16) / 10 ** c.preco, c.preco)}`],
    ['V vírgula', s.slice(16, 18)],
    ['C duração', `${s.slice(18, 22)} · ${parseInt(s.slice(18, 22), 16)} s`],
    ['B bico', s.slice(22, 24)],
    ['Data', `${s.slice(24, 26)}/${s.slice(30, 32)} ${s.slice(26, 28)}:${s.slice(28, 30)}`],
    ['R registro', s.slice(32, 36)],
    ['E encerrante', `${num(n(36, 46) / 100, 2)} L`],
    ['SS', s.slice(46, 48)],
    ['KK', `${s.slice(48, 50)} · ${kk(s.slice(0, 48)) === s.slice(48, 50) ? 'confere' : 'não confere'}`],
    ['Tamanho', `${q.length} chars`],
  ];
}

/** Card class (core classeDoTipo) → label and icon. */
export const CLASSES_CARTAO = {
  tag: ['TAG', 'sell'],
  lavadora: ['Lavadora', 'local_car_wash'],
  cliente: ['Cliente', 'person'],
  funcionario: ['Funcionário', 'id_card'],
  gerente: ['Gerente', 'shield_person'],
  total: ['Total', 'admin_panel_settings'],
  reservado: ['Reservado', 'badge'],
};

export function baixar(nome, texto, tipo = 'application/json') {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
