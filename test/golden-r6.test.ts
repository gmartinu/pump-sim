/**
 * Goldens of the (a) fixes of the diff r6 triage (docs/DECISIONS.md §21, "r6 bench run"). Every
 * `A_*` constant is side A of the bench capture of 2026-10-17 (real SimuladorCBC 2.7.2), copied byte for
 * byte. Fields the clock writes (duration, date/time) and the KK that covers them are masked, like
 * the r4b/r5 goldens. Each block pins a mirror on a real profile, which must not move.
 */
import { describe, expect, it } from "vitest";
import { statusTextual } from "../src/control/comandos.js";
import { paf1 } from "../src/protocols/companytec/formatos.js";
import { abastecer, kk, novo, passo } from "./util.js";

/** Masks the clock fields of a PAF1 `&LC` frame: duration (30..34), date/time (34..44), KK + `)`. */
const semRelogioLC = (x: string) =>
  x.slice(0, 30) + "x".repeat(14) + x.slice(44, -3);

/** Offset of the lane `bb cc tt` fields in the PAF1 frame (counting the `(`). */
const PISTA_PAF1 = 1 + 2 + 9 + 6 + 6 + 4 + 2 + 4 + 2 + 8 + 2 + 6 + 10 + 10;

/** DIFF-08 step 4 and 10 (A): `&LC0001` after the R$ 1,00 fueling on 04; lane fields `bb cc tt` = 00. */
const A_LC_0001 =
  "(a2G9999999900010000008911233A00060417132410260000010000000089000000000000000000000000000000000000000000000000000000000046)";
/** EQUIV-LEITURA step 15 (A): the same frame after a `&c00411223349`; lane fields `113322`. */
const A_LC_PISTA =
  "(a2G9999999900010000008911233A0006041713301026000001000000008900000000001133220000000000000000000000000000000000000000004F)";
/** EQUIV-LEITURA 17/18 (A): `&LE` row 1 = the opening event (DDMMhhmm), nothing elsewhere. */
const A_LE_ABERTURA = "(17101322000000000000000000000000)";
const A_LE_VAZIO = "(00000000000000000000000000000000)";
/** EQUIV-PENDENTES 4..6 (A): the 32 with a valid KK acks and stores no price. */
const A_32_ACK = ">!00043200AA";
const A_TU44 = "(TU440000212399)";
const A_Tu44 = "(TU4400002123000059)";

/** Step 1 of the r6 DIFF-08 / EQUIV-LEITURA: R$ 1,00 preset fueling on 04, 100 ms at a time. */
function preset1(
  sim: ReturnType<typeof novo>["sim"],
  clock: ReturnType<typeof novo>["clock"],
) {
  sim.pedir(kk("&E0400000000"));
  expect(sim.pedir(kk("&P04000100"))).toBe("(P04)");
  sim.conc.retirarBico(0x04);
  for (let i = 0; i < 40; i++) passo(sim, clock, 100);
  sim.conc.recolocarBico(0x04);
  for (let i = 0; i < 25; i++) passo(sim, clock, 100);
}

describe("G1 C_272: o &LC sai com os campos de pista em 00 até um &c (bancada r6, DIFF-08)", () => {
  it("passos 4/10: &LC0001 byte a byte com o quadro A (sem relógio)", () => {
    const { sim, clock } = novo();
    preset1(sim, clock);
    const lc = sim.pedir(kk("&LC0001"))!;
    expect(lc).toHaveLength(A_LC_0001.length);
    expect(semRelogioLC(lc)).toBe(semRelogioLC(A_LC_0001));
    // Re-read after a `&S`/`?S` (steps 6..10): the record does not change.
    sim.pedir("(&S)");
    expect(semRelogioLC(sim.pedir(kk("&LC0001"))!)).toBe(
      semRelogioLC(A_LC_0001),
    );
  });

  it("EQUIV-LEITURA 15: depois de um &c, o campo traz 113322 (quadro A)", () => {
    const { sim, clock } = novo();
    sim.pedir("(&c00411223349)"); // no reply on the wire
    preset1(sim, clock);
    const lc = sim.pedir(kk("&LC0001"))!;
    expect(semRelogioLC(lc)).toBe(semRelogioLC(A_LC_PISTA));
  });

  it.each(["cbc-32", "horustech-48"] as const)(
    "espelho %s: perfil real mantém o número de pista no PAF",
    (p) => {
      const { sim, clock } = novo(p);
      abastecer(sim, clock, sim.conc.bicoPorNumero(1)!.codigo, 3000);
      const paf = paf1(sim.conc, sim.conc.buffer.todos().at(-1)!);
      expect(paf.slice(PISTA_PAF1, PISTA_PAF1 + 2)).toBe("01");
    },
  );
});

describe("G2 L_272: &LE linha 1 = abertura do simulador (bancada r6, EQUIV-LEITURA 17/18)", () => {
  it("passos 17/18: o relógio do PC na abertura (hh:mm mascarado), o resto zerado", () => {
    const { sim, clock } = novo(); // opened at 16/10 14:30 UTC (the bench: 17/10 13:22, masked on hh:mm)
    sim.pedir(kk("&KW126101606143000"));
    clock.advance(60_000);
    const r = sim.pedir("(&LE00148)")!;
    expect(r).toHaveLength(A_LE_ABERTURA.length);
    // Same shape as A: DDMM hhmm + 24 zeros; the day/month is compared, not the hh:mm.
    expect(r.slice(1, 5)).toBe("1610");
    expect(r.slice(9)).toBe(A_LE_ABERTURA.slice(9));
    expect(r.slice(1, 5)).not.toBe(A_LE_ABERTURA.slice(1, 5)); // A ran on 17/10; the model follows its own clock
    expect(sim.pedir(kk("&LE00C"))).toBe(A_LE_VAZIO);
    expect(sim.pedir("(&LE00047)")).toBeNull(); // step 19: n = 0 stays mute
  });

  it("espelho cbc-32: o &LE do perfil real segue mudo", () => {
    expect(novo("cbc-32").sim.pedir("(&LE00148)")).toBeNull();
  });
});

describe("G5 HORUSTECH_272: o 32 com KK válido responde e não grava (bancada r6, EQUIV-PENDENTES 4..6)", () => {
  it("passos 4/5/6: ack, &T44U e &T44u iguais ao quadro A", () => {
    const { sim } = novo();
    sim.conc.setModelo("Horustech");
    expect(sim.pedir(">?000B320210015002F")).toBe(A_32_ACK);
    sim.conc.setModelo("CBC-06");
    expect(sim.pedir(kk("&T44U"))).toBe(A_TU44);
    expect(sim.pedir(kk("&T44u"))).toBe(A_Tu44);
    expect(sim.pedir(kk("&T04u"))).not.toContain("1500");
    expect(sim.pedir(kk("&T08u"))).not.toContain("1500");
  });

  it("espelho horustech-48: o perfil real segue gravando o preço", () => {
    const { sim } = novo("horustech-48");
    const b = sim.conc.bicoPorNumero(2)!;
    const antes = structuredClone([b.precos, b.precosPendentes]);
    expect(sim.pedir(">?000B320200011112C")).toBe(A_32_ACK);
    expect([b.precos, b.precosPendentes]).not.toEqual(antes);
  });
});

describe("G3/G4 vazão e legenda do motor (bancada r6, DIFF-18 e EQUIV-MOTOR 41/42)", () => {
  const lado1 = (sim: ReturnType<typeof novo>["sim"]) => sim.conc.lado(1, 1)!;
  /** DIFF-18 A: every sample is a multiple of 13 (one tick = 0,013 L), the last (30th) is 70 ticks. */
  const A_DIFF18 = [
    0, 26, 52, 91, 117, 156, 182, 221, 247, 273, 312, 338, 377, 403, 442, 468,
    494, 533, 559, 598, 624, 650, 689, 715, 754, 780, 806, 845, 871, 910,
  ];

  // §29: the period on load is the Windows-effective 109.375 ms (100 ms asked, 7 × 15.625 ms system tick).
  it('DIFF-18: o 2.7.2 sai de "Normal" já marcado em 109,375 ms; as amostras do A são múltiplos de 13 e fecham em (04000910) = 70 ticks', () => {
    expect(A_DIFF18.every((v) => v % 13 === 0)).toBe(true);
    const { sim, clock } = novo();
    sim.conc.setVelocidade("normal"); // the driver's "velocidade Normal" click: radio already checked
    expect(sim.conc.tickVazaoMs).toBe(109.375);
    const tick = sim.conc.tickVazaoMs; // one step = one flow tick
    sim.conc.retirarBico(0x04);
    for (
      let k = 0;
      k < 40 && statusTextual(lado1(sim), true) !== "Abastecendo..";
      k++
    )
      passo(sim, clock, tick);
    for (let i = 0; i < 70; i++) passo(sim, clock, tick);
    expect(sim.pedir("(&V)")).toBe("(04000910)");
  });

  it("EQUIV-MOTOR #41 (A): preset R$ 9,00 em 3E, 28 ticks → (04000364), o passo é 13", () => {
    const { sim, clock } = novo();
    sim.pedir(kk("&CW013E010200"));
    expect(sim.pedir(kk("&P04000900"))).toBe("(P04)");
    const tick = sim.conc.tickVazaoMs; // one step = one flow tick (109.375 ms, §29)
    sim.conc.retirarBico(0x04);
    for (
      let k = 0;
      k < 40 && statusTextual(lado1(sim), true) !== "Abastecendo..";
      k++
    )
      passo(sim, clock, tick);
    for (let i = 0; i < 28; i++) passo(sim, clock, tick);
    expect(sim.pedir("(&V)")).toBe("(04000364)");
  });

  it('espelho cbc-32: perfil real, "Normal" sempre aplica 300 ms; legenda desde o início', () => {
    const { sim } = novo("cbc-32");
    sim.conc.setVelocidade("normal");
    expect(sim.conc.tickVazaoMs).toBe(300);
    sim.conc.retirarBico(0x04);
    expect(statusTextual(lado1(sim), sim.conc.q("CONCLUINDO_272"))).not.toBe(
      "Retirar Bico",
    );
  });
});
