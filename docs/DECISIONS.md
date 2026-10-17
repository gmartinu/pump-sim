# Decisions

Sources: the maintainer's v1 specification (with the "Crítica de completude" K1–K30), the bench
reports against a real SimuladorCBC 2.7.2 (Windows, 17/10), and the Companytec protocol
documents DT435 rev.10 / DT432 rev.02 / DT360.

Note on references: the specification, the bench captures and the behavioral-equivalence notes are not
published with this repository. They are cited below as "bench capture, 2026-10-17" or "behavioral
equivalence", with their case ids (DIFF-xx, verdict #n, B2, E3…); every literal byte sequence they
contributed lives in the golden tests under `test/`.

## 1. Normative decisions (maintainer's, do not re-evaluate)

| # | Decision | Where it is in the code |
| --- | --- | --- |
| N1 | The repository is public, open source and POS-agnostic. Nothing is imported from a client | the whole repo |
| N2 | v1 = `(&…)` + `(?…)` + native Horustech only 02/06/32 (what the 2.7.2 handles). Full Horustech and TLS-350/TCU are left for v1.1+ | `src/protocols/companytec`, `src/protocols/identfid`, `src/protocols/horustech` (`Perfil.identfid`, `Perfil.horustech`) |
| N3 | 7 profiles as data: simulador-2.7.2, cbc-32, cbc05-dip3, cbc01, horustech-cbc-36, horustech-48, concept-48 | `src/profiles/index.ts`, `Perfil` in `types.ts` |
| N4 | 14 identification modes. On real profiles they follow the DT435 §3.10 rule. On the 2.7.2 they are only a label | `src/core/identificacao.ts` (`validarCartaoReal` / `validarCartao272`, quirk `IDF_CC_BYTE`); `Concentrador.definirModoIdentificacao` |
| N5 | Read pointer per port (serial, 857, 1771, 2001) on real profiles; a single one on the 2.7.2 | `BufferAbastecimentos` and `FilaIdsPendentes` with groups; `Concentrador.grupoPonteiroDe` (quirk `Q3`); `ServidorTcp` passes the logical port |
| N6 | The 2.7.2 quirks Q1–Q8 are options, on by default only in `simulador-2.7.2`. The modal MessageBox becomes a configurable freeze | `Perfil.quirks`, `Concentrador.travar` / `travamentoMs` |
| N7 | MIT license | `LICENSE`, `package.json` (`license`) |
| N8 | Date and time come from an injectable clock. ESLint forbids `Date.now` outside `clock.ts`/`cli.ts` | `src/core/clock.ts`, `eslint.config.js` |

## 2. Quirks

All on in `simulador-2.7.2` and all off on real profiles. They can be switched per instance with `new PumpSim({ quirks: { Q1: false } })`.

| Id | 2.7.2 behavior | Source |
| --- | --- | --- |
| Q1 | Each socket read is one command: of two frames in the same segment, only the 1st is served (`Framer` in `leituraUnica`). Nothing stays pending between reads: a chunk without `)` goes whole to the parser; the verbs without KK matched by prefix (`&I`, `&S`, `&R`, `&KW`, `&V`, `&H`, `&E`) are served at once, without checking KK, and the others are lost (a `)` arriving later falls into the parser, with no reply). **Revised 17/10 (§12, verdict #2):** before, only `(&S…`. **Revised 17/10 (time-based DIFF-04, §11):** the 50 ms reassembly window was refuted | behavioral equivalence, DIFF-04, bench capture, 2026-10-17 |
| Q2 | MessageBox (`&U` with an invalid level, `>?32` with a non-numeric value) → `Concentrador.travar`. The modal freezes the screen, but the socket keeps serving (DIFF-16, and the bench's 10053 modal). The default is `travamentoMs = 0`: immediate OK, plus an `MSG` event. With `null` the modal stays open until `liberarTravamento()`, with a number for that time. **Revised 17/10 (§13, verdict #8):** the modal no longer silences the socket; only the reply the 2.7.2 gives after the OK (E3) is held until it closes. Without Q2 (real profiles) the freeze is the synthetic frozen-console fault | behavioral equivalence (quirk list #11) (refuted), the bench error notes §1 |
| Q3 | A single pointer for all ports. A separate identified-records pointer serves the identified records. Bug: at 10000 it sets the write pointer to **1** (it was 0 until §14) | behavioral equivalence, D4 |
| Q4 | With the buffer full, the write pointer pushes the read pointer (drops the oldest) and raises a `BEEP` event. Without Q4: a pure circular buffer, and write = read looks empty (DT432 p.4) | behavioral equivalence |
| Q5 | The record date comes from the PC clock. Without Q5, from the simulated RTC | behavioral equivalence (quirk list #9) |
| Q6 | Truncates instead of rounding and blinks 7 ticks of `888888` before flowing | behavioral equivalence |
| Q7 | The simulation only runs with DIP4 and Automação on | behavioral equivalence |
| Q8 | `simcnf.ini`. A no-op here: nothing is persisted. Where the 2.7.2 persists: only `c:\simcnf.ini` (no registry, no VirtualStore — `asInvoker` manifest), written when the window closes and read when it opens; a creation failure is silent (§14) | behavioral equivalence, engine H1–H3 |
| A36 | `&A` with DIP3 off comes out with 36 chars, not 34. **The layout is the DIP3 of the moment the record was stored** (verdict #12, bench diff r4b, §18) | behavioral equivalence (quirk list #1) |
| TG | The default reply `(TG BB write−1 read−1)` applies to `&T99P`, `&T99N`, modes N/P/I and an unknown nozzle or mode | behavioral equivalence, bench V3 |
| ERROS_272 | Nonexistent nozzle → `?t` (`&P`/`&U`). Invalid mode → silence. **`&M` with a nonexistent nozzle → echo `(MBB)` with no effect**, and ~~**`&M99` b/c/l in the long form (25 chars) → `(M?f)` without touching the list**~~ (DIFF-02, §9; **reinterpreted in §13**: `(M?f)` is "card not registered", quirk `M99_272`). The short form `&M..c` (9 chars, `(&M99c48)` included) replies `(M99)` with any BB and, with `M99_272`, clears nothing (empty routine, §13) | behavioral equivalence, DIFF-02 |
| L_VAZIO_SILENCIO | `&LR`/`&LC` at an empty position → silence | behavioral equivalence (quirk list #4) |
| R_EXTRAS | `&R` is followed by DHA/SOFT MONITOR/M×5 and one row per address in the `&C` layout: `(C`+channel(2)+type+comma(hex)+address(2)+nozzles(2)+`00)` | behavioral equivalence, DIFF-12 |
| PAF_G9 | `G99999999` instead of `$`+serial | behavioral equivalence (quirk list #7) |
| A67_M_IGUAL_R | The M4 of `&A67` repeats R | behavioral equivalence (quirk list #8) |
| V_INCLUI_E | `&V` includes the nozzles in status E | behavioral equivalence |
| BUFFER_1000 | Buffer with positions 1..999, wrapping to 1 at 1000. On the real ones: 0..9999 | behavioral equivalence |
| IDF_CC_BYTE | Validates the card by the whole CC byte (bit1 releases, bit2 shift). Modes 01–14 are ignored | behavioral equivalence |
| CARTAO_VAZIO_ZEROS | Missing card = 16 zeros. On the real ones = 16 `F` (DT435 examples) | behavioral equivalence |
| LIBERACAO_IMEDIATA | `&M A` with the nozzle in E starts fueling at once. On the real ones it goes through P (DT432 p.9) | behavioral equivalence |
| IDF_272 | 2.7.2 Identfid: `?V`/`?A`/`?S` only by exact string; `?I`/`?D` without KK; `?V` with KK and only card 1; `?F` with length ≠ 41 → MessageBox (Q2); `?A` reads the pointer's cell and `?I` always advances (1..8192, wraps to 1); the CBC type of `?S` stays `0` | behavioral equivalence, DIFF-13 |
| HORUSTECH_272 | `>?` matched by chars 7-8, validating neither KK nor length; `02` in the col10 layout (`0200`+R4, fixed `010000`, hex duration, final totalizer before the initial one, `a8` zeroed); `32` replies the literal ack `>!00043200AA`, nozzle ∉ 1..48 and level ∉ {0,1} → MessageBox; non-numeric value → MessageBox `Error: '1,11F' is not a valid floating point value.`; **the KK goes through `StrToInt('$' + KK)` first: not hex → E9 and silence (E3, §18)** | behavioral equivalence, DIFF-16, diff r4b |
| NIVEIS_PRECO_ZERO | Default configuration: only level 0 gets nozzle number + 0.12; levels 1 and 2 start at `0000` | DIFF-10 |
| RTC_272 | Field-based RTC (clock timer): the weekday is stored and starts at `00`; `&KW1` accepts a date outside the calendar (month 13), echoes it and `&R`/`&KR1` start showing it. **Extended in §13:** 7 fields advanced by the clock timer (equality every second, every month has 31 days, month 13 → January on the 1st tick), `&KW` without KK and `&H`/`&KW` without range | behavioral equivalence (clock timer), DIFF-12, step 9 |
| CONCLUINDO_272 | After hang-up, the 1st state tick stores the record and the status stays `C` ("Concluindo.."); the next tick sets L/P/B | behavioral equivalence, the fueling probe 17/10 |
| BICO_272 | Pre-authorization and preset belong to the nozzle (`&M A` marks the 4 nozzles, `&P` only its own), the start does not clear them and the end clears the 4; no "side busy" lock; no authorization deadline; **the `&S` letter is A while a nozzle of the address fuels (§18)** | behavioral equivalence B2/B4/B5/C1/C2/H0, §14, diff r4b |
| VAZAO_272 | The flow timer without the Automação/DIP4 gate and conditioned on status A: `&M B` freezes whoever is fueling; a reached preset freezes in A without finishing; with a preset the step is 0.13 L even with 3 decimals | behavioral equivalence A3/A4/B8/C3/C4, §14 |
| MS_272 | `&M S` only on the addressed nozzle and in any state; on an idle nozzle it stores a ghost record repeating the last volume/total and adds it again to the totalizer | behavioral equivalence B10, verdict §0.5, §14 |
| DESPACHO_272 | Parser dispatch: only the `&` at char 2 is tested (free 1st char; only the no-KK verbs pass); the `?` branch is entered with char 2 = `?` on CBC-06 or with any frame on the Horustech model, and chars 7–8 = `02`/`06`/`32` go to Horustech before `?F`/`?C`/`?LF`; `>!…` on CBC-06 is ERRO CMD (§17) | behavioral equivalence, verdict #3/#5/#6/#7 |
| BLOQUEIO_272 | Per-nozzle block: `&M B` sets it, `&M L` clears it, `&M A` on a nozzle in E clears it, `&M H`/`I` only touch the sensor and the start raises the block when the sensor is on, `?C` sets sensor and block (§17) | behavioral equivalence B2/B6/B7/B9, verdict #24/#25/#29/#52 |
| MODELO_272 | Model combo on CBC-02 does not write char 39 of `&S`: the previous digit stays (§17) | behavioral equivalence F6 (flow timer), verdict #10 |
| PADRAO_272 | "Carregar configuração padrão" puts write and read back at position 1; the identified-records pointer is untouched (§17); **re-initializes the active nozzles like `&C` (price, L, rest, unblocked; P back on the next tick) (§18)** | behavioral equivalence D5, verdict #78, diff r4b |

## 3. Implementation notes: core, Companytec codec and profiles (revisable)

1. **CBC01 follows DT435, not the spec table.** Spec §2.2 marks ✗ for `&T`/`&U`/`&P`/`&M`/`&R` on the CBC01. The DT435 compatibility lines (p.23, 25, 28, 30, 31) include the CBC01, so the `cbc01` profile has those verbs. `&S` is left out of the CBC01, because the `&S` compatibility is CBC03+.
2. **`cbc05-dip3` does not have the verbs marked with `?`** in the spec (Tu, TI, U6, M99, KW1). The CBC03 is a `derivePerfil('cbc05-dip3', { removerVerbos: ['LC','LR','T99P','KR1'] })` (K28).
3. Firmware: `simulador-2.7.2` = V3.7 (no gates), cbc-32 = V8.4 (DT435 example), cbc05 = V8.4, cbc01 = V1.0, Horustech and Concept = V8.4.
4. `&U` ack = `(UBB)` on all profiles. It is what the DT435 examples and the bench (V2) show. It can be changed with `ackPreco`.
5. Errors on real profiles: nonexistent nozzle `?b`, invalid mode `?m`, address in fault or pump fueling `?t`. Invalid price level on the real ones: silence (no source, B).
6. `&T` on the real ones: nonexistent nozzle → silence (verdict T4). `&T P` = write pointer with 8 digits (no example, B). `&T I` = cards of the current or the last fueling.
7. `&LC` on `cbc-32`/`cbc05` uses the layout I rebuilt from the 90-char example: `00`+T L P V C B DHMN R4 E10 `00` I16 N4(R) i16. The KK checks.
8. Empty `&LR`/`&LC` position on the real ones: the whole frame in `F` + `01` before the KK. The 82 example checks (KK 29). For 74/90 I applied the same rule (B); the 123 one has `00` in R6 (§7 R2).
9. The `&LE`, `&c` and `&CH` layouts were not recovered. They are accepted and stay silent. **Revised:** `&LE` in §12; `&c` and `&CH` in §13 (`&CH` does not exist: it is a `&C` with type H).
10. `&R` with R_EXTRAS: ~~the `(C0…00)` row was built as `(C0{canal}0{endereço}00)` (inference, B).~~ Refuted by DIFF-12 (§9): the layout is the `&C` one.
11. `&E` (totals write): the 8-digit value has 2 decimals (liters). It creates no record. **Only outside `E_272`**; on the 2.7.2 §13 applies (whole liters, `((TL`, record).
12. Preset: when it cuts, it finishes the fueling (status C) and stores the record on the next tick. The nozzle is considered hung up. **Only on the real ones since §14:** on the 2.7.2 (VAZAO_272) a reached preset freezes in A.
13. Only one nozzle per side fuels at a time. **Only on the real ones since §14:** the 2.7.2 has no such lock (BICO_272).
14. Value and volume are kept as integers (mL and thousandths of a real). Above the field's digit count, I keep the least significant digits. `&V` does not cut, as on the 2.7.2.
15. RTC = offset over the `Clock`, with a real calendar. The 2.7.2 clock timer's "day wraps at 32" was **not** reproduced. On the 2.7.2 (RTC_272) the out-of-calendar date and the weekday are per field; the raw date does not advance at midnight (B).
16. A wrong checksum is silence on all profiles, because the real console is not documented (DIFF-03).

## 4. K1–K30 (completeness critique)

| K | Status | How / why |
| --- | --- | --- |
| K1 | Deferred | The kit changelog items (1.1.07, 1.1.45/52, 1.1.53, 1.1.33/32/34/43) become DIFF cases. Until then, the equivalence analysis applies: empty `&LR` silent by quirk, and the decimal separator does not exist here (integers) |
| K2 | Recorded | `horustech-cbc-36` = 9 channels/X36, per DT435 p.22. DT277 p.7 says 8 channels. The contradiction is left for DIFF-30 |
| K3 | Documentary | No action |
| K4 | Accepted | Pointer per port on `cbc-32` with confidence M |
| K5 | Done | `&S` with a parameter falls into the same `&S` handler |
| K6 | Partial | Fixed `DD` on all profiles (`status.dips`). The real DIP encoding is left for DIFF-05 |
| K7 | Done | `Perfil.firmware` goes out in the trailer and drives `gatesFirmware` (A3/KW1 >5.3 or >6.7, A4 >8.0, TI >2.3) |
| K8 | Done/scope | Type F releases in any mode. Type 2, permission 8 and the car wash do not release the pump (the car wash is out of scope). A only releases via bit 2 |
| K9 | Done | `core/virgula.ts` holds the general bit rule. `virgulaUsual` flags what falls outside 2A/2E/3A/3E |
| K10 | Done | `capacidadeEventos` (Horustech 8000) and `capacidadeCartoes` (16000). Events: FIFO discard; cards: refused when full |
| K11 | Done | Real profiles include `serial:COM1` as its own pointer group. The serial transport was not built (§5) |
| K12 | Done | E→B with the nozzle hung up (lifted→at rest). P→B/L when the `N2` deadline of `?F P` expires without the nozzle being lifted (`Lado.autorizacaoExpiraEm`) |
| K13 | Deferred | `#`/`!` belong to native Horustech (v1.1) |
| K14 | Partial | `&A4` goes out with auth/res/brand zeroed and the price level in bits 6-7. The record has no payment method nor levels 3–5 |
| K15 | Partial | `combustivel` is a number, without the 01..25 table |
| K16 | Deferred | DIP1 stream over serial: not done, and TCP never sends anything unsolicited |
| K17 | Done in the transport | One reply per `write`, nothing unsolicited, synchronous reply (<1 ms). Latency test: next battery |
| K18 | Done | `set_ponteiro` (no `valor` = synchronizes read = write), per port or for the `?A` queue |
| K19 | Done | `list_conexoes` (id, port, remote, bytes) |
| K20 | Partial | `importar_simcnf` (`&C` lines, `[c,e,b](…)` and `C,`+7 columns; the card column order is an inference, B) and `importar_log` (`[CONF]` + events). `carregar_arquivo_buffer` not: the "load file" button only fills col3 of the UI, it does not affect the protocol |
| K21 | Done | `injetar_evento`, `ciclo_energia` (finishes and stores the fuelings, OFF + ON) |
| K22 | Done | `configurar_bico` and `configurar_endereco.bicos[]` (lane, fuel, tank, volume) |
| K23 | Partial | `nivel_preco` in `abastecer`/`preset`. Payment method: `Registro` has no such field (K14) |
| K24 | Deferred | `1C`, `25`, `1F`, `27`, `1B 5B..5E`: full Horustech, v1.1 |
| K25 | Done | `get_displays` (text status and blinking `888888`) |
| K26 | Done | `set_modelo` and `set_firmware` (derives the profile, without losing state) |
| K27 | Done | On the 2.7.2 `modelo` changes char 39 of `&S` and the `&LR`/`&LC` layout (`porModelo`). The `?`/`>` gate comes with those codecs |
| K28 | Done | `derivePerfil` for the CBC03 |
| K29 | Partial | `concept-48` = horustech-48. Memory of 10000, because R has 4 digits. The `36` and the 10002 are left for v1.1/v2 |
| K30 | Partial | `tipoBomba` per side (default `W`) goes out in `&F`. The effect of the type on `?D`/`1A` comes with those codecs |

## 5. Implementation notes: Identfid, Horustech, framer and TCP (revisable)

1. **The Identfid/Horustech gate is data.** `Perfil.identfid` (verbs + `modelos`) and `Perfil.horustech` (functions + `modelos` + levels). On the 2.7.2 both only exist with the Modelo combo on CBC-06 or Horustech. `cbc05-dip3`/`cbc01` do not speak `?`; `>?` only on the three Horustech/Concept profiles and on the 2.7.2.
2. **`?S`, `?D` and `?C` only on the 2.7.2.** They are not in DT435, so the real profiles stay silent. On the real ones the 01–14 mode and the sensor are set through the API (`definirModoIdentificacao`, `setSensorIdf`) or by `&M H/I`.
3. **Positional identifier registry, 0-based** (the 1st DT435 `?F G` comes out at `000000`). A delete leaves a hole and the next write takes it. The delete failure is `000000`, which collides with success at position 0 — it is the manual's, kept. Full memory on `?F G` = silence (no source).
4. **`?A` queue with a pointer per port on the real ones** (same rule as DT432 p.5-6 for fuelings; inference, B), 0..9999, drops the oldest when full. The unknown card enters with the side's lifted nozzle (or the 1st active one).
5. **`?F P`**: C=0 → card 1 (attendant); 1 and 2 (customer, odometer) → card 2 (B for the odometer). `$` = cap in cents on the side; `V` = cap in volume (the side's volume decimals) and only that nozzle releases. `P6 = 0` = no cap; `N2 = 00` = no deadline (B).
6. **`?D`**: the state of nozzle 1 comes out as 02 at rest, 01 fueling, 00 otherwise (the equivalence analysis only has the literals, B).
7. **Lane nozzle number** (Horustech `B2` and `32`): now it is the lowest free number ≥ 1 when the nozzle is activated (the default configuration gives 1..32 in channel/address/nozzle order), instead of the hex code. It also affects the PAF `bb`. `definirNumeroPista` changes it.
8. **Horustech on the real ones**: wrong KK or length → silence (like §3.16). A function outside 02/06/32 → silence (v1.1), not `E`. `32`: invalid parameter `EC`, nonexistent nozzle `E7`, address fault `E6`. Levels 0..2. `02` uses the DT214 107 layout, with the initial totalizer before the final one and an empty card as `F`.
9. **Framer**: on the real ones Horustech is framed by `CCCC` (8 + length), so a frame split across segments is reassembled; with no readable `CCCC` the old delimiter applies (CR/LF / end of chunk).
10. **TCP**: `ServidorTcp.abrir` listens on all the profile's TCP ports on the real ones; on the 2.7.2 only one, from the options 2001/1771/7002, and `trocarPorta` drops the connections (like turning the TServerSocket off). `mapa` links logical port → physical (0 = ephemeral) without changing the pointer, which is always the logical port's.

## 6. Implementation notes: control, recorder, MCP, CLI and diff (revisable)

1. **A single catalog as data** (`src/control/catalogo.ts`): name, group, description and JSON Schema. The HTTP/WS API validates and runs; the MCP lists the same catalog and only does `POST /api/comandos/<tool>`. A test ensures catalog = handlers and covers the inventory of spec §5 + K18–K26.
2. **Reads return structured data + `quadro`**: the frame comes from the codec itself (default port = the profile's 1st), so it honors the profile's gates and quirks (e.g. `get_status companytec48` only answers on the 2.7.2). `get_status horustech` (function 01) and `h02a1/h02a2` answer "v1.1".
3. **Faults**: `vezes` default = 1; they match by frame prefix; the command is applied unless `aplicar: false`. `checksum_errado` replaces the 2 chars before the `)` even on replies without KK. The order of a socket's outputs is preserved under delay.
4. **`set_quirk` derives the profile and rebuilds the concentrator** with the state (`exportarEstado/importarEstado`), because BUFFER_1000, Q4 and IDF_272 are read at construction. `set_perfil`/`set_firmware` do the same; ports only reopen if they change (connections drop).
5. **`reset {manter_config}`** keeps addresses, prices, lane, sensor/mode, cards and blacklist; zeroes buffer, totalizers, events and changed quirks.
6. **`abastecer`**: volume/value become the side's preset (cut finishes, §3.12); `duracao_s` schedules the hang-up (approximate: state tick + blinks); `vazao_l_s` changes the flow tick of the whole concentrator; authorizes with `&M A` if the side is blocked or has IDF.
7. **`gerar_abastecimentos`** (outside the spec) stores N records at once. ~~DIFF-17 (1001 fuelings) is not feasible with real-time flow.~~ **Revised in §15:** DIFF-17 is a loop of `abastecer` in Rápido through the screen, on both sides; the command stays for direct use.
8. **`avancar_tempo` + `--relogio-manual`** (outside the spec): deterministic CI with the injectable clock.
9. **Recording**: `rx` = one socket read, `tx` = one `write` (after faults), bytes in hex, a `meta` line at the start, synchronous writing per line.
10. **Replay server** matches per frame (~~`fluxo` framer~~ with the recorded profile's framing, §15), consumes the replies of the same frame in order and repeats the last one; a frame not recorded = silence.
11. **Diff**: each case runs whole on A and then on B, with new connections; silence = nothing within `timeout` (1000 ms), ~~end of reply = 150 ms with no bytes~~ (end of reply = the complete protocol frame, expected silences 400 ms, §25); the `&S` battery T byte is masked. The spec only has DIFF-01..20 and DIFF-30 (there is no DIFF-21); I added `BANCADA-1710` with the `esperado` values from the 17/10 bench. The `?C`, `?F A`, `?F00L`, `&LE`, `&c`, `&CH` frames of the script have fields with no source (B).
12. The API listens on 127.0.0.1 by default, without authentication (hardened in the review, §7 R5).

## 7. Adversarial review (16/10, revisable)

| # | Change | Source |
| --- | --- | --- |
| R1 | `(&M99c48)` (short form, no code) clears the blacklist and replies `(M99)` on profiles with `M99`. Before, it fell into `&M` of nozzle 99 and replied `(M?b)`. On `cbc05-dip3`/`cbc01` (no `M99`) it stays `(M?b)`; on the 2.7.2 nothing changes (`ERROS_272`) | DT435 p.20-21 (example "Limpeza de lista negra") |
| R2 | `&LC` PAF1 (123) at an empty position has `00` at offset 46 (start of R6), like the manual's example (KK `3A` checks). Fixes §3.8 only for that layout; 74/82/90 stay pure F | DT435 p.11 (`(&LC50007A)`) |
| R3 | `&T BB I` with a missing card: 16 `F` on the real ones, 16 zeros only with `CARTAO_VAZIO_ZEROS`. Before it was zero on all profiles (a 2.7.2 quirk leaking) | DT435 §3.3.6 + the record rule |
| R4 | The `&U` error uses the same prefix as the ack (`ackPreco`): `(U?b)` by default, `(M?b)` with `ackPreco: 'M'`. Before the error was always `U` | DT435 p.24-25 (structure `M?b`, example `U04`) |
| R5 | Control API: no `access-control-allow-origin: *`; 403 for a non-loopback `Origin` (HTTP, preflight and WS upgrade) and for a non-loopback `Host` when bound to loopback (DNS rebinding); `POST` requires `application/json` (415); `GET /api/comandos/<nome>` only for the `leitura` group (405). Reason: any page open in the browser could call `start_recording {arquivo}` (truncates and writes any user file) via a simple POST or an `<img src>` | security |
| R6 | ESLint also forbids `Math.random` and argument-less `new Date()` outside `clock.ts`/`cli.ts` | N8 |

Checked with no change: nothing imports or mentions a POS/client (N1); real profiles have all quirks off and no code compares `perfil.id`; every quirk is read via `q()`/`quirks.*`; the catalog covers all spec §5 tools; the domain does not read `Date.now`/`Math.random`.

## 8. Not done

- Serial transport: it would need a native dependency (`serialport`). The external bridge remains (com0com/socat → TCP).
- Native Horustech beyond 02/06/32 (v1.1, decision N2) and TLS-350/TCU.
- ~~Unrecovered layouts: `&LE`, `&c`, `&CH`.~~ Done in §12/§13 (the content of the `&LE` event grid is still out).
- UI; snapshot persistence on disk (snapshot is memory-only); payment method (K14/K23); `carregar_arquivo_buffer` (K20).

## 9. Diff against the real 2.7.2 (Windows bench, 17/10)

`pump-sim diff` with A = real SimuladorCBC 2.7.2 (127.0.0.1:2001) and B = `simulador-2.7.2`
(7002). On the `simulador-2.7.2` profile the real one beats the spec, the equivalence analysis and the manual. On real profiles
nothing changed. A already had the step 5 fueling and price 5899 on nozzle 04.

| Case | tx | A (real) | B (before) | Class | What changed |
| --- | --- | --- | --- | --- | --- |
| BANCADA-1710, DIFF-11 | `(&T01l47)`, `(&T0AL37)`, `(&T04L2A)`… | `(TG01000100017E)`, `(TL04000007028D)` | `(TG01000000007C)`, `(TL040000000084)` | state (pointers, totalizer 7.02) | nothing |
| DIFF-03, -04, -13 | `(&S79)`, `(&S)(&V)`, `(&S)\r\n`, `(&S01DA)` | `…G85)` | `…G89)` | voltage | `ignorarFim: 2` on those script steps |
| DIFF-16 | `>?00020667` | `>!000E06000002000002A0` | `>!000E060000010000019E` | state (pointers) | nothing |
| DIFF-02 | `(&M3FA2D)` | `(M3F)` | `(M?t)` | behavior | ERROS_272: BB echo |
| DIFF-02 | `(&M99b…0148)`…`(&M99c…0048)` | `(M?f)` on all, already on the 1st | `(M99)` up to the 20th | behavior | ERROS_272: the long form (b/c/l) always `(M?f)`. ~~It could not be told apart from a state (list already full from an earlier round…)~~ **Reinterpreted in §13:** `(M?f)` came because none of the 21 cards was in the registry (the card grid), not because the list was full; there is no list of its own nor a capacity. The short form `(&M99c48)` was not tested and follows the equivalence analysis (§10 V1) |
| DIFF-04 | `(&S` + `)` 5 ms apart | `(S…G86)` | silence | behavior | Q1: ~~50 ms reassembly window~~ (refuted, §11): `(&S` is served without waiting for the `)`. "Two frames in the same segment → only the 1st" was kept: A's `(&S)(&V)` only brought `(S…)` |
| DIFF-10 | `(&T08u57)` / `(&T08U37)` | `(TU0800001123000058)` / `(TU080000112398)` | `(TU0811201123112060)` / `(TU08112011239C)` | behavior | NIVEIS_PRECO_ZERO |
| DIFF-12 | `(&KR1F4)` | `(KR12610170000185693)` (WW 00) | `…07…` | behavior | RTC_272 |
| DIFF-12 | `(&KW126131606143000BA)` | `(KW12613160614300094)` (accepted) | current value | behavior | RTC_272 |
| DIFF-12 | `(&R)` | `(REL 14:30:00 16/13/26)…(C01W3A010200)(C01W3A020200)…` | `(REL … 16/10/26)…(C010100)…` | behavior | RTC_272 + new R_EXTRAS layout |
| DIFF-13 | `(?S92)` | `(SF…FFDD0v3.7M1.0G87)` | `…DD6v…` | behavior | IDF_272: type `0` (the initial `0` of the buffer, behavioral equivalence) |
| DIFF-16 | `>?000A3202000111FA` (with and without `\n`) | silence + modal `Error: '1,11F' is not a valid floating point value.` | silence + "Nível de preço incorreto." | behavior (UI) | HORUSTECH_272: the modal text. The value read is `00111F` (the KK goes into the field); `'1,11F'` is the last 4 chars with the comma after the 1st (B) |

bench capture, 2026-10-17 (nozzle 04, 7.02 L): `&S` L→A→C→L in slot 0; `&V` `(04VVVVVV)` with 2 decimals
and no KK; `&A` 52; `&A67` 75 with `A` in front; `&I` silent and the following `&A67` `(0)`;
`&T04L`/`l` with 7.02. Diverged and was fixed:

- **Flow:** `&V` rose `39, 130, 234, 325, 416, 507, 598` every ~0.78 s, i.e. 0.13 L every
  ~111 ms, and the total is 54 × 0.13 = 7.02 L. It is the 100 ms flow timer (~109 ms with the
  Windows timer granularity): the "Normal" speed button handler does not fire on load (closes the
  behavioral equivalence open item and DIFF-18). `simulador-2.7.2` now has ~~`tickVazaoMs: 100`~~ `tickVazaoMs: 109.375` (§29); `set_velocidade normal` stays 300.
- **C → L:** 1.585 s after hang-up slot 0 was still `C`, and `&A` already had the record.
  Before, C lasted one tick. Now CONCLUINDO_272 (behavioral equivalence: state 3 → 2 stores, 2 → L on the next tick).

Test: `test/bancada-diff-1710.test.ts` (A's literals, and the real profiles unchanged).

## 10. Adversarial review of the diff round (17/10)

Checked against the `rx_A` of the diff captures and attempt 3 of the fueling probe (bench capture, 2026-10-17): the 69
literals of `golden-diff-1710.test.ts` and the 22 of the fueling cycle match the JSON byte by byte.
Running each `tx` on a new `simulador-2.7.2`, only the state differences remain
(`TG` pointers, totalizer 7.02, `>?06`), the PC clock (`&KR1`) and the `&S` voltage byte.
No new quirk applies to real profiles (all in `quirksDesligados`; `tickVazaoMs` 300 and
the reassembly window, later removed in §11, absent from `BASE_REAL`), and `golden-manuais` passes.

| # | Change | Source |
| --- | --- | --- |
| V1 | ~~`(&M99c48)` on the 2.7.2 again clears the list and replies `(M99)`.~~ **Revised in §13:** it replies `(M99)` and clears nothing (the routine is empty; the blacklist is the registry column, which `&M99` with op ≠ `b` unmarks). The round had set `(M?f)` citing DIFF-02, but DIFF-02 only sent the long form `(&M99c000000000000000048)` (25 chars, another handler). Without this, nothing emptied the blacklist on the 2.7.2 | behavioral equivalence (`c` → `(M99)` in the 9-char handler); bench capture, 2026-10-17 DIFF-02 steps 2-23 |
| V2 | DIFF-04 refutes "the fragment is always lost" only for 5 ms. The behavioral-equivalence analysis says each read replaces the received text without concatenating, which favors the other explanation: both halves arrived together in a single read. Both give the same bytes at 5 ms. DIFF-03 (`(&T08L2E` and, 1 s later, the full frame → `(TL080000000088)`) shows nothing is left after 1 s. ~~The 50 ms stays B until a case with 10/20/50/100/500 ms~~ → closed in §11: neither, `&S` does not wait for the `)` | bench capture, 2026-10-17 DIFF-04 step 0 (`(&S` + `)` → `(S…G86)`), DIFF-03 steps 5-6 |
| V3 | `CONCLUINDO_272` (C lasts one more tick) matches the only sample (`C` 1.585 s after hang-up and `L` 5.8 s after). It is not possible to tell whether C lasts 1 or more state ticks (B) | bench capture, 2026-10-17, attempt 3 |

## 11. Diff r1 and time-based DIFF-04 (Windows bench, 17/10)

**Diff r1** (bench capture, 2026-10-17, A = real 2.7.2, B = `simulador-2.7.2` after §9/§10):
69 steps, 60 equal, 9 divergences (4 + 3 + 2). All of them state: `TG` pointers
(`&T01l/L`, `&T0AL`, `&TC4L`), totalizer 7.02 (`&T04l/L`), `>?06` (2 steps) and the RTC
inherited in `&KR1`. No measured behavior divergence remained.

**r1's `&KR1` is not the PC clock** (review 17/10): A replied `(KR127011606145908A0)`
= 16/01/27 14:59:08, WW 06. It is the RTC that the previous round's month-13 `&KW1` left
(16/13/26 14:30:00, ~29 min earlier), with month 13 already normalized to 01 and the year +1. Right
after `&KW1`, `&R` still shows `16/13/26` (diff-2 and diff-r1-2, DIFF-12 step 3). The
`simulador-2.7.2` keeps month 13 forever (RTC_272). **Open:** when the clock timer normalizes
(next second, minute, hour?) cannot be known from one sample; a case `&KW1`
month 13 → `&KR1` at 1 s, 61 s and 3601 s is missing. Code not touched. **Closed in §13 (#40):**
step 9 measured `&KR1` at 0.1/2.1/10.1/65.1 s; month 13 becomes 01 of the next year on the 1st
the clock timer tick, and the "keeps forever" above was dropped.

**DIFF-04 explained** (bench capture, 2026-10-17): the 2.7.2 answers `(&S` with `(S…)` in ~3 ms
**without waiting for the `)`**. With a late `)`, the reply always arrives before it and the `)` is
ignored (no reply).

| Interval `(&S` → `)` (requested / measured) | A (real 2.7.2) | B (50 ms window, before) |
| --- | --- | --- |
| 10 / 19 ms | `(S…)` 17 ms before the `)` | `(S…)` after the `)` |
| 20 / 30 ms | `(S…)` 26 ms before | `(S…)` after the `)` |
| 50 / 61 ms | `(S…)` 57 ms before | silence |
| 100 / 109 ms | `(S…)` 106 ms before | silence |
| 200 / 202 ms | `(S…)` 199 ms before | silence |
| 500 / 512 ms | `(S…)` 509 ms before | silence |
| `(&S` alone | `(S…)` in 3 ms | silence |
| `(&T04L` alone (no KK and no `)`) | silence | silence |

- **Refuted:** the 50 ms reassembly window (§9, §10 V2). Removed from the code
  (`janelaRemontagemMs`, `Framer.pendente/expirar` and the `ServidorTcp` timer).
- **Now (Q1 only, i.e. only `simulador-2.7.2`):** each socket read is one command; a
  read that starts with `(&S` and has no `)` is served at once as `&S` (the framer closes the
  frame); a loose `)` arriving later goes to the parser and gets no reply. Real profiles
  stay on `fluxo` (they reassemble and only reply after the `)`), as in the manual.
- **Only `&S`:** in the JSON files, the only other frames without `)` are `(&T08L2E` (DIFF-03 step 5,
  with KK) and `(&T04L` (without KK), both silent on A. The other verbs stay as they were
  (silence without KK/framing). Implementation note (B): `(&S` followed by other chars without `)`
  (e.g. `(&S79`) is also closed with `)` and goes to the codec; not measured.
- Test: `test/tcp.test.ts` (intervals 10–500 ms and `(&T04L`, plus `cbc-32` reassembling)
  and `test/sanidade.test.ts` (framer), plus `test/diff04-tempo.test.ts` (A's `rx` line by
  line over real TCP, and all real profiles with a TCP port silent until the `)`).

**DIFF-16 in r1:** `>?000A3202000111FA` (steps 4-5) stayed silent on A, as in
§9, but **did not open a new modal** on the 2.7.2. The sim's modal **did not change**. Hypothesis, without
enough evidence: the modal may not reopen while another modal is open, or
after the 1st time.


**Framing read from the current state on every read** (17/10, implementation note,
revisable): `ServidorTcp` kept one framer per connection and only rebuilt it when the `PumpSim`
changed. `set_quirk` and `set_perfil` already swapped the sim (via `trocarPerfil`), but
`snapshot_carregar` with the same profile id swaps the quirks **in place**
(`importarEstado` without `manterQuirks`), and then an open connection kept the old Q1.
Now each `data` reads `PumpSim.modoFramer()` (Q1 → `leituraUnica`, otherwise `fluxo`) and only rebuilds the
framer if the mode changed. Side effect, intended: swapping the sim without changing the mode (e.g.
`set_quirk Q6` on `cbc-32`) **no longer** loses a frame split in `fluxo`; changing the mode
discards what was accumulated (`leituraUnica` keeps nothing between reads). The `&S79`/`(&S7` cases
and the month-13 clock were not touched (they wait for a bench measurement). Test:
`test/tcp.test.ts`, block "enquadramento acompanha quirk/perfil com a conexão aberta".

## 12. Behavioral equivalence, slice 1 — reads (17/10)

Source: the behavioral-equivalence verdict and the slice notes, checked against the
bench (driver test log, diff r1 captures, step 9 capture; 2026-10-17). Everything only on
`simulador-2.7.2`: two new quirks, `T_272` and `L_272`, and Q1 extended. Real profiles
did not change. Script: `EQUIV-LEITURA` in `src/diff/roteiros.ts`. Test:
`test/equivalencia-leitura.test.ts`.

| # verdict | Change | Contradicts | Source |
| --- | --- | --- | --- |
| #2 | Q1: a chunk without `)` goes whole to the codec; `&I`, `&S`, `&R`, `&KW`, `&V`, `&H` and `&E` reply/act by prefix, without KK. A split `(&I` advances the pointer. `(&A`, `(&T04L` and the others with KK stay mute. The framer no longer appends the `)` | §11 "Only `&S`" (implementation note, B) | behavioral equivalence; DIFF-04, step 9 (`(&S79`, `(&SX`) |
| #17 | `T_272`: `&T` without length test, only the KK; mode = 6th char (`(&T04LX82)` → `TL`, `(&T04DE)` → `TG`) | spec (9 chars) | behavioral equivalence |
| #19 | `T_272`: the 5th field of `Ts` is the nozzle index within the address (1–4). The bench's `(&T08C25)` (nozzle 1 of address 1) stays the same | DT435 p.24-25 (address; applies on the real ones) | behavioral equivalence |
| #20 | `T_272`: `TU` = `FloatToStr` of the price, without comma, zeros on the **right** up to 4, first 4 (5.49 → `5490`). With 3 decimals it gives the same as before (DIFF-10) | left `padNum` | behavioral equivalence (verdict: A) |
| #22 | `L_272`: `&LR`/`&LC` without length test; position = chars 5–8 parsed as a Delphi integer (accepts `$hex` and leading spaces); non-numeric → E9 modal (`'xx' is not a valid integer value`, Q2) and silence | spec (11 chars, decimal) | behavioral equivalence; the bench error notes E9 |
| #23 | `L_272`: `&LE` answers. n = 7th char in hex; 0 → silence; not hex → E9; column (n div 4) − 1 and rows by n mod 4 (verdict correction). **The event grid is not modeled**: the cells come out empty and the reply is `()` (B, the event layout was not recovered). On the real ones it stays mute (§3.9) | §3.9 / §8 (`&LE` mute) | behavioral equivalence; bench `(&LE000178)` mute |
| — | `&LR` 74 (CBC-06) / 82 (Horustech) by Modelo: already there; now there is a byte-by-byte test with both bench frames | — | the driver test log (`(&LR000185)`) |

Out of this round (on purpose):
- #3 (`X&S)` with a free 1st char), #5/#6/#7 (`?`/Horustech branch before `?F`/`?C`/`?LF`):
  dispatch in `sim.ts`/Identfid, outside the slice list.
- #18 (`&T L`/`l`/`$` without cutting): the case only shows up with a totalizer ≥ 10⁶ L, which depends on
  `&E` in whole liters (#42, another slice).
- #22 point 3 and #12 (col3 52/36 layout fixed by DIP3 at write time) and #13 (the identified-records pointer):
  writing, engine slice.
- `&KW` without `)` replies, but `&KW` **with** `)` still requires KK (#39, another slice). `&H` without
  `)` reaches the handler, which still checks the range (#38). **Closed in §13** (#39 and #38).
- The comma field of `Ts` (only `2E`/`2A`/`3E`/`3A`, otherwise empty) was not touched.

## 13. Behavioral equivalence, slice 2 — commands (17/10)

Source: the behavioral-equivalence verdict and the slice notes and
the bench error notes, checked against the bench (step 9 capture, DIFF-02/12/13 of the diff
captures and the modal log; 2026-10-17). Everything only on `simulador-2.7.2`: five new quirks (`P_272`,
`M99_272`, `U_272`, `C_272`, `E_272`), `RTC_272` extended and Q2 revised. Real profiles
did not change ("perfis reais" tests in each block). Script: `EQUIV-COMANDOS` in
`src/diff/roteiros.ts`. Test: `test/equivalencia-comandos.test.ts`.

| # verdict | Change | Contradicts | Source |
| --- | --- | --- | --- |
| #40 | `RTC_272`: the clock is 7 one-byte fields. The clock timer adds 1 s per tick and tests **by equality** (sec 60, min 60, hour 24, day 32, month 13), with no calendar: every month has 31 days (30/04 23:59:59 + 3 s = 31/04) and month 13 becomes January of the next year on the 1st tick. The 1st tick comes 1 s after the write (B: the real phase is unknown) | §11 "`simulador-2.7.2` keeps month 13 forever"; §3.15 | behavioral equivalence; step 9 (`(KR1270116061430028F)` at 2.1 s) |
| #39 | `&KW`: the dispatch only looks at `KW` (neither the KK nor the `1`); 7 fields by `StrToInt`, without range (hour 25 accepted and `&KR1` shows it); replies the values read. Non-numeric or missing field → E9 and silence, **without** the current time. Stores field by field up to the failing one (B for `&KW`; the equivalence analysis states it for `&H`) | spec (`&KW1` with KK and range) | behavioral equivalence; DIFF-12 (`(KW12613160614300094)`) |
| #38 | `&H`: day/hour/minute by `StrToInt`, without range; `(&H)`; non-numeric → E9. Included because it is the same RTC field (the slice's "clock" item) | spec (range) | behavioral equivalence |
| #35 | `P_272`: no length test; `(P?t)` with a nonexistent nozzle or with its **own** nozzle in A; otherwise pre-authorizes the nozzle and sets P before converting the value (non-numeric → E8, nozzle already in P, no preset). The preset stays on the side (#72/#73 belong to the engine; **revised in §14 #73**: the preset belongs to the nozzle) | spec (14 chars, refusal by side) | behavioral equivalence |
| #32 | `M99_272`: the blacklist is the card registry column (`Cartao.listaNegra`), with no list of its own nor capacity. 25 chars with KK and **free BB**; `b` marks, any other op unmarks; `(M99)` if the card is registered (identical code), `(M?f)` if not. The short form `&M..c` clears nothing. Fixes the reading of DIFF-02 (§2, §9, §10 V1) | §9 DIFF-02, §10 V1 | behavioral equivalence |
| #43, #36 | `C_272`: `&C` without length test; channel = `cmd[5]`, address = `cmd[9]` (outside 1..8/1..4 it does nothing); resending resets **even the active nozzles** (initial price, L, at rest, unblocked); reducing does **not** deactivate the nozzles above n; n=0 unconfigures and zeroes totalizers, cards and IDF; the raw grid (`Lado.gradeC`) goes out in `&R`, including `(C01W3A010000)`. A char that does not convert → E6 and nothing changes | spec (17 chars, deactivates above n) | behavioral equivalence |
| #45 | Removed the invented verb `CH`: `(&CH…)` is a `&C` with type H (`&F` → `RH61`). DIFF-13's `(&CH0213)` reads past the end → E6 and silence, as before. On real profiles `(&CH…)` falls into their `&C` (17 chars) | §3.9 | behavioral equivalence; DIFF-13 |
| #44 | `C_272`: `&c` copies `cmd[6..7]`, `[8..9]`, `[10..11]` into three fields of the nozzle with code `cmd[4..5]`, with no reply. Mapped to lane nozzle, fuel and tank (the PAF `bb cc tt`), **B**: the position in the layout was not traced | §3.9 | behavioral equivalence (verdict: A) |
| #33 | `U_272`: 14-char `&U` with an invalid level → modal "Nível de preço incorreto." and **`(UBB)` after the OK**, without changing the price; non-numeric price → E8 with no reply. The price is 4 digits with a comma (`dd,dd` with 2x, `d,ddd` with the others). The verdict's test frame: `(&U0420058917)` (14 chars), not the slice's | Q2 (silence) | behavioral equivalence; errors E3/E8 |
| #34 | `U_272`: 16-char `&U` reads the price in `cmd[9..12]` (`cmd[7..8]` ignored); with comma 2x levels 1 and 2 store into 0; invalid level → `(U?t)` after the OK | spec (6 digits) | behavioral equivalence |
| #42 | `E_272`: `&E` without KK; `((TL`+BB+V8+KK+`)` with the KK summing the 1st `(`; totalizer in **whole liters**; creates a zero-volume record if the value changed (B: initial totalizer = final = the new one, level 0 price); replies even without a nozzle; non-numeric → E8. The Dinheiro radio (silence) is not modeled | §3.11 (2 decimals, no record) | behavioral equivalence (verdict §0.1) |
| #8 + E3 | Q2: the modal does not silence the socket (the other frames keep going). The reply the handler only gives after the OK (`aposOk`: 14/16-char `&U` and Horustech 32 with an invalid level) goes out at once with `travamentoMs = 0`, or when the modal closes (`liberar_travamento` or deadline); over TCP it is written to the socket that asked for it (`ResultadoQuadro.adiada`) | Q2 / behavioral equivalence (quirk list #11) ("the socket freezes") | the bench error notes §1 and E3; the modal log (bench capture, 2026-10-17) (10053 with the socket serving) |

Implementation notes (revisable):
- Without Q2 (real profiles), `travar`/the `travamento` fault keep freezing everything: it is a useful
  synthetic fault for testing the client, and a real console has no modal. The
  "freeze by fault freezes" tests now use `cbc-32`.
- The field-based RTC only starts at the 1st `&KW`/`&H`; before that the calendar applies (with WW 00). The 2.7.2
  starts from `Now` when the window opens and would already follow the 31-day rule; the difference only shows
  when crossing the end of a 30-day month with no adjustment (B).
- `set_relogio`/`set_relogio_simulado` (control) set the RTC back to the calendar.

Out of this round (on purpose):
- #43 "pending 1.123 with 2 decimals": the price is an integer at the nozzle's scale; 1.123 does not fit
  in 2 decimals. `&T U` after a `&C` with comma 2x stays `1120`, not `1123`.
- #31 (`&M` invalid mode with a nonexistent nozzle → silence) and #24–#29 (`&M A/L/B/S/H/I`,
  per-nozzle block model): engine/block, another slice.
- #18 (`&T L` without cutting): it can now be proven (`&E` in whole liters), but it belongs to slice 1.
- #21 (`&T` on an unconfigured nozzle replies `TL` with 0) and the BB code kept in the nozzle with
  n=0: the deactivated nozzle is not found by `bicoPorTexto`.
- The modal blocking the control API (verdict §2.8); n > 4 in `&C` (overflow into the
  next address): stops at 4.

## 14. Behavioral equivalence, slice 3 — engine (17/10)

Source: the behavioral-equivalence verdict and the slice notes and the bench error notes,
checked against the bench (fueling probe attempt 3, driver test log, `driver.ps1` and the modal
log; 2026-10-17). Everything only on `simulador-2.7.2`: three new quirks (`BICO_272`, `VAZAO_272`,
`MS_272`), Q3 fixed and Q2 extended to RST. Real profiles did not change ("perfis
reais" test and the quirks off). Script: `EQUIV-MOTOR` in `src/diff/roteiros.ts`. Test:
`test/equivalencia-motor.test.ts`.

| # verdict | Change | Contradicts | Source |
| --- | --- | --- | --- |
| #72 | `VAZAO_272`: a reached preset fixes volume = preset/price and total = preset and **does not finish**: status A, `&V` repeats the volume, no record until hang-up or `&M S`. The comparison is exact (`0.13·(n+1)·price > preset`), without truncating | §3.12 | behavioral equivalence C3 |
| #73 | `BICO_272`: `&P` preset on the nozzle (`Bico.presetCentavos`); the start does not clear it; hang-up clears the 4 nozzles of the address, `&M S`/`&M P` only the nozzle | §13 #35 ("the preset stays on the side") | behavioral equivalence C2, B1, B10, B11 |
| #74 | `VAZAO_272`: with an active preset the step is 0.13 L also with 3 volume decimals | `vazaoMlPorTick.casas3` | behavioral equivalence C4 + verdict §0.6 |
| #68 | `BICO_272`: `preAut` per nozzle (`Bico.preAut`); `&M A` with no nozzle in E marks the 4; the start does **not** clear it; the end (write) clears the 4. `&S` shows P for the idle nozzle while another one fuels | `iniciar` zeroed the side's | behavioral equivalence B4/B5/B7 |
| #66 | `BICO_272`: no "side busy" lock: two nozzles of the same address fuel together | §3.13 | behavioral equivalence B2 |
| #89 | `BICO_272`: no authorization deadline (the `?F P` `N2` does not expire). Evaluated: the 2.7.2's state timer has no deadline; the deadline stays on the real ones (DT432 p.18). Case in the script since the §16 review | K12 (P→B/L on the 2.7.2) | behavioral equivalence H0 |
| #27 | `MS_272`: `&M S` only on the addressed nozzle, in any state: C at once and the state timer stores. Idle: repeats volume/total/price of the last fueling (`Bico.ultimo`; zero if it never fueled, R0001 on a freshly opened one) and adds it again to the totalizer. B: the ghost's initial totalizer is the one of the last start (as before) | finished the whole side and ignored the idle one | behavioral equivalence B10, verdict §0.5 |
| #26, #64 | `VAZAO_272`: the flow timer only advances with status A (not by state). `&M B` sets B on the 4 nozzles at once, including the one fueling: the flow freezes with the nozzle still fueling, `&V` does not list it and the state timer does not rewrite the status of the one fueling. It ends on hang-up (record with the frozen volume) | only blocked at rest | behavioral equivalence A4/B8 |
| #63 | `VAZAO_272`: the flow timer looks at neither Automação nor DIP4 (the volume keeps rising; only the state timer stops and nothing is stored) | Q7 on the flow timer | behavioral equivalence A3 |
| #13 | Q3: at the identified-records pointer = 10000 the write pointer goes to **1**, not 0 | §2 Q3 | behavioral equivalence D4 (verdict: C) |
| #69 | `get_displays`/`statusTextual`: "Concluindo.." from hang-up until the tick that clears C (before, it went back to "Retirar Bico" on the 1st tick, with C still in `&S`) | — | driver.ps1 ("Abastecendo.." → "Concluindo.." → "Retirar Bico"), driver test log (bench capture, 2026-10-17) |
| #92 | Q2: each abrupt drop (RST → `ECONNRESET`/`EPIPE` on the socket) opens `Asynchronous socket error 10053.` (`MSG` event; with `travamentoMs = null` the modal stays open and the socket keeps serving). FIN opens nothing. Nothing changes on the real ones | "the socket error is ignored" | the bench error notes E1, the modal log (bench capture, 2026-10-17) (2 10053 modals), engine I1 |
| #90/#91 | Documented only (Q8 in §2): the 2.7.2 persists only in `c:\simcnf.ini`, nothing in the Windows registry nor in VirtualStore; without elevation the creation fails silently, which explains the bench without the file. The `LL` on addresses 1–2 without a click probably comes from a `companytec.log` in the exe folder (D6/H3, not verified) | — | engine H1–H3 |

**"The flow starts ~2.5 s after lifting" did not become a delay in the code** (implementation note,
revisable). The ~2.5 s of the driver test log is measured from the driver's POST, which before the click switches
tab (`Invoke-OnPage`, 250–400 ms) and only then clicks. `driver.ps1` itself measured click →
"Abastecendo.." at ~0.5–1 s, and the fueling probe (attempt 3, 2026-10-17) has the click at 38.188 s and at
39.774 s `&S` already in A with 0.39 L in `&V` (3 ticks): start ~1 s and flow ~1.65 s after the
click. That is the current model: the start on the next state tick (≤ 1 s) plus 7 blinking ticks
(~0.78 s). A 1.5 s delay broke that bench data (tested and reverted). The effect of
I3 (the state timer pumping messages 2 ms per nozzle, effective period > 1 s) was not modeled.

Support changes: `abastecer` (control) with `valor`/`volume` and without `duracao_s` sets
`recolocarNoPreset`, because with VAZAO_272 the preset no longer finishes (the "attendant" hangs up);
the control `preset` uses the 2.7.2 `&P` with `P_272`; the diff executor got the
`desconectar` step (`fin`/`rst`, `ClienteTcp.fecharRst`) and the `esperar` option (tests with a manual clock).
The §13 test (#35) now checks the preset on the nozzle, not on the side.

Out of this round (on purpose):
- Per-nozzle block model (#24 `&M A` zeroes the block of the nozzle in E, #25 `&M L` × sensor, #29
  `&M H/I` raises the block only at the start, #52 `?C`, #70 card validation every tick): the
  block stays on the side (`Lado.bloqueado`). `&M B` uses the per-nozzle status only to freeze.
- #75 (quadratic volume preset of `?F P V`): the volume preset freezes, but compares volume
  with volume.
- #67 (only the level 0 pending price enters at the start), #71 (address fault turns on the 4 nozzles),
  #12 (DIP3 at write time), #78 (Default config zeroes pointers), #81/#82 (totalizers), #85 (battery),
  #10 (CBC-02), #93 (the state timer pumping messages): not on the slice list.
- #13 has no case in the script: it requires 9999 fuelings (verdict: "unit").
- `&M A` on a nozzle in B frozen by `&M B`: the equivalence analysis only sets status 3 with the nozzle in E; here
  it stays B until hang-up (B, inferred from B7/B8).

## 15. Diff infrastructure: actions through the UI driver, drenar, replay (17/10)

Source: the driver contract, `driver.ps1` and the driver test log (bench capture, 2026-10-17). Nothing
changes in the simulated behavior (real profiles and `simulador-2.7.2` the same); the script and the
executor change. Test: `test/diff-acoes.test.ts`.

| # | Change | Contradicts | Source |
| --- | --- | --- | --- |
| D1 | Bench driver in the repo: `tools/driver-simuladorcbc/driver.ps1` (byte-for-byte copy) + README with the contract, the measured adjustments and the mapping | — | driver.ps1, contract |
| D2 | `acao` step (`src/diff/acoes.ts`): on a target with `driver` it becomes `POST /acao {tipo, ...params}`; on a target with `controle` (pump-sim) it becomes the API commands, with the screen state (channel, radio) mirrored. Left panel = address 1, right = 2, `alt` = position 1 | §6-11 (manual only through the pump-sim API) | the driver test log (channel 1 = 04/05, channel 2 = 08/09) |
| D3 | CLI: `--controle-a` is the driver and `--controle-b` the pump-sim API (`--controle-x-tipo` swaps). In the library, `AlvoDiff.controle` is still the pump-sim API and `driver` is the new field | — | task |
| D4 | DIFF-01, 05–09, 18–20 (and the `EQUIV-*`) with actions instead of `manual`. DIFF-14/15: the IDF/card steps stay `manual` with `semDriver` (no HWND in the UI); lift/hang-up became actions. EQUIV-MOTOR #66 (04 and 44 together) stays `manual`: the UI has one button per panel. `configurar_travamento` is `soPumpSim` (nothing in the driver) | — | contract ("fora do contrato") |
| D5 | DIFF-17 = `drenar` + Rápido + N × (`abastecer` 3 s + 2.5 s) + Normal, N = `--diff17-n` (default 1001, ~2 h estimated; with 1 s and 2 s the real-time pump-sim stored zero-volume records, because the flow starts up to ~1.8 s after lifting) | §6-7 (`gerar_abastecimentos` only on B) | contract |
| D6 | DIFF-16: `32` is now the manual's, 6-digit price `>?000B320200011112C` (KK 2C checks on `horustech-48`; the 2.7.2 replies the literal ack). The `>?000A32…111FA` had 4 digits and the KK inside the field | 17/10 script | DT214 |
| D7 | DIFF-13 without `(&CH0213)`: `&CH` does not exist (verdict #45); `&C` with type H is in EQUIV-COMANDOS | 17/10 script | §13 #45 |
| D8 | Replay server with the recorded profile's framing: `meta.enquadramento` (the recorder now writes the `modoFramer()` from the start of the recording) or the Q1 of `meta.perfil`; `--enquadramento` forces it | §6-10 (always `fluxo`) | Q1 (§11) |
| D9 | `drenar` step (`(&A)` → `(&I)` until `(0)`, own connection closed with FIN, cap 10010) at the start of every case, except `BANCADA-1710` (assumes a freshly opened target) | — | task |

Implementation notes (revisable):
- A failing action (driver 400, pump-sim 409) becomes `acoes[].ok = false` in the report and the case
  goes on; before, a `manual` with an error brought the whole diff down.
- `retirar`/`recolocar` on the pump-sim side are not idempotent like the driver's (pump-sim
  replies 409 if the nozzle is already in that state); the script always alternates, so it does not show up.
- The `aguardar` after hang-up went from 1.5 s to 2.5 s ("Concluindo.." lasts until the 2nd
  state tick, CONCLUINDO_272); the driver already waits for C to end before lifting again.
- `porta` on pump-sim = `abrir_porta` (swaps the 2.7.2 single port). The diff target does not follow the
  new port: a case that swaps the port needs `porta` on the `enviar` step. No case uses it.
- The model does not change `&S`/`?S` (step 12 of the driver test log: `…DD6V…` and `…DD0v…` on
  CBC-06 and on Horustech): pump-sim already gave the same (`Concentrador.tipoCbc()` = 6 on both). Case in DIFF-08 (`(&S)` and `(?S92)` with Horustech). Only `&LR`
  changes (74 × 82), already covered in EQUIV-LEITURA. Nothing touched.

Not verified: no action ran against the real driver in this round (only against a fake driver
in the tests). The side/address mapping comes from the two channels of the driver test log.

## 16. Adversarial review of slices 1–3 and the diff infrastructure (§12–§15, 17/10)

Checked against the behavioral-equivalence verdict, the slice reports and the bench. Nothing in the
simulated behavior changed (real profiles and `simulador-2.7.2` the same); the script and
this file changed.

| # | What was checked | Result |
| --- | --- | --- |
| V1 | 19 sampled fixes (#2, #17, #19, #20, #22, #26, #27, #32, #33, #34, #35, #36, #38–#40, #42, #43, #45, #72), frame by frame, on `simulador-2.7.2` and on `cbc-32` | All match the verdict. #40 matches step 9 byte by byte (`&KR1` at 0.1/2.1/10.1/65.1 s). `cbc-32` follows the manual in all of them |
| V2 | Replay of the 69 frames of the diff r1 captures (side A = real 2.7.2) on a freshly opened 2.7.2 | 60 equal. The 9 different ones are state inherited from the bench (record and totalizer 7.02 from earlier rounds, month-13 RTC, `>?06` pointer), as in §11; none is behavior |
| V3 | Quirks: the 35 on only in `simulador-2.7.2`; no code compares `perfil.id`. Goldens of the manuals, DIFF-1710 and the bench: 176/176 | No leakage |
| V4 | KK and length of every frame of the `EQUIV-*` by script | The only KKs that do not check are on purpose: `&KW` with a wrong/non-numeric KK (#39), and `&E`/`&H`, which carry no KK. The E3 `>?000B32…XX` has an invalid KK on purpose (the 2.7.2 does not check it) |
| V5 | A script case for each fix | #89 was missing (no authorization deadline): added to `EQUIV-MOTOR` (`?F04P…` with N = 02 s, 5 s, `(&S)` → P on the 2.7.2). #13 stays test-only (9999 records) |
| V6 | Consistency of this file | Marked as closed: the month-13 "Open" (§11 → §13 #40), the §12 `&KW`/`&H` (→ §13) and the §13 #35 "preset stays on the side" (→ §14 #73) |

Not verified: no `EQUIV-*` case has run against the real 2.7.2 yet.

## 17. Equivalence round r4: the lines left out of §12–§14 (17/10)

Source: the behavioral-equivalence verdict and its slice notes,
checked against the bench (the diff r1 captures, the driver test log, the Comunicação screen capture).
Authority order in `simulador-2.7.2`: bench, then verdict, then the older equivalence notes. All changes are
quirks on only in `simulador-2.7.2` (four new: `DESPACHO_272`, `BLOQUEIO_272`, `MODELO_272`,
`PADRAO_272`; `T_272`, `ERROS_272`, `IDF_272` and `HORUSTECH_272` extended). Real profiles and
their goldens did not change; no code compares `perfil.id`. Test: `test/equivalencia-rodada.test.ts`.
This closes the "out of this round" items #3/#5/#7 and #18 (§12), #21/#31/#24–#29 (§13) and the
block model, #10, #78 (§14).

| # verdict | Change | Contradicts | Source |
| --- | --- | --- | --- |
| #3 | `DESPACHO_272`: a frame with `&` at char 2 goes to the `&` codec whatever the 1st char. The exact literals and the KK check include the `(`, so only the verbs matched by prefix without KK answer (`X&S)` = `&S`; `X&A)` and `X&T…` stay mute). The parser cuts at the 1st `)` | `sim.ts` routing by `(&` | behavioral equivalence (verdict: C) |
| #5, #6 | `DESPACHO_272`: inside the `?` branch the order is the exact `(?A80)`/`(?V95)`/`(?S92)`, `?D`, `?I`, then chars 7–8 = `02`/`06`/`32` → Horustech, then `?F`/`?C`/`?LF`. `(?LF000697)` → Horustech 06 (advances the read pointer, `>!000E06…`); `(?C00102000035)` → Horustech 02 and does not touch the sensor. With the Horustech model any non-`&` frame enters the branch (#6, no test: needs the UI) | Identfid routing by `(?` | behavioral equivalence (verdict: C) |
| #7 | `DESPACHO_272`: on CBC-06 only char 2 = `?` enters the branch, so `>!000202` is ERRO CMD (mute) | Horustech routing by `>` | behavioral equivalence (verdict: X, narrowed) |
| #10 | `MODELO_272`: switching the combo to CBC-02 keeps the digit the previous model wrote (`6` from CBC-06) | `tipoCbc` = `0` on CBC-02 | behavioral equivalence F6 (verdict: C) |
| #18 | `T_272`: `&T L`/`l`/`$` pad up to 8/10/8 and do not cut (`(&E0401234567)` then `(&T04L2A)` → `TL04123456700`) | `padNum` cut | behavioral equivalence (verdict: C) |
| #21 | `T_272`: the `&T` loop matches the BB code stored in the nozzle and does not test `ativo`; after `(&CW013A010000B6)` (n=0, totalizers zeroed by C_272) `(&T04L2A)` → `TL0400000000` | `TG` for an inactive nozzle | behavioral equivalence + slice 1 §10 (inference, medium confidence) |
| #31 | `ERROS_272`: the 9-char `&M` picks the routine by mode first; a mode outside A/B/L/S/P/I/H is silent even with a nonexistent nozzle (`(&M3FZ46)` mute). A valid mode with a nonexistent nozzle still echoes `(MBB)` (DIFF-02) | echo before the mode test | behavioral equivalence (verdict: C) |
| #24 | `BLOQUEIO_272`: `&M A` on a nozzle with status E zeroes that nozzle's block besides pre-authorizing it; after replacing, its next lift fuels with no command | `autorizarLado` did not touch the block | behavioral equivalence B7 (verdict: X) |
| #25 | `BLOQUEIO_272`: `&M L` zeroes the block of the 4 nozzles; the IDF sensor alone does not hold a lifted nozzle | the sensor blocked (`tickEstado`) | behavioral equivalence B9 (verdict: C) |
| #29 | `BLOQUEIO_272`: `&M H`/`I` only switch the sensor; the start of a fueling with the sensor on raises the block of that nozzle for the next one | the sensor blocked right away | behavioral equivalence B2 (verdict: C) |
| #52 | `BLOQUEIO_272`: `?C` turns on the sensor **and** the block of the 4 nozzles; at rest the nozzle goes to B (`&S` → `B`) | only the sensor | behavioral equivalence (verdict: C) |
| #51 | `IDF_272`: `?D` maps the **status** of nozzle 1: A → `02`, B → `01`, else `00` (after `?C`: `RI01FF`) | state map (02 rest, 01 fueling) | behavioral equivalence (verdict: C) |
| #55 | `IDF_272`: the `?F` branch checks the KK first; `?F L` with a valid KK clears the registry without checking length or `00` and without a modal; only write/delete lock on length ≠ 41 (so wrong length + wrong KK is now silent, no modal: slice 2 #34(c)). **It does not answer**: see "Stopped" below | `?F` locked on length before the KK | slice 2 `?F L` (verdict: C) |
| #59 | `HORUSTECH_272`: 32 picks the nozzle by the fixed table (1→04, 2→44, 3→84, 4→C4, 5→05…); **no nozzle → silence, no modal** (`>?000B320300011112D` mute with the default config); n not a number → E9 modal (`'0A' is not a valid integer value`); price = last 4 digits of P6 with the Windows comma. Level and the ack are unchanged (see "Stopped") | `bicoPorNumero` (lane number), ack without nozzle | slice 2 #37 (verdict: A) |
| #78 | `PADRAO_272`: "Carregar configuração padrão" puts write and read (every group) back at the 1st position; the identified-records pointer (`escritaId`) is untouched, so `&A` says `(0)` while `&A67` still reads row 1 | the button did not touch pointers | behavioral equivalence D5 (verdict: A) |

Implementation notes (revisable):
- The per-nozzle block is `Bico.bloqueio`; `Lado.bloqueado` stays as a mirror ("some active nozzle
  blocked") for the control API and "Bicos Bloqueados". Real profiles keep the side flag.
- The status at rest is computed on the spot (as pump-sim already did), not on the next state
  tick: `(?C…)` then `(&S)` gives `B` at once. On the real 2.7.2 an immediate `&S` may still show `L`
  for up to ~1 s (B). The per-tick card validation of a blocked nozzle (#70) is not modeled.
- "The BB code is stored in the nozzle" is modeled as `Bico.codigoGravado`, set when `&C` (or the
  default config) activates the nozzle. A never-configured nozzle has no code and `&T` keeps `TG` (B).
- `MODELO_272`: the retained digit starts at `0` (the initial buffer char, as in DIFF-13 for `?S`) and
  is taken when switching to CBC-02; it goes into snapshots (`tipoCbcRetido`). CBC-01 keeps `0` as
  before (not in the equivalence analysis).
- `PADRAO_272` keeps the old rows in the buffer (the button does not clear the grid; B).
- `DESPACHO_272` does not normalize the 1st char for `?D`/`?I` (`X?D…`): those stay mute (edge, B).

Stopped and reported (the test or the old assertion contradicts the verdict; not adapted):
- **#55** (**closed in §18**: the bench says silent): `test/equivalencia-rodada.test.ts` expects `(?F00L31)` to answer (`not.toBeNull()`). Slice 2
  (`?F L`: "It does not answer") and the verdict row ("→ clears") say silence; `limpar` was already
  silent in every profile and no bench frame exists. The behavior above is implemented and the test
  stays red until someone decides.
- **#51/#52**: `test/identfid.test.ts` ("?S: … ?D mostra RI") still expects `RI02FF` after `?C` in
  `simulador-2.7.2`; it encodes the pre-verdict state map. With #51/#52 it gives `RI01FF`, the value
  `equivalencia-rodada` asserts. Not edited; red.
- **#59, level** (**E3 closed in §18**: E9 on a non-hex KK; the level source is still open): the verdict says level 1 comes from `cmd[5]` (the last CCCC char) and `cmd[10] ≠ '0'`
  otherwise opens the level modal. `test/horustech.test.ts` asserts `>?000B32021001500XX` writes level
  1 (`cmd[10] = '1'`). Not implemented, to keep that assertion. The slice also says 2.7.2 pre-validates
  KK and CCCC as hex (E9): the E3 frame `>?000B32022001500XX` (roteiro `EQUIV-COMANDOS`,
  `equivalencia-comandos.test.ts`, `horustech.test.ts`) would then be an E9, not the level modal. Not
  implemented either (verdict: A, no bench frame).

Not done: no `EQUIV-*` roteiro case was added for these lines (the verdict §3 lists the raw ones), and
nothing ran against the real 2.7.2.

## 18. First full diff against the real 2.7.2 (diff r4b, 17/10)

Source: bench capture, 2026-10-17 (bench, 24 cases, 280 steps, 167 equal, 87 divergences +
29 different steps of the `informativo` DIFF-18). **The bench is the top authority for
`simulador-2.7.2`** (normative, maintainer's): where it contradicts the verdict or an older test, the
bench wins and the old assertion was changed with a citation. The step-by-step triage, with the
class of each of the 116 different steps and the re-measure frames, is in
§20: 37 behavior (a), 40 state/environment (b), 2 script
(c), 33 driver (d; 29 of them DIFF-18) and 4 to re-measure (m). Real profiles and their goldens did
not move (manuals, DIFF-1710 and the bench goldens green); every behavior change is a quirk that
already existed, extended. Test: `test/diff-r4b.test.ts`.

| # | Change | Contradicts | Bench step |
| --- | --- | --- | --- |
| F1 | `PADRAO_272`: "Carregar configuração padrão" re-initializes the active nozzles as the 2.7.2 `&C` does (initial price, rest, L, unblocked). The pre-authorization flag stays: L right after the click, P again on the next state tick. A nozzle lifted at the click goes back to rest without a record (B, not measured) | the button only activated inactive nozzles | DIFF-05 0/2, DIFF-07, DIFF-10, DIFF-19 step 2, EQUIV-LEITURA, EQUIV-MOTOR #72 |
| F2 | `C_272`: `&c` cmd[8..9] goes where the PAF prints the tank and cmd[10..11] where it prints the fuel (`113322`) | §13 #44 (B: bb cc tt) | EQUIV-COMANDOS #44 |
| F3 | `A36`: the `&A` 52 × 36 layout is fixed by DIP3 at write time (`Registro.dip3NaGravacao`) | layout by the current DIP3 | DIFF-07 step 6 |
| F4 | `IDF_272`: `?F G` M6 = registry count before the write | count after (DT435) | DIFF-14/15, EQUIV-COMANDOS |
| F5 | `L_272`: an unused `&LE` cell is `00000000` (row 16 included) | §12 #23 (`()`) | EQUIV-LEITURA #23 |
| F6 | `E_272`: the `&E` record has initial totalizer = the old one, the configured level-0 price, duration since the nozzle's last start (B) | §13 #42 (B: initial = final, current price, 0) | EQUIV-COMANDOS #42/#44 |
| F7 | `BICO_272`: `&S` letter A while a nozzle of the address fuels (even with another in P or the fueling one frozen in B) | §14 #68 (P) and #26 (B) | EQUIV-MOTOR #68/#26 |
| F8 | `HORUSTECH_272` (E3): `StrToInt('$' + KK)` first, KK = the 2 chars after the CCCC data; not hex → modal `''$XX'' is not a valid integer value.`, no reply, no price on any level. The 17/10 frame `>?000A3202000111FA` (KK `FA`) still reaches StrToFloat | §13 E3 (`>!00043200AA` after the OK) | EQUIV-PENDENTES, EQUIV-COMANDOS |
| #55 | `(?F00L31)` on a fresh state is silent and the socket keeps answering; the test expecting a reply now expects silence | §17 test (`not.toBeNull()`) | EQUIV-PENDENTES step 0 |
| Modals | E9/E8 texts as the watcher read them: `''XX'' is not a valid integer value.` (doubled quotes, final dot) and `'000012X4' is not a valid floating point value.`; catalog of every 2.7.2 modal seen, modeled or not, in `src/core/modais.ts` (`MODAIS_272`) | `'XX' is not a valid integer value` | diff r4b modal list |
| D1 | Driver: "Bicos Bloqueados" (blocked panel at rest) and "Aguarda liberação" (lifted, waiting) are states. At rest = "Retirar Bico", "Concluindo..", "Bicos Bloqueados"; the remap accepts all six captions (`driver.ps1`, PowerShell 5.1, no new dependency) | driver of 17/10 | DIFF-18/19/20 |
| D1′ | Mirror on pump-sim: the `retirar`/`recolocar` actions click like the driver (`clicarBotaoPainel`: idempotent by caption, waits up to 4 s); on `simulador-2.7.2` the caption follows the state timer (a lifted nozzle shows "Aguarda liberação" only once a tick left it in E; an authorized one goes from "Retirar Bico" straight to "Abastecendo..") | §15 "not idempotent" (implementation note); caption at once | DIFF-20, EQUIV-MOTOR #63/#74 (B started ~1,8 s later) |
| Script | Robust cases: `configPadrao`/`zerarEncerrantes`/`acertarRelogio` at the start, R$ presets for deterministic volumes, masks only on clock fields (`mascara`), DIFF-14/15 end with `&M04I` + `&M04L`, DIFF-19 R$ 5,00, EQUIV-COMANDOS without the pump-sim-only modal hold, EQUIV-PENDENTES with a valid-KK level probe on nozzle 44, BANCADA-1710 first | — | see the triage |

Implementation notes (revisable):
- Where a step had several causes it is counted once, by its behavior cause when there is one.
- F1 also puts a lifted/fueling nozzle back at rest (the `&C` routine does it; the button on a lifted
  nozzle was not measured).
- F4 for a rewrite of a card already registered: also "count before" (not measured).
- F6 duration counted from the last start (like the `&M S` ghost); only one sample (0x2C), so it is
  masked as a clock field and listed as re-measure M3.
- F8 with a non-hex CCCC does not convert the KK (not measured).
- The 3 modal texts the watcher read as empty are taken as the three "Nível de preço
  incorreto." of the run (probable, listed as such in the catalog).
- Clock masks cover only duration C4, hh:mm (hh:mm:ss in PAF2), the `&R` time and the KK over them.
  The day/month and every behavior field stay compared.
- `abastecimento()` presets R$ 1,00 by default; DIFF-30 (real console) and EQUIV-MOTOR #89 (preset
  from `?F P`) keep the free flow.
- The new `>?000B3202200150030` step in EQUIV-COMANDOS has no `esperado` until measured (M5).

Not fixed (stays different on the next bench run, by design or pending a measure):
- DIFF-08 position 0500 (empty only on freshly opened targets; the buffers had wrapped) and
  BANCADA-1710 (assumes freshly opened targets): restart both targets before a full run.
- DIFF-14 `?A80`/`?V95` (IDF panel outside the driver) and EQUIV-MOTOR #66 (two nozzles on one panel).
- DIFF-16 Horustech 02 pointer (M1), EQUIV-LEITURA `&LE` row 1 event (M2).
- Free-flow volumes that remain (EQUIV-MOTOR #26 record, #74 `&V`, DIFF-18): aligned at the start, but
  a state/flow timer phase can still give one tick of difference.
- The E10 date/time modals (`Invalid argument to date/time encode.`) are cataloged, not opened.

Not verified: nothing of this ran against the real 2.7.2 yet (only pump-sim × pump-sim and the fake
driver in the tests); the driver change was not run on Windows.


## 19. Web UI (17/10)

Source: the design approved by the maintainer (11 screens, `tokens.css`, sample data and a design
spec; not published with this repository). Nothing in the simulated
behavior changed (`npm run ci` 565 → 581, the 16 new tests are `test/ui.test.ts`); the control API
gained operations and the CLI gained flags.

Normative (maintainer's, not re-evaluated here): the design 1:1 through the tokens, neutral identity,
light and dark, desktop-first; served by pump-sim on loopback next to the control API and driving the
simulator only through it; parity with the 2.7.2 screen plus our extras; Windows = Node SEA executable,
Mac/Linux = CLI; minimal dependencies.

| # | Decision | Where |
| --- | --- | --- |
| U1 | **No framework and no build step.** Plain browser ES modules in `ui/` (`js/app.js` shell, `js/telas/*.js` one module per tab, `js/morph.js` a 60-line DOM patcher so the 300 ms refresh keeps focus and typing). The design's markup is template strings with the design's class names; `ui/tokens.css` is a byte-for-byte copy of the design's, `ui/app.css` holds the per-screen styles of each `.dc.html`, scoped by `.scr-<tab>` (the screens reuse `.cols`, `.ptr`, `.sel` with different meanings) | `ui/` |
| U2 | **Served by the control server** at `/` and `/ui/<file>` (same 403 for a foreign `Origin`/`Host`, plus CSP `script-src 'self'`, `nosniff`, no CORS). Files are read from `<package>/ui` (dist and tests resolve the same folder); inside a SEA they come from the executable's assets `ui/<path>` (`node:sea`). Only plain relative names with a known extension are served | `src/ui/assets.ts`, `src/control/servidor.ts` |
| U3 | **One channel.** The UI polls `get_estado_simulador` + `get_displays` every 300 ms over the WS (commands tagged `origem: 'ui'`), plus per-tab reads; actions are catalog commands. Live traffic is a new `trafego` WS event (each socket read/write with the connection id, from the transport hooks the recorder already uses) and a `falha` event (an injected rule fired). The UI keeps no state of its own besides form fields, the console buffer and the theme (`localStorage`) | `src/control/runtime.ts`, `ui/js/api.js` |
| U4 | **The side button is the 2.7.2's toggle**: its caption is `get_displays.statusTexto` ("Retirar Bico", "Abastecendo..", "Concluindo..", "Bicos Bloqueados", "Aguarda liberação"); a click recolocates the nozzle that is out, else lifts the radio's nozzle; disabled during "Concluindo.." (the driver waits it out too). A side in fault shows "Limpar falha" instead (our extra). The chip next to it is the `&S` letter (design state map) | `ui/js/telas/pista.js` |
| U5 | **Control API additions** (catalog + handler, loopback rule unchanged): `limpar_buffer` (core `buffer.limpar`), `enviar_pela_porta` (a real TCP connection to the port, so faults, recording and that port's pointer apply), `list_gravacoes`, `list_roteiros_diff`; new optional args `list_abastecimentos.com_quadro`, `gravar_inicio.na_pasta`, `gravar_encerrante.painel`, `diff_executar.controle_a/b`, `tipo_controle_a/b`, `drenar_antes`; new result fields `get_estado_simulador.gravacao/erroPorta/perfil.opcoesPortaTcp`, `list_cartoes[].classe/listaNegra`. Routes `GET /api/servidor` (WS clients, last 50 non-UI calls with origin, MCP client) and `GET /api/gravacoes/<nome>.jsonl` (download, recordings folder only). The MCP server now sends `x-pump-sim-origem: mcp` and the client name | `src/control/*`, `src/mcp/servidor.ts` |
| U6 | **"Gravar totais" = the 2.7.2 button** with `painel: true`: with quirk `E_272` it runs `gravarEncerrante272` (the routine the 2.7.2's `&E` calls: zero-volume record when the totalizer changes) and "Dinheiro" is refused (409, the 2.7.2 radio is silent). Without `painel`, or on real profiles, `gravar_encerrante` is unchanged | `src/control/comandos.ts` |
| U7 | **Port in use does not abort with `--ui`** (`tolerarPortaOcupada`): the simulator runs with no port, `erroPorta` holds the logical port, the Pista banner offers "Tentar de novo"/"Usar <outra>" (`abrir_porta`). `abrir_porta` failures are recorded the same way. Without `--ui` the CLI still exits on EADDRINUSE | `src/control/runtime.ts`, `src/transport/tcp.ts` (`ServidorTcp.vazio`) |
| U8 | **CLI**: `--ui` (control on 7070 when `--control` is missing, prints `UI em <url>/`, opens an app window: Edge `--app`, then Chrome `--app`, found by install path (U10), else the default browser; `--sem-abrir` only prints); `--lembrar` (profile, ports, DIPs, model, Automação, AC, battery, speed in `%APPDATA%/pump-sim/ultima-config.json` or `$XDG_CONFIG_HOME|~/.config/pump-sim/`, saved every 2 s when it changes and on exit, re-applied through the control commands); `--gravacoes <pasta>` (default `./gravacoes`). Inside a SEA with no arguments: `--ui --lembrar`. The URL is printed whenever the control API is on | `src/cli.ts` |
| U9 | **The UI never leaves loopback**: the design's two Google Fonts `@import`s are replaced by `ui/fonts.css` + `ui/fonts/*.woff2` (IBM Plex Sans variable and Plex Mono 400/500/600, latin + latin-ext; Material Symbols Rounded variable, full set: 3.0 MB, so no icon can go missing). CSP is now `font-src 'self'`, `style-src 'self' 'unsafe-inline'`, no external origin. `ui/tokens.css` differs from the design's copy only in that `@import` line. Licenses (OFL 1.1, Apache 2.0) in `ui/fonts/LICENSES.txt`. Gated by `test/ui.test.ts` (CSP without http(s), every font URL served as `font/woff2`, no http(s) load in any UI file) | `ui/fonts*`, `src/ui/assets.ts`, `src/control/servidor.ts` |
| U10 | **Windows build** (`npm run build:sea:win`, `tools/build-sea.mjs`): tsc, then esbuild `dist/cli.js` → one CJS file `build/sea/pump-sim.cjs` (`--platform=node --format=cjs --target=node22`, `import.meta.url` defined as `undefined`, ws's optional `bufferutil`/`utf-8-validate` external), `sea-config.json` with every `ui/**` file as asset `ui/<path>`, `useCodeCache`/`useSnapshot` false (the blob is built on any OS), `node --experimental-sea-config`; downloads `node-v22.20.0-win-x64.zip`, checks it against nodejs.org `SHASUMS256.txt` (stops on mismatch), strips `node.exe`'s Authenticode certificate table (left in, it points into the injected data and the file reads as corrupt-signed), injects with postject (fuse `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, overwrite). Must run on Node 22.20.0 exactly. Unsigned: SmartScreen warning documented in the README. `dirUi()` finds `ui/` from `import.meta.url`, else `__dirname`, else `process.execPath` (first folder with `index.html`), so the bundle also runs outside the SEA. Browsers are found by install path (`%ProgramFiles(x86)%`, `%ProgramFiles%`, `%LOCALAPPDATA%`), never `start msedge`, which pops a Windows error dialog where Edge is not registered | `tools/build-sea.mjs`, `src/ui/assets.ts`, `src/ui/navegador.ts`, `test/sea.test.ts` |

Dev dependencies for the Windows build (decision, 17/10): `esbuild` 0.28.2 (already in the
lockfile as a vitest transitive, so no new download tree) bundles the ESM output and its three runtime
dependencies into the single CJS file a SEA requires (a SEA `require` sees only built-in modules);
`postject` 1.0.0-alpha.6 is the injector the Node SEA docs use and the only one that writes the blob
into a PE from macOS/Linux. Both pinned exactly; runtime dependencies unchanged.

Implementation notes (revisable):
- Truthful copy where the design text promised behavior the simulator does not have: profile switch
  says the physical state carries over (`trocarPerfil`), not "reinicia… voltam a zero"; the
  "Parser local" hint says it uses the chosen port's pointer (the design said it does not touch it);
  "Relógio manual" is a read-only switch (startup flag `--relogio-manual`); Diff's voltage mask and
  new connections are fixed switches ("sempre") and "Interativo" is CLI-only.
- No product names exist in the simulator: nozzles show "Bico N" (+ the fuel code when set) instead of
  "Gasolina C"; the Preços product filter groups by fuel code.
- The traffic console's checksum column: "válido" when the 2 chars before `)` are the KK of the rest,
  "inválido" for a request that should carry one and does not match, "sem KK" otherwise (a display
  heuristic, not the parser's rule). `&A` 52 decode is display-only and checked against
  `formatos.a52` by a test.
- "Pendentes" on Comandos básicos is `(escrita − leitura) mod capacidade`.
- Diff: bytes that differ in a step the executor judged equal are drawn as "mascarado".
- Fonts and icons are served locally (U9); the icon ligatures stay clipped to one glyph in case a
  font fails to load.
- A `?tema=claro|escuro` query forces the theme for screenshots; there is a theme button in the top bar
  (the design has none; default follows the OS).
- `--drenar-antes` is now a boolean flag: before, the CLI parser took the next argument as its value,
  so `diff … --drenar-antes --json rel.json` (the README example) lost `--json`.

Not done:
- **Serial** (Comunicação): the card says it is not available; the simulator has no serial (§8).
- **"Carregar de arquivo"** on the buffer: disabled; `carregar_arquivo_buffer` (K20) does not exist.
- Replay and Diff have **no progress**: `replay`/`diff_executar` are one call; the UI shows "rodando…"
  and the result at the end.
- The **Windows executable** is built (U10) but was not run on Windows from here: the CJS bundle and a
  macOS SEA made from the same blob were smoke-tested (no arguments → `--ui --lembrar`, UI served from
  the SEA assets, `(&S)` answered on 2001). It is unsigned and carries no icon or version resource.
- No browser test runs in CI: the UI is gated by `test/ui.test.ts` (serving, imports, helpers vs
  simulator, the new commands). A headless-Chrome click-through (33 checks over all tabs) was run by
  hand on macOS, not committed.
- Partial port failure on a real profile at startup leaves all ports closed; "Tentar de novo" opens
  only the failed one (the others are reopened from Configuração).

### Design-parity review (17/10)

Every screen and state rendered with headless Chromium at the artboard width (1440) in light and dark,
the `.dc.html` artboards rendered the same way (served over HTTP so `TopBar` imports), and compared
side by side. Profiles: `simulador-2.7.2` (all tabs), `cbc-32` (Comandos básicos), `horustech-48`
(Pista Horustech), plus port in use, no client and API off. Network log of the page: only
`127.0.0.1` after U9 (before: `fonts.googleapis.com`, `fonts.gstatic.com`).

Fixed:
- Fonts from Google (U9).
- Comandos básicos: the latest written record gets the design's green row (`bg w`, the record just
  behind the write pointer); "2 bico(s) abastecendo" → "2 bicos abastecendo".
- Pista Horustech: the `&S` line says "48 posições · sem trailer" (was "51 chars") when the frame is
  only state letters.
- Comunicação: the closing parenthesis hugs the typed command (`field-sizing: content`, the field is a
  `label`, so the whole box still focuses the input).
- Configuração: the design's one-line profile captions (the profile's full description is the
  tooltip); Modelo helper "tipo no char 39 do &S".
- Identfid: an address without the IDF sensor shows only "Sem sensor IDF" (disabled; the mode is chosen
  after turning the sensor on), as in the design.
- Preços: "Aplicar alterações" instead of "Aplicar 0 alterações".
- Gravação & agentes: one-line ellipsis for the recordings folder, the catalog group lists (full list in
  the tooltip) and long command names in "Últimas chamadas"; the MCP JSON keeps `args` on one line.

Accepted (implementation notes, revisable):
- Normative captions win over the artboards: the side button shows the driver's "Abastecendo..",
  "Retirar Bico", "Bicos Bloqueados" where the design drew "Recolocar bico"/"Retirar bico" (U4).
- "Sem conexão" and "porta ocupada" keep the live grid under the banner; the design drew a ghost grid.
  The pumps must stay operable before a client connects (the banner itself says the forecourt keeps
  simulating).
- API off is a page-wide overlay with the design's card (the whole UI depends on the API), not only the
  card on Gravação & agentes.
- Pista and Pista Horustech show the per-state count legend and "Recolocar todos" on every profile; the
  Horustech artboard has neither. The channel header has the `more_horiz` menu (fault, generate) where
  the Horustech artboard had an expand icon.
- Native `<select>` with a CSS caret instead of the design's custom field with a hex chip and
  `expand_more` (keyboard and a11y for free; an `<option>` cannot hold a chip). Identfid's "Apresentar
  cartão" picks the side with a select (the design showed one fixed nozzle).
- Diff: the controller type is a `driver de UI | API de controle` segmented control under the URL, not a
  label inside the field.
- Data-driven differences, not UI: volume decimals come from `get_displays`/the record's comma code
  (2.7.2 default config shows 2), nozzles are "Bico N", the port role labels appear only on the known
  ports (2001/1771/857/7002), the fault form has no seed field (the PRNG seed is per runtime, not per
  rule, and not exposed), the traffic console annotates rows with "N chars" instead of the artboard's
  hand-written notes ("sem resposta (esperado)", "+800 ms").
- The theme button in the top bar (§19 above).

- `simulador-2.7.2` starts at the measured 100 ms flow tick (the 2.7.2's "Normal" speed button does not fire on
  load, `src/profiles/index.ts`), so Pista says "tick de 100 ms" and Configuração selects no speed
  ("agora 100 ms") until one is clicked; the artboards assumed "300 ms (Normal)". Truthful, kept.

Seen and not fixed (outside the UI): `horustech-48` starts with
the default config of 8 channels × 2 addresses (16 addresses, channels 9–12 "sem endereços
configurados"), not 48 addresses.

## 20. Diff r4b triage (17/10)

Source: bench capture, 2026-10-17, the first FULL run of `pump-sim diff` against the real
SimuladorCBC 2.7.2 on the Windows bench. Side A = 2.7.2 (through `tools/driver-simuladorcbc`),
side B = pump-sim r4b (`simulador-2.7.2`). 24 cases, 280 steps: 167 equal, 87 counted divergences
(84 steps with A ≠ B in byte cases + 3 BANCADA-1710 steps where A = B but both miss the bench
`esperado`), plus the 29 different steps of the `informativo` DIFF-18. Every one of the 116 is
classified below; the table was generated from the JSON, so the step numbers are the report's
`indice` (0-based, `enviar` steps only). Decisions: §18.

Neither target started fresh: the 2.7.2 drained 998 old records in the first `drenar` (its
999-cell buffer had wrapped) and had 05 in P; pump-sim drained 596 and had nozzle 04 still
fueling from an earlier session (DIFF-06: `retirar_bico: bico 04 não está em repouso`).

### Classes

| Class | Meaning | Steps (of 87 counted) | Steps incl. DIFF-18 |
| --- | --- | --- | --- |
| a | Behavior divergence in pump-sim (fixed as a `simulador-2.7.2` quirk) | 37 | 37 |
| b | State / environment: dirty start, clock, buffer history, timing window | 40 | 40 |
| c | Case / script bug in `src/diff/roteiros.ts` | 2 | 2 |
| d | Driver gap (bench driver or the pump-sim mirror of it) | 4 | 33 |
| m | Needs re-measure (cannot be classified from the report) | 4 | 4 |

A step with several causes is counted once, by the first key of its Action (the behavior one when
there is one); the other keys are listed after a `+`.

### Action keys

Behavior fixes (class a), all on `simulador-2.7.2` only:

- **F1** `PADRAO_272`: "Carregar configuração padrão" re-initializes the nozzles already active, as the
  2.7.2 `&C` does: initial price (the `&U` price is lost), at rest, status L, unblocked; the
  pre-authorization flag stays, so P comes back on the next state tick (DIFF-05 step 0 L, step 2 P).
  pump-sim used to touch only inactive nozzles, so B kept 12,34 (DIFF-07/10), 0,12 (EQUIV-MOTOR #72,
  from EQUIV-COMANDOS) and the `?C` block of DIFF-15 (EQUIV-LEITURA: no record on B).
- **F2** `C_272`: `(&c00411223349)` prints `113322` in the PAF on the 2.7.2: cmd[8..9] goes where the
  PAF prints the tank, cmd[10..11] where it prints the fuel.
- **F3** `A36`: the `&A` 52 × 36 layout is fixed by DIP3 at write time (verdict #12): a record stored
  with DIP3 on still reads as 52 after DIP3 goes off.
- **F4** `IDF_272`: the `M6` of the `?F G` reply is the registry count before the write (0/0, 1/1,
  2/2, 3/3 on the bench), not after.
- **F5** `L_272`: an unused `&LE` cell is `00000000` (`(&LE00C5A)` → 32 zeros), not empty.
- **F6** `E_272`: the `&E` record has the old totalizer as the initial one, the configured level-0
  price (11,23 right after a `&C`, not the 11,20 in effect) and a non-zero duration (B: counted from
  the nozzle's last start).
- **F7** `BICO_272`: while a nozzle of the address is fueling the `&S` letter is A, even with another
  nozzle in P (#68) ~~or with the one fueling frozen by `&M B` (#26)~~ (#26 part refuted by r6/r7g:
  the letter is B, §23 B2). The verdict said P / B.
- **F8** `HORUSTECH_272` (E3): the 32 converts the KK with `StrToInt('$' + KK)` first (KK = the 2
  chars after the CCCC data); not hex → E9 modal `''$XX'' is not a valid integer value.`, no reply,
  no price.

State / environment (class b), made robust in the script:

- **A1** `configPadrao` at the start of DIFF-01/03/04 (with F1 it normalizes the nozzle state both
  targets carried in).
- **A2** `zerarEncerrantes(...)`: `(&EBB00000000)` + `drenar` before reading totalizers (DIFF-03/07/
  08/11/19/20, EQUIV-LEITURA, EQUIV-MOTOR).
- **A3** Deterministic volumes: `abastecimento()` sets a R$ 1,00 preset first (the flow freezes at
  preset/price, VAZAO_272), DIFF-06 uses R$ 0,50 per nozzle, EQUIV-MOTOR #73 gives 44 its own
  R$ 2,00 and #63 checks that the flow reaches a preset with Automação off. And the pump-sim `retirar`
  now returns where the driver's does (at the start of the fueling, see D1). Free-flow steps that stay
  (#26 record, #74) can still differ by a tick.
- **A4** `configPadrao` before the fueling, so position 1 is the case's own record, plus the clock
  masks.
- **A5** Not fixable in the script: position 0500 is only empty on freshly opened targets (both
  buffers had wrapped). Restart both targets before a full run.
- **A6** `acertarRelogio()` (`&KW` to 16/10/26 14:30:00) and masks on the clock fields (`&R` time).
- **A7** BANCADA-1710 assumes freshly opened targets: it is now the first case of `todos`; on the r4b
  bench it ran after DIFF-20.

Clock masks (`mascara` on `enviar`): only the fields the clock writes — record duration C4 and hh:mm
(hh:mm:ss in PAF2), `&R` time — and the KK that covers them. No behavior field is masked.

Script bugs (class c):

- **C1** EQUIV-COMANDOS held the modal on pump-sim only (`configurar_travamento {ms: null}`); on the
  bench a modal watcher closes each MessageBox in ~0,4–0,8 s, so the 2.7.2 answered `(U04)` (834 ms)
  and `(U?t)` (384 ms) inside the step while B stayed silent. The hold is gone and the `esperado` are
  the bench bytes.
- **C2** DIFF-19: R$ 10,00 at 11,23/L (0,89 L) is not reached in 15 s at Normal (0,624 L on the
  2.7.2): the cut never happened. Now R$ 5,00.
- **C3** DIFF-15 left sensor and block on in address 1 (`?C`, #52), and DIFF-14 left the sensor on in
  pump-sim only: the panel stayed "Bicos Bloqueados" for DIFF-18/20 and BANCADA-1710 (`(SB…)`). Both
  cases now end with `&M04I` + `&M04L`.
- Also fixed (no row of its own): EQUIV-PENDENTES read the #59 level on 04, but the 32 table maps
  n = 02 to nozzle 44; it now reads `&T44U`/`&T44u`, and the level-source probe uses a valid KK
  (`>?000B320210015002F`).

Driver gaps (class d):

- **D1** `driver.ps1` did not know "Bicos Bloqueados" (blocked panel at rest) and "Aguarda
  liberação" (lifted, waiting): it took "Bicos Bloqueados" as lifted, so `retirar` did not click
  (DIFF-18: `(0)` on A for the whole case) and `recolocar` timed out, leaving 04 lifted for DIFF-19/20.
  Fixed in `driver.ps1` (PowerShell 5.1, no new dependency) and its README. The pump-sim side now
  clicks like the driver (`clicarBotaoPainel`: idempotent by caption, waits up to 4 s) and, on
  `simulador-2.7.2`, the caption follows the state timer as on the bench.
- **D2** Not fixable: the IDF panel has no control with an HWND (DIFF-14 `?A80`, `?V95`); A skips
  those steps by design.
- **D3** Not fixed: EQUIV-MOTOR #66 lifts 04 and 44 together; the UI has one button per panel. Needs a
  UI measure (M4) before the driver can do it.

Needs re-measure (class m) — exact frames to send on a freshly opened 2.7.2:

- **M1** DIFF-16: `>?00020263` returned an old record (`R4 = 0008`, 17/10 03:40) on the 2.7.2 right
  after `drenar` emptied `&A`; pump-sim said empty. Which pointer does the Horustech 02 read? With
  Modelo = Horustech: one fueling of 04, then `>?00020263`, `(&A)`, `(&I)`, `>?00020263`, `(&A67)`,
  `>?00020667`, `>?00020263`, `(&T99P3C)`.
- **M2** EQUIV-LEITURA `(&LE00148)`: row 1 had `16101956` on the 2.7.2 (the other 31 cells are
  modeled by F5). What writes it? `(&LE00148)` right after opening, then after
  `(&KW126101606143000B7)`, after one fueling of 04 and after `(?C00101010035)`.
- **M3** (masked, F6 duration): reference of the `&E` record duration. One fueling of 04, wait 30 s,
  `(&E0400001000)`, `(&A)` (C4 = 30 s + flow, or since the hang-up?).
- **M4** (D3) the UI with two nozzles of one panel: channel 1, radio pos 0, `retirar` esquerdo, radio
  alt, `GET /estado` (caption of the panel with 44 selected), `retirar` esquerdo, `(&V)`.
- **M5** (new frames, no esperado yet): `>?000B3202200150030` (valid KK, level 2: level modal and the
  ack after the OK?) and `>?000B320210015002F` + `(&T44u)` (#59 level source).

### Steps

| Case | Step | Frame | A (2.7.2) | B (pump-sim r4b) | Class | Action |
| --- | --- | --- | --- | --- | --- | --- |
| DIFF-01 | 3 | `(&S)` | `(SLPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | `(SAPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | b | A1 |
| DIFF-03 | 0 | `(&S)` | `(SLPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | `(SAPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | b | A1 |
| DIFF-03 | 1 | `(&S79)` | `(SLPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | `(SAPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | b | A1 |
| DIFF-03 | 6 | `(&T08L2E)` | `(TL080000192498)` | `(TL080000132694)` | b | A2 |
| DIFF-04 | 0 | `(&S)` | `(SLPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | `(SAPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | b | A1 |
| DIFF-04 | 1 | `(&S)(&V)` | `(SLPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | `(SAPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | b | A1 |
| DIFF-04 | 2 | `(&S)\r\n` | `(SLPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | `(SAPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | b | A1 |
| DIFF-05 | 0 | `(&S)` | `(SLLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | `(SAPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | a | F1 |
| DIFF-05 | 2 | `(&S)` | `(SLPLFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | `(SAPLFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | b | A1 |
| DIFF-05 | 4 | `(&S)` | `(SLPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | `(SAPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | b | A1 |
| DIFF-05 | 5 | `(&S)` | `(SLPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | `(SAPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | b | A1 |
| DIFF-06 | 0 | `(&V)` | `(04000377080002470C000117)` | `(04090662080000910C000091)` | b | A3 |
| DIFF-07 | 0 | `(&A)` | `(00013100011711233A000604171038100…` | `(00011200009112343A000304171038100…` | a | F1+A3 |
| DIFF-07 | 1 | `(&A67)` | `(A00013100011711233A00060417103810…` | `(A00011200009112343A00030417103810…` | a | F1+A3 |
| DIFF-07 | 2 | `(&@66)` | `(@00013100011711233A00060417103810…` | `(@00011200009112343A00030417103810…` | a | F1+A3 |
| DIFF-07 | 3 | `(&A299)` | `…99999900013100011711233A0006041710…` | `…99999900011200009112343A0003041710…` | a | F1+F2+A3 |
| DIFF-07 | 4 | `(&A39A)` | `…99999900013100011711233A0006042610…` | `…99999900011200009112343A0003042610…` | a | F1+F2+A3 |
| DIFF-07 | 6 | `(&A)` | `(00013100011711233A000604171038100…` | `(00011200009112343A0003041710381048)` | a | F3+F1 |
| DIFF-08 | 0 | `(&LR000185)` | `(00045200040311233A000C04171037100…` | `(10182809067511233A041704171037100…` | b | A4 |
| DIFF-08 | 1 | `(&LR050089)` | `(00027700024711233A000404170441100…` | `(00010200009111233A000204170630100…` | b | A5 |
| DIFF-08 | 2 | `(&LC000176)` | `…2G9999999900045200040311233A000C04…` | `…2G9999999910182809067511233A041704…` | b | A4 |
| DIFF-08 | 3 | `(&LC05007A)` | `…999999900027700024711233A000404170…` | `…999999900010200009111233A000204170…` | b | A5 |
| DIFF-08 | 6 | `(&LR000185)` | `(00045200040311233A000C04171037100…` | `(10182809067511233A041704171037100…` | b | A4 |
| DIFF-08 | 7 | `(&LR050089)` | `(00027700024711233A000404170441100…` | `(00010200009111233A000204170630100…` | b | A5 |
| DIFF-08 | 8 | `(&LC000176)` | `…2G9999999900045200040311233A000C04…` | `…2G9999999910182809067511233A041704…` | b | A4 |
| DIFF-08 | 9 | `(&LC05007A)` | `…999999900027700024711233A000404170…` | `…999999900010200009111233A000204170…` | b | A5 |
| DIFF-10 | 1 | `(&T08u57)` | `(TU0800001123000058)` | `(TU080000123400005B)` | a | F1 |
| DIFF-10 | 2 | `(&T08U37)` | `(TU080000112398)` | `(TU08000012349B)` | a | F1 |
| DIFF-11 | 1 | `(&T44L2E)` | `(TL440000026090)` | `(TL44000002218D)` | b | A2 |
| DIFF-12 | 0 | `(&KR1F4)` | `(KR12610160617525098)` | `(KR12610160621331391)` | b | A6 |
| DIFF-14 | 0 | `(?F27GABCDEF01234567890000235900002359FD)` | `…00000000000ABCDEF01234567890000235…` | `…00000000001ABCDEF01234567890000235…` | a | F4 |
| DIFF-14 | 4 | `(?A80)` | `(0)` | `(A11223344556677880417032710000100A3)` | d | D2 |
| DIFF-14 | 5 | `(?F27G11223344556677880000235900002359A3)` | `…0000000000011223344556677880000235…` | `…0000000000111223344556677880000235…` | a | F4 |
| DIFF-14 | 6 | `(?V95)` | `(04000000000000000064)` | `(041122334455667788AC)` | d | D2 |
| DIFF-15 | 3 | `(?F27G0000000000000027000000010000000140)` | `…0000100000100000000000000270000000…` | `…0000100000200000000000000270000000…` | a | F4 |
| DIFF-15 | 4 | `(?F67G0000000000000067000000010000000148)` | `…0000200000200000000000000670000000…` | `…0000200000300000000000000670000000…` | a | F4 |
| DIFF-16 | 0 | `>?00020263` | `>!006B0200000801000000027700024711…` | `>!00020245` | m | M1 |
| DIFF-16 | 1 | `>?00020263\n` | `>!006B0200000801000000027700024711…` | `>!00020245` | m | M1 |
| DIFF-16 | 6 | `>?00020200` | `>!006B0200000801000000027700024711…` | `>!00020245` | m | M1 |
| DIFF-18 | 1 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 2 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 3 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 4 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 5 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 6 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 7 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 8 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 9 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 10 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 11 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 12 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 13 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 14 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 15 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 16 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 17 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 18 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 19 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 20 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 21 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 22 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 23 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 24 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 25 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 26 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 27 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 28 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-18 | 29 | `(&V)` | `(0)` | `(04000000)` | d | D1+C3 |
| DIFF-19 | 1 | `(&V)` | `(0400009108000624)` | `(08000559)` | d | D1+C2 |
| DIFF-19 | 2 | `(&A)` | `(00070000062411233A001208171040100…` | `(00068900055912343A000F08171040100…` | a | F1+C2 |
| DIFF-20 | 0 | `(&A)` | `(00013100011711233A000605171041100…` | `(00004300003911233A000305171041100…` | b | A3+D1 |
| BANCADA-1710 | 0 | `(&S)` | `(SBLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | `(SBLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF… (A = B; both ≠ esperado)` | b | A7+C3 |
| BANCADA-1710 | 2 | `(&T01l47)` | `(TG01000900098E)` | `(TG01000900098E) (A = B; both ≠ esperado)` | b | A7 |
| BANCADA-1710 | 3 | `(&T01L27)` | `(TG01000900098E)` | `(TG01000900098E) (A = B; both ≠ esperado)` | b | A7 |
| BANCADA-1710 | 4 | `(&T04l4A)` | `(Tl0400003724631D)` | `(Tl0400002898001F)` | b | A7 |
| BANCADA-1710 | 5 | `(&T08l4E)` | `(Tl08000000286018)` | `(Tl08000000198923)` | b | A7 |
| BANCADA-1710 | 6 | `(&T04L2A)` | `(TL04003724639D)` | `(TL04002898009F)` | b | A7 |
| BANCADA-1710 | 7 | `(&T08L2E)` | `(TL080000286098)` | `(TL0800001989A3)` | b | A7 |
| BANCADA-1710 | 9 | `(&A67)` | `(A00027700024711233A00040417034010…` | `(A00010200009111233A00020417054510…` | b | A7 |
| EQUIV-LEITURA | 1 | `(&R` | `…REL 14:32:24 16/01/27)(DHA SIM02 V…` | `…REL 14:32:41 16/01/27)(DHA SIM02 V…` | b | A6 |
| EQUIV-LEITURA | 2 | `(&T99P3C)` | `(TG99000100008E)` | `(TG99000000008D)` | a | F1 |
| EQUIV-LEITURA | 4 | `(&T99P3C)` | `(TG99000100018F)` | `(TG99000000008D)` | a | F1 |
| EQUIV-LEITURA | 5 | `(&T04LX82)` | `(TL04003725809D)` | `(TL04002898009F)` | b | A2 |
| EQUIV-LEITURA | 6 | `(&T04DE)` | `(TG040001000181)` | `(TG04000000007F)` | a | F1 |
| EQUIV-LEITURA | 9 | `(&LR000185)` | `(00013100011711233A000604171041100…` | `(10182809067511233A041704171037100…` | a | F1+A3 |
| EQUIV-LEITURA | 10 | `(&LR00010B5)` | `(00013100011711233A000604171041100…` | `(10182809067511233A041704171037100…` | a | F1+A3 |
| EQUIV-LEITURA | 11 | `(&LR$00179)` | `(00013100011711233A000604171041100…` | `(10182809067511233A041704171037100…` | a | F1+A3 |
| EQUIV-LEITURA | 12 | `(&LC000176)` | `…2G9999999900013100011711233A000604…` | `…2G9999999910182809067511233A041704…` | a | F1+A3 |
| EQUIV-LEITURA | 13 | `(&LR000185)` | `(00013100011711233A000604171041100…` | `(10182809067511233A041704171037100…` | a | F1+A3 |
| EQUIV-LEITURA | 14 | `(&LE00148)` | `(16101956000000000000000000000000)` | `()` | m | M2 |
| EQUIV-LEITURA | 15 | `(&LE00C5A)` | `(00000000000000000000000000000000)` | `()` | a | F5 |
| EQUIV-COMANDOS | 14 | `(?F01G1234567890ABCDEF0000000000000000CF)` | `…000030000031234567890ABCDEF0000000…` | `…000030000041234567890ABCDEF0000000…` | a | F4 |
| EQUIV-COMANDOS | 27 | `(&R)` | `…EL 14:30:08 16/10/26)(DHA SIM02 V2…` | `…EL 14:30:06 16/10/26)(DHA SIM02 V2…` | b | A6 |
| EQUIV-COMANDOS | 34 | `(&A299)` | `…000000011233A002C04171042102600000…` | `…000000011203A000004171042102600000…` | a | F2+F6 |
| EQUIV-COMANDOS | 37 | `(&A)` | `…000000011233A002C04171042100001000…` | `…000000011203A000004171042100001000…` | a | F6 |
| EQUIV-COMANDOS | 40 | `(&U0420058917)` | `(U04)` | `(silence)` | c | C1 |
| EQUIV-COMANDOS | 47 | `(&U043000001265)` | `(U?t)` | `(silence)` | c | C1 |
| EQUIV-MOTOR | 2 | `(&S)` | `(SCLFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | `(SCPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | a | F1 |
| EQUIV-MOTOR | 3 | `(&A)` | `(00014500013011233A003404171043100…` | `(00001400001311233A007204171044100…` | b | A3 |
| EQUIV-MOTOR | 7 | `(&V)` | `(04000089)` | `(04000182)` | a | F1 |
| EQUIV-MOTOR | 8 | `(&V)` | `(04000089)` | `(04000221)` | a | F1 |
| EQUIV-MOTOR | 11 | `(&A)` | `(00010000008911233A000A04171043100…` | `(00000200023400123A000804171045100…` | a | F1 |
| EQUIV-MOTOR | 14 | `(&A)` | `(00010000008911233A000F04171043100…` | `(00000200023400123A000C04171045100…` | a | F1 |
| EQUIV-MOTOR | 15 | `(&T04L2A)` | `(TL040012370899)` | `(TL04001238819B)` | a | F1 |
| EQUIV-MOTOR | 18 | `(&S)` | `(SAPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | `(SPPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | a | F7 |
| EQUIV-MOTOR | 19 | `(&V)` | `(44000260)` | `(44000156)` | b | A3 |
| EQUIV-MOTOR | 22 | `(&V)` | `(0)` | `(0400001344000013)` | d | D3 |
| EQUIV-MOTOR | 26 | `(&S)` | `(SAPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | `(SBPFFLLFFLLFFLLFFLLFFLLFFLLFFLLFF…` | a | F7 |
| EQUIV-MOTOR | 29 | `(&A)` | `(00011600010411233A000704171044100…` | `(00000000000000123A000404171045100…` | a | F1+A3 |
| EQUIV-MOTOR | 31 | `(&V)` | `(04000143)` | `(04000013)` | b | A3 |
| EQUIV-MOTOR | 32 | `(&V)` | `(04000195)` | `(04000065)` | b | A3 |
| EQUIV-MOTOR | 36 | `(&V)` | `(04000117)` | `(04000013)` | b | A3 |
| EQUIV-MOTOR | 37 | `(&A)` | `(00014500130011233E000604171044100…` | `(00002900026011233E000204171045100…` | b | A3 |
| EQUIV-PENDENTES | 2 | `>?000B32022001500XX` | `(silence)` | `>!00043200AA` | a | F8 |
| EQUIV-PENDENTES | 4 | `>?000B32021001500XX` | `(silence)` | `>!00043200AA` | a | F8 |
| EQUIV-PENDENTES | 7 | `(&R)` | `(REL 14:34:09 16/10/26)(DHA SIM02 …` | `(REL 14:33:33 16/10/26)(DHA SIM02 …` | b | A6 |

## 21. Diff r5 and r6 triage (17/10)

Source: bench capture, 2026-10-17 (one JSON per case, plus the modal log) from the Windows
bench. Side A = the real SimuladorCBC 2.7.2 started fresh (through `tools/driver-simuladorcbc`), side
B = pump-sim r5 (`simulador-2.7.2`). The partial file holds 17 cases (BANCADA-1710, DIFF-01..16), 134
steps, 14 different, plus 3 IDF steps skipped on A (DIFF-14) and 2 (DIFF-15) with no byte effect.
The modal log has one MessageBox with empty text at 11:45:29, which is DIFF-01 step 2 (`&U` level 2,
"Nível de preço incorreto.", as in §18); DIFF-01 was equal.
Step numbers are the report's `indice` (0-based, `enviar` steps only) of this run; DIFF-11/12/16
now have more steps, so the indices of the next run differ.

### What the run shows about the bench: c:\simcnf.ini is being read

The 2.7.2 drained 0 records at the start, yet BANCADA-1710 read totalizers 04 = 1243,19 L and
08 = 286,0 L, and DIFF-12 listed `&C` grid rows (`(C01F0A040000)` …) that no frame of the run wrote.
That is exactly what Q8 persists (`c:\simcnf.ini`: `&C` lines, totalizers/prices per nozzle, cards;
not the buffer; written when the window closes, read when it opens; K20 `importar_simcnf` reads the same
format). In r4b the file could not be created (§14 #90/#91); in r5 it was, so "started fresh" no
longer means "freshly opened state". Every class-b step below comes from it.

### Classes

| Class | Meaning | Steps |
| --- | --- | --- |
| a | Behavior divergence in pump-sim (fixed as a `simulador-2.7.2` quirk) | 3 |
| b | State / environment | 9 |
| c | Case / script bug | 0 |
| d | Driver gap | 2 |
| m | Needs re-measure | 0 |

### Steps

| Case | Step | Frame | A (2.7.2) | B (pump-sim r5) | Class | Action |
| --- | --- | --- | --- | --- | --- | --- |
| BANCADA-1710 | 4 | `(&T04l4A)` | `(Tl04000012431918)` | `(Tl04000000000004)` = esperado | b | E1 |
| BANCADA-1710 | 5 | `(&T08l4E)` | `(Tl08000000286018)` | `(Tl08000000000008)` = esperado | b | E1 |
| BANCADA-1710 | 6 | `(&T04L2A)` | `(TL040012431998)` | `(TL040000000084)` = esperado | b | E1 |
| BANCADA-1710 | 7 | `(&T08L2E)` | `(TL080000286098)` | `(TL080000000088)` = esperado | b | E1 |
| DIFF-11 | 2 | `(&T0AL37)` | `(TG0A000100018E)` | `(TG0A000000008C)` | b | S1 |
| DIFF-11 | 4 | `(&TC4L3D)` | `(TGC40001000194)` | `(TGC40000000092)` | b | S1 |
| DIFF-12 | 4 | `(&R)` | 4 rows per channel (`F0A` on addresses 3–4, none in channel 5) | 2 rows per channel (+ `C01W3A030000`) | b | S2 |
| DIFF-14 | 4 | `(?A80)` | `(0)` | `(A1122334455667788…)` | d | D2 of r4b |
| DIFF-14 | 6 | `(?V95)` | `(04000000000000000064)` | `(041122334455667788AC)` | d | D2 of r4b |
| DIFF-16 | 0 | `>?00020263` | `>!006B02000003…75` (R4 0003, R$ 0,50, 17/10 11:46) | `>!00020245` | a | F1 |
| DIFF-16 | 1 | `>?00020263\n` | same as step 0 | `>!00020245` | a | F1 |
| DIFF-16 | 2 | `>?00020667` | `>!000E06000003000003A2` | `>!000E06000002000002A0` | b | S3 |
| DIFF-16 | 3 | `>?00020667\n` | `>!000E06000003000003A2` | `>!000E06000002000002A0` | b | S3 |
| DIFF-16 | 6 | `>?00020200` | same as step 0 | `>!00020245` | a | F1 |

### Actions

Behavior (class a), `simulador-2.7.2` only:

- **F1** `HORUSTECH_272`: the 2.7.2 `02` has no "empty" test. It reads the grid cell at the read
  pointer even when read = write and does not pop (two `02` give the same record; the wrong KK too).
  This is M1 of §20, measured by the A-side frames: after the DIFF-15 drain, read =
  write = 3 (the `06` reply) and `02` returned R4 0003 = the 3rd record of DIFF-06 (R$ 0,50, nozzle
  0C, totalizer 7,93 → 8,37 L), left in row 3 because "Carregar configuração padrão" rewinds the
  pointers but keeps the rows (PADRAO_272). The r4b frame (R4 0008, `06` = 8/8) fits the same rule.
  A never-written cell still gives `>!00020245` (bench 17/10, `golden-diff-1710`). Code:
  `src/protocols/horustech/handlers.ts` (`leitura`). Real profiles unchanged (pop at the read
  pointer, empty when read = write).

State / environment (class b):

- **E1** BANCADA-1710: the 2.7.2 reloaded totalizers from c:\simcnf.ini. B gave the bench `esperado`
  on all four. **Not fixed in the case**: zeroing with `&E` stores records on A only (E_272 stores
  one only when the value changes), and rewinding them with "Carregar configuração padrão" leaves
  the identified-records pointer ahead (#78), so `(&A67)` would no longer be `(0)` and `(&T01…)` would no longer be
  `TG01 0000 0000`: the case cannot rebuild "freshly opened" through the protocol. Bench
  prerequisite instead: with the 2.7.2 closed, delete `c:\simcnf.ini`, then open it (closing it
  writes the file again).
- **S1** DIFF-11: `&T0A`/`&TC4` reply `TG BB write−1 read−1`. A's `&E44` (or `&EC4`) stored a record
  because that totalizer came non-zero from simcnf.ini (A drained 1 record, B 0), so A's pointers
  were one ahead. The case now clicks "Carregar configuração padrão" after the zeroing: pointers back
  to 1 on both, whatever the history.
- **S2** DIFF-12: the `(C…)` rows of `&R` are the raw `&C` texts of the grid (C_272, #36), reloaded
  from simcnf.ini on A; the default configuration does not touch addresses 3–4. The case now writes
  `(&CW0c3A0a0000)` for addresses 3 and 4 of the 8 channels (0 nozzles, so `&S` stays `FF` there, as
  in DIFF-05) before the clock steps. Both targets keep those 16 rows afterwards (A persists them).
- **S3** DIFF-16 `06`: the pointer value (3 × 2) is the S1 extra record carried over. DIFF-16 now sets
  its own grid: `zerarEncerrantes('04')`, "Carregar configuração padrão", two R$ 1,00 fuelings
  (rows 1–2), the button again (pointers to 1, rows kept), one more fueling (row 1), then a `02`
  with read 1 × write 2, `drenar`, and the original frames (read = write = 2, stale row 2). The
  record replies mask only the hex duration C4, the hh:mm and the KK (`relogioHorustech02`).

Driver (class d):

- **D2** of r4b, unchanged: the IDF panel has no control with an HWND, so A skips the card steps and
  `?A80`/`?V95` differ by design.

### Implementation notes (revisable)

- F1 extends `HORUSTECH_272` instead of a new quirk id (same rule as §18: existing quirks extended).
- The pointer the `02` reads is taken as the read pointer. The bench only had read = write
  (r4b 8/8, r5 3/3), so read and write cannot be told apart from the data; the new DIFF-16 step
  `>?00020263` with read 1 × write 2 measures it on the next run (pump-sim answers row 1; row 2 on the
  2.7.2 would mean the write pointer).
- BANCADA-1710 is left as it is (see E1) and the environment fix goes to the bench procedure.
- DIFF-12 normalizes addresses 3–4 to `W3A…0000`, not to A's `F0A…`: a known value is what matters,
  and `F` is not a type the 2.7.2 offers in the UI.
- `test/diff-api-mcp.test.ts`: DIFF-16 left `CASOS_SEM_ESPERA` (it now fuels, ~22 s of real-time
  waits); it runs on a manual clock in `test/diff-r5.test.ts`, against an A pre-dirtied like the bench.

### Re-measure (no step blocked on it)

- **M1b** (in the script now): DIFF-16 `>?00020263` right after the 3rd fueling, read 1 × write 2.
  Row 1 (R4 0001) = read pointer, as modeled; row 2 (R4 0002) = write pointer.
- BANCADA-1710 after deleting `c:\simcnf.ini`: expected A = esperado on steps 4–7.

### Not fixed

- BANCADA-1710 steps 4–7 (E1, bench prerequisite).
- DIFF-14 steps 4/6 (D2).
- Other simcnf.ini effects outside this partial file (cards, prices, and the cases after DIFF-16)
  were not checked: the run stopped at DIFF-16.

Test: `test/diff-r5.test.ts`.

### DIFF-17R / DIFF-13R: the buffer wrap and the identified-records pointer without hours of fuelings (17/10)

Why: DIFF-17 fills the buffer with 1001 fuelings through the screen: ~2 h on the real 2.7.2
(~8/min in Rápido) and ~1h40 on the pump-sim side because it waited in real time.

Normative (not re-evaluated): verdict #27 (`MS_272`), `&M S` on a stopped nozzle stores a ghost
record repeating its last fueling.

What changed (`src/diff/roteiros.ts`, `src/diff/executor.ts`, `src/net/cliente-tcp.ts`; test
`test/diff-17r-13r.test.ts`):

| # | Change | Why |
| --- | --- | --- |
| R1 | **DIFF-17R** (default run): `drenar`, `&E` zeroes 04/44/05, "Carregar configuração padrão" (pointers at 1), three real R$ 1,00 fuelings through the screen (04, 44, 05), **995** `&M S` ghosts, three more real fuelings = **1001** records; then `(&T99P3C)`, `&LR0999/0001/0002/0003`, `(&A)`/`(&I)`/`(&A)`, `(&T99P3C)`, Horustech `06`, and the button again | Positions and contents are equal on both targets; ending with the button leaves the pointers at 1, so the next case does not drain ~1000 records (~2000 frames) |
| R2 | **Ghosts go in rounds, not back to back.** `MS_272` (verdict #27 as written in this file) sets C at once and the *next state tick* stores. A 2nd `&M S` on the same nozzle before that tick finds it in C and stores nothing. So each round sends one `&M S` per nozzle (each waits for its `(Mbb)`) and then waits `TICK_FANTASMA_MS` = 1500 ms; The state timer stores every nozzle in C on the same tick | "Back to back" on one nozzle gives ~1 record per tick, not 1 per frame: the 995 would not fill the buffer |
| R3 | DIFF-17R ghosts only on 04/44/05, the nozzles it fuels itself | A ghost repeats the nozzle's last fueling (`Bico.ultimo`); any other nozzle on the bench 2.7.2 carries an unknown fueling from earlier rounds |
| R4 | **DIFF-13R** (opt-in, verdict #13): on **freshly opened** targets, 9998 ghosts over the 32 default nozzles (32 per tick), `(&T99P3C)`, the 9999th ghost (identified-records pointer = 10000), `(&T99P3C)`, one more, `(&T99P3C)`, Horustech `06`, the button. Expected on `simulador-2.7.2`: `TG99 0008 0009` → `TG99 0000 0010` → `TG99 0001 0010` (the TG default is write − 1, read − 1) | That pointer counts every record since the target opened and nothing resets it, so the case only means something run alone on both targets fresh. Only pointers are compared (the per-tick store order of the 32 nozzles is not read) |
| R5 | `CasoDiff.opcional` (reason text): `todos` leaves the case out; naming it in `--casos` or `OpcoesRoteiro.incluirOpcionais` runs it. **DIFF-17** (unchanged) and **DIFF-13R** are opt-in | A plain run never takes hours |
| R6 | Executor: `aguardar` on a pump-sim target whose control API reports a manual clock (`get_estado_simulador` → `relogio.manual`, probed once per run; `AlvoDiff.relogioManual` forces it) becomes `avancar_tempo`, including the panel-button polling | Side B never waits in real time. It uses the existing `avancar_tempo` (control API, `--relogio-manual`); nothing in `src/control` changed. `OpcoesDiff.esperar` (tests) still wins; a driver target or a failed probe keeps the real wait |
| R7 | `PassoEnviar.terminaEm` / `OpcoesTroca.terminador`: the reply ends when its last byte is `)`, instead of after 150 ms of silence. Used only on the `&M S` frames | 10000 frames × 150 ms idle = 25 min per side of pure waiting |

Bench usage: start the pump-sim side B with `--relogio-manual` (existing flag) so R6 applies;
`--casos DIFF-17` / `--casos DIFF-13R` for the opt-in cases. Restart the 2.7.2 (and B) right before
DIFF-13R.

Expected bench duration (pump-sim latency measured, 2.7.2 latency **unknown**):

| Case | Frames | Ticks waited | Bench A ≈ | pump-sim × pump-sim (test) |
| --- | --- | --- | --- | --- |
| DIFF-17R | 995 `&M S` + ~25 others, 6 fuelings through the driver | 332 × 1.5 s ≈ 8.3 min | ~9–10 min + 995 × L272 (+ the start drain on a dirty A) | ~1.7 s for both sides |
| DIFF-13R | 10000 `&M S` + ~8 others | 315 × 1.5 s ≈ 7.9 min | ~8 min + 10000 × L272 | ~1.0 s for both sides |

pump-sim per frame (loopback, `&M S` with `terminaEm`): ~0.05 ms (20000 frames + ~630
`avancar_tempo` in ~1 s). L272 is the 2.7.2 reply latency per frame: at 20 ms DIFF-13R adds
~3.3 min, at 100 ms ~17 min.

Implementation notes (revisable):
- Rounds of one `&M S` per nozzle + 1500 ms instead of back-to-back frames (R2), and multiple nozzles
  per tick (R3/R4). The latter relies on the model's state timer storing every nozzle in C on one tick
  (from the equivalence analysis, not measured on the bench). If a bench run shows fewer records than expected, rerun with
  a single nozzle per round (DIFF-17R ~25 min, DIFF-13R ~4 h) — `fantasmas(n, ['04'])`.
- DIFF-17R is in the default run; DIFF-17 and DIFF-13R are opt-in.
- The executor probes the clock automatically (R6) rather than adding a CLI flag (the CLI was out of
  scope for that change).

Not done:
- No CLI flag for `relogioManual`, no `--casos` help text for the opt-in cases, no README/DECISIONS.md
  entry at the time (out of scope for that change). §14 still says "#13 has no case in the script".
- ~~`drenar` still waits 150 ms idle on each `(&A)` and 300 ms on each `(&I)`: ~0.45 s per record, ~7.5 min
  for a full 2.7.2 buffer. Not touched (shared by every case).~~ Done in §25 (T4).
- The `equivalencia-rodada` "every case with an action" run no longer covers DIFF-17 (opt-in); DIFF-17
  with N = 3 is covered in `test/diff-17r-13r.test.ts`.

### r6 bench run (17/10)

Source: bench capture, 2026-10-17 (report, partial cases, log, modal log) from the Windows bench.
Side A = a **fresh** real SimuladorCBC 2.7.2 (PID 23704, opened ~13:22, run from 13:23:58; it opens
with no nozzle configured and the bench clicked "Carregar configuração padrão" right after opening),
side B = pump-sim r6 (`simulador-2.7.2`, real-time clock). 24 cases (no DIFF-17/DIFF-30), 333 steps,
304 compared: 290 equal, 14 different (+ the 29 `informativo` DIFF-18 steps). Normative: this run is
the top authority for `simulador-2.7.2`. DIFF-30 skipped (no console on 1771).

Confirmed, no change: #55 silent, E3 silent + modal (`''$XX''`), and DIFF-16 M1b: with read 1 ×
write 2 the 2.7.2 `02` returned R4 0001, the **read** pointer, as modeled (step 4 equal).

#### Classes

| Class | Meaning | Steps |
| --- | --- | --- |
| a | Behavior divergence in pump-sim (fixed as a `simulador-2.7.2` quirk) | 8 |
| b | State / environment / timing window | 2 |
| c | Case / script bug | 0 |
| d | Driver gap | 3 |
| m | Needs re-measure | 1 |

A step is counted once, by its behavior cause when it has one (script changes that came with a fix
are listed with it).

| Case | Step | Frame | A (2.7.2) | B (pump-sim r6) | Class | Action |
| --- | --- | --- | --- | --- | --- | --- |
| DIFF-08 | 4, 10 | `(&LC000176)` | PAF `bb cc tt` = `000000` | `010000` | a | G1 |
| DIFF-12 | 20 | `(&R)` | `REL 14:30:01 16/01/27` | `REL 14:30:00 16/13/26` | b | S1 |
| DIFF-14 | 4 | `(?A80)` | `(0)` | the card | d | D2 of r4b |
| DIFF-14 | 6 | `(?V95)` | `(04000000000000000064)` | `(041122334455667788AC)` | d | D2 of r4b |
| EQUIV-LEITURA | 17 | `(&LE00148)` | `(17101322` + 24 zeros`)` | 32 zeros | a | G2 |
| EQUIV-MOTOR | 6 | `(&S)` | `(SCP…)` | `(SCL…)` | b | S2 |
| EQUIV-MOTOR | 27 | `(&V)` | `(0)` | `(0400000044000000)` | d | #66 skipped on A (one button per panel) |
| EQUIV-MOTOR | 31 | `(&S)` after `&M04B` | `(SBP…)` | `(SAP…)` | m | M1 |
| EQUIV-MOTOR | 34 | `(&A)` (#26) | 0,299 L, 23 ticks | 0,026 L, 2 ticks | a | G3 + G4 (residual b) |
| EQUIV-MOTOR | 41 | `(&V)` (#74) | `(04000364)` = 28 ticks | `(04000039)` = 3 ticks | a | G3 + G4, script S3 |
| EQUIV-MOTOR | 42 | `(&A)` (#74) | 0,390 L | 0,039 L | a | G3 + G4, script S3 |
| EQUIV-PENDENTES | 5 | `(&T44U37)` | `(TU440000212399)` | `(TU44150021239F)` | a | G5 |
| EQUIV-PENDENTES | 6 | `(&T44u57)` | `(TU4400002123000059)` | `(TU441500212300005F)` | a | G5 |

DIFF-14 steps 4/6 are a consequence of the 3 IDF UI steps skipped on A (class d, checked before
changing anything): B presented the card and turned the sensor on through the control API, A did
neither, so A's `?A80` has no card and its `?V95` shows nozzle 04 with a zero card. No behavior change.

#### Where the EQUIV-MOTOR volumes came from (the "start delay" question)

The root was not an unmodeled start delay. Two pump-sim behaviors, both visible in DIFF-18 (the
`(&V)` samples are 1 ms + 150 ms idle + 100 ms wait ≈ 255 ms apart, real time on both sides):

- **Speed.** A gained 2–3 ticks of 13 per sample (≈ 104 ms per tick); B gained ~0.86 per sample
  (≈ 300 ms). DIFF-18 clicks "Normal": on the 2.7.2 "Normal" is already checked at load (its click handler
  never fired, so the flow timer keeps its initial 100 ms), and the driver only clicks a radio that is not
  checked (`driver.ps1`, `velocidade`); either way nothing changes. pump-sim switched to 300 ms, and
  every later case ran at a third of A's flow: #74 3 s → 10 ticks − 7 blinks = 3 (B) × 28 (A).
- **Caption.** A's volume rises from the moment the driver's `retirar` returns: 2 ticks in the 1st
  255 ms sample of DIFF-18, 28 ticks in the 3 s of #74 (start within ~0.1 s of the return), 23 ticks in
  the 2.5 s before `&M B` in #26. The driver returns when the caption leaves the rest set, and every
  A action reads `'Retirar Bico' -> 'Abastecendo..'`, so the 2.7.2 shows "Abastecendo.." when the
  flow starts, after the blinking ticks. pump-sim showed it at the state-tick start, so its mirror returned
  7 ticks early. The click → flow time (state tick ≤ 1 s + 7 blinks, the fueling probe attempt 3: 1,27 s) was
  already modeled; the ~2,5 s of the driver test log adds the driver's tab switches.

The duration C4 (a masked clock field) was A = B + 1 s in all four R$ 1,00 records of the run; with
the caption fix B hangs up as much later as A does, which should close it (not measured).

#### Fixes

Behavior (class a), `simulador-2.7.2` only, existing quirks extended:

- **G1** `C_272`: the PAF `bb` field is the 1st `&c` field (`Bico.campoPista272`), `00` until a `&c`
  (fresh A: `…0000000089 0000000000 00 00 00 00000000…`; DIFF-07 later read `113322` after its `&c`,
  and the button did not clear it). The lane number (`numeroPista`) is still assigned for the control
  API's `{numero}` and stays in the PAF of the real profiles. Code: the record in
  `src/core/concentrador.ts`.
- **G2** `L_272`: `&LE` column 0 row 1 = `DDMMhhmm` of the PC clock when the simulator was opened
  (`Concentrador.ligadoEmMs`, kept in snapshots). r6 read `17101322` after a `&KW` to 16/10 14:30, so it
  is not the RTC; r4b's `16101956` fits a 2.7.2 open since the evening before. Every other cell stays
  `00000000`. The case masks only the hh:mm (`[5, 9)`); the day/month is compared.
- **G3** `VAZAO_272`: the speed radio is state (`radioVelocidade`, `normal` at start with the 100 ms
  tick); selecting the radio already checked changes nothing. Rápido → 150 ms, then Normal → 300 ms
  (the OnClick; not measured). A numeric speed (control/snapshot) sets the tick and leaves the radio.
- **G4** Caption (`statusTextual` with `legendaPorTick`, the 2.7.2 mirror): "Abastecendo.." only once
  the nozzle fuels **and** the blinking ticks are over; before that the panel keeps its rest caption
  ("Retirar Bico" / "Bicos Bloqueados"). The UI button and `clicarBotaoPainel` follow it. Real profiles
  unchanged ("Abastecendo.." at the start).
- **G5** `HORUSTECH_272`: the 32 with a valid KK still validates and converts everything (E9/E8
  modals, silence without a nozzle, the level modal) and acks `>!00043200AA`, but stores no price
  (measured: `>?000B320210015002F` left 44 at `TU440000212399`, levels 1 and 0 untouched).

Script (`src/diff/roteiros.ts`):

- **S1** DIFF-12: `aguardar 1500` between the month-13 `&KW` and `&R`, and the `&R` time masked
  (`RELOGIO_R`). A's `&R` 1 ms after the `&KW` had already ticked (14:30:01 and month 13 → 01/27), so
  its clock phase is free-running (the tick came within ~150 ms of the write); pump-sim ticks 1 s after
  the write (RTC_272, §13 #40, "B: the real phase is unknown"). Both roll after 1,5 s; the date is
  compared. The phase is not modeled (unknowable per run; the step 9 capture's `&KR1` samples fit both).
- **S2** EQUIV-MOTOR: `aguardar 1500` after the 2nd "Carregar configuração padrão" (F1 of §18: address
  2 is L until the next state tick restores its P; A's tick had come, B's had not).
- **S3** EQUIV-MOTOR #74: R$ 3,00 preset and 8 s (0,267 L = 21 ticks: 2,1 s at 100 ms, 6,3 s at
  300 ms), so `&V` and the record are the frozen preset volume on both targets. The step itself (13
  per tick with 3 volume decimals and a preset, not 12,9) is the r6 A frame `(04000364)` = 28 ticks,
  pinned in `test/diff-r6.test.ts`.
- #26 (EQUIV-MOTOR): a 2nd `(&S)` 1,2 s after `&M04B` (re-measure M1). The free-flow record of #26 is
  kept on purpose (the volume at the freeze is what the case measures): after G3/G4 it can still
  differ by a tick or two (the flow timer phase, driver polling 100 ms), class b.
- EQUIV-PENDENTES: `&T04u` and `&T08u` after the 32, to see whether 15,00 went to another nozzle.
- Default grid: a fresh 2.7.2 has no nozzles. DIFF-09, DIFF-12, DIFF-13, DIFF-14 and DIFF-15 now
  start with "Carregar configuração padrão" like the others (DIFF-01, 03–08, 10, 11, 16–20, 17R, 13R
  and every `EQUIV-*` already did). Left without it: BANCADA-1710 (assumes the freshly opened state
  the bench prepares, button included), DIFF-02 (no frame depends on a configured nozzle: invalid mode,
  nonexistent nozzle, the card registry) and DIFF-30 (real console).

Tests changed with this citation: `test/horustech.test.ts` (the 32 asserted level 1 pending = 1500),
`test/equivalencia-leitura.test.ts` (`(&LE00148)` asserted 32 zeros), `test/control.test.ts` K25
(asserted "Abastecendo.." while blinking), `test/diff-acoes.test.ts` and `test/diff-api-mcp.test.ts`
(DIFF-14 action list now starts with `config_padrao`). New: `test/diff-r6.test.ts` (11 tests, with a
real-profile mirror per fix). Scoped run (`tsc --noEmit` + golden/equivalencia/diff/identfid/horustech):
425 → 436 tests, 17 → 18 files, all green; `control`, `sanidade`, `revisao`, `ui-api`: 89 green.

#### Implementation notes (revisable)

- G1 as a separate PAF field instead of zeroing the lane number: zeroing it broke the control API's
  `{numero}` lookup on `simulador-2.7.2`. `&C` with n = 0 also zeroes the field (as it zeroed the lane
  number; not measured).
- G2 takes the opening instant; the data does not separate "opened" from "first click on the button"
  (both ~13:22 in r6). See M2.
- G3 starts the radio on Normal only with `VAZAO_272`; Rápido → Normal = 300 ms follows the equivalence analysis,
  not a measure (M3). The Web UI still derives the selected speed from the tick (shows none at 100 ms).
- G4: the rest caption during the blinking ticks (not "Aguarda liberação": every A transition read
  `'Retirar Bico' -> 'Abastecendo..'`, and the driver would have returned at "Aguarda liberação").
- The clock phase (S1) is not made free-running in the model.
- #74 compares a frozen preset volume instead of a free-flow sample; the step property lives in the test.

#### Re-measure

- **M1** (in the script now) EQUIV-MOTOR #26: with 04 fueling, `(&M04B19)` then `(&S)` at once and
  again 1,2 s later. r4b read `(SAP…)`, r6 `(SBP…)` at once, both with 04 fueling (8 and 23 ticks). If
  the 2nd read is B and the 1st A on the next run, the letter changes on the state tick after `&M B`
  (F7 holds only before it); if both are B, F7 (#26 part) is wrong. pump-sim keeps F7 until then.
- **M2** `&LE` event: open the 2.7.2, wait ≥ 2 min, click "Carregar configuração padrão", then
  `(&LE00148)`. hh:mm = opening → G2 as modeled; = the click → the button's event.
- **M3** Speed after Rápido → Normal: `velocidade Rápido`, `velocidade Normal`, then the DIFF-18
  sampling (300 ms expected).
- **M4** (in the script now) #59: `(&T04u…)`/`(&T08u…)` after the 32; 15,00 on either means the price
  went to another nozzle instead of nowhere.

#### Not fixed (expected to stay different on the next run)

- DIFF-14 steps 4/6 and EQUIV-MOTOR #66 `&V` (d: IDF panel and two nozzles on one panel are outside
  the driver).
- EQUIV-MOTOR #26 `&S` after `&M B` (M1) and its free-flow record (± 1–2 ticks, b).
- DIFF-18 stays `informativo`; its samples should now grow at the same rate on both sides.

## 22. Icon, executable branding, profile validation labels and site guard (17/10)

| # | Decision | Where |
| --- | --- | --- |
| I1 | The mark is the amber seven-segment "P" on graphite (maintainer's choice, option 1b). `ui/icone.svg` is the single source; the site favicon, the 32 px and 180 px PNGs and the Windows `.ico` (16, 24, 32, 48, 64, 128, 256 px, PNG entries) are generated from it by `tools/gen-icons.mjs` (headless Chrome over the DevTools protocol, no image library) and committed, so the build never needs Chrome | `ui/icone.svg`, `site/assets/`, `tools/icon/pump-sim.ico`, `tools/gen-icons.mjs` |
| I2 | The apple-touch icon is drawn full-bleed (no rounded corners): iOS applies its own mask, and transparent corners would show black | `tools/gen-icons.mjs` |
| I3 | The top bar mark is the same SVG (`<img class="brand-mark">`), in the UI and on the site | `ui/js/app.js`, `site/index.html`, `tokens.css` |
| I4 | The executable gets the icon and a pump-sim version resource (ProductName `pump-sim`, FileVersion/ProductVersion from `package.json`, CompanyName "Gabriel Martinusso", OriginalFilename `pump-sim-win-x64.exe`) through `resedit` 3.1.0, a pure-JS PE resource editor (dev dependency, pinned; no wine/rcedit, runtime dependencies unchanged). It runs **after** postject: rewriting `.rsrc` while `.reloc` still follows it moved `.reloc` and left `.rsrc` with a raw size above its virtual size, and postject then reported "Relocation corrupted". After postject `.rsrc` is the last section. The build reads the PE back and fails unless the icon group, the version strings, the `NODE_SEA_BLOB` resource (same size as the blob) and the flipped fuse are all there | `tools/build-sea.mjs` (`marcar`, `conferir`) |
| P1 | Each profile states where its behavior comes from: `simulador-2.7.2` is "measured against the real SimuladorCBC 2.7.2"; the six real profiles are "per the manual, not validated on hardware", each with its manual reference (DT435 p.x, DT432, DT277). Shown as a badge per row in Configuração, in the README profiles table and on the homepage (PT/EN). Display only: the profile data and the API output are unchanged | `ui/js/telas/config.js` (`ORIGEM`), `README.md`, `site/index.html`, `site/js/i18n.js` |
| W1 | Neutral wording (maintainer's decision): comments, tests and docs describe behavior as "measured on the bench" or "behavioral equivalence" and cite no binary addresses, no names that only exist inside the binary (fields, form components, timers) and no unpublished files; case ids (DIFF-xx, verdict #n, B2, E3…) are kept. The timers are named by role: the 1 s state tick, the 100 ms flow timer, the clock timer. The diff triage notes moved here as §20 and §21 | this file, `src/diff/roteiros.ts`, `src/profiles`, `test/` |
| W2 | Delphi runtime names that describe a parsing rule (`StrToInt`, `FloatToStr`, `TServerSocket`) are kept: they are public library semantics, not names taken from the binary | §12–§14 |
| G1 | `test/site-sem-origem-externa.test.ts` gates site/ and ui/: an http(s) URL is allowed only as an `<a href>` (or visible text, such as a command to copy) to a documentation host (github.com, signpath.org, about.signpath.io), as loopback or the `host:porta` placeholder, or as an XML namespace; CSS and SVG may reference none, JS only as display text. Markdown and the font license texts are not loaded by any page and are not scanned | `test/site-sem-origem-externa.test.ts` |
| D1 | The bench driver treats "Retira Bico" (no "r", shown by a freshly created panel, at start or right after "Carregar configuração padrão") as at rest, like the Go driver; the TypeScript and UI caption sets follow, so `test/diff-r4b.test.ts` keeps them equal. pump-sim never shows that caption, so nothing changes on the pump-sim side | `tools/driver-simuladorcbc/driver.ps1`, `src/diff/acoes.ts`, `ui/js/fmt.js` |

## 23. r7g bench run (17/10)

Source: bench capture, 2026-10-17 (report, partial cases, log, modal log) from the Windows bench.
Side A = the real SimuladorCBC 2.7.2 through the new Go driver, side B = pump-sim (`simulador-2.7.2`)
on a **manual clock** (`--relogio-manual`, R6 of §21). 1322 steps compared: 1309 equal, 13 different
(+ the 29 `informativo` DIFF-18 steps). Normative: this run is the top authority for `simulador-2.7.2`.
Step numbers are the report's `indice` (0-based, `enviar` steps only) of this run.

### Classes

| Class | Meaning | Steps |
| --- | --- | --- |
| a | Behavior divergence in pump-sim (fixed as a `simulador-2.7.2` quirk) | 5 |
| b | State / environment / timing window (B's manual clock, free flow) | 5 |
| c | Case / script bug | 0 |
| d | Driver gap | 3 |
| m | Needs re-measure | 0 |

| Case | Step | Frame | A (2.7.2) | B (pump-sim) | Class | Action |
| --- | --- | --- | --- | --- | --- | --- |
| DIFF-14 | 4 | `(?A80)` | `(0)` | the card | d | X1 |
| DIFF-14 | 6 | `(?V95)` | `(04000000000000000064)` | `(041122334455667788AC)` | d | X1 |
| DIFF-17R | 1006 | `&LR0999` | E10 `0000029741` | `0000029726` | a | B1 |
| DIFF-17R | 1007 | `&LR0001` | E10 `0000015732` | `0000015731` | a | B1 |
| DIFF-17R | 1008 | `&LR0002` | E10 `0000029652` | `0000029637` | a | B1 |
| DIFF-20 | 6 | `(&A)` | hh:mm 14:49 | 14:46 | b | S1 |
| EQUIV-MOTOR | 27 | `(&V)` (#66) | `(0)` | `(0400019544000195)` | d | X1 + S2 |
| EQUIV-MOTOR | 31 | `(&S)` after `&M04B` | `(SBP…)` | `(SAP…)` | a | B2 |
| EQUIV-MOTOR | 33 | `(&S)` a state tick later | `(SBP…)` | `(SAP…)` | a | B2 |
| EQUIV-MOTOR | 35 | `(&A)` (#26) | R4 0005, 0,299 L (23 ticks), E10 655 | R4 0007, 0,325 L (25 ticks), E10 876 | b | S2 (R4/E10) + residual |
| EQUIV-MOTOR | 43 | `(&A)` (#74) | R4 0007, E10 1011 | R4 0009, E10 1232 | b | S2 + S3 |
| EQUIV-PENDENTES | 1 | `(&S)` | `(SLP…)` | `(SLL…)` | b | S4 |
| EQUIV-PENDENTES | 3 | `(&S)` | `(SLP…)` | `(SLL…)` | b | S4 |

The DIFF-17R record clock (B 3 min behind A, manual clock) was already masked by `relogioRegistro`
(C4 and hh:mm; day and month are compared): only E10 differed there, so no clock change was needed.

### Fixes

Behavior (class a), `simulador-2.7.2` only, existing quirks extended:

- **B1** `VAZAO_272`: a volume frozen at preset/price keeps its sub-mL part and the totalizer adds the
  unrounded value. The three `&LR` E10 fit it exactly: 04 and 05 at 1,123 R$/L give 890,47 mL per
  R$ 1,00 record, 334 records (1 real + 332 ghosts + 1 real) = 297 417 mL → `0000029741` (B summed
  334 × 890 = `0000029726`), 333 records on 05 → `0000029652`; 44 at 2,123 gives 471,03 mL,
  334 records → `0000015732`. A step of 0,1 mL does not fit (334 × 890,4 → 29739; 334 × 890,5 →
  29742), so the 2.7.2 keeps (at least) hundredths of a mL; pump-sim keeps the exact quotient.
  The displayed fields still truncate (L6 `000089`, `&V`, `&T`). The fraction lives in
  `Bico.encerranteFracMl` (carried by the `&M S` ghost through `UltimoAbastecimento.volumeFracMl`);
  `&E`, the control API totalizer import and a zero-nozzle `&C` reset it. `&E` to the same whole
  value counts as a change while a fraction is held (the 2.7.2 compares the unrounded totalizer:
  inference, not measured), so it stores its record. Code: `src/core/concentrador.ts`
  (`somarEncerrante`, the preset freeze in the flow timer, `finalizar`, `gravarEncerrante272`).
  Real profiles unchanged (integer mL, no fraction field).
- **B2** `BICO_272` (F7 of §20, #26 part refuted): with the nozzle that is fueling frozen in B by
  `&M B`, the `&S` letter is B, right after the frame and again a state tick later (r6 read `(SBP…)`
  at once; r7g read `(SBP…)` both times, which was M1's rule for "F7 #26 is wrong"). The r4b
  `(SAP…)` is taken as the outlier (dirty start; not explained). The #68 part (A while a nozzle
  fuels with another in P) stays: r7g step 23 equal. Code: `letraDoLado`.

Script and executor:

- **X1** Executor (`src/diff/executor.ts`): `PassoEnviar.dependeDe` names the `rotulo` of earlier
  `manual`/`acao` steps. When one of them was skipped on either target, the step is reported with
  `pulado` ("depende de …, pulado em A") and counts neither as equal nor as a divergence
  (`ResultadoCaso.passosPulados`, `total.pulados`; the terminal report marks it `~`, the UI "pulado").
  The replies are kept in the report. Used on DIFF-14 `?A80`/`?V95` (`idf`) and EQUIV-MOTOR #66 `&V`.
- **S1** DIFF-20 step 6: the 2nd `(&A)` masks the record clock fields (`relogioRegistro`).
- **S2** EQUIV-MOTOR #66 moved to the end of the case (after #92). A cannot lift 04 and 44 together
  (one button per panel), so B stored two records A did not: every later R4 was 2 ahead and the
  totalizer of 04 1,95 L ahead (#26 and #74 records).
- **S3** EQUIV-MOTOR: `zerarEncerrantes('04')` after the #26 record, so the #74 record E10 does not
  carry the #26 free-flow difference.
- **S4** EQUIV-PENDENTES: `aguardar 1500` right after "Carregar configuração padrão". Address 2 carries
  its pre-authorization from EQUIV-MOTOR on both targets (EQUIV-MOTOR steps 49–52 equal, `SLP`); the
  button leaves it L until the next state tick (F1 of §18). A's tick came during the 1,5 s `?F00L`
  timeout; B's manual clock only moves on `aguardar`, so B stayed L for the whole case.

### Implementation notes (revisable)

- B1 extends `VAZAO_272` (it is the preset freeze of that quirk) instead of a new quirk id.
- B1 keeps the fraction in a separate field instead of making `encerranteMl` fractional: every
  consumer (`&T`, E10/i10, control API, snapshot) keeps an integer.
- B2 falls back to the first status ≠ L when the only fueling nozzle is in B. A fueling nozzle in E
  (`&M P`) keeps the A letter as before (not measured).
- X1 reports the step as skipped when the dependency is skipped on **either** side.

### Residual (no change)

- EQUIV-MOTOR #26 record volume: A 23 ticks × B 25 in the 2,5 s before `&M B` (r6 also 23 on A).
  B is exact on a manual clock (2500 ms / 100 ms). Kept as the documented ± 1–2 tick free-flow
  window (§21); the case still compares it on purpose.
- DIFF-18 (`informativo`): B gains 1 tick per sample because its manual clock only advances on the
  `aguardar 100`, not during the 300 ms reply window; A gains 2–3. The rates are not comparable with
  B on a manual clock.

### Re-measure (optional, nothing blocked)

- #26 start lag: Normal, lift 04 through the driver, then `(&V)` every 100 ms for 1 s (no preset).
  The first non-zero sample tells how many ticks after the driver's return the 2.7.2 volume starts;
  2 ticks would make the A 23 × B 25 a modelable caption-to-flow lag instead of a timing window.

### Not fixed

- DIFF-14 `?A80`/`?V95` and EQUIV-MOTOR #66 stay outside the driver (d); they are now reported as
  skipped, not different.
- EQUIV-MOTOR #26 free-flow volume (residual above).

### Neutral wording, second pass (W1 of §22)

The remaining reverse-engineering references in `src/core`, `src/protocols` and
`src/diff/executor.ts` comments (binary addresses, analysis-note section ids, form component and
field names, timer component names) now describe behavior: "behavioral equivalence" (with the
verdict/case ids kept), the state tick / flow timer / clock timer, the records and events grids,
the "Carregar configuração padrão" and "Gravar totais" buttons, the write / read /
identified-records pointers. The stale `diff-r4b-triage` reference in the Horustech `02` comment
now points to §20. The modal catalogue source of "Nível de preço incorreto." cites the bench
(DIFF-01 step 2) instead of an unpublished file. No behavior change.

Tests: new `test/diff-r7g.test.ts` (B1 with a real-profile mirror, X1 through the executor, the
script changes); changed with this citation: `test/golden-r4b.test.ts` and
`test/equivalencia-motor.test.ts` (#26 asserted `(SA…)` with the nozzle frozen).

## 24. Recorded 2.7.2 oracle (17/10)

Normative (maintainer): the replies the real 2.7.2 gave on the bench are a regression oracle in CI,
stored in this public repository under `test/fixtures/`; the bench is only for new or changed cases
and for the final confirmation. This refines the clean-room rule: bench reports and captures still
stay out of the repo, but the side-A frames of a diff run are stored, like the golden tests' literal
bytes (only the frame sent and the 2.7.2 reply, the driver's action log and the modal texts it
closed; no pump-sim replies, no traffic capture, no timing).

| # | Decision | Where |
| --- | --- | --- |
| O1 | One fixture per case (`test/fixtures/oracle-2.7.2/<case>.json`) plus a manifest with the bench run's case order, clock start, logical port and drain. First import: diff r7g (§23), 26 cases, 1350 steps | `src/diff/oraculo.ts` (`construirOraculo`, `gravarOraculo`) |
| O2 | A case is keyed on a stable hash of its script (`hashRoteiro`): everything that changes what is sent, done, waited for or compared, with keys sorted; notes, titles and operator texts are left out (and the `silencio` listening hint, §25 T2). The executor now writes it into every report case (`ResultadoCaso.roteiroHash`) | `src/diff/hash.ts`, `src/diff/executor.ts` |
| O3 | Hash differs (or is unknown) = **stale: needs bench**: neither a pass nor a failure. The vitest suite pins the acknowledged stale list, so a script change turns CI red until the case is re-recorded or acknowledged with its reason | `executarOraculo`, `test/oraculo-2.7.2.test.ts` |
| O4 | The replay goes through the live diff executor and action layer. Side A answers from the recording (driver semantics: `manual` steps without the driver are skipped there, as on the bench). Side B is `simulador-2.7.2` in process, on a manual clock advanced by `aguardar` through `avancar_tempo`, over in-memory connections served by the same `ServidorTcp` path as a socket (`conectarMemoria`): a reply is what the server wrote once its output queue settled, a silence costs no timeout. This matches the bench's B, which also ran on a manual clock (nothing moves during a reply window) | `src/transport/memoria.ts`, `ServidorTcp.atender` |
| O5 | Cases share state as on the bench, so they run in the run's order on one fresh pump-sim per bench run (session). A newer partial bench run becomes a new session; a case it re-recorded still runs in the older session with the current script (not compared) to keep the state of the cases after it | `SessaoOraculo`, `mesclarOraculo` |
| O6 | r7g predates `roteiroHash`. On import, a case gets the current script's hash only when its frames match the recording and it is not listed in `--alterados`; DIFF-14, DIFF-20, EQUIV-MOTOR and EQUIV-PENDENTES were listed (their scripts changed after the run: X1, S1, S2/S3, S4 of §23) and are stale | `construirOraculo` |
| O7 | A case the bench skipped (DIFF-30: the 2.7.2 only listens on its configured port) is `pulado`: no oracle, listed, never a pass | `executarOraculo` |
| O8 | Steps whose reply depends on time keep the script's masks and are marked `sensivel` (`relogio`, `bateria`, `vazao-livre`: a volume read after a fueling with no `&P` preset; a heuristic, metadata only) | `anotarRoteiro` |

### Implementation notes (revisable)

- B's clock starts at the run's wall time with a zero time-zone offset (`inicioRelogio`; r7g:
  the log's start, 2026-10-17 14:35:32), so the unmasked record day/month match the 2.7.2's.
- An injected fault delay (`atrasoMs`) is real time and is not waited for on an in-memory connection;
  no script uses faults.
- A frame sent by a script whose hash matches the fixture but that is not the recorded frame is a
  failure (the fixture was edited by hand), not stale.

### First run (r7g fixtures, current scripts)

20 equal, 0 different, 4 stale (DIFF-14, DIFF-20, EQUIV-MOTOR, EQUIV-PENDENTES), 1 skipped (DIFF-30),
1 informative (DIFF-18). The three DIFF-17R `&LR` steps that differed on the bench (§23 B1) are equal
now. Under the current scripts DIFF-14, DIFF-20 and EQUIV-PENDENTES would also replay equal, and
EQUIV-MOTOR differs in 22 steps (S2 reordered its frames, so the recording no longer lines up); all
four stay stale until the next bench run.

## 25. Diff wall time (17/10)

Source: a timing breakdown of the r6 bench run (727 s: fixed `aguardar` waits 50%, 1 s silence
timeouts 19% (69 per side), driver UI sleeps 16%, the 150 ms idle tail after each reply 11%, the
drain 4%). Scope: the diff executor, the TCP client and the scripts; no simulator behavior changed and
the bench driver (`tools/`) was not touched. Every change keeps the recorded oracle (§24) as it was:
20 equal, 0 different, the same 4 stale, 1 skipped, 1 informative.

| # | Decision | Why | Where |
| --- | --- | --- | --- |
| T1 | A reply ends as soon as its protocol frame is complete: the last byte is `)` (Companytec, Identfid), or a Horustech `>!` reply has its 4-hex-digit length plus the 2-char KK. The 150 ms idle tail stays only for `&R` (several groups, `(REL …)(DHA …)(C…)…`), for a send with two frames (`(&S)(&V)`: one reply on the 2.7.2, two on real profiles) and for a fragmented send (`intervaloMs`: the 2.7.2 answers `(&S` before the `)`, so the reply says nothing about the last chunk; without the tail the next frame went out right behind it, and the DIFF-04 `2.7.2 × cbc-32` test failed once under load) | The tail is pure waiting once the frame is closed. Checked against every recorded 2.7.2 reply: the rule is true on the whole reply and false on every proper prefix (1000+ replies), so it never cuts a recorded reply short | `src/diff/resposta.ts` (`fimDaResposta`), `OpcoesTroca.completo` in `src/net/cliente-tcp.ts` |
| T2 | `PassoEnviar.silencio`: the bench recorded silence for that step. It waits `OpcoesDiff.timeoutSilencioMs` (default 400 ms, never more than `timeoutMs`; CLI `--timeout-silencio`) instead of `timeoutMs`. `esperado: null` counts the same. A step with its own `timeoutMs` (the replies that come after a modal's OK, ~0,4–0,8 s on the bench) or followed by `fechar_modais` before the next `enviar` keeps the full timeout. 45 flags; 60 steps of the default run are shortened | Silences were 1 s each. The flag is a listening hint, not script: it is left out of `hashRoteiro` (refines O2), so the recordings stay valid, and `test/diff-tempo.test.ts` requires every flagged step to line up with a recorded `a: null` with no modal. Steps of EQUIV-MOTOR past its reordered frames (stale, §24 first run) are not flagged | `silencioEsperado` in `src/diff/executor.ts`, `src/diff/roteiros.ts`, `src/diff/hash.ts` |
| T3 | Bytes that arrive after a reply was declared complete and before the next step is sent are kept as `atrasados` on that next step (report warning `bytes atrasados`; ~~warning only~~ a divergence when they differ between the targets, T6), not dropped | T1 and T2 listen less; a reply that goes on longer than expected must be visible, never silently lost or merged into the next step's capture | `ResultadoTroca.atrasados`, `Resposta.atrasados`, `formatarRelatorio` |
| T4 | `drenar`: the `(&A)` ends on its `)`; the silent `(&I)` waits `INTERVALO_DRENAR_MS` = 50 ms (was 300 ms; `PassoDrenar.timeoutMs` and `OpcoesDiff.intervaloDrenarMs` override). An `(&A)` with no reply right after an `(&I)` is sent once more (the 2.7.2 serves only the first frame of a segment, Q1, so the two read together lose the `(&A)`) | Was ~0,45 s per record. One read and one acknowledge per record is the fewest frames that do not depend on profile-specific pointer replies: reading the `&T99P` pointers and sending N blind `(&I)` would rely on the 2.7.2 TG semantics (write − 1, read − 1) and on real consoles' per-port pointers | `drenar` in `src/diff/executor.ts` |
| T5 | Script waits are named by the timer they wait for: `ticks(n, TICK_ESTADO_MS / TICK_RELOGIO_MS, margin)` (state timer 1 s: "Concluindo..", status letters, ghost stores, fueling start; clock timer 1 s: `&KW` roll-over) and `vazao(ms)` for flow (until the preset freezes the volume, as calibrated on the bench). Every value is the same number of ms as before (the hashes did not change) | Flow waits are not a whole number of ticks of one timer (start = state tick + blinks, then flow ticks with a margin); rewriting them as ticks would change the value and make the case stale | `src/diff/roteiros.ts` |
| T6 | (Independent review.) A step whose `atrasados` differ between A and B is a divergence (`PassoComparado.igual` false, `byte` stays −1); `--atualizar-de` warns about any side-A `atrasados`; a recording with steps beyond its same-hash script fails the replay ("passo(s) gravado(s) além do roteiro") | With T1/T2 a late 2.7.2 reply (the rest of a multi-segment reply, or a reply after a watcher-closed modal to a step that listened only 400 ms) would land outside every compared reply: as a warning alone the case read IGUAL and the import recorded the step as silence | `executarDiff` comparison, `construirOraculo`, `CursorGravacao.restantes` |

No wait was removed. Every `aguardar` left waits for a timer tick or for flow, except two that wait
for an asynchronous reaction: the 500 ms after the RST/FIN of EQUIV-MOTOR #92 (the next step means "the
socket serves with the 10053 modal open" only once the modal is open), and the 100 ms sampling period of
DIFF-18 (the measurement itself). Removing either changes what the step measures on the bench, which the
oracle cannot see (side A is a recording), so they stay.

### Measured (pump-sim × pump-sim, `simulador-2.7.2`, real clock, default set)

| Run | Before | After |
| --- | --- | --- |
| 24 cases without DIFF-17R | 690,9 s (693,6 s with two CLI processes) | 517,2 s (−25%) |
| DIFF-17R, one side (other side on a manual clock) | 561,0 s | 554,2 s |
| Default set (25 cases, DIFF-30 skipped) | 1807,2 s (two CLI processes) | ≈ 1625 s (517 + 2 × 554, estimated) |

DIFF-17R is 332 state ticks × 1,5 s per side (§21 R2): T1–T4 do not touch that. The before run
(two CLI processes) had 2 divergences, both real-clock timing (DIFF-14 `?A80` minute, EQUIV-MOTOR #26
free-flow volume, §21); the after runs had none, and no step reported `atrasados`.

Not done:
- The driver UI sleeps (16% of r6) are in the bench driver, out of scope here.
- The panel button polling on pump-sim (`clicarBotaoPainel`, 100 ms) keeps its period: on a manual
  clock each poll advances 100 ms of virtual time, so a finer poll would change the oracle replay's B.
- The 400 ms silence and the 50 ms `(&I)` gap are not measured on the bench 2.7.2 yet; T3 and the
  `(&A)` retry make a wrong guess visible (or self-correcting) instead of silent.

## 26. r8 bench run: oracle re-record and Wine tolerance (17/10)

Source: diff r8 (Windows bench, real SimuladorCBC 2.7.2 freshly opened, Go driver, `simulador-2.7.2` B on
a manual clock; started 2026-10-17 17:18:06 local). 26 cases, 1350 steps: 1315 equal, 3 different,
3 skipped (`dependeDe`, X1 of §23), DIFF-30 skipped (port), DIFF-18 informative.

### Oracle re-recorded

`pump-sim oracle --atualizar-de diff-r8.json --inicio 2026-10-17T17:18:06 --substituir`: one session
`diff-r8` replaces `diff-r7g`. The r8 report has no `roteiroHash`, so every case got the current hash
by the frame check of O6 (no `--alterados`: every script was unchanged since the r8 package). The
four stale cases of §24 (DIFF-14, DIFF-20, EQUIV-MOTOR, EQUIV-PENDENTES) are live and the stale list is
empty. Replay: 21 equal, 3 different, 0 stale, 1 skipped (DIFF-30), 1 informative (DIFF-18). The
replay's B gives the same bytes as the bench's B on the three different steps:

| Case | Step | Frame | A (2.7.2) | B (pump-sim) | Why |
| --- | --- | --- | --- | --- | --- |
| DIFF-12 | 17 | `(&KR1F4)` | seconds `01` | `00` | Clock timer phase: A's 1 s clock timer ticked once between "RTC set to 14:30:00" and the read; on the manual clock nothing moves there. r7g read `00` (the script note already says the second depends on the clock phase) |
| EQUIV-COMANDOS | 2 | `(&KR1F4)` (#40) | seconds `03` | `02` | Same clock phase, after the 01/27 roll-over |
| EQUIV-MOTOR | 32 | `(&A)` (#26) | L6 0,299 L, T6 3,35, E10 655 | 0,325 L, 3,64, 681 | Free flow of the 2,5 s before `&M B`: A 23 flow ticks, B 25 (the §23 residual, now live: S2/S3 moved the case and the #74 record that follows is equal) |

They are pinned in `test/oraculo-2.7.2.test.ts` (`DIFERENCAS_RECONHECIDAS`) with both exact replies,
like the stale list of O3: any other difference, a change of these bytes or one of them turning equal
makes CI red. Masks were not widened: a wider `&KR1` mask would change the script hash (stale again)
and hide a real seconds bug.

### Wine tolerance (normative: maintainer)

| # | Decision | Where |
| --- | --- | --- |
| W1 | When side A is the 2.7.2 under Wine (`pump-sim diff --alvo-a wine`, control API `diff_executar` `plataforma_a: 'wine'`, `OpcoesDiff.plataformaA`), the free-flow fields of the steps annotated `vazao-livre` (O8, now shared by the oracle and the live diff) compare within ~~±4%~~ ±10% (§30) (`TOLERANCIA_WINE`). Reason: Wine's flow timer runs at 100.0 ms per tick against ~~~104 ms~~ 109.375 ms (§29) on Windows, so a free-flow fueling gains ~~~4%~~ volume in the same wall time (§29: 8,0% on EQUIV-MOTOR #26 against the new `simulador-2.7.2` period; ~~the 4% bound itself was kept~~ widened to 10% in §30). Everything else stays byte-exact. Never applies to the recorded oracle or to a Windows run (default `windows`) | `src/diff/tolerancia.ts`, `src/diff/sensivel.ts`, `executarDiff` |
| W2 | Fields: `&V` L6 per nozzle; records `&A` 52/36/34, `&LR` 74/82, `&A67` 75, `&@66` 87 (common core T6 L6 P4 V2 C4 B2, E10 on the longer ones): L6 volume and C4 duration within ~~4%~~ 10% (§30) of the larger value, T6 amount within ~~4%~~ 10% plus one unit of its last digit (volume × price rounding), E10 totalizer within ~~4%~~ 10% of the record's volume (in mL, by the V2 decimals) plus its 10 mL floor: the totalizer start is the same on both sides, so only the fueling may differ, and 4% of a large totalizer would hide a real error. Other bytes compare after the script masks; the KK is skipped only when a field differs, and must then check on each side. Any reply with no field map (`&T`, PAF layouts, `?A`) stays byte-exact | `compararComToleranciaWine` |
| W3 | Report: the step counts as equal (`PassoComparado.tolerancia` with the fields and the deviation; `byte` keeps the first differing byte), the terminal marks it `≈ … [igual (tolerância wine): …]`, the total says how many (`toleradosWine`), the header names the Wine target, the UI says "igual (tolerância wine)" | `formatarRelatorio`, `ui/js/telas/diff.js` |

Implementation notes (revisable): the relative bound is against the larger of the two values (a
symmetric ~~±4%~~ ±10%, §30); a zero on one side and not the other is outside it. The UI diff form has no Wine
toggle yet (the bench runs from the CLI); the control API takes `plataforma_a`.

Tests: new `test/diff-wine.test.ts` (field maps, the bounds, KK, preset reads stay exact, Windows
default, the oracle never tolerates); changed with this citation: `test/oraculo-2.7.2.test.ts` (r8
session, no stale, the three pinned differences).

## 27. 2.7.2 clock timer phase and the #26 fueling start, measured under Wine (17/10)

Source: the real SimuladorCBC 2.7.2 in the CrossOver bottle `pump-sim-272` (calibrated for
EQUIV-COMANDOS, see the Wine calibration of the r7 package), Go driver with `-vigia`, freshly started
with `reset_estado`, 2026-10-17. Measured over a raw TCP connection to port 2001. Wine runs USER timers
exactly (§26 W1), so the numbers are the 2.7.2's own timer logic without the Windows rounding.

### Clock timer: free phase, not restarted by `&KW`

| Measure | Result |
| --- | --- |
| `&KW` to a known time, then `&KR1` every 50 ms for 3 s, 6 writes 0,3–1,7 s apart (random) | First second increment 330, 330, 430, 480, 680 and 725 ms after the write; then every 1000 ms. Write instant + first increment, modulo 1000 ms of one monotonic clock: 915–958 ms in all six (the 50 ms poll resolution) |
| `&KR1` every 10 ms after a write, three times about 5 min apart (about 30 `&KW` in between) | Increments at the same fraction of the PC second each time (≈ 650 ms, not the PC second boundary) |
| DIFF-12 sequence (`&KW`, `&KR1` at once, `&KW` ×2 with month 13, 1,5 s, `&R`), 10 times | `&KR1` seconds `00` 10/10; `&R` `14:30:01` 5/10 and `14:30:02` 5/10 |
| EQUIV-COMANDOS #40 sequence (`&KW` month 13, `&KR1` at once, 2 s, `&KR1`), 10 times | `00` (month 13) then `02` (01/27), 10/10 |

So the 2.7.2's clock timer runs at a phase fixed when the app starts, and `&KW` only stores the fields:
the 1st tick after a write comes 0–1000 ms later, uniformly over the phase. It is not deterministic
relative to the frames, so it is **not** modeled as a quirk: `RTC_272` keeps "1st tick 1 s after the
write" (phase = the write instant, one admissible value; the `gravarCampos` comment now says so).

The Windows r8 run is consistent with a free phase but saw two rare cases: DIFF-12 #17 read `01` about
1 ms after the `&KW` (r7g read `00`), and EQUIV-COMANDOS #2 read `03` after a 2,0 s wait (3 ticks;
Wine 10/10 `02`). Both fit one tick firing right after the `&KW` frame, e.g. a WM_TIMER that was due
while the main thread handled other messages and was delivered after the socket message. Hypothesis
only: not reproducible under Wine, not measured on Windows.

| # | Decision | Where |
| --- | --- | --- |
| K1 | The `&KR1` reads that come after the clock may have ticked mask the **units digit of the seconds and the KK** (`SEGUNDO_KR1`, chars 17–19 of `(KR1yymmddwwhhmmssKK)`): DIFF-12 #17 and EQUIV-COMANDOS #2, #4 (#40) and #7 (#39). The tens digit, the date, the weekday, the hour and the minute stay compared, so the month-13 roll-over, the 31-day month and hour 25 are still checked. Not masked: EQUIV-COMANDOS #1 (read at once after the month-13 write): a tick in between would also roll the month, which is what the step checks, so the mask would hide nothing useful; that step keeps a race of the order of the write's round trip (ms per second) | `src/diff/roteiros.ts` |
| K2 | This refines §26 "Masks were not widened": that was before the phase was measured. The mask changes the script hash of DIFF-12 and EQUIV-COMANDOS, so the oracle was re-imported from the same r8 report with the same command (`--atualizar-de diff-r8.json --inicio 2026-10-17T17:18:06 --substituir`): the sent frames, actions and waits did not change (O6 frame check), only the comparison did, so the r8 recordings stay valid. The fixture diff is the two hashes and the four masked steps; every side-A reply is the same | `test/fixtures/oracle-2.7.2/DIFF-12.json`, `EQUIV-COMANDOS.json` |

Replay after K1/K2: 23 equal, 1 different (EQUIV-MOTOR #26, pinned), 0 stale, 1 skipped (DIFF-30),
1 informative (DIFF-18). The two `&KR1` entries left `DIFERENCAS_RECONHECIDAS`.

### EQUIV-MOTOR #26: fueling start and the free-flow window

| Measure (Normal speed, channel 1, nozzle 04, no preset, 5 fuelings each) | Result |
| --- | --- |
| `&V` + `&S` every 50 ms on one connection while the driver lifts | `&S` letter A appears on a state tick; the first non-zero `&V` (`(04000013)`, one flow tick) comes 697–699 ms after the first A sample in all five. The driver's `retirar` returns (caption "Abastecendo..", polled every 100 ms) between 104 ms before and 24 ms after that first volume |
| `&V` exactly 2,5 s after the driver's `retirar` returns (the #26 window) | `(04000325)` 5/5 = 25 flow ticks, the same as pump-sim on a manual clock |

The caption and the first flow tick come together (within the driver's 100 ms caption poll); the
~0,7 s from the A letter to the first volume is not a whole number of state ticks and is already
inside "start = state tick + blinks" (T5 of §25). There is no caption-to-flow lag to model: the
§23 re-measure question ("2 ticks would make 23 × 25 a modelable lag") is answered no. The Windows 23
ticks are the Windows flow-timer period (~~~104 ms, §26 W1: 2500 / 104 ≈ 24, minus the phase of the
first tick~~ 109.375 ms, §29). ~~EQUIV-MOTOR #26 stays pinned as the documented residual;~~ (refuted by §29: the period is modeled and #26 is equal); a Windows bench run compares it
byte-exact on purpose, and a Wine run already tolerates it (W1).

Tests: new `test/diff-relogio.test.ts` (which reads carry the mask, the mask accepts the r8 extra tick
and still rejects the tens digit, the month and the minute); changed with this citation:
`test/oraculo-2.7.2.test.ts` (only EQUIV-MOTOR #26 pinned).

Not done: the Windows "tick right after `&KW`" hypothesis needs a Windows bench (same 50 ms poll after
`&KW`, with and without UI actions just before). Nothing is blocked by it.

## 28. `&S` letter right after `&P` / `&M B`: a ~100 ms deferral, measured under Wine (17/10)

Source: local Wine diff r9 (real SimuladorCBC 2.7.2 in the CrossOver bottle `pump-sim-272`, Go driver,
`--alvo-a wine`): 22 equal, 2 different, both the `&S` read right after a command. EQUIV-COMANDOS #35:
right after `(&P04000500FF)` A read `(SL…)`, B `(SP…)`. EQUIV-MOTOR #26: right after `&M04B` on the
fueling nozzle A read `(SAP…)`, B `(SBP…)` (Windows r6/r7g/r8 read `(SBP…)` there, §23 B2; the second
read a state tick later was equal in r9).

### Measured (same bottle, `reset_estado` before every repetition, raw TCP to 2001)

Hypothesis tested: the letters move on the 1 s state tick (free phase, like the clock timer of §27).
Command, then `&S` in a loop on the same connection; time = from sending the command.

| Command | Poll | Repetitions | First sample with the new letter |
| --- | --- | --- | --- |
| `(&P04000500FF)` (L → P) | 50 ms | 5 | 58, 55, 53, 3 (first sample), 54 ms |
| `(&P04000500FF)` | 2 ms | 20 | 43, 45, 85, 24, 80, 4 (first), 86, 19, 4 (first), 38, 44, 9, 78, 58, 42, 6, 54, 61, 4 (first), 48 ms |
| `&M04B` on 04 fueling 2,5 s (A → B) | 50 ms | 5 | 53, 104, 107, 106, 107 ms |
| `&M04B` | 2 ms | 15 | 66, 70, 36, 64, 78, 67, 62, 33, 36, 60, 84, 66, 66, 60, 48 ms |
| `(&M04S2A)` on idle 04 (L → C), control | 2 ms | 5 | first sample (1–6 ms) 5/5 |

The reply (`(P04)`, `(M04)`) comes at once (1–2 ms). The state-tick hypothesis is **refuted**: the new
letter is never later than 107 ms, so it is not the 1 s state tick. The delays spread over 0–107 ms
from the frame, which fits a ~100 ms timer with a free phase relative to the frames (under Wine the flow
timer runs at exactly 100 ms, §26 W1); `&M S` → C is not deferred. So a read right after `&P` / `&M B`
races that short timer, and under Wine (where the reply-to-next-frame gap is ~1–2 ms) it nearly always
loses: 19/20 + 15/15 old letter in the fine polls above, matching r9.

On Windows the same immediate reads gave the new letter in every run (EQUIV-MOTOR #26 r6, r7g, r8;
EQUIV-COMANDOS #35 r7g and r8 equal). Why Windows does not show the deferral is not known (hypothesis
only: the letter is refreshed on a low-priority message, like a timer or a repaint, that Windows
delivers in the gap before the next socket message and Wine does not); not measured on Windows.

| # | Decision | Where |
| --- | --- | --- |
| L1 | The two `&S` reads that follow `&P` (EQUIV-COMANDOS #35) and `&M04B` (EQUIV-MOTOR #26) wait first for the letter to settle: `letraAssentada()` = `ticks(2, TICK_VAZAO_MS, 100)` = 300 ms, above the 107 ms maximum measured and well under a state tick, so it neither masks the letter nor lets a state tick in. The letter stays compared byte-exact. Other `&S` reads right after a command were left as they are: `&M S` (#27, measured immediate), the `&CW` reads of DIFF-04 and the `&U` read after the modal's OK (equal on Windows and on Wine r9, not measured here) | `src/diff/roteiros.ts` (`TICK_VAZAO_MS`, `letraAssentada`) |
| L2 | pump-sim keeps changing the letter at once (no quirk). The authority is the Windows bench (r6/r7g/r8: new letter at once), and under Wine the change is never on the state tick, only within one ~100 ms period; a deferral quirk would model the Wine timing, not the 2.7.2 the clients see. With L1 the read is after that period on both platforms, so the immediate letter is admissible for every measured case. On B's manual clock the 300 ms wait moves nothing that is compared (#35: no nozzle fuels; #26: the nozzle is frozen by `&M B`, the next `&V` stays `(0)`) | `src/core` unchanged |
| L3 | L1 changes the script hash of EQUIV-COMANDOS and EQUIV-MOTOR, so the oracle was re-imported from the r8 report with the §26 command (`pump-sim oracle --atualizar-de diff-r8.json --inicio 2026-10-17T17:18:06 --substituir`). The sent frames, the actions and the compared steps did not change (O6 frame check; an `aguardar` sends nothing), only a wait was added, so the r8 recordings stay valid: the fixture diff is the two `roteiroHash` lines, every side-A reply is the same. Replay unchanged: only EQUIV-MOTOR #26 `(&A)` pinned (§27) | `test/fixtures/oracle-2.7.2/EQUIV-COMANDOS.json`, `EQUIV-MOTOR.json` |

Tests: new `test/diff-letra.test.ts` (the wait sits between the command and the `&S` on #35 and #26,
it covers the 107 ms and stays under half a state tick, `&M S` keeps its immediate read).

Not done: measuring the deferral on Windows (same 2 ms poll after `&P` and `&M B`), and re-running
the Wine diff with L1 (expected: EQUIV-COMANDOS and EQUIV-MOTOR equal apart from the tolerated #26
record).

## 29. Final bench confirmation r10: the Windows flow-timer period (17/10)

Source: diff r10 (Windows bench, real SimuladorCBC 2.7.2 freshly opened, Go driver with `-vigia`,
`simulador-2.7.2` B on a manual clock; started 2026-10-17 18:55:38 local). 26 cases, 1350 steps: 1346
equal, 3 skipped (`dependeDe`, X1 of §23: the IDF panel twice, two nozzles at once), DIFF-30 skipped
(port; needs a real console), DIFF-18 informative and 30/30 equal, **one** difference: EQUIV-MOTOR
#26 `(&A)`, A `0,299 L` (23 flow ticks) × B `0,325 L` (25), the §23 residual pinned in §26–§28.

### The period: 7 × 15.625 = 109.375 ms

The 2.7.2 asks for a 100 ms flow timer. Windows fires a window timer on its system clock tick
(15.625 ms by default), so the 100 ms request elapses on the 7th tick: 109.375 ms. Wine runs it at
100.0 ms (§26 W1, §27). Every timing measurement of the Windows 2.7.2 was fitted to one period:

| Evidence | What it constrains | Fit |
| --- | --- | --- |
| Fueling probe of the 17/10 capture (§9; `test/golden-diff-1710.test.ts`): `&V` at 1975, 2752, 3532, 4309, 5087, 5864, 6644 ms = 3, 10, 18, 25, 32, 39, 46 ticks. The probe stamps its own sends, so the executor's timers are not involved | One period and one phase must give all seven counts | P ∈ [107.3, 111.1] ms. 100 ms (Wine) and 104 ms (the §26 estimate) are outside: on the real timestamps the sim drifts 4 and 2 ticks over the seven samples, 109.375 stays on one offset |
| EQUIV-MOTOR #26 on r6, r7g, r8 and r10: 23 ticks between the driver's `retirar` and `&M04B` (`vazao(2500)`, a 2500 ms wait = 160 system ticks), with the first flow tick 24 ms before to 104 ms after the driver returns (§27) | 23 = ⌊(W − d) / P⌋ + 1 with W ∈ [2500, 2516], d ∈ [−24, 104] | P ∈ (104.2, 115.5] ms |
| DIFF-18 r6, r7, r7g, r8: 29 sample intervals of reply + 150 ms idle tail + `aguardar 100` (before T1 of §25), 70 ticks every time, increments 2/3 | The executor's waits run on the same 15.625 ms quantum on Windows (inference, not measured directly: Node's timers there wake on the system tick; it is what makes the r6–r8 and r10 counts agree with the probe): 150 → 156.25, then 100 → 109.375, so one sample = 17 system ticks = 265.625 ms. 29 × 265.625 / P ∈ (69, 71) | P ∈ (108.5, 111.6) ms |
| DIFF-18 r10: after T1 the sample is reply + `aguardar 100` = 7 system ticks = 109.375 ms; A gains **exactly 1 tick on each of the 29 intervals** | Sampling loop and flow timer locked: \|S − P\| · 29 < P with S = 109.375 | 109.375 (the lock). With exact waits the loop would be ~101 ms, as on the Wine run r9 (macOS host): there A gained 2 ticks once in 29, which the Windows run never shows |
| Recorded-oracle replay with the r10 recordings | #26 equal and every other step unchanged on B's manual clock | 0 differences at 109.375; a sweep of 104–114 ms in 0.25 ms steps gives 0 for every value in 107.25–111.0 except 108.0, and for some isolated values outside it (B's start phase moves with P), so it is the weakest constraint |

Intersection: P ∈ (108.5, 111.1) ms; the only multiple of the system tick in it is 7 × 15.625 =
**109.375 ms**, which also explains the DIFF-18 r10 lock and the earlier "~109 ms" (§9) and "~111 ms"
estimates. The §26 "~104 ms" came from DIFF-18 r6–r8 read with exact (unquantized) executor waits
(29 × 251 / 70 ≈ 104), which the probe excludes.

| # | Decision | Where |
| --- | --- | --- |
| P1 | `simulador-2.7.2` flow tick `tickVazaoMs: 109.375` (was 100). It is profile data, like the 100 it replaces (the real profiles keep their own 300; real-profile goldens unchanged). The 7 blinks before the volume (`ticksPiscando`) and every derived flow time follow it. The radio speeds keep 150/300/450: what Windows does with them is not measured (inference: 156.25/312.5/453.125, the same rounding); nothing in the scripts compares them | `src/profiles/index.ts` |
| P2 | The scripts' waits are unchanged (`TICK_VAZAO_MS` stays 100 in `roteiros.ts`, `letraAssentada` 300 ms): they are what the bench executor waits for, a change would make every case stale, and the oracle replay is equal with them | `src/diff/roteiros.ts` (comment only) |
| P3 | Oracle re-imported from the r10 report with the §26 command: `pump-sim oracle --atualizar-de diff-r10.json --inicio 2026-10-17T18:55:38 --substituir`. One session `diff-r10` replaces `diff-r8`; the r10 report has `roteiroHash`, so every case carries the bench's hash (`origemHash` "relatório da bancada"). EQUIV-MOTOR #26 left `DIFERENCAS_RECONHECIDAS` (now empty) | `test/fixtures/oracle-2.7.2/`, `test/oraculo-2.7.2.test.ts` |
| P4 | ~~The Wine tolerance stays as §26 W1/W2 set it (±4%, `--alvo-a wine` only, never the oracle).~~ Superseded by §30 T1 (±10%, still `--alvo-a wine` only, never the oracle). Its reason text is corrected (Windows 109.375 ms, not ~104) | `src/diff/tolerancia.ts`, `src/cli.ts` |

Preset-bound fuelings stay exact: every preset read of the scripts freezes at preset/price well inside
its wait. The oracle replay was run with the flow tick forced to 115, 120, 125 and 130 ms: the only step
that changed is the #26 free-flow record; every preset `&V`/`&A`/`&LR` read stayed equal.

### Oracle replay (r10 recordings, P = 109.375)

26 cases: 24 equal, 0 different, 0 stale, 1 skipped (DIFF-30), 1 informative (DIFF-18); 1350 steps,
0 divergences (3 steps skipped by `dependeDe`).

DIFF-18 is informative and is not compared, but it now differs on B: the replay's manual clock samples
every 100 virtual ms while the flow ticks every 109.375, so B gains 26 ticks over the 29 samples where
A gained 29 (A's samples were locked to 109.375 ms of wall time, above). A live Windows bench run
would show the same on its manual-clock B. No period reproduces both on a manual clock (DIFF-18 needs
100 ms per sample, #26 needs 23 ticks in 2,5 s); #26 is compared and DIFF-18 is not.

### Consequence for Wine runs (~~open~~ resolved in §30: bound widened to 10%)

With B at 109.375 ms and a Wine A at 100.0 ms, a free-flow read differs by the period ratio
(1 − 100 / 109.375 = 8,6%). EQUIV-MOTOR #26 under Wine (r9: `0,325 L`, R$ 3,64, E10 681) against B
now (`0,299 L`, R$ 3,35, E10 655) is 8,0% on L6 and T6 and 26 mL on E10 (bound 4% × 325 + 10 = 23 mL),
outside the ±4% of W2: a Wine diff (`--alvo-a wine`) would report #26 as a divergence again. Not
changed here (W1 is the maintainer's); the options are a bound that covers the ratio (~9%) or giving B
the Wine period (100 ms) when side A is Wine.

Tests: changed with this citation: `test/diff-r6.test.ts`, `test/golden-r6.test.ts`,
`test/bancada-diff-1710.test.ts` and `test/golden-diff-1710.test.ts` (one fake-clock step = one flow
tick, `tickVazaoMs`, instead of 100 ms; the A literals are unchanged; the probe's tick-rate test now
asserts no drift at 109.375 and a drift at 100/104; the probe cycle reads its first `(SC…)` one state
tick after the hang-up, because the probe's hang-up is off the flow-tick timeline: A has 54 ticks at
the logged click where 109.375 ms gives 56–57 from the 6644 sample), `test/golden-r7g.test.ts` (#26 and
#74 without S3 now byte-equal to the bench), `test/diff-wine.test.ts` (the oracle-never-tolerates
witness is a planted #26 record within 4%), `test/oraculo-2.7.2.test.ts` (r10 session, no pinned
difference).

## 30. Wine tolerance at 10%, Go driver in CI, site notes out of Pages, UI icon-font subset (17/10)

Source: maintainer decisions after §29 (the four items below are normative: maintainer).

| # | Decision | Where |
| --- | --- | --- |
| T1 | `TOLERANCIA_WINE` goes from 0.04 to **0.10**. §29 left a Wine run (`--alvo-a wine`) red on EQUIV-MOTOR #26: Wine's flow timer is 100.0 ms against 109.375 ms on Windows, 1 − 100 / 109.375 = 8.6% apart, so a free-flow fueling of the same wall time differs by up to that ratio (r9 under Wine × B now: L6 2,99 × 3,25 L and T6 3,35 × 3,64, 8.0% of the larger; E10 +26 cL = 260 mL). 10% covers the ratio with a margin; the other option of §29 (giving B the Wine period when A is Wine) was not taken. Everything else of §26 W1–W3 is unchanged: only `vazao-livre` steps, only the field maps of W2, the amount keeps its +1 unit, the totalizer keeps its rule (the tolerance × the record's volume in mL, plus the 10 mL floor: 10% × 3250 + 10 = 335 mL for #26), never the recorded oracle or a Windows run. CLI help, control API catalog text and the report header say ±10% | `src/diff/tolerancia.ts`, `src/diff/executor.ts`, `src/cli.ts`, `src/control/catalogo.ts`, `README.md` |
| T2 | CI gets a `driver-go` job: `go vet ./...` (host and `GOOS=windows GOARCH=386`, so the Win32-only files the bench `.exe` is built from are vetted too) and `go test ./...` in `tools/driver-go`. `actions/setup-go` is pinned by tag like the other actions, and the Go version comes from `go.mod` (`go-version-file`), so CI and the module cannot drift | `.github/workflows/ci.yml` |
| T3 | `pages.yml` uploads `site/` as is, so nothing that is not the page may live there: `site/README.md` and `site/DEVIATIONS.md` moved to `docs/site/` (links and the regeneration command updated). `test/site-sem-origem-externa.test.ts` fails if a Markdown file appears under `site/` again | `docs/site/`, `.github/workflows/pages.yml` (comment) |
| T4 | The web UI serves `ui/fonts/material-symbols-rounded-subset.woff2` (~52 KB) instead of the full Material Symbols Rounded (3.1 MB), which made up most of the UI assets embedded in the Windows executable. Same method as the homepage subset (`pyftsubset`, ASCII for the ligature components, all layout features, no layout closure), with glyphs selected by id because one glyph serves several ligature names; each icon's filled glyph (the FILL-axis substitution behind `.ms.fill`) is kept. The icon names: every literal `.ms` span text plus every quoted lowercase identifier of `ui/js` that is a ligature of the full font (catches dynamic icons such as the theme toggle and the state badges; a few non-icon words that happen to be icon names, e.g. `pill`, `toast`, are kept as a harmless superset). The full font moved to `tools/fonts/` (with its license text) as the source of both subsets; it is not in the npm package (`files`: `dist`, `ui`) nor in the executable. `ui/fonts/LICENSES.txt` stays and names the subset. `test/ui.test.ts` reads the GSUB ligatures of both fonts and fails when an icon used by the UI does not resolve in the subset (or loses its filled form), when a literal `.ms` text is not an icon, or when a file over 200 KB appears in `ui/fonts/`. After adding an icon: `node tools/gen-icon-subset.mjs` | `tools/gen-icon-subset.mjs`, `tools/fonte-icones.mjs`, `ui/fonts.css`, `ui/fonts/`, `tools/fonts/`, `test/ui.test.ts` |

Tests: changed with this citation: `test/diff-wine.test.ts` (bound 0.1; the #26 Wine fields, 8.7% from A, are now tolerated; new
out-of-bound witnesses at 10%: volume +12% and an amount 1 unit over; the totalizer boundary 310 mL in / 350 mL out for a 3,05 L
record; `&V` 555 in / 556 out of 500). New: the icon-subset test in `test/ui.test.ts` and the no-Markdown guard in
`test/site-sem-origem-externa.test.ts`.
