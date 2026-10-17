/**
 * 2.7.2 clock timer phase (docs/DECISIONS.md §27): the clock timer runs at a free phase set when the app
 * starts and `&KW` does not restart it, so the 1st tick after a write comes 0–1000 ms later. A `&KR1`
 * read after the clock may have ticked therefore shows N or N+1 seconds on the bench; the scripts mask
 * the units digit of the seconds (and its KK) on exactly those reads, and nothing else.
 */
import { describe, expect, it } from 'vitest';
import { type PassoEnviar, mascarar, roteiro } from '../src/index.js';

const SEGUNDO_KR1: [number, number][] = [[17, 20]];

function leiturasKr1(id: string): PassoEnviar[] {
  const caso = roteiro(id);
  expect(caso, id).toBeDefined();
  return caso!.passos.filter((p): p is PassoEnviar => 'enviar' in p && p.enviar === '(&KR1F4)');
}

const igual = (a: string, b: string, faixas: readonly (readonly [number, number])[]) =>
  mascarar(Buffer.from(a, 'latin1'), 0, faixas).equals(mascarar(Buffer.from(b, 'latin1'), 0, faixas));

describe('&KR1 depois do relógio do 2.7.2 andar (§27)', () => {
  it('DIFF-12: a leitura logo depois do &KW mascara só a unidade do segundo', () => {
    expect(leiturasKr1('DIFF-12').map((p) => p.mascara)).toEqual([SEGUNDO_KR1]);
  });

  it('EQUIV-COMANDOS: a 1ª leitura (mês 13 antes do tick) segue byte a byte; as outras três mascaram o segundo', () => {
    expect(leiturasKr1('EQUIV-COMANDOS').map((p) => p.mascara)).toEqual([undefined, SEGUNDO_KR1, SEGUNDO_KR1, SEGUNDO_KR1]);
  });

  it('a máscara aceita o tick a mais da bancada r8 e ainda pega dezena, data e hora', () => {
    // r8: A 01 × B 00 (DIFF-12 #17) and A 03 × B 02 (EQUIV-COMANDOS #2), KK included.
    expect(igual('(KR1261016061430018D)', '(KR1261016061430008C)', SEGUNDO_KR1)).toBe(true);
    expect(igual('(KR12701160614300390)', '(KR1270116061430028F)', SEGUNDO_KR1)).toBe(true);
    expect(igual('(KR1261016061430108D)', '(KR1261016061430008C)', SEGUNDO_KR1)).toBe(false);
    expect(igual('(KR1261316061430018D)', '(KR1261016061430008C)', SEGUNDO_KR1)).toBe(false);
    expect(igual('(KR1261016061431008D)', '(KR1261016061430008C)', SEGUNDO_KR1)).toBe(false);
  });
});
