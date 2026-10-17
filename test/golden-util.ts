import {
  ManualClock,
  PumpSim,
  type Perfil,
  type PerfilId,
  type Registro,
  checksum,
  decodificarBico,
} from '../src/index.js';

/** Default instant of the goldens: 12/02/2020 16:40:10 UTC (time zone 0). */
export const T0 = Date.UTC(2020, 1, 12, 16, 40, 10);

export function criar(perfil: PerfilId | Perfil, quando: number = T0, configPadrao = true) {
  const clock = new ManualClock(quando);
  const sim = new PumpSim({ perfil, clock, configPadrao });
  return { sim, clock };
}

/** `(` + body + KK + `)` */
export const kk = (corpo: string) => `(${corpo}${checksum(corpo)})`;

/** Joins the lines where the PDF broke an example. */
export const junta = (...partes: string[]) => partes.join('');

/**
 * Stores a manual record directly in the buffer, at position `posicao` (R), and sets the
 * port's (group's) read pointer to it. Returns the record.
 */
export function injetar(
  sim: PumpSim,
  over: Partial<Registro> & { posicao: number; codigoBico: number },
  porta = 'tcp:2001',
): Registro {
  const c = sim.conc;
  const dec = decodificarBico(over.codigoBico);
  if (!dec) throw new Error(`código de bico inválido: ${over.codigoBico}`);
  c.buffer.definirEscrita(over.posicao);
  c.buffer.definirLeitura(c.grupoPonteiroDe(porta), over.posicao);
  return c.buffer.gravar(
    (posicao): Registro => ({
      numero: posicao,
      numeroIdentificacao: 0,
      canal: dec.canal,
      endereco: dec.endereco,
      totalMil: 0,
      volumeMl: 0,
      precoUnit: 0,
      virgula: 0x3e,
      nivelPreco: 0,
      duracaoS: 0,
      data: { ano: 2020, mes: 2, dia: 12, hora: 16, minuto: 40, segundo: 10, diaSemana: 4 },
      encIniMl: 0,
      encFimMl: 0,
      cartao1: null,
      cartao2: null,
      numeroPista: 0,
      combustivel: 0,
      tanque: 0,
      volumeTanque: 0,
      ...over,
      posicao,
    }),
  );
}

/** Record of the `(&A)` example in DT435 p.4 (52 chars). */
export const REG_A52: Partial<Registro> & { posicao: number; codigoBico: number } = {
  posicao: 683,
  codigoBico: 0x08,
  totalMil: 3860,
  volumeMl: 3860,
  precoUnit: 1000,
  virgula: 0x3e,
  duracaoS: 0x1c,
  data: { ano: 2020, mes: 2, dia: 12, hora: 16, minuto: 40, segundo: 10, diaSemana: 4 },
  encIniMl: 804030,
  encFimMl: 807890,
};
