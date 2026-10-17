import {
  type FuncaoHorustech,
  type Perfil,
  type PerfilId,
  type Quirks,
  type VerboCompanytec,
  type VerboIdentfid,
  quirksDesligados,
  quirksLigados,
} from './types.js';

export * from './types.js';

const V = (...v: VerboCompanytec[]): ReadonlySet<VerboCompanytec> => new Set(v);

/** CBC06 verbs (fw ≤ 5.3 and above, DT435). */
const VERBOS_CBC06: VerboCompanytec[] = [
  'A', 'A67', '@66', 'A2', 'A3', 'LC', 'LR', 'T99P', 'T99N', 'I', 'V', 'S',
  'T$', 'TL', 'Tl', 'TN', 'TU', 'Tu', 'TP', 'TC', 'TI', 'U4', 'U6', 'P', 'M', 'M99',
  'R', 'KR1', 'H', 'KW1',
];

const IDF = (...v: VerboIdentfid[]): ReadonlySet<VerboIdentfid> => new Set(v);
/** DT435 Identfid (CBC06 and Horustech). */
const IDF_DT435 = IDF('V', 'A', 'FG', 'FA', 'FL', 'FP', 'I', 'LF');
const HORUS_V1: ReadonlySet<FuncaoHorustech> = new Set(['02', '06', '32']);

const HORUSTECH_SERIAL = { tipo: 'serial', porta: 'COM1' } as const;

const BASE_REAL = {
  monitor: 'M1.0',
  numeroSerie: '00000001',
  permissaoSerie: 'C',
  ackPreco: 'U',
  tickEstadoMs: 1000,
  tickVazaoMs: 300,
  vazaoMlPorTick: { casas2: 130, casas3: 129 },
  ticksPiscando: 0,
  bateriaDinamica: false,
  repousoComSensorBloqueado: true,
  dip3Padrao: true,
  capacidadeEventos: 8000,
  capacidadeCartoes: 16000,
  buffer: { posMin: 0, posMax: 9999 },
  escutaTcp: 'simultanea',
  opcoesPortaTcp: [],
  // No number in the manual: the ?A R4 caps it at 10000 (B).
  idsPendentes: { posMin: 0, posMax: 9999 },
  horustech: null,
} as const;

function semQuirks(): Quirks {
  return quirksDesligados();
}

export const PERFIS: Readonly<Record<PerfilId, Perfil>> = {
  'simulador-2.7.2': {
    id: 'simulador-2.7.2',
    nome: 'SimuladorCBC 2.7.2',
    descricao:
      'Medido contra o SimuladorCBC Vr 2.7.2 real, bugs incluídos como quirks. 8 canais, ponteiro único, porta 2001.',
    modelo: 'CBC-06',
    firmware: 'V3.7',
    monitor: 'M1.0',
    numeroSerie: '99999999',
    permissaoSerie: 'G',
    canais: 8,
    status: { formato: 'cbc32', tipoCbc: '6', dips: 'DD' },
    verbos: V(...VERBOS_CBC06, 'LE', 'F', 'E', 'C', 'c'),
    gatesFirmware: {},
    formatoA: 'dip3',
    dip3Padrao: true,
    leituraRegistro: { lr: 74, lc: 'paf1', porModelo: true },
    ackPreco: 'U',
    buffer: { posMin: 1, posMax: 999 },
    capacidadeEventos: 1000,
    capacidadeCartoes: 1000,
    portas: [{ tipo: 'tcp', porta: 2001 }],
    escutaTcp: 'umaPorVez',
    opcoesPortaTcp: [2001, 1771, 7002],
    identfid: { verbos: IDF('V', 'A', 'FG', 'FA', 'FL', 'FP', 'I', 'LF', 'S', 'D', 'C'), modelos: ['CBC-06', 'Horustech'] },
    idsPendentes: { posMin: 1, posMax: 8192 },
    horustech: { funcoes: HORUS_V1, modelos: ['CBC-06', 'Horustech'], niveisPreco: ['0', '1'] },
    tickEstadoMs: 1000,
    // Flow timer: the 2.7.2 asks for 100 ms, and Windows fires it on its 15.625 ms system tick, so the
    // effective period is 7 × 15.625 = 109.375 ms (DECISIONS §29: fits the fueling probe, DIFF-18 of
    // r6–r10 and EQUIV-MOTOR #26 of every Windows bench run). Under Wine it is exactly 100 ms (§26 W1).
    // The "Normal" speed button does not fire its handler on load (fueling probe on the bench, 17/10).
    tickVazaoMs: 109.375,
    vazaoMlPorTick: { casas2: 130, casas3: 129 },
    ticksPiscando: 7,
    bateriaDinamica: true,
    repousoComSensorBloqueado: false,
    quirks: quirksLigados(),
  },
  'cbc-32': {
    ...BASE_REAL,
    id: 'cbc-32',
    nome: 'CBC06 (32 posições)',
    descricao: 'Console CBC06 segundo o DT435: &S 32+trailer tipo 6, &A 52, erros completos, ponteiro por porta.',
    modelo: 'CBC-06',
    firmware: 'V8.4',
    canais: 8,
    status: { formato: 'cbc32', tipoCbc: '6', dips: 'DD' },
    verbos: V(...VERBOS_CBC06),
    gatesFirmware: { A3: 5.3, KW1: 5.3, TI: 2.3 },
    formatoA: 52,
    leituraRegistro: { lr: 74, lc: 'cbc' },
    capacidadeCartoes: 16000,
    portas: [HORUSTECH_SERIAL, { tipo: 'tcp', porta: 2001 }, { tipo: 'tcp', porta: 1771 }],
    identfid: { verbos: IDF_DT435 },
    quirks: semQuirks(),
  },
  'cbc05-dip3': {
    ...BASE_REAL,
    id: 'cbc05-dip3',
    nome: 'CBC03/04/05',
    descricao:
      'Console CBC04/05 (DT435 p.3-4): &A 52 ou 34 pela DIP3, &S tipo 5, sem Identfid nem PAF. CBC03 = este perfil sem &L/&T99P/&KR1 (derivePerfil).',
    modelo: 'CBC-05',
    firmware: 'V8.4',
    canais: 8,
    status: { formato: 'cbc32', tipoCbc: '5', dips: 'DD' },
    verbos: V(
      'A', 'LC', 'LR', 'T99P', 'I', 'V', 'S', 'T$', 'TL', 'Tl', 'TN', 'TU', 'TP', 'TC',
      'U4', 'P', 'M', 'R', 'KR1', 'H',
    ),
    gatesFirmware: {},
    formatoA: 'dip3',
    leituraRegistro: { lr: 74, lc: 'cbc' },
    capacidadeCartoes: 0,
    portas: [HORUSTECH_SERIAL, { tipo: 'tcp', porta: 2001 }],
    identfid: null,
    quirks: semQuirks(),
  },
  cbc01: {
    ...BASE_REAL,
    id: 'cbc01',
    nome: 'CBC01 / IMS01-02',
    descricao: 'Console CBC01/IMS (DT435 p.4): &A 34, sem &S/&L/&T99P/&KR1, só serial.',
    modelo: 'CBC-01',
    firmware: 'V1.0',
    canais: 8,
    // &S is not documented for the CBC01 (&S compat. = CBC03/04/05/06): the verb is left out.
    status: { formato: 'cbc32', tipoCbc: '0', dips: 'DD' },
    verbos: V('A', 'I', 'V', 'T$', 'TL', 'Tl', 'TN', 'TU', 'TP', 'TC', 'U4', 'P', 'M', 'R', 'H'),
    gatesFirmware: {},
    formatoA: 34,
    leituraRegistro: { lr: 74, lc: 'cbc' },
    capacidadeCartoes: 0,
    portas: [HORUSTECH_SERIAL],
    identfid: null,
    quirks: semQuirks(),
  },
  'horustech-cbc-36': {
    ...BASE_REAL,
    id: 'horustech-cbc-36',
    nome: 'Horustech em protocolo CBC (36)',
    descricao:
      'Horustech emulando CBC (DT435 p.22): &S com 36 posições + trailer, 9 canais, &LR 82, &LC PAF1, ponteiro por porta.',
    modelo: 'Horustech',
    firmware: 'V8.4',
    canais: 9,
    status: { formato: 'cbc36', tipoCbc: '6', dips: 'DD' },
    verbos: V(...VERBOS_CBC06, 'A4'),
    gatesFirmware: { A3: 6.7, KW1: 6.7, A4: 8.0 },
    formatoA: 52,
    leituraRegistro: { lr: 82, lc: 'paf1' },
    portas: [
      HORUSTECH_SERIAL,
      { tipo: 'tcp', porta: 2001 },
      { tipo: 'tcp', porta: 1771 },
      { tipo: 'tcp', porta: 857 },
    ],
    identfid: { verbos: IDF_DT435 },
    horustech: { funcoes: HORUS_V1, niveisPreco: ['0', '1', '2'] },
    quirks: semQuirks(),
  },
  'horustech-48': {
    ...BASE_REAL,
    id: 'horustech-48',
    nome: 'Horustech em protocolo Companytec (48)',
    descricao:
      'Horustech emulando Companytec 12 canais (DT435 p.22, DT277 p.7): &S com 48 posições sem trailer, ICOM3 24..F3, memória de 10000.',
    modelo: 'Horustech',
    firmware: 'V8.4',
    canais: 12,
    status: { formato: 'h48', tipoCbc: '6', dips: 'DD' },
    verbos: V(...VERBOS_CBC06, 'A4'),
    gatesFirmware: { A3: 6.7, KW1: 6.7, A4: 8.0 },
    formatoA: 52,
    leituraRegistro: { lr: 82, lc: 'paf1' },
    portas: [
      HORUSTECH_SERIAL,
      { tipo: 'tcp', porta: 2001 },
      { tipo: 'tcp', porta: 1771 },
      { tipo: 'tcp', porta: 857 },
    ],
    identfid: { verbos: IDF_DT435 },
    horustech: { funcoes: HORUS_V1, niveisPreco: ['0', '1', '2'] },
    quirks: semQuirks(),
  },
  'concept-48': {
    ...BASE_REAL,
    id: 'concept-48',
    nome: 'Concept (48)',
    descricao:
      'Concept = horustech-48 (DT432 p.4). Memória "bem maior" sem número no manual; o R de 4 dígitos limita a 10000. TLS-350 (10002) fica para a v2.',
    modelo: 'Concept',
    firmware: 'V8.4',
    canais: 12,
    status: { formato: 'h48', tipoCbc: '6', dips: 'DD' },
    verbos: V(...VERBOS_CBC06, 'A4'),
    gatesFirmware: { A3: 6.7, KW1: 6.7, A4: 8.0 },
    formatoA: 52,
    leituraRegistro: { lr: 82, lc: 'paf1' },
    portas: [
      HORUSTECH_SERIAL,
      { tipo: 'tcp', porta: 2001 },
      { tipo: 'tcp', porta: 1771 },
      { tipo: 'tcp', porta: 857 },
    ],
    identfid: { verbos: IDF_DT435 },
    horustech: { funcoes: HORUS_V1, niveisPreco: ['0', '1', '2'] },
    quirks: semQuirks(),
  },
};

export function versaoFirmware(fw: string): number {
  const m = /([0-9]+(?:\.[0-9]+)?)/.exec(fw);
  return m ? Number(m[1]) : 0;
}

export const IDS_PERFIS = Object.keys(PERFIS) as PerfilId[];

export function obterPerfil(id: PerfilId): Perfil {
  const p = PERFIS[id];
  if (!p) throw new Error(`perfil desconhecido: ${String(id)}`);
  return p;
}

export type PerfilOverrides = Partial<Omit<Perfil, 'quirks' | 'verbos'>> & {
  quirks?: Partial<Quirks>;
  verbos?: ReadonlySet<VerboCompanytec>;
  removerVerbos?: VerboCompanytec[];
  adicionarVerbos?: VerboCompanytec[];
};

/** Derives a profile (e.g. CBC03 = cbc05-dip3 without LC/LR/T99P/KR1, K28). */
export function derivePerfil(base: PerfilId | Perfil, o: PerfilOverrides): Perfil {
  const b = typeof base === 'string' ? obterPerfil(base) : base;
  const verbos = new Set(o.verbos ?? b.verbos);
  for (const v of o.removerVerbos ?? []) verbos.delete(v);
  for (const v of o.adicionarVerbos ?? []) verbos.add(v);
  const { quirks, removerVerbos: _r, adicionarVerbos: _a, verbos: _v, ...resto } = o;
  return { ...b, ...resto, verbos, quirks: { ...b.quirks, ...(quirks ?? {}) } };
}
