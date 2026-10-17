/**
 * Catalog of the MessageBox texts the real SimuladorCBC 2.7.2 showed on the bench, with what
 * opens each one and whether pump-sim (`simulador-2.7.2`, Q2) opens the same text. The texts are
 * verbatim as the bench modal watcher read them (doubled quotes included): a `travar` in the
 * codecs must use exactly one of these strings when it models the same modal.
 *
 * Sources: `modais.jsonl` (17/10) and the diff r4b run (17/10, DECISIONS §18).
 */
export interface Modal272 {
  /** Text read by the watcher. `null` = the watcher read an empty text. */
  texto: string | null;
  /** What opens it on the 2.7.2 (frame or UI action). */
  origem: string;
  /** pump-sim opens the same modal (Q2 `travar`) with the same text. */
  modelado: boolean;
  fonte: string;
}

export const MODAIS_272: readonly Modal272[] = [
  { texto: 'Asynchronous socket error 10053.', origem: 'client drops with RST', modelado: true, fonte: 'modais.jsonl; diff r4b EQUIV-MOTOR #92' },
  { texto: 'Nível de preço incorreto.', origem: '&U 14/16 with an invalid level; Horustech 32 with level ∉ {0,1}', modelado: true, fonte: 'bench 17/10 DIFF-01 step 2 (E3)' },
  {
    texto: null,
    origem: 'probably the three "Nível de preço incorreto." of DIFF-01 and EQUIV-COMANDOS #33/#34 (the watcher read no text)',
    modelado: true,
    fonte: 'diff r4b (3×)',
  },
  { texto: "''XX'' is not a valid integer value.", origem: '(&KW1261016XX143000BA): StrToInt of a clock field (E9)', modelado: true, fonte: 'diff r4b EQUIV-COMANDOS #39' },
  { texto: "''$XX'' is not a valid integer value.", origem: ">?000B3202…XX: StrToInt('$' + KK) of the Horustech 32 (E3)", modelado: true, fonte: 'diff r4b EQUIV-COMANDOS/EQUIV-PENDENTES (3×)' },
  { texto: "'000012X4' is not a valid floating point value.", origem: '(&E04000012X4): StrToFloat of the totalizer (E8)', modelado: true, fonte: 'diff r4b EQUIV-COMANDOS #42' },
  { texto: "Error: '1,11F' is not a valid floating point value.", origem: '>?000A3202000111FA: StrToFloat of the 32 price', modelado: true, fonte: 'bench 17/10 DIFF-16' },
  {
    texto: 'Invalid argument to date encode.',
    origem: 'clock in an invalid date (month 13, 31/04) after &KW; the 2.7.2 repeats it every second until &KW fixes it (E10)',
    modelado: false,
    fonte: 'diff r4b EQUIV-COMANDOS #40 (3×)',
  },
  { texto: 'Invalid argument to time encode.', origem: 'clock with hour 25 after &KW (E10)', modelado: false, fonte: 'diff r4b EQUIV-COMANDOS #39 (1×)' },
];
