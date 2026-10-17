import type { Concentrador } from '../../core/concentrador.js';
import { hex2 } from '../../core/codigo-bico.js';
import type { Cartao, Lado } from '../../core/modelo.js';
import { ehDecimal, ehHex, padNum } from '../../core/numeros.js';
import type { VerboIdentfid } from '../../profiles/types.js';
import { comKK, kkValido, semKK } from '../companytec/checksum.js';
import { cartao } from '../companytec/formatos.js';

/**
 * Identfid `(?…)` (DT435 §3.2.2, §3.3, §3.5.6; behavioral equivalence). The frames use the same
 * framing and the same KK as `(&…)`.
 *
 * Real profiles: everything carries KK. 2.7.2 (quirk IDF_272): `?V`/`?A`/`?S` match by exact
 * string, `?I`/`?D` do not check KK, `?F` with length ≠ 41 freezes (MessageBox).
 */
export interface ResultadoIdentfid {
  resposta: string | null;
  verbo: VerboIdentfid | null;
  travar?: string;
  erro?: string;
}

const silencio = (verbo: VerboIdentfid | null, erro?: string): ResultadoIdentfid => ({ resposta: null, verbo, erro });
const ok = (verbo: VerboIdentfid, resposta: string): ResultadoIdentfid => ({ resposta, verbo });

const EXATOS_272: Record<string, VerboIdentfid> = { '(?V95)': 'V', '(?A80)': 'A', '(?S92)': 'S' };

/** Verbs the 2.7.2 accepts without checking the KK. */
const SEM_KK_272 = new Set<VerboIdentfid>(['I', 'D']);

/** Fixed length of every `?F` (write, delete, clear and identified preset). */
const TAMANHO_F = 41;

export function identificarVerboIdentfid(cmd: string): VerboIdentfid | null {
  if (!cmd.startsWith('(?') || !cmd.endsWith(')')) return null;
  switch (cmd[2]) {
    case 'V':
      return 'V';
    case 'A':
      return 'A';
    case 'I':
      return 'I';
    case 'S':
      return 'S';
    case 'D':
      return 'D';
    case 'C':
      return 'C';
    case 'L':
      return cmd[3] === 'F' ? 'LF' : null;
    case 'F': {
      const p = cmd[5];
      return p === 'G' ? 'FG' : p === 'A' ? 'FA' : p === 'L' ? 'FL' : p === 'P' ? 'FP' : 'FG';
    }
    default:
      return null;
  }
}

export function processarIdentfid(conc: Concentrador, porta: string, cmd: string): ResultadoIdentfid {
  const idf = conc.perfil.identfid;
  // Console without Identfid, or 2.7.2 with another model in the combo: the `?` branch is not even tried.
  if (!idf || (idf.modelos && !idf.modelos.includes(conc.modelo))) return silencio(null, 'ERRO CMD');
  const verbo = identificarVerboIdentfid(cmd);
  if (!verbo) return silencio(null, 'ERRO CMD');
  if (!idf.verbos.has(verbo)) return silencio(verbo, 'verbo não suportado no perfil');
  const q272 = conc.q('IDF_272');

  if (q272 && (verbo === 'V' || verbo === 'A' || verbo === 'S')) {
    if (EXATOS_272[cmd] !== verbo) return silencio(verbo, 'ERRO CMD');
  } else if (!(q272 && SEM_KK_272.has(verbo)) && !kkValido(cmd)) {
    return silencio(verbo, 'checksum inválido');
  }
  // IDF_272 (behavioral equivalence, verdict #34(c)/#55): the `?F` branch needs the KK first; `P` and `L`
  // do not check the length (`L` = clear, KK is enough); only write/delete lock on length.
  if (q272 && verbo === 'FL') {
    conc.limparCartoes();
    return silencio('FL');
  }
  if (q272 && cmd[2] === 'F' && verbo !== 'FP' && cmd.length !== TAMANHO_F) {
    return { resposta: null, verbo, travar: 'STRING Gravação de TAG - Tamanho inválido' };
  }

  switch (verbo) {
    case 'V':
      return ok('V', visualizacaoIdentificada(conc));
    case 'A':
      return leituraPendente(conc, porta);
    case 'I':
      conc.idsPendentes.incrementar(conc.grupoPonteiroDe(porta));
      return silencio('I');
    case 'FG':
      return gravar(conc, cmd);
    case 'FA':
      return excluir(conc, cmd);
    case 'FL':
      return limpar(conc, cmd);
    case 'FP':
      return presetIdentificado(conc, cmd);
    case 'LF':
      return leituraCadastro(conc, cmd);
    case 'S':
      return ok('S', statusIdf(conc));
    case 'D':
      return ok('D', sensores(conc));
    case 'C':
      return configurarSensor(conc, cmd);
  }
}

// ───────────────────────── reads ─────────────────────────

/** ?V: nozzle + identifier of each fueling in progress. */
function visualizacaoIdentificada(conc: Concentrador): string {
  const q272 = conc.q('IDF_272');
  let corpo = '';
  for (const b of conc.bicosAtivos()) {
    if (b.estado !== 'abastecendo' || !b.corrente) continue;
    const id = q272 ? b.corrente.cartao1 : (b.corrente.cartao1 ?? b.corrente.cartao2);
    corpo += hex2(b.codigo) + cartao(conc, id);
  }
  if (!corpo) return '(0)';
  return q272 ? comKK(corpo) : semKK(corpo);
}

/** ?A: unregistered identifier at the pointer (A C16 B2 D H M N R4 S2 KK). */
function leituraPendente(conc: Concentrador, porta: string): ResultadoIdentfid {
  const id = conc.idsPendentes.atual(conc.grupoPonteiroDe(porta));
  if (!id) return ok('A', '(0)');
  const p2 = (n: number) => padNum(n, 2);
  const d = id.data;
  return ok(
    'A',
    comKK('A' + id.codigo + hex2(id.codigoBico) + p2(d.dia) + p2(d.hora) + p2(d.minuto) + p2(d.mes) + padNum(id.posicao, 4) + '00'),
  );
}

function turnos(c: Cartao): string {
  const t = (f: Cartao['turnoA']) => (f ? f.inicio + f.fim : '00000000');
  return t(c.turnoA) + t(c.turnoB);
}

/** ?LF: registry record at position P6. */
function leituraCadastro(conc: Concentrador, cmd: string): ResultadoIdentfid {
  if (cmd.length !== 13) return silencio('LF', 'tamanho inválido');
  const p = cmd.slice(4, 10);
  if (!ehDecimal(p)) return silencio('LF', 'posição não numérica');
  const pos = Number(p);
  const c = conc.cartoes.em(pos);
  const qtd = padNum(conc.cartoes.quantidade, 6);
  const dados = c ? c.codigo + turnos(c) + hex2(c.controle) : 'F'.repeat(34);
  return ok('LF', comKK('LF' + padNum(pos, 6) + qtd + dados));
}

// ───────────────────────── registry ─────────────────────────

function faixa(ini: string, fim: string): Cartao['turnoA'] {
  return ini === '0000' && fim === '0000' ? null : { inicio: ini, fim };
}

/** ?F CC G T16 AAAA aaaa BBBB bbbb KK → (F G P6 M6 T16 AAAA aaaa BBBB bbbb CC KK). */
function gravar(conc: Concentrador, cmd: string): ResultadoIdentfid {
  if (cmd.length !== TAMANHO_F) return silencio('FG', 'tamanho inválido');
  const cc = cmd.slice(3, 5);
  const t = cmd.slice(6, 22).toUpperCase();
  const tt = cmd.slice(22, 38);
  if (!ehHex(cc) || !ehHex(t) || !ehDecimal(tt)) return silencio('FG', 'campo inválido');
  // IDF_272, bench diff r4b (§18, DIFF-14/15, EQUIV-COMANDOS): M6 is the registry count
  // *before* the write (0/0, 1/1, 2/2, 3/3 on the bench), not after. B: a rewrite of a card
  // already registered was not measured.
  const antes = conc.cartoes.quantidade;
  const pos = conc.gravarCartao({
    codigo: t,
    controle: parseInt(cc, 16),
    turnoA: faixa(tt.slice(0, 4), tt.slice(4, 8)),
    turnoB: faixa(tt.slice(8, 12), tt.slice(12, 16)),
  });
  if (pos === null) return silencio('FG', 'memória de identificadores cheia');
  const m6 = conc.q('IDF_272') ? antes : conc.cartoes.quantidade;
  return ok('FG', comKK('FG' + padNum(pos, 6) + padNum(m6, 6) + t + tt + cc.toUpperCase()));
}

/** ?F CC A T16 00 R6 L8 KK → (F A X6 S6 C16 AAAA aaaa BBBB bbbb CC KK); X = 000000 = failure. */
function excluir(conc: Concentrador, cmd: string): ResultadoIdentfid {
  if (cmd.length !== TAMANHO_F) return silencio('FA', 'tamanho inválido');
  const t = cmd.slice(6, 22);
  const r = cmd.slice(24, 30);
  if (!ehHex(t) || !ehDecimal(r)) return silencio('FA', 'campo inválido');
  const pos = conc.excluirCartao(t);
  return ok('FA', comKK('FA' + padNum(pos ?? 0, 6) + r + '0'.repeat(16) + '0'.repeat(16) + '00'));
}

/** ?F00L + 32 fixed chars: clears the registry, no reply. */
function limpar(conc: Concentrador, cmd: string): ResultadoIdentfid {
  if (cmd.length !== TAMANHO_F || cmd.slice(3, 5) !== '00') return silencio('FL', 'quadro inválido');
  conc.limparCartoes();
  return silencio('FL');
}

/** ?F BB P T16 C A P6 N2 H R5 KK → (FBB) | (F?t) | (F?b). */
function presetIdentificado(conc: Concentrador, cmd: string): ResultadoIdentfid {
  if (cmd.length !== TAMANHO_F) return silencio('FP', 'tamanho inválido');
  const bb = cmd.slice(3, 5);
  const t = cmd.slice(6, 22);
  const c = cmd[22] ?? '';
  const a = cmd[23] ?? '';
  const valor = cmd.slice(24, 30);
  const n = cmd.slice(30, 32);
  const h = cmd[32] ?? '';
  const e272 = conc.q('ERROS_272');
  const b = conc.bicoPorTexto(bb);
  if (!b) return ok('FP', e272 ? '(F?t)' : '(F?b)');
  const tipos = { '0': 'frentista', '1': 'cliente', '2': 'hodometro' } as const;
  if (!ehHex(t) || !(c in tipos) || (a !== 'S' && a !== 'N') || !ehDecimal(valor) || !ehDecimal(n) || (h !== '$' && h !== 'V')) {
    return silencio('FP', 'campo inválido');
  }
  const r = conc.presetIdentificado({
    codigo: b.codigo,
    identificador: t,
    tipoId: tipos[c as keyof typeof tipos],
    autoriza: a === 'S',
    valor: Number(valor),
    segundos: Number(n),
    tipoPreset: h,
  });
  if (r === 'ok') return ok('FP', `(F${bb})`);
  return ok('FP', '(F?t)');
}

// ───────────────────────── 2.7.2 (outside DT435) ─────────────────────────

/** Side letter in ?S: F without IDF sensor, A fueling, L. */
function letraIdf(l: Lado): string {
  if (!l.sensorIdf) return 'F';
  return l.bicos.some((b) => b.ativo && b.estado === 'abastecendo') ? 'A' : 'L';
}

/** ?S: &S over the IDF vector, with the firmware "v" in lowercase. */
function statusIdf(conc: Concentrador): string {
  let x = '';
  for (let i = 0; i < 32; i++) {
    const l = conc.ladoPorIndice(i);
    x += l ? letraIdf(l) : 'F';
  }
  const p = conc.redeAC ? 'G' : 'B';
  const t = hex2(Math.round((conc.bateriaCv * 102) / 1000));
  const fw = conc.perfil.firmware.replace(/^V/, 'v');
  // DIFF-13 (bench 17/10): on the 2.7.2 the CBC type of ?S stays at the initial `0` of the buffer
  // (behavioral equivalence: only the &S one is rewritten by the model). Only tested with the combo on CBC-06.
  const tipo = conc.q('IDF_272') ? '0' : conc.tipoCbc();
  return semKK('S' + x + 'FF' + conc.perfil.status.dips + tipo + fw + conc.perfil.monitor + p + t);
}

/**
 * ?D: F + 32×(N000 without sensor | RI + state of nozzle 1 + FF) + KK.
 * State: 02 at rest, 01 fueling, 00 otherwise (the mapping is an inference, B).
 * IDF_272 (verdict #51): it is the **status** of nozzle 1, not the state: A → 02, B → 01,
 * anything else → 00.
 */
function sensores(conc: Concentrador): string {
  let corpo = 'F';
  for (let i = 0; i < 32; i++) {
    const l = conc.ladoPorIndice(i);
    if (!l || !l.sensorIdf) {
      corpo += 'N000';
      continue;
    }
    if (conc.q('IDF_272')) {
      const st = l.bicos[0]?.status;
      corpo += 'RI' + (st === 'A' ? '02' : st === 'B' ? '01' : '00') + 'FF';
      continue;
    }
    const e = l.bicos[0]?.estado;
    corpo += 'RI' + (e === 'repouso' ? '02' : e === 'abastecendo' ? '01' : '00') + 'FF';
  }
  return comKK(corpo);
}

/**
 * ?C: turns on the IDF sensor of address Copy(5,2)/Copy(7,2). The fields
 * Copy(9,2)/Copy(11,2) — the identification mode among them — are discarded.
 */
function configurarSensor(conc: Concentrador, cmd: string): ResultadoIdentfid {
  const canal = cmd.slice(4, 6);
  const endereco = cmd.slice(6, 8);
  if (!ehDecimal(canal) || !ehDecimal(endereco)) return silencio('C', 'campo inválido');
  // BLOQUEIO_272 (verdict #52): the 2.7.2 also turns on the block of the 4 nozzles.
  conc.configurarSensorIdf(Number(canal), Number(endereco));
  return silencio('C');
}
