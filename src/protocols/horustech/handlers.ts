import type { Concentrador } from '../../core/concentrador.js';
import type { Registro } from '../../core/modelo.js';
import { ehDecimal, hexN, padNum, strToFloatDelphi, strToIntDelphi } from '../../core/numeros.js';
import { decodificarVirgula } from '../../core/virgula.js';
import type { FuncaoHorustech } from '../../profiles/types.js';
import { base, cartao } from '../companytec/formatos.js';

/**
 * Native Horustech `>?CCCC TT … KK` (DT214), only functions 02, 06 and 32 — the ones
 * SimuladorCBC 2.7.2 handles (decision N2). The rest of DT214 is left for v1.1.
 *
 * KK = ASCII sum of P + CCCC + DATA, 8 bits, uppercase hex; the `>` is left out.
 * Real profiles: checks length and KK (wrong → silence, as in `(&…)`).
 * 2.7.2 (quirk HORUSTECH_272): matches by chars 7-8, validating nothing (behavioral equivalence).
 */
export interface ResultadoHorustech {
  resposta: string | null;
  verbo: FuncaoHorustech | null;
  travar?: string;
  aposOk?: string;
  erro?: string;
}

const silencio = (verbo: FuncaoHorustech | null, erro?: string): ResultadoHorustech => ({ resposta: null, verbo, erro });
const ok = (verbo: FuncaoHorustech, resposta: string): ResultadoHorustech => ({ resposta, verbo });

export function checksumH(corpo: string): string {
  let soma = 0;
  for (let i = 0; i < corpo.length; i++) soma = (soma + corpo.charCodeAt(i)) & 0xff;
  return soma.toString(16).toUpperCase().padStart(2, '0');
}

/** Builds `>` + P + CCCC + DATA + KK. */
export function quadroH(dados: string, p: '!' | '?' = '!'): string {
  const corpo = p + hexN(dados.length, 4) + dados;
  return '>' + corpo + checksumH(corpo);
}

/** ACK/error `>!0004 TT C D KK` (DT214 p.44): C = 0 success, E error; D = code. */
export function ackH(tt: string, erro: string | null = null): string {
  return quadroH(tt + (erro === null ? '00' : 'E' + erro));
}

/** Checks frame, length and KK of a request. Returns the DATA, or null. */
export function validarQuadroH(cmd: string): string | null {
  const m = /^>\?([0-9A-F]{4})/.exec(cmd);
  if (!m) return null;
  const len = parseInt(m[1]!, 16);
  if (cmd.length !== 8 + len) return null;
  const dados = cmd.slice(6, 6 + len);
  return checksumH(cmd.slice(1, 6 + len)) === cmd.slice(6 + len) ? dados : null;
}

const ERRO = { bicoInexistente: '7', timeout: '6', parametro: 'C' } as const;

export function processarHorustech(conc: Concentrador, porta: string, cmd: string): ResultadoHorustech {
  const h = conc.perfil.horustech;
  if (!h || (h.modelos && !h.modelos.includes(conc.modelo))) return silencio(null, 'ERRO CMD');
  const q272 = conc.q('HORUSTECH_272');
  let dados: string;
  if (q272) {
    if (cmd.length < 8) return silencio(null, 'ERRO CMD');
    dados = cmd.slice(6);
  } else {
    const d = validarQuadroH(cmd.replace(/[\r\n]+$/, ''));
    if (d === null) return silencio(null, 'moldura, tamanho ou checksum inválido');
    dados = d;
  }
  const tt = dados.slice(0, 2) as FuncaoHorustech;
  if (!h.funcoes.has(tt)) return silencio(null, 'função Horustech fora da v1');
  switch (tt) {
    case '02':
      return leitura(conc, porta);
    case '06':
      return incremento(conc, porta);
    case '32':
      return q272 ? preco272(conc, cmd) : preco(conc, dados);
  }
}

/**
 * 02: fueling at the read pointer (POP). Empty = `>!000202KK`.
 *
 * 2.7.2 (HORUSTECH_272, bench diff r5 DIFF-16, M1 of DECISIONS §20): no "empty" test. It
 * reads the grid cell at the read pointer even when read = write, so after `&A`/`&I` (or the
 * "Carregar configuração padrão" rewind, which keeps the rows) it serves the stale record left
 * in that cell; only a never-written cell gives the empty reply (bench 17/10, `>!00020245`).
 */
function leitura(conc: Concentrador, porta: string): ResultadoHorustech {
  const g = conc.grupoPonteiroDe(porta);
  if (conc.q('HORUSTECH_272')) {
    const r = conc.buffer.ler(conc.ponteiroLeitura(porta));
    return ok('02', quadroH(r ? registro272(conc, r) : '02'));
  }
  if (conc.buffer.vazio(g)) return ok('02', quadroH('02'));
  const r = conc.buffer.ler(conc.ponteiroLeitura(porta));
  if (!r) return silencio('02', 'célula vazia');
  return ok('02', quadroH(conc.q('HORUSTECH_272') ? registro272(conc, r) : registro107(conc, r)));
}

function data5(r: Registro): string {
  const d = r.data;
  const p2 = (n: number) => padNum(n, 2);
  return p2(d.dia) + p2(d.mes) + p2(d.ano % 100) + p2(d.hora) + p2(d.minuto);
}

function casas(r: Registro): string {
  const c = decodificarVirgula(r.virgula);
  return `${c.total}${c.volume}${c.preco}`;
}

/**
 * DT214 p.4-5 layout (107 chars): 02 N6 B2 C2 A2 T6 L6 P4 X Y Z t4 d m y h n e10 E10 i16 I16 a8.
 * B = lane nozzle number (decimal); t = duration in seconds (decimal).
 */
function registro107(conc: Concentrador, r: Registro): string {
  const b = base(conc, r);
  return (
    '02' +
    padNum(r.numero, 6) +
    padNum(r.numeroPista, 2) +
    padNum(r.combustivel, 2) +
    padNum(r.tanque, 2) +
    b.T6 +
    b.L6 +
    b.P4 +
    casas(r) +
    padNum(r.duracaoS, 4) +
    data5(r) +
    b.i10 +
    b.E10 +
    cartao(conc, r.cartao1) +
    cartao(conc, r.cartao2) +
    padNum(r.volumeTanque, 8)
  );
}

/**
 * Column 10 of the 2.7.2 records grid (behavioral equivalence): `0200`+R4 instead of
 * N6, fixed nozzle/fuel/tank `010000`, duration in hex, FINAL totalizer before
 * the initial one and tank volume zeroed.
 */
function registro272(conc: Concentrador, r: Registro): string {
  const b = base(conc, r);
  return (
    '0200' + b.R4 + '010000' + b.T6 + b.L6 + b.P4 + casas(r) + b.C4 + data5(r) + b.E10 + b.i10 +
    cartao(conc, r.cartao1) + cartao(conc, r.cartao2) + '00000000'
  );
}

/** 06: advances the POP; replies `06 n6 N6` (equal = nothing to increment). */
function incremento(conc: Concentrador, porta: string): ResultadoHorustech {
  conc.incrementarPonteiro(porta);
  return ok('06', quadroH('06' + padNum(conc.ponteiroLeitura(porta), 6) + padNum(conc.buffer.escrita, 6)));
}

/**
 * Nozzle of the 2.7.2 Horustech 32 (behavioral equivalence, verdict #59): fixed table n → code, by
 * position and not by lane number: 1→04, 2→44, 3→84, 4→C4, 5→05, 6→45… (nozzle (n−1) mod 4
 * of the ((n−1) div 4)-th address, counting channel 1 addresses 1–4, then channel 2…).
 */
function bicoPorTabela272(conc: Concentrador, n: number): ReturnType<Concentrador['bico']> {
  return conc.bico((((n - 1) % 4) << 6) | (4 + Math.floor((n - 1) / 4)));
}

/**
 * 32 of the 2.7.2 (HORUSTECH_272, behavioral equivalence, verdict #59). KK by `StrToInt('$' + KK)` first
 * (not hex → E9 modal and silence, bench E3); n = `StrToInt(cmd[8..9])`
 * (not a number → E9 and silence); n ∉ 1..48 → modal and silence; nozzle by the fixed table,
 * and **no nozzle → silence, without modal**; level 0 with `cmd[10] = '0'`, otherwise the
 * level the frame gives (see DECISIONS §17 on `cmd[5]`); the price is the **last 4 digits**
 * of P6 with the Windows comma (`dd,dd` with comma `2x`, `d,ddd` otherwise), converted (E8 modal
 * when it is not a number) and **not stored**: bench diff r6 (EQUIV-PENDENTES) acked
 * `>?000B320210015002F` and nozzle 44 kept `TU440000212399` (levels 1 and 0 untouched). The ack is
 * the literal `>!00043200AA` (after the OK when a modal opened, E3).
 */
function preco272(conc: Concentrador, cmd: string): ResultadoHorustech {
  // E3, bench diff r4b (§18): the KK is converted with StrToInt('$' + KK) before anything is
  // applied (it is not compared). `>?000B32022001500XX` → modal "''$XX'' is not a valid integer
  // value.", no reply, no price on any level. The KK is the 2 chars after the CCCC data
  // (`>?000A3202000111FA` → `FA`, so the 17/10 bench frame still reaches StrToFloat '1,11F').
  // B: a non-hex CCCC was not measured; then the KK is not converted.
  const cccc = strToIntDelphi('$' + cmd.slice(2, 6));
  if (cccc !== null) {
    const kk = cmd.slice(6 + cccc, 8 + cccc);
    if (strToIntDelphi('$' + kk) === null) return { resposta: null, verbo: '32', travar: `''$${kk}'' is not a valid integer value.` };
  }
  const bb = cmd.slice(8, 10);
  const nivel = cmd[10] ?? '';
  const niveis = conc.perfil.horustech?.niveisPreco ?? [];
  const n = strToIntDelphi(bb);
  if (n === null) return { resposta: null, verbo: '32', travar: `''${bb}'' is not a valid integer value.` };
  if (!(n >= 1 && n <= 48)) return { resposta: null, verbo: '32', travar: 'Bico deve estar no intervalo de 1 a 48' };
  const b = bicoPorTabela272(conc, n);
  if (!b) return silencio('32', 'bico fora da tabela');
  // E3: the ShowMessage is inside the parser; the literal ack goes out after the OK.
  if (!niveis.includes(nivel)) return { resposta: null, verbo: '32', travar: 'Nível de preço incorreto.', aposOk: '>!00043200AA' };
  const casas = conc.casasDoBico(b).preco;
  const d = cmd.slice(13, 17);
  const txt = casas === 2 ? d.slice(0, 2) + ',' + d.slice(2) : d.slice(0, 1) + ',' + d.slice(1);
  const valor = strToFloatDelphi(txt);
  // DIFF-16 (bench 17/10): `>?000A3202000111FA` opens the StrToFloat modal with '1,11F' and does not reply.
  if (valor === null) return { resposta: null, verbo: '32', travar: `Error: '${txt}' is not a valid floating point value.` };
  return ok('32', '>!00043200AA');
}

/** 32 BB N P6: price per level; applies on the next fueling (like &U). */
function preco(conc: Concentrador, dados: string): ResultadoHorustech {
  const bb = dados.slice(2, 4);
  const nivel = dados[4] ?? '';
  const valor = dados.slice(5, 11);
  const niveis = conc.perfil.horustech?.niveisPreco ?? [];
  if (dados.length !== 11 || !ehDecimal(bb) || !ehDecimal(valor) || !niveis.includes(nivel)) {
    return ok('32', ackH('32', ERRO.parametro));
  }
  const b = conc.bicoPorNumero(Number(bb));
  if (!b) return ok('32', ackH('32', ERRO.bicoInexistente));
  const r = conc.definirPreco(b.codigo, Number(nivel), Number(valor));
  if (r === 'ok') return ok('32', ackH('32'));
  return ok('32', ackH('32', r === 'bicoInexistente' ? ERRO.bicoInexistente : ERRO.timeout));
}
