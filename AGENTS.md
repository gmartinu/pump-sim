# AGENTS.md — pump-sim

Rules for coding in this repository. Loaded into every agent session: keep it short (under ~8 KB).
Detail lives in [README.md](README.md) and [docs/DECISIONS.md](docs/DECISIONS.md); read the
relevant DECISIONS section before changing behavior.

## What this is

Open-source (MIT), POS-agnostic simulator of Companytec fuel concentrators (CBC01–CBC06,
Horustech, Concept). It speaks the protocol like SimuladorCBC 2.7.2 and like the real consoles
(DT435/DT432). Nothing is imported from any client; it must stay usable by any forecourt software.

## Module map

| Path | Role |
| --- | --- |
| `src/core` | Protocol-agnostic engine: concentrator state, nozzles, buffers, pointers, clock (`ManualClock`), identification |
| `src/protocols` | Codecs: `companytec` `(&…)`, `identfid` `(?…)`, `horustech` `>?` (02/06/32 only) |
| `src/profiles` | Profiles as data (`simulador-2.7.2`, `cbc-32`, `cbc05-dip3`, `cbc01`, `horustech-cbc-36`, `horustech-48`, `concept-48`) |
| `src/transport`, `src/net` | TCP server (ports per profile), TCP client |
| `src/control` | Loopback HTTP + WS control API; `catalogo.ts` is the full command inventory |
| `src/recorder` | JSONL traffic recording and replay |
| `src/mcp` | stdio MCP server that only adapts the control API |
| `src/diff` | Differential test runner and scripts (`roteiros.ts`, `acoes.ts`), recorded 2.7.2 oracle (`oraculo.ts`) |
| `src/ui` | Serving of the web UI assets, browser launcher |
| `src/cli.ts`, `src/sim.ts`, `src/index.ts` | CLI, `PumpSim` facade, library exports |
| `ui/` | Static web UI: plain ES modules, no build step; fonts/icons bundled in `ui/fonts/` |
| `tools/` | `build-sea.mjs` (Windows single executable), `gen-icons.mjs` + `icon/` (raster icons from `ui/icone.svg`), `gen-icon-subset.mjs` + `fonts/` (the UI icon-font subset from the full Material Symbols), `driver-simuladorcbc/` (bench UI driver, PowerShell) and `driver-go/` (its Go port, one 32-bit `.exe`) |
| `test/` | Vitest suites, golden tests |

## Sources of truth

- `simulador-2.7.2` profile, authority order: **the real 2.7.2 measured on a bench** >
  the behavioral-equivalence verdict > anything else (older tests, older equivalence notes, the spec).
  When the bench contradicts an older assertion, the bench wins and the assertion is changed
  **with a citation** (DECISIONS section/case) — never silently.
- Real profiles follow the Companytec manuals (DT435 rev.10, DT432 rev.02, DT360). Where a manual
  is silent, record the inference and its confidence in DECISIONS.
- DECISIONS §1 (N1–N8) is normative: do not re-evaluate it.

## 2.7.2 quirks

- Every 2.7.2 bug or oddity is an opt-in option (a "quirk" in `Perfil.quirks`), enabled by
  default **only** in `simulador-2.7.2`. Add a new quirk rather than changing shared behavior.
- **Never branch on the profile id.** Code checks the quirk/option, never `perfil.id === …`.
- Real-profile goldens must stay **byte-identical** when you add or change a 2.7.2 quirk.

## Clean-room rule

- Never paste or commit decompiled code, disassembly, or binary addresses/offsets as code.
  Describe the behavior in words (measured on the bench, behavioral equivalence); comments, tests and
  docs cite no binary addresses and no names that only exist inside the binary (fields, components).
- Bench captures (`*.jsonl`, `diff-*.json`, driver logs) and reverse-engineering notes stay out of
  the repo. The literal byte sequences they contribute live in the golden tests and in the recorded
  oracle (`test/fixtures/oracle-2.7.2`, side-A frames only, imported with `pump-sim oracle --atualizar-de`).

## Tests

- Golden tests assert **exact frames** (bytes, checksum included).
- A behavior fix ships with a golden test **plus a real-profile mirror** test proving the real
  profiles did not change (or asserting their documented behavior).
- Never weaken, skip or loosen an assertion to get green. If a test fails, find out why; if the
  expectation itself is wrong, fix it only with a cited source (see Sources of truth).
- Time is injected: use `ManualClock`. ESLint forbids `Date.now` outside `clock.ts`/`cli.ts`.
- `npm run ci` (typecheck, lint, vitest) must pass at zero errors before any commit. Node 22
  (the Windows executable build needs Node 22.20.0 exactly).

## UI and network

- The UI talks **only** to the loopback control API (commands over WS, polling, events).
- No external network request from the page: fonts and icons are local (`ui/fonts/`).
  `test/ui.test.ts` gates this.
- The CSP stays closed (`script-src 'self'`, `font-src 'self'`, no external origin). Keep the
  control API's loopback guards (Origin/Host 403, no CORS, JSON-only POST).

## Language

- Code, comments, docs, DECISIONS and commit messages: **English**.
- User-facing UI copy: **Portuguese (pt-BR)**. Strings copied from the 2.7.2 UI are quoted verbatim.
- Existing Portuguese identifiers and command names (`get_estado_simulador`, `Bico`…) are part of
  the API: keep them.

## Commits

- Plain messages that explain **why** (the decision, the trade-off, the bug avoided).
- **No `Co-Authored-By` or `Claude-Session` trailers** (or any AI attribution trailer) in this repo.
- Focused commits; do not mix unrelated changes.

## Releases

- Only through the release workflow (`.github/workflows/release.yml`): tag `v*` equal to the
  `package.json` version, built by GitHub Actions, signed via SignPath once configured
  ([CODE_SIGNING.md](CODE_SIGNING.md)).
- Release binaries are only built by the release workflow; until SignPath is configured they are
  unsigned and the release notes say so. Never upload a locally built binary as a release asset.
- npm releases are only staged by the release workflow (`npm` job, `npm stage publish` over
  Trusted Publishing with provenance); a maintainer approves each staged version on npmjs.com.
  Never run `npm publish` or `npm stage publish` locally.

## Dependencies

- Keep runtime dependencies minimal: currently `ws`, `@modelcontextprotocol/sdk`, `zod`. Adding one
  needs a DECISIONS entry with the reason.
- No native dependencies (must run on macOS, Windows and CI).
- Dev dependencies are pinned to exact versions (no `^`/`~`).

## DECISIONS.md

Every non-obvious decision gets recorded: append a new section (or a row in the current one) with
source, rationale and where it lives in the code. Do not rewrite history: refute an old entry by
striking it through and pointing to the new section.
