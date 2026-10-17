import type { Concentrador } from '../../core/concentrador.js';
import { type CamposRtc, dataHoraDeEpoch } from '../../core/datahora.js';
import { hex2 } from '../../core/codigo-bico.js';
import type { Bico } from '../../core/modelo.js';
import { ehDecimal, padNum, padNumSemCorte, deMilesimos, strToFloatDelphi, strToIntDelphi } from '../../core/numeros.js';
import { decodificarVirgula } from '../../core/virgula.js';
import { type VerboCompanytec, versaoFirmware } from '../../profiles/index.js';
import { comKK, kkValido, semKK } from './checksum.js';
import * as F from './formatos.js';

/** Result of a request: `resposta` null = silence. `travar` = modal MessageBox (Q2). */
export interface Resultado {
  resposta: string | null;
  verbo: VerboCompanytec | null;
  travar?: string;
  /** Reply that only goes out after the OK of the `travar` modal (ShowMessage in the parser, E3). */
  aposOk?: string;
  erro?: string;
}

const silencio = (verbo: VerboCompanytec | null, erro?: string): Resultado => ({ resposta: null, verbo, erro });
const ok = (verbo: VerboCompanytec, resposta: string): Resultado => ({ resposta, verbo });

/** Frames the 2.7.2 matches by exact string (the KK is part of the literal). */
const EXATOS: Record<string, VerboCompanytec> = {
  '(&A)': 'A',
  '(&A67)': 'A67',
  '(&@66)': '@66',
  '(&A299)': 'A2',
  '(&A39A)': 'A3',
  '(&A49B)': 'A4',
  '(&F)': 'F',
  '(&KR1F4)': 'KR1',
};

/** Verbs whose request carries no KK (DT435; behavioral equivalence). */
const SEM_KK = new Set<VerboCompanytec>(['A', 'I', 'V', 'S', 'R', 'H', 'E']);

/** Identifies the verb from the frame (with parentheses). null = not recognized. */
export function identificarVerbo(cmd: string): VerboCompanytec | null {
  if (!cmd.startsWith('(&') || !cmd.endsWith(')')) return null;
  const exato = EXATOS[cmd];
  if (exato) return exato;
  const c = cmd[2];
  switch (c) {
    case 'I':
      return 'I';
    case 'S':
      return 'S';
    case 'R':
      return 'R';
    case 'V':
      return 'V';
    case 'H':
      return 'H';
    case 'E':
      return 'E';
    case 'P':
      return 'P';
    case 'c':
      return 'c';
    case 'C':
      // There is no `&CH` verb: `(&CH…)` is a `&C` with pump type H (verdict #45).
      return 'C';
    case 'M':
      return cmd.length === 25 && cmd.slice(3, 5) === '99' ? 'M99' : 'M';
    case 'U':
      return cmd.length === 16 ? 'U6' : 'U4';
    case 'K':
      return cmd.slice(2, 5) === 'KW1' ? 'KW1' : null;
    case 'L': {
      const m = cmd[3];
      return m === 'E' ? 'LE' : m === 'R' ? 'LR' : m === 'C' ? 'LC' : null;
    }
    case 'T': {
      if (cmd.slice(3, 6) === '99P') return 'T99P';
      if (cmd.slice(3, 6) === '99N') return 'T99N';
      const modo = cmd[5];
      const mapa: Record<string, VerboCompanytec> = {
        $: 'T$',
        L: 'TL',
        l: 'Tl',
        N: 'TN',
        U: 'TU',
        u: 'Tu',
        P: 'TP',
        C: 'TC',
        I: 'TI',
      };
      // Unknown mode: the &T handler decides (TG on the 2.7.2, silence on the real ones).
      return (modo && mapa[modo]) || 'TL';
    }
    default:
      return null;
  }
}

/**
 * 2.7.2 (Q1), frame without `)`: the parser uses the whole text and only the verbs matched
 * by prefix and without KK answer (behavioral equivalence; verdict #2; DIFF-04 and step 9 for
 * `&S`). The KK ones, the exact ones (`(&A`) and the rest fall into "ERRO CMD".
 */
function verboSemMoldura(cmd: string): VerboCompanytec | null {
  if (!cmd.startsWith('(&')) return null;
  switch (cmd[2]) {
    case 'I':
      return 'I';
    case 'S':
      return 'S';
    case 'R':
      return 'R';
    case 'V':
      return 'V';
    case 'H':
      return 'H';
    case 'E':
      return 'E';
    case 'K':
      // Only the 2.7.2 (Q1) gets here: its dispatch only looks at `KW` (verdict #39).
      return cmd.slice(2, 4) === 'KW' ? 'KW1' : null;
    default:
      return null;
  }
}

function verboHabilitado(conc: Concentrador, v: VerboCompanytec): boolean {
  if (!conc.perfil.verbos.has(v)) return false;
  const gate = conc.perfil.gatesFirmware[v];
  return gate === undefined || versaoFirmware(conc.perfil.firmware) > gate;
}

/**
 * Serves a `(&…)` frame. `porta` = port id (e.g. "tcp:2001") for the
 * read pointer.
 */
export function processarCompanytec(conc: Concentrador, porta: string, quadro: string): Resultado {
  let cmd = quadro;
  let verbo: VerboCompanytec | null;
  if (cmd[0] !== '(' && cmd[1] === '&') {
    // DESPACHO_272 (verdict #3): only the 2.7.2 dispatch gets here. The 1st char is not
    // tested, but the exact literals and the KK check include the `(`, so only the verbs
    // matched by prefix without KK answer (`X&S)` = `&S`).
    verbo = conc.q('DESPACHO_272') ? verboSemMoldura('(' + cmd.slice(1)) : null;
    if (verbo === 'KW1' && !conc.q('RTC_272')) verbo = null;
    if (!verbo) return silencio(null, 'ERRO CMD');
    // The parser cuts at the 1st `)` (the framer only does it for frames starting in `(`/`>`).
    const fim = cmd.indexOf(')');
    cmd = '(' + (fim >= 0 ? cmd.slice(1, fim + 1) : cmd.slice(1) + ')');
    if (!verboHabilitado(conc, verbo)) return silencio(verbo, 'verbo não suportado no perfil');
    return despachar(conc, porta, cmd, verbo);
  }
  if (cmd.endsWith(')')) {
    verbo = identificarVerbo(cmd);
    // 2.7.2: `&KW` without the `1` (RTC_272) and 25-char `&M` with any BB (M99_272, verdict #32).
    if (!verbo && conc.q('RTC_272') && cmd.slice(2, 4) === 'KW') verbo = 'KW1';
    if (verbo === 'M' && cmd.length === 25 && conc.q('M99_272')) verbo = 'M99';
  } else {
    // Without `)` it only gets here on the 2.7.2 (Q1). The 2.7.2 verbs without KK do not check the
    // KK, so the handler gets the closed frame and the KK is not tested.
    verbo = conc.q('Q1') ? verboSemMoldura(cmd) : null;
    if (verbo) {
      cmd += ')';
      if (!verboHabilitado(conc, verbo)) return silencio(verbo, 'verbo não suportado no perfil');
      return despachar(conc, porta, cmd, verbo);
    }
  }
  if (!verbo) return silencio(null, 'ERRO CMD');
  // &T with an unknown mode: handled inside the &T handler.
  const ehT = cmd[2] === 'T';
  if (!ehT && !verboHabilitado(conc, verbo)) return silencio(verbo, 'verbo não suportado no perfil');
  // RTC_272 (verdict #39): the 2.7.2 &KW does not check the KK.
  const semKK = SEM_KK.has(verbo) || (verbo === 'KW1' && conc.q('RTC_272'));
  if (!semKK && !EXATOS[cmd] && !kkValido(cmd)) return silencio(verbo, 'checksum inválido');
  return despachar(conc, porta, cmd, verbo);
}

function despachar(conc: Concentrador, porta: string, cmd: string, verbo: VerboCompanytec): Resultado {
  switch (verbo) {
    case 'A':
      return leituraA(conc, porta);
    case 'A67':
    case '@66':
    case 'A2':
    case 'A3':
    case 'A4':
      return leituraIdentificada(conc, porta, verbo);
    case 'I':
      conc.incrementarPonteiro(porta);
      return silencio('I');
    case 'V':
      return ok('V', visualizacao(conc));
    case 'S':
      return ok('S', status(conc));
    case 'R':
      return ok('R', relogioR(conc));
    case 'KR1':
      return ok('KR1', relogioKR1(conc));
    case 'H':
      return ajusteH(conc, cmd);
    case 'KW1':
      return ajusteKW1(conc, cmd);
    case 'M':
      return modo(conc, cmd);
    case 'M99':
      return listaNegra(conc, cmd);
    case 'P':
      return preset(conc, cmd);
    case 'U4':
    case 'U6':
      return preco(conc, cmd, verbo);
    case 'LR':
    case 'LC':
      return leituraRegistro(conc, cmd, verbo);
    case 'F':
      return ok('F', bombas(conc));
    case 'E':
      return gravarTotais(conc, cmd);
    case 'C':
      return configurar(conc, cmd);
    case 'LE':
      if (conc.q('L_272')) return leituraEvento(conc, cmd);
      return silencio(verbo, 'sem resposta (layout não recuperado)');
    case 'c':
      if (conc.q('C_272')) return configurarCampos272(conc, cmd);
      // On the real ones: a verb outside DT435, accepted with no reply.
      return silencio(verbo, 'sem resposta (fora do manual)');
    default:
      return totalizadores(conc, porta, cmd);
  }
}

// ───────────────────────── fueling reads ─────────────────────────

function leituraA(conc: Concentrador, porta: string): Resultado {
  const g = conc.grupoPonteiroDe(porta);
  if (conc.buffer.vazio(g)) return ok('A', '(0)');
  const reg = conc.buffer.ler(conc.ponteiroLeitura(porta));
  if (!reg) return silencio('A', 'célula vazia');
  if (F.usarA52(conc, reg)) return ok('A', F.a52(conc, reg));
  return ok('A', conc.q('A36') ? F.a36(conc, reg) : F.a34(conc, reg));
}

function leituraIdentificada(conc: Concentrador, porta: string, v: VerboCompanytec): Resultado {
  if (conc.vazioIdentificado(porta)) return ok(v, '(0)');
  const reg = conc.buffer.ler(conc.ponteiroLeitura(porta));
  if (!reg) return silencio(v, 'célula vazia');
  const fmt = { A67: F.a67, '@66': F.a66, A2: F.paf1, A3: F.paf2, A4: F.a4 } as const;
  return ok(v, fmt[v as keyof typeof fmt](conc, reg));
}

function leituraRegistro(conc: Concentrador, cmd: string, v: 'LR' | 'LC'): Resultado {
  let posicao: number;
  if (conc.q('L_272')) {
    // 2.7.2 (behavioral equivalence, verdict #22): no length test; the position is
    // StrToInt(Copy(5,4)), which accepts `$hex` and spaces. Non-numeric → modal E9, no reply.
    const campo = cmd.slice(4, 8);
    const n = strToIntDelphi(campo);
    if (n === null) return erroConversao(conc, v, campo);
    posicao = n;
  } else {
    if (cmd.length !== 11) return silencio(v, 'tamanho inválido');
    const pos = cmd.slice(4, 8);
    if (!ehDecimal(pos)) return silencio(v, 'posição não numérica');
    posicao = Number(pos);
  }
  const reg = posicao > 0 ? conc.buffer.ler(posicao) : null;
  const lr = conc.perfil.leituraRegistro;
  type Fmt = (c: Concentrador, r: NonNullable<typeof reg>) => string;
  let formato: Fmt;
  if (lr.porModelo) {
    // 2.7.2: col8 (CBC-06) / col7 (Horustech) / col3 in &LR; col6 (PAF1) or col3 in &LC.
    const m = conc.modelo;
    if (v === 'LR') formato = m === 'CBC-06' ? F.lr74 : m === 'Horustech' ? F.lr82 : F.a52;
    else formato = m === 'CBC-06' || m === 'Horustech' ? F.paf1 : F.a52;
  } else if (v === 'LR') {
    formato = lr.lr === 82 ? F.lr82 : F.lr74;
  } else {
    formato = lr.lc === 'paf1' ? F.paf1 : F.lcCbc;
  }
  const tamanhos = new Map<Fmt, number>([
    [F.lr74, 74],
    [F.lr82, 82],
    [F.a52, 52],
    [F.paf1, 123],
    [F.lcCbc, 90],
  ]);
  const tamanho = tamanhos.get(formato) ?? 0;
  const prefixo = formato === F.paf1 ? 'a2' : '';
  if (!reg) {
    if (conc.q('L_VAZIO_SILENCIO')) return silencio(v, 'posição vazia');
    return ok(v, F.vazioF(tamanho, prefixo, formato === F.paf1 ? F.ZEROS_VAZIO_PAF1 : []));
  }
  return ok(v, formato(conc, reg));
}

/** Delphi conversion exception (E9): modal MessageBox and no reply (Q2). */
function erroConversao(conc: Concentrador, v: VerboCompanytec, campo: string): Resultado {
  // Text as the bench watcher read it (diff r4b, §18): doubled quotes and a final dot.
  const msg = `''${campo}'' is not a valid integer value.`;
  if (conc.q('Q2')) return { resposta: null, verbo: v, travar: msg };
  return silencio(v, msg);
}

/**
 * &LE of the 2.7.2 (behavioral equivalence, verdict #23 with the judge's correction): n = StrToInt('$' + 7th
 * char). n = 0 → silence. Column (n div 4) − 1 (0 if negative) and rows 1–4, 5–8, 9–12
 * or 13–16 by n mod 4 (1, 2, 3, 0), in the events grid (4 × 16).
 * Reply `(` + the 4 cells + `)`, without KK. Only the opening event in row 1 is modeled
 * ({@link celulaEvento}); every other cell is the unused `00000000`.
 */
function leituraEvento(conc: Concentrador, cmd: string): Resultado {
  const c = cmd[6] ?? '';
  const n = /^[0-9A-Fa-f]$/.test(c) ? parseInt(c, 16) : null;
  if (n === null) return erroConversao(conc, 'LE', '$' + c);
  if (n === 0) return silencio('LE', 'nenhum grupo de linhas');
  const coluna = Math.max(0, Math.floor(n / 4) - 1);
  const resto = n % 4;
  const primeira = resto === 0 ? 13 : 4 * (resto - 1) + 1;
  let corpo = '';
  for (let linha = primeira; linha < primeira + 4; linha++) corpo += celulaEvento(conc, coluna, linha);
  return ok('LE', semKK(corpo));
}

/**
 * Events grid cell. Bench diff r4b (§18, EQUIV-LEITURA #23): an unused cell comes out
 * as 8 zeros, row 16 included (`(&LE00C5A)` → 32 zeros). Row 1 of column 0 holds the opening
 * event, `DDMMhhmm` of the PC clock when the simulator was opened: bench diff r6 (fresh 2.7.2
 * opened ~13:22, run from 13:23:58) read `17101322` after a `&KW` to 16/10 14:30, so it is not
 * the RTC; r4b read `16101956` on a 2.7.2 open since the evening before. Which event it is
 * (opening × first "Carregar configuração padrão") is not separated by the data (B).
 */
function celulaEvento(conc: Concentrador, coluna: number, linha: number): string {
  if (coluna === 0 && linha === 1) {
    const d = dataHoraDeEpoch(conc.ligadoEmMs, conc.rtc.offsetMinutos);
    return [d.dia, d.mes, d.hora, d.minuto].map((n) => padNum(n, 2)).join('');
  }
  return '00000000';
}

// ───────────────────────── display and status ─────────────────────────

export function visualizacao(conc: Concentrador): string {
  const incluiE = conc.q('V_INCLUI_E');
  let corpo = '';
  for (const b of conc.bicosAtivos()) {
    if (b.status === 'A' || (incluiE && b.status === 'E')) {
      const ml = b.corrente?.volumeMl ?? 0;
      corpo += hex2(b.codigo) + padNumSemCorte(Math.floor(ml / 10), 6);
    }
  }
  return corpo ? semKK(corpo) : '(0)';
}

export function status(conc: Concentrador): string {
  const fmt = conc.perfil.status.formato;
  const n = fmt === 'cbc32' ? 32 : fmt === 'cbc36' ? 36 : 48;
  let x = '';
  for (let i = 0; i < n; i++) {
    const l = conc.ladoPorIndice(i);
    x += l ? conc.letraDoLado(l) : 'F';
  }
  if (fmt === 'h48') return semKK('S' + x);
  const p = conc.redeAC ? 'G' : 'B';
  const t = hex2(Math.round((conc.bateriaCv * 102) / 1000));
  const trailer = conc.tipoCbc() + conc.perfil.firmware + conc.perfil.monitor + p + t;
  return semKK('S' + x + (fmt === 'cbc32' ? 'FF' + conc.perfil.status.dips : '') + trailer);
}

/** (&F) of the 2.7.2: F + 32×(N000 | R + type + state of nozzle 1) + KK. */
function bombas(conc: Concentrador): string {
  const estadoHex: Record<string, string> = { retirado: '71', abastecendo: '91', repouso: '61', recolocado: 'A1' };
  let corpo = 'F';
  for (let i = 0; i < 32; i++) {
    const l = conc.ladoPorIndice(i);
    const b1 = l?.bicos[0];
    if (!l || !b1 || !b1.ativo) corpo += 'N000';
    else corpo += 'R' + l.tipoBomba.slice(0, 1) + (estadoHex[b1.estado] ?? 'FF');
  }
  return comKK(corpo);
}

// ───────────────────────── clock ─────────────────────────

/** Date/time the concentrator shows: by fields on the 2.7.2 (RTC_272), otherwise the calendar. */
function rtcAgora(conc: Concentrador) {
  return conc.q('RTC_272') ? conc.rtc.agoraPorCampos() : conc.rtc.agora();
}

/** 2-digit RTC field. On the 2.7.2 (RTC_272) a byte above 99 comes out whole (B). */
function campo2(conc: Concentrador, n: number): string {
  return conc.q('RTC_272') ? padNumSemCorte(n, 2) : padNum(n, 2);
}

function relogioR(conc: Concentrador): string {
  const d = rtcAgora(conc);
  const p2 = (n: number) => campo2(conc, n);
  let r = `(REL ${p2(d.hora)}:${p2(d.minuto)}:${p2(d.segundo)} ${p2(d.dia)}/${p2(d.mes)}/${p2(d.ano % 100)})`;
  if (conc.q('R_EXTRAS')) {
    r += '(DHA SIM02 V2.7.2)(SOFT MONITOR V:1.0)' + '(M 00000000)'.repeat(5);
    // DIFF-12 (bench 17/10): one row per address, in the &C layout:
    // C + channel(2) + pump type + comma + address(2) + nozzle count(2) + 00.
    // C_272 (verdict #36): the raw texts &C stored in the grid, including with 0 nozzles.
    for (const l of conc.lados) {
      if (l.gradeC) {
        r += `(C0${l.canal}${l.gradeC.tipo}${l.gradeC.cv}0${l.endereco}${l.gradeC.bicos}00)`;
        continue;
      }
      if (!l.configurado) continue;
      r += `(C${padNum(l.canal, 2)}${l.tipoBomba.slice(0, 1)}${hex2(l.virgula & 0x3f)}${padNum(l.endereco, 2)}${padNum(l.nBicos, 2)}00)`;
    }
  }
  return r;
}

function relogioKR1(conc: Concentrador): string {
  const d = rtcAgora(conc);
  const p2 = (n: number) => campo2(conc, n);
  return comKK(`KR1${p2(d.ano % 100)}${p2(d.mes)}${p2(d.dia)}${p2(d.diaSemana)}${p2(d.hora)}${p2(d.minuto)}${p2(d.segundo)}`);
}

/**
 * &H/&KW fields of the 2.7.2 (RTC_272): `StrToInt` field by field, with no range, storing them
 * one by one. The 1st one that does not convert opens E9 and the command gets no reply; the earlier ones
 * stay stored (behavioral equivalence, E9).
 */
function gravarCampos272(
  conc: Concentrador,
  v: 'H' | 'KW1',
  cmd: string,
  campos: [keyof CamposRtc, number][],
): Resultado | number[] {
  const valores: number[] = [];
  for (const [nome, i] of campos) {
    const txt = cmd.slice(i, i + 2);
    const n = strToIntDelphi(txt);
    if (n === null) return erroConversao(conc, v, txt);
    conc.rtc.gravarCampos({ [nome]: n });
    valores.push(n);
  }
  return valores;
}

function ajusteH(conc: Concentrador, cmd: string): Resultado {
  if (conc.q('RTC_272')) {
    // Verdict #38: day, hour and minute without range checking; `(&H)` even with hour 25.
    const r = gravarCampos272(conc, 'H', cmd, [
      ['dia', 3],
      ['hora', 5],
      ['minuto', 7],
    ]);
    return Array.isArray(r) ? ok('H', '(&H)') : r;
  }
  const dd = cmd.slice(3, 5);
  const hh = cmd.slice(5, 7);
  const mm = cmd.slice(7, 9);
  if (![dd, hh, mm].every((s) => s.length === 2 && ehDecimal(s))) return silencio('H', 'não numérico');
  const dia = Number(dd);
  const hora = Number(hh);
  const minuto = Number(mm);
  if (dia < 1 || dia > 31 || hora > 23 || minuto > 59) return silencio('H', 'fora da faixa');
  conc.rtc.ajustar({ dia, hora, minuto });
  return ok('H', '(&H)');
}

function ajusteKW1(conc: Concentrador, cmd: string): Resultado {
  if (conc.q('RTC_272')) {
    // Verdict #39/#40: the dispatch only looks at `KW` (neither the KK nor the `1` is checked), the 7
    // fields go raw to the field-based RTC (month 13 and hour 25 included) and the reply repeats
    // the values read with 2 digits. Missing or non-numeric field: E9 and silence, without
    // replying with the current time.
    const r = gravarCampos272(conc, 'KW1', cmd, [
      ['ano', 5],
      ['mes', 7],
      ['dia', 9],
      ['diaSemana', 11],
      ['hora', 13],
      ['minuto', 15],
      ['segundo', 17],
    ]);
    return Array.isArray(r) ? ok('KW1', comKK('KW1' + r.map((n) => padNumSemCorte(n & 0xff, 2)).join(''))) : r;
  }
  const p = cmd.slice(5, 19);
  const atual = (): string => {
    const d = rtcAgora(conc);
    const p2 = (n: number) => padNum(n, 2);
    return comKK(`KW1${p2(d.ano % 100)}${p2(d.mes)}${p2(d.dia)}${p2(d.diaSemana)}${p2(d.hora)}${p2(d.minuto)}${p2(d.segundo)}`);
  };
  if (cmd.length !== 22 || !ehDecimal(p)) return ok('KW1', atual());
  const n = (i: number) => Number(p.slice(i, i + 2));
  const [aa, mes, dia, ws, hora, minuto, segundo] = [n(0), n(2), n(4), n(6), n(8), n(10), n(12)];
  const valido = mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31 && ws >= 1 && ws <= 7 && hora <= 23 && minuto <= 59 && segundo <= 59;
  if (!valido) return ok('KW1', atual());
  conc.rtc.ajustar({ ano: 2000 + aa, mes, dia, hora, minuto, segundo });
  return ok('KW1', comKK('KW1' + p));
}

// ───────────────────────── commands ─────────────────────────

function erro(conc: Concentrador, prefixo: string, tipo: 'bicoInexistente' | 'modoInvalido' | 'falha' | 'abastecendo'): string | null {
  const e272 = conc.q('ERROS_272');
  switch (tipo) {
    case 'bicoInexistente':
      return `(${prefixo}${e272 ? '?t' : '?b'})`;
    case 'modoInvalido':
      return e272 ? null : `(${prefixo}?m)`;
    case 'falha':
    case 'abastecendo':
      return `(${prefixo}?t)`;
  }
}

const MODOS_M = ['A', 'B', 'L', 'S', 'P', 'I', 'H'];

function modo(conc: Concentrador, cmd: string): Resultado {
  if (cmd.length !== 9) return silencio('M', 'tamanho inválido');
  const bb = cmd.slice(3, 5);
  const m = cmd[5] ?? '';
  if (m === 'c' && conc.q('ERROS_272')) {
    // behavioral equivalence: in the 9-char handler, `c` answers (M99) with any BB. The clear
    // it calls does nothing: with M99_272 there is no list to clear (the blacklist is the
    // registry column, verdict #30/#32).
    if (!conc.q('M99_272')) conc.listaNegraOp('c', '');
    return ok('M', '(M99)');
  }
  // ERROS_272 (behavioral equivalence, verdict #31): the 9-char handler picks the routine by the mode
  // first; a mode outside A/B/L/S/P/I/H leaves the answer empty, even with a nonexistent nozzle.
  if (conc.q('ERROS_272') && !MODOS_M.includes(m)) return silencio('M', 'modo inválido');
  // DT435 p.20-21: clearing the blacklist is the short form `(&M99c48)`, with no identifier code.
  if (bb === '99' && m === 'c' && verboHabilitado(conc, 'M99')) {
    conc.listaNegraOp('c', '');
    return ok('M99', '(M99)');
  }
  const b = conc.bicoPorTexto(bb);
  // DIFF-02 (bench 17/10): on the 2.7.2, &M with a nonexistent nozzle echoes the BB, with no effect.
  if (!b && conc.q('ERROS_272')) return ok('M', `(M${bb})`);
  if (!b) return { resposta: erro(conc, 'M', 'bicoInexistente'), verbo: 'M' };
  const r = conc.modo(b.codigo, m);
  if (r === 'ok') return ok('M', `(M${bb})`);
  return { resposta: erro(conc, 'M', r === 'modoInvalido' ? 'modoInvalido' : 'falha'), verbo: 'M' };
}

function listaNegra(conc: Concentrador, cmd: string): Resultado {
  const op = cmd[5];
  const cod = cmd.slice(6, 22);
  if (conc.q('M99_272')) {
    // behavioral equivalence, verdict #32: 25 chars with KK, free BB. Walks the card
    // registry; on the row with the same code (exact comparison) marks `sim` with `b` and
    // `nao` with any other op. (M99) if found, (M?f) = card not registered.
    const c = conc.cartoes.get(cod);
    if (!c || c.codigo !== cod) return ok('M99', '(M?f)');
    conc.listaNegraOp(op === 'b' ? 'b' : 'l', cod);
    return ok('M99', '(M99)');
  }
  if (op !== 'c' && op !== 'b' && op !== 'l') {
    return { resposta: conc.q('ERROS_272') ? null : '(M?m)', verbo: 'M99' };
  }
  // DIFF-02 (bench 17/10): the real 2.7.2 answers (M?f) already on the 1st `b` and also on `c`.
  if (conc.q('ERROS_272')) return ok('M99', '(M?f)');
  const r = conc.listaNegraOp(op, cod);
  return ok('M99', r === 'cheia' ? '(M?f)' : '(M99)');
}

function preset(conc: Concentrador, cmd: string): Resultado {
  if (conc.q('P_272')) {
    // behavioral equivalence, verdict #35: no length test (only the KK). (P?t) with a nonexistent
    // nozzle or with its own nozzle in A. Otherwise pre-authorizes and sets P, and only then
    // converts the value: non-numeric → E8, no reply, with the nozzle already marked.
    const bb = cmd.slice(3, 5);
    const b = conc.bicoPorTexto(bb);
    if (!b || b.status === 'A') return ok('P', '(P?t)');
    const txt = cmd.slice(5, 9) + ',' + cmd.slice(9, 11);
    const v = strToFloatDelphi(txt);
    conc.preset272(b, v === null ? null : Math.round(v * 100));
    if (v === null) return erroFloat(conc, 'P', txt);
    return ok('P', `(P${bb})`);
  }
  if (cmd.length !== 14) return silencio('P', 'tamanho inválido');
  const bb = cmd.slice(3, 5);
  const valor = cmd.slice(5, 11);
  if (!ehDecimal(valor)) return silencio('P', 'valor não numérico');
  const b = conc.bicoPorTexto(bb);
  if (!b) return { resposta: erro(conc, 'P', 'bicoInexistente'), verbo: 'P' };
  const r = conc.preset(b.codigo, Number(valor));
  if (r === 'ok') return ok('P', `(P${bb})`);
  return { resposta: erro(conc, 'P', r === 'abastecendo' ? 'abastecendo' : 'falha'), verbo: 'P' };
}

/** StrToFloat exception (E8): MessageBox and no reply (Q2). */
function erroFloat(conc: Concentrador, v: VerboCompanytec, campo: string): Resultado {
  // Text as the bench watcher read it (diff r4b, §18: `'000012X4' is not a valid floating point value.`).
  const msg = `'${campo}' is not a valid floating point value.`;
  if (conc.q('Q2')) return { resposta: null, verbo: v, travar: msg };
  return silencio(v, msg);
}

/**
 * &U of the 2.7.2 (U_272, behavioral equivalence, verdict #33/#34). Price = 4 digits with the
 * Windows comma: `cmd[7..10]` in the 14-char one and `cmd[9..12]` in the 16-char one (`cmd[7..8]` ignored),
 * `dd,dd` with comma `2x` and `d,ddd` with the others. Invalid level → modal "Nível de preço
 * incorreto." and, after the OK, `(UBB)` in the 14-char one and `(U?t)` in the 16-char one, without changing the price.
 * Non-numeric price → E8, no reply. Bug of the 16-char one: with comma `2x`, levels 1 and 2
 * store into level 0.
 */
function preco272(conc: Concentrador, cmd: string, v: 'U4' | 'U6'): Resultado {
  const ack = conc.perfil.ackPreco;
  const bb = cmd.slice(3, 5);
  const b = conc.bicoPorTexto(bb);
  if (!b) return ok(v, `(${ack}?t)`);
  const nivel = cmd[5] ?? '';
  const niveis = v === 'U4' ? ['0', '1'] : ['0', '1', '2'];
  if (!niveis.includes(nivel)) {
    const depois = v === 'U4' ? `(${ack}${bb})` : `(${ack}?t)`;
    return { resposta: null, verbo: v, travar: 'Nível de preço incorreto.', aposOk: depois };
  }
  const casas = conc.casasDoBico(b).preco;
  const d = v === 'U4' ? cmd.slice(7, 11) : cmd.slice(9, 13);
  const txt = casas === 2 ? d.slice(0, 2) + ',' + d.slice(2) : d.slice(0, 1) + ',' + d.slice(1);
  const valor = strToFloatDelphi(txt);
  if (valor === null) return erroFloat(conc, v, txt);
  const alvo = v === 'U6' && casas === 2 ? 0 : Number(nivel);
  conc.definirPreco(b.codigo, alvo, Math.round(valor * 10 ** casas));
  return ok(v, `(${ack}${bb})`);
}

function preco(conc: Concentrador, cmd: string, v: 'U4' | 'U6'): Resultado {
  const tam = v === 'U4' ? 14 : 16;
  if (cmd.length !== tam) return silencio(v, 'tamanho inválido');
  if (conc.q('U_272')) return preco272(conc, cmd, v);
  const bb = cmd.slice(3, 5);
  const nivelCh = cmd[5] ?? '';
  const valor = cmd.slice(7, v === 'U4' ? 11 : 13);
  const b = conc.bicoPorTexto(bb);
  if (!b) return { resposta: erro(conc, conc.perfil.ackPreco, 'bicoInexistente'), verbo: v };
  const niveis = v === 'U4' ? ['0', '1'] : ['0', '1', '2'];
  if (!niveis.includes(nivelCh) || !ehDecimal(valor)) {
    // 2.7.2: modal MessageBox "Nível de preço incorreto." and no reply (Q2).
    if (conc.q('Q2')) return { resposta: null, verbo: v, travar: 'Nível de preço incorreto.' };
    return silencio(v, 'nível de preço inválido');
  }
  const r = conc.definirPreco(b.codigo, Number(nivelCh), Number(valor));
  if (r === 'ok') return ok(v, `(${conc.perfil.ackPreco}${bb})`);
  return { resposta: erro(conc, conc.perfil.ackPreco, 'falha'), verbo: v };
}

/**
 * &C of the 2.7.2 (C_272, behavioral equivalence, verdict #43/#45): no length test (only the KK);
 * channel = cmd[5] and address = cmd[9]. Outside 1..8 / 1..4 it does nothing. Type = cmd[3]
 * (`(&CH…)` = type H), price decimals = cmd[6], volume decimals = cmd[7] (A → 2, E → 3, other
 * keeps), nozzle count = cmd[11]. A char that does not convert (or past the end of the frame)
 * opens E6 "Erro na configuração" and nothing changes. Never replies.
 */
function configurar272(conc: Concentrador, cmd: string): Resultado {
  const dig = (i: number) => (/^[0-9]$/.test(cmd[i] ?? '') ? Number(cmd[i]) : null);
  const e6 = (): Resultado => {
    const msg = `Erro na configuração: ${cmd}`;
    return conc.q('Q2') ? { resposta: null, verbo: 'C', travar: msg } : silencio('C', msg);
  };
  const canal = dig(5);
  const endereco = dig(9);
  if (canal === null || endereco === null) return e6();
  if (canal < 1 || canal > 8 || endereco < 1 || endereco > 4) return silencio('C', 'canal/endereço fora da faixa');
  const casasPreco = dig(6);
  const n = dig(11);
  if (casasPreco === null || n === null) return e6();
  const vol = cmd[7];
  conc.configurarEndereco272({
    canal,
    endereco,
    // n > 4 overwrites the next address on the 2.7.2 (index overflow): here it stops at 4 (B).
    nBicos: n,
    tipoBomba: cmd[3] ?? 'W',
    casasPreco: casasPreco & 3,
    casasVolume: vol === 'A' ? 2 : vol === 'E' ? 3 : null,
    grade: { tipo: cmd[3] ?? '', cv: cmd.slice(6, 8), bicos: cmd.slice(10, 12) },
  });
  return silencio('C');
}

/**
 * &c of the 2.7.2 (C_272, behavioral equivalence, verdict #44): KK; `cmd[3]` ignored; for the nozzle with
 * code = `cmd[4..5]`, copies `cmd[6..7]`, `cmd[8..9]` and `cmd[10..11]` into the three fields
 * the record generator reads along with the PAF (B: lane nozzle, fuel and tank, in that
 * order; the position in the layout was not traced). Never replies.
 */
function configurarCampos272(conc: Concentrador, cmd: string): Resultado {
  const b = conc.bicoPorTexto(cmd.slice(4, 6));
  if (b) conc.camposBico272(b, [cmd.slice(6, 8), cmd.slice(8, 10), cmd.slice(10, 12)]);
  return silencio('c');
}

function configurar(conc: Concentrador, cmd: string): Resultado {
  if (conc.q('C_272')) return configurar272(conc, cmd);
  // (&C T 0c VV 0e 0n 00 KK) — behavioral equivalence
  if (cmd.length !== 17) return silencio('C', 'tamanho inválido');
  const tipo = cmd[3] ?? 'W';
  const canal = Number(cmd[5]);
  const virgula = parseInt(cmd.slice(6, 8), 16);
  const endereco = Number(cmd[9]);
  const nBicos = Number(cmd[11]);
  if ([canal, virgula, endereco, nBicos].some((n) => Number.isNaN(n))) return silencio('C', 'campo inválido');
  conc.configurarEndereco({ canal, endereco, nBicos, tipoBomba: tipo, virgula });
  return silencio('C');
}

function gravarTotais(conc: Concentrador, cmd: string): Resultado {
  if (conc.q('E_272')) {
    // behavioral equivalence, verdict #42: no KK; the nozzle field = cmd[3..4] (1 char
    // gets a leading 0), the value field = cmd[5..12]. The totalizer in liters becomes
    // StrToFloat(value), in **whole** liters, and creates a record if it changed. Replies even
    // without a nozzle, with the literal `(TL` passed to the builder, which adds another `(` and sums both
    // into the KK: `((TL`+nozzle+value+KK+`)`. Non-numeric → E8, no reply. The
    // Dinheiro radio button (silence) is not modeled: Litros always applies.
    let bb = cmd.slice(3, 5);
    if (bb.length === 1) bb = '0' + bb;
    const v8 = cmd.slice(5, 13);
    const litros = strToFloatDelphi(v8);
    if (litros === null) return erroFloat(conc, 'E', v8);
    const b = conc.bicoPorTexto(bb);
    if (b) conc.gravarEncerrante272(b, Math.round(litros * 1000));
    return ok('E', comKK(`(TL${bb}${v8}`));
  }
  // (&E BB VVVVVVVV) without KK; replies (TL BB value KK) — 2.7.2 "Litros" radio button.
  const bb = cmd.slice(3, 5);
  const valor = cmd.slice(5, 13);
  if (!ehDecimal(valor)) return silencio('E', 'valor não numérico');
  const b = conc.bicoPorTexto(bb);
  if (!b) return silencio('E', 'bico inexistente');
  conc.gravarEncerrante(b.codigo, Number(valor) * 10);
  return ok('E', comKK(`TL${bb}${padNum(Number(valor), 8)}`));
}

// ───────────────────────── &T ─────────────────────────

function totalizadores(conc: Concentrador, porta: string, cmd: string): Resultado {
  const verbo = identificarVerbo(cmd) ?? 'TL';
  const t272 = conc.q('T_272');
  // 2.7.2 (behavioral equivalence, verdict #17): no length test, only the KK; the mode is the 6th char.
  if (!t272 && cmd.length !== 9) return silencio(verbo, 'tamanho inválido');
  if (!kkValido(cmd)) return silencio(verbo, 'checksum inválido');
  const bb = cmd.slice(3, 5);
  const m = cmd[5] ?? '';
  const tg = conc.q('TG');
  const padrao = (): Resultado =>
    ok(
      verbo,
      comKK(
        'TG' + bb + padNum(conc.buffer.escrita - 1, 4) + padNum(conc.ponteiroLeitura(porta) - 1, 4),
      ),
    );
  if (!conc.perfil.verbos.has(verbo) && !tg) return silencio(verbo, 'verbo não suportado no perfil');
  const habilitado = conc.perfil.verbos.has(verbo) && verboHabilitadoGate(conc, verbo);

  if (verbo === 'T99P') {
    if (tg) return padrao();
    if (!habilitado) return silencio(verbo);
    return ok(verbo, comKK('TP99' + padNum(conc.buffer.escrita, 4) + padNum(conc.ponteiroLeitura(porta), 4)));
  }
  if (verbo === 'T99N') {
    if (tg) return padrao();
    if (!habilitado) return silencio(verbo);
    return ok(verbo, comKK('T' + conc.perfil.permissaoSerie + '99' + padNum(Number(conc.perfil.numeroSerie), 8)));
  }
  const modosConhecidos = ['L', 'l', '$', 'C', 'U', 'u', 'N', 'P', 'I'];
  // T_272 (behavioral equivalence, verdict #21): the loop compares the BB code stored in the nozzle and
  // does not test whether it is active, so a nozzle unconfigured by `&C` n=0 still answers.
  const b = t272 ? conc.bicoComCodigo(bb) : conc.bicoPorTexto(bb);
  if (!b || !modosConhecidos.includes(m)) return tg ? padrao() : silencio(verbo, 'bico ou modo inexistente');
  // T_272 (verdict #18): L/l/$ pad with zeros up to the minimum and do not cut above it.
  const pad = t272 ? padNumSemCorte : padNum;
  if (!habilitado) return tg ? padrao() : silencio(verbo);
  switch (m) {
    case 'L':
      return ok(verbo, comKK('TL' + bb + pad(Math.floor(b.encerranteMl / 10), 8)));
    case 'l':
      return ok(verbo, comKK('Tl' + bb + pad(Math.floor(b.encerranteMl / 10), 10)));
    case '$':
      return ok(verbo, comKK('T$' + bb + pad(Math.floor(b.encerranteValorMil / 10), 8)));
    case 'C':
      return ok(verbo, configBico(conc, b, bb, t272));
    case 'U': {
      // 2.7.2 (verdict #20): FloatToStr, no comma, trailing zeros up to 4 and the first 4.
      const f = t272
        ? (n: number) => precoFloatToStr4(n, conc.casasDoBico(b).preco)
        : (n: number) => padNum(n, 4);
      return ok(verbo, comKK('TU' + bb + f(conc.precoConfigurado(b, 1)) + f(conc.precoConfigurado(b, 0))));
    }
    case 'u':
      return ok(
        verbo,
        comKK(
          'TU' +
            bb +
            padNum(conc.precoConfigurado(b, 1), 4) +
            padNum(conc.precoConfigurado(b, 0), 4) +
            padNum(conc.precoConfigurado(b, 2), 4),
        ),
      );
    case 'N':
      if (tg) return padrao();
      return ok(verbo, comKK('T' + conc.perfil.permissaoSerie + bb + padNum(Number(conc.perfil.numeroSerie), 8)));
    case 'P':
      if (tg) return padrao();
      // No example in DT435 (C3): returns the write pointer in 8 digits (B).
      return ok(verbo, comKK('TP' + bb + padNum(conc.buffer.escrita, 8)));
    case 'I': {
      if (tg) return padrao();
      const c = b.corrente ?? b.ultimosCartoes;
      // Missing card: 16 `F` on the real ones, 16 zeros only with CARTAO_VAZIO_ZEROS (2.7.2), as in the records.
      return ok(verbo, comKK('TI' + bb + F.cartao(conc, c.cartao1) + F.cartao(conc, c.cartao2)));
    }
    default:
      return tg ? padrao() : silencio(verbo);
  }
}

function verboHabilitadoGate(conc: Concentrador, v: VerboCompanytec): boolean {
  const gate = conc.perfil.gatesFirmware[v];
  return gate === undefined || versaoFirmware(conc.perfil.firmware) > gate;
}

/**
 * (Ts BB CC VV EE PP KK): channel, comma, address, number of positions (DT435 p.24-25).
 * On the 2.7.2 (`indiceBico`, behavioral equivalence, verdict #19) the 5th field is the nozzle index
 * within the address (1–4), not the address.
 */
function configBico(conc: Concentrador, b: Bico, bb: string, indiceBico = false): string {
  const l = conc.ladoDoBico(b);
  const campo5 = indiceBico ? b.posicao + 1 : l.endereco;
  return comKK('Ts' + bb + padNum(l.canal, 2) + hex2(l.virgula & 0x3f) + padNum(campo5, 2) + padNum(l.nBicos, 2));
}

/**
 * Price of the 2.7.2 `&T U`: FloatToStr of the price (integer at the `casas` scale), without the
 * comma, padded with trailing zeros up to 4 and cut to the first 4.
 * 5.49 → "549" → `5490`; 5.00 → "5" → `5000`; 1.123 → `1123`; 0 → `0000`.
 */
export function precoFloatToStr4(preco: number, casas: number): string {
  const v = Math.trunc(Math.abs(preco));
  const div = 10 ** casas;
  const frac = casas > 0 ? (v % div).toString().padStart(casas, '0').replace(/0+$/, '') : '';
  return (Math.floor(v / div).toString() + frac).padEnd(4, '0').slice(0, 4);
}

/** Value (cents, 2 decimals) of the current fueling — used by MCP/UI. */
export function valorCorrente(conc: Concentrador, b: Bico): number {
  const casas = decodificarVirgula(conc.ladoDoBico(b).virgula);
  return deMilesimos(b.corrente?.totalMil ?? 0, casas.total, conc.q('Q6'));
}
