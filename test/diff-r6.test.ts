/**
 * Fixes from the diff r6 bench run against a FRESH real 2.7.2 (17/10; docs/DECISIONS.md §21,
 * section "r6 bench run"). Behavior changes are `simulador-2.7.2` quirks only; each block has a
 * real-profile mirror.
 * - C_272: no lane number of its own; the PAF `bb cc tt` fields are 00 until a `&c` (DIFF-08 `&LC`).
 * - HORUSTECH_272: the 32 with a valid KK acks and stores no price (EQUIV-PENDENTES).
 * - L_272: `&LE` row 1 is the opening event, DDMMhhmm of the PC clock (EQUIV-LEITURA #23).
 * - VAZAO_272: a click on the speed radio already checked changes nothing ("Normal" on a fresh
 *   2.7.2 keeps 100 ms; DIFF-18, EQUIV-MOTOR #74).
 * - The panel caption is "Abastecendo.." only once the flow started, after the blinking ticks
 *   (DIFF-18, EQUIV-MOTOR #26/#74): the driver returns there and the 2.7.2 volume was already rising.
 */
import { describe, expect, it } from 'vitest';
import { type PumpSim, type ManualClock } from '../src/index.js';
import { statusTextual } from '../src/control/comandos.js';
import { paf1 } from '../src/protocols/companytec/formatos.js';
import { abastecer, kk, novo, passo } from './util.js';

/** Offset of the lane `bb cc tt` fields in the PAF1 `&LC`/`&A299` frame (counting the `(`). */
const PISTA_PAF1 = 1 + 2 + 9 + 6 + 6 + 4 + 2 + 4 + 2 + 8 + 2 + 6 + 10 + 10;

/** R$ 1,00 preset fueling on 04 with a manual clock, 100 ms at a time. */
function abastecerPreset(sim: PumpSim, clock: ManualClock) {
  expect(sim.pedir(kk('&P04000100'))).toBe('(P04)');
  sim.conc.retirarBico(0x04);
  for (let i = 0; i < 40; i++) passo(sim, clock, 100);
  sim.conc.recolocarBico(0x04);
  for (let i = 0; i < 25; i++) passo(sim, clock, 100);
}

const lado1 = (sim: PumpSim) => sim.conc.lado(1, 1)!;

describe('C_272: campos de pista do PAF em 00 até um &c (diff r6 DIFF-08)', () => {
  it('2.7.2: &LC0001 sai com `000000` + 8 zeros de pista; o &c grava 11 33 22', () => {
    const { sim, clock } = novo();
    abastecerPreset(sim, clock);
    const lc = sim.pedir(kk('&LC0001'))!;
    expect(lc.slice(0, 12)).toBe('(a2G99999999');
    // Bench A frame of r6, step 4: `…0000000089 0000000000 00 00 00 00000000 …`.
    expect(lc.slice(PISTA_PAF1, PISTA_PAF1 + 14)).toBe('00000000000000');
    // The lane number stays for the control API ({numero}); only the PAF field is the &c one.
    expect(sim.conc.bico(0x04)!.numeroPista).toBe(1);
    sim.pedir('(&c00411223349)');
    abastecerPreset(sim, clock);
    expect(sim.pedir(kk('&LC0002'))!.slice(PISTA_PAF1, PISTA_PAF1 + 6)).toBe('113322');
  });

  it('perfis reais: o PAF segue com o número de pista (01 no 1º bico)', () => {
    const { sim, clock } = novo('cbc-32');
    abastecer(sim, clock, 0x04, 3000);
    // The PAF1 layout over the stored record (`&A299`/`&LC` where the profile has them).
    const paf = paf1(sim.conc, sim.conc.buffer.todos().at(-1)!);
    expect(paf.slice(0, 3)).toBe('(a2');
    expect(paf.slice(PISTA_PAF1, PISTA_PAF1 + 2)).toBe('01');
  });
});

describe('HORUSTECH_272: 32 com KK válido responde e não grava (diff r6 EQUIV-PENDENTES)', () => {
  it('2.7.2: >?000B320210015002F → ack, &T44U e &T44u como na bancada', () => {
    const { sim } = novo();
    sim.conc.setModelo('Horustech');
    expect(sim.pedir('>?000B320210015002F')).toBe('>!00043200AA');
    sim.conc.setModelo('CBC-06');
    expect(sim.pedir(kk('&T44U'))).toBe('(TU440000212399)');
    expect(sim.pedir(kk('&T44u'))).toBe('(TU4400002123000059)');
  });

  it('perfil real horustech-48: o 32 continua gravando o preço (DT214)', () => {
    const { sim } = novo('horustech-48');
    const b = sim.conc.bicoPorNumero(2)!;
    const antes = structuredClone([b.precos, b.precosPendentes]);
    expect(sim.pedir('>?000B320200011112C')).toBe('>!00043200AA');
    expect([b.precos, b.precosPendentes]).not.toEqual(antes);
  });
});

describe('L_272: &LE linha 1 = evento de abertura (diff r6 EQUIV-LEITURA #23)', () => {
  it('2.7.2: DDMMhhmm do relógio do PC na abertura, não o RTC nem a hora do pedido', () => {
    const { sim, clock } = novo(); // 16/10/26 14:30 UTC, fuso do perfil
    const d = new Date(clock.now() + sim.conc.rtc.offsetMinutos * 60_000);
    const esperado = [d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCHours(), d.getUTCMinutes()].map((n) => String(n).padStart(2, '0')).join('');
    expect(sim.pedir(kk('&KW126101606143000'))).toBe('(KW12610160614300091)');
    clock.advance(65 * 60_000);
    expect(sim.pedir('(&LE00148)')).toBe('(' + esperado + '0'.repeat(24) + ')');
    expect(sim.pedir(kk('&LE00C'))).toBe('(' + '0'.repeat(32) + ')');
    // It survives a snapshot.
    const outro = novo().sim;
    clock.advance(1);
    outro.conc.importarEstado(sim.conc.exportarEstado());
    expect(outro.pedir('(&LE00148)')).toBe('(' + esperado + '0'.repeat(24) + ')');
  });

  it('perfil real: &LE mudo', () => expect(novo('cbc-32').sim.pedir('(&LE00148)')).toBeNull());
});

describe('VAZAO_272: clicar no rádio de velocidade já marcado não faz nada (diff r6 DIFF-18)', () => {
  // §29: the period on load is the Windows-effective 109.375 ms (100 ms asked, 7 × 15.625 ms system tick).
  it('2.7.2: abre em Normal com 109,375 ms; "Normal" fica em 109,375; Rápido → 150; Normal → 300', () => {
    const { sim } = novo();
    expect(sim.conc.tickVazaoMs).toBe(109.375);
    sim.conc.setVelocidade('normal');
    expect(sim.conc.tickVazaoMs).toBe(109.375);
    sim.conc.setVelocidade('rapido');
    expect(sim.conc.tickVazaoMs).toBe(150);
    sim.conc.setVelocidade('normal');
    expect(sim.conc.tickVazaoMs).toBe(300);
    sim.conc.setVelocidade(250);
    expect(sim.conc.tickVazaoMs).toBe(250);
  });

  it('perfil real: "Normal" sempre aplica 300 ms', () => {
    const { sim } = novo('cbc-32');
    sim.conc.setVelocidade(100);
    sim.conc.setVelocidade('normal');
    expect(sim.conc.tickVazaoMs).toBe(300);
    sim.conc.setVelocidade('normal');
    expect(sim.conc.tickVazaoMs).toBe(300);
  });
});

describe('legenda "Abastecendo.." só com a vazão começando (diff r6 DIFF-18, EQUIV-MOTOR #26/#74)', () => {
  it('2.7.2: "Retirar Bico" durante as piscadas; "Abastecendo.." no 1º tick de vazão', () => {
    const { sim, clock } = novo();
    // One step = one flow tick (109.375 ms on simulador-2.7.2, §29).
    const tick = sim.conc.tickVazaoMs;
    sim.conc.retirarBico(0x04);
    let t = 0;
    while (sim.conc.bico(0x04)!.estado !== 'abastecendo') {
      passo(sim, clock, 100); // the state tick (1 s) starts the fueling
      t += 100;
      expect(t).toBeLessThanOrEqual(1000);
    }
    expect(statusTextual(lado1(sim), true)).toBe('Retirar Bico');
    let piscadas = 0;
    while (statusTextual(lado1(sim), true) !== 'Abastecendo..') {
      expect(sim.pedir('(&V)')).toBe('(04000000)');
      passo(sim, clock, tick);
      piscadas++;
      expect(piscadas).toBeLessThanOrEqual(10);
    }
    expect(piscadas).toBe(7);
    // The driver returns here; the 2.7.2 volume rises from this moment (DIFF-18: 2 ticks in 255 ms).
    passo(sim, clock, tick);
    passo(sim, clock, tick);
    expect(sim.pedir('(&V)')).toBe('(04000026)');
  });

  it('#74, quadro A da bancada r6: vírgula 3E com preset, 28 ticks de vazão → (04000364) (passo 13, não 12,9)', () => {
    const { sim, clock } = novo();
    sim.pedir(kk('&CW013E010200'));
    expect(sim.pedir(kk('&P04000900'))).toBe('(P04)');
    sim.conc.retirarBico(0x04);
    // One step = one flow tick (109.375 ms on simulador-2.7.2, §29).
    const tick = sim.conc.tickVazaoMs;
    for (let k = 0; k < 40 && statusTextual(lado1(sim), true) !== 'Abastecendo..'; k++) passo(sim, clock, tick);
    for (let i = 0; i < 28; i++) passo(sim, clock, tick);
    expect(sim.pedir('(&V)')).toBe('(04000364)');
  });

  it('perfil real (sem legendaPorTick): "Abastecendo.." já no início, como antes', () => {
    const { sim, clock } = novo('cbc-32');
    sim.conc.retirarBico(0x04);
    for (let k = 0; k < 20 && sim.conc.bico(0x04)!.estado !== 'abastecendo'; k++) passo(sim, clock, 100);
    expect(sim.conc.bico(0x04)!.estado).toBe('abastecendo');
    expect(statusTextual(lado1(sim), sim.conc.q('CONCLUINDO_272'))).toBe('Abastecendo..');
  });
});
