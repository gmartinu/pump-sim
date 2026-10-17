import type { DataHora } from './datahora.js';
import type { Cartao } from './modelo.js';

/**
 * Identification 01–14 (spec §3.3, P1). On real profiles the release follows the
 * DT435 §3.10 control table (CC = permission<<4 | type). On the 2.7.2 the modes are only a
 * label (quirk IDF_CC_BYTE): the whole CC byte applies (bit 1 releases, bit 2 shift).
 */
export const MODOS_IDENTIFICACAO: readonly string[] = [
  '01 - Frentista (sem turno, sem gerente)',
  '02 - Frentista (com turno, sem gerente)',
  '03 - Frentista (sem turno, com gerente)',
  '04 - Frentista (com turno, com gerente)',
  '05 - Gerente (sem turno)',
  '06 - Gerente (com turno)',
  '07 - Caixa (sem turno, P1, P2)',
  '08 - Caixa (com turno, P1, P2)',
  '09 - Funcionário (sem turno, P1)',
  '10 - Funcionário (com turno, P1)',
  '11 - Cliente (libera bomba)',
  '12 - Cliente (não libera bomba)',
  '13 - TAG (libera bomba)',
  '14 - TAG (não libera bomba)',
];

export type ClasseCartao = 'tag' | 'lavadora' | 'reservado' | 'cliente' | 'funcionario' | 'gerente' | 'total';

export function classeDoTipo(tipo: number): ClasseCartao {
  if (tipo === 1) return 'tag';
  if (tipo === 2) return 'lavadora';
  if (tipo >= 4 && tipo <= 6) return 'cliente';
  if (tipo >= 7 && tipo <= 0xc) return 'funcionario';
  if (tipo === 0xd || tipo === 0xe) return 'gerente';
  if (tipo === 0xf) return 'total';
  return 'reservado';
}

export function permissao(cc: number): number {
  return (cc >> 4) & 0x0f;
}

export function tipo(cc: number): number {
  return cc & 0x0f;
}

function dentroDe(hhmm: string, faixa: { inicio: string; fim: string } | null): boolean {
  if (!faixa) return false;
  const v = Number(hhmm);
  const ini = Number(faixa.inicio);
  const fim = Number(faixa.fim);
  return ini <= fim ? v >= ini && v <= fim : v >= ini || v <= fim;
}

export function noTurno(c: Cartao, agora: DataHora): boolean {
  const hhmm = `${String(agora.hora).padStart(2, '0')}${String(agora.minuto).padStart(2, '0')}`;
  return dentroDe(hhmm, c.turnoA) || dentroDe(hhmm, c.turnoB);
}

export type ResultadoCartao =
  | { aceito: false; motivo: 'desconhecido' | 'listaNegra' | 'semPermissao' | 'foraDoTurno' | 'classe' }
  | {
      aceito: true;
      /** Which record field the card goes into. */
      campo: 'cartao1' | 'cartao2';
      /** The card releases the pump alone (or completes the release). */
      libera: boolean;
      /** A 2nd card (manager or P2) is missing to release. */
      aguardaSegundo: boolean;
    };

/** 2.7.2 rule (behavioral equivalence): registered card, bit 1 of the CC byte releases, bit 2 requires shift. */
export function validarCartao272(c: Cartao | undefined, agoraPc: DataHora): ResultadoCartao {
  if (!c) return { aceito: false, motivo: 'desconhecido' };
  if ((c.controle & 0x02) === 0) return { aceito: false, motivo: 'semPermissao' };
  if ((c.controle & 0x04) !== 0 && !noTurno(c, agoraPc)) return { aceito: false, motivo: 'foraDoTurno' };
  return { aceito: true, campo: 'cartao1', libera: true, aguardaSegundo: false };
}

interface RegraModo {
  /** Classes accepted as the 1st card. */
  primeiro: ClasseCartao[];
  /** Classes required as the 2nd card (becomes I2), or null. */
  segundo: ClasseCartao[] | null;
  turno: boolean;
  libera: boolean;
}

/** Inference (B) from spec §3.3: attendant = employee 7..C, manager = D/E, customer = 4/5/6, TAG = 1. */
const REGRAS: Record<number, RegraModo> = {
  1: { primeiro: ['funcionario'], segundo: null, turno: false, libera: true },
  2: { primeiro: ['funcionario'], segundo: null, turno: true, libera: true },
  3: { primeiro: ['funcionario'], segundo: ['gerente'], turno: false, libera: true },
  4: { primeiro: ['funcionario'], segundo: ['gerente'], turno: true, libera: true },
  5: { primeiro: ['gerente'], segundo: null, turno: false, libera: true },
  6: { primeiro: ['gerente'], segundo: null, turno: true, libera: true },
  7: { primeiro: ['funcionario', 'gerente'], segundo: ['funcionario', 'gerente', 'cliente', 'tag'], turno: false, libera: true },
  8: { primeiro: ['funcionario', 'gerente'], segundo: ['funcionario', 'gerente', 'cliente', 'tag'], turno: true, libera: true },
  9: { primeiro: ['funcionario'], segundo: null, turno: false, libera: true },
  10: { primeiro: ['funcionario'], segundo: null, turno: true, libera: true },
  11: { primeiro: ['cliente'], segundo: null, turno: false, libera: true },
  12: { primeiro: ['cliente'], segundo: null, turno: false, libera: false },
  13: { primeiro: ['tag'], segundo: null, turno: false, libera: true },
  14: { primeiro: ['tag'], segundo: null, turno: false, libera: false },
};

/**
 * Real profile rule. `jaTemPrimeiro` says the side already got the 1st card.
 * Permission (DT435 §3.10.1): 2 releases the pump, 4 honors shift, 6 = 2+4, 8 car wash,
 * A = pumps + car wash. Type F (full control) passes in any mode as the 1st card.
 */
export function validarCartaoReal(
  c: Cartao | undefined,
  modo: number,
  agora: DataHora,
  jaTemPrimeiro: boolean,
): ResultadoCartao {
  if (!c) return { aceito: false, motivo: 'desconhecido' };
  const regra = REGRAS[modo] ?? REGRAS[1]!;
  const perm = permissao(c.controle);
  const classe = classeDoTipo(tipo(c.controle));
  if ((perm & 0x2) === 0) return { aceito: false, motivo: 'semPermissao' };
  if (regra.turno && (perm & 0x4) !== 0 && !noTurno(c, agora)) {
    return { aceito: false, motivo: 'foraDoTurno' };
  }
  if (jaTemPrimeiro && regra.segundo) {
    if (!regra.segundo.includes(classe) && classe !== 'total') return { aceito: false, motivo: 'classe' };
    return { aceito: true, campo: 'cartao2', libera: regra.libera, aguardaSegundo: false };
  }
  if (!regra.primeiro.includes(classe) && classe !== 'total') return { aceito: false, motivo: 'classe' };
  const campo = classe === 'cliente' || classe === 'tag' ? 'cartao2' : 'cartao1';
  const aguardaSegundo = regra.segundo !== null && classe !== 'total';
  return { aceito: true, campo, libera: regra.libera && !aguardaSegundo, aguardaSegundo };
}
