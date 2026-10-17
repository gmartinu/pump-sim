# driver-simuladorcbc

HTTP driver for the **SimuladorCBC 2.7.2** UI (Windows). It plays the "control API" role
of side A in `pump-sim diff`: the script's action steps (`acao: retirar`, `dip`, `modelo`…)
become clicks on the 2.7.2 window, and the same steps become pump-sim control API
commands on side B. This way the cases that used to be "interactive" (DIFF-01, 05–09, 17–20)
run without an operator.

## Origin

Written against a SimuladorCBC 2.7.2 install (PowerShell 5.1, no extra dependency), following the
[contract](#contract) below and adjusted with what the bench measured (header of `driver.ps1`). It uses
nothing from the 2.7.2 binary: only Win32 messages (`SendMessage`/`PostMessage`) to the window's VCL
controls, found by class + text + position. Summary of the driver's own checks: `docs/DECISIONS.md`
§14 and §15.

## Running

```powershell
powershell -ExecutionPolicy Bypass -File driver.ps1 [-Prefix http://127.0.0.1:7071/] `
  [-ProcessName 'SimuladorCBC Vr 2.7.2'] [-Log <path>\driver.log]   # default: %TEMP%\driver-simuladorcbc.log
```

With the 2.7.2 already open. Then, from any machine that reaches both ports:

```sh
pump-sim diff --a 127.0.0.1:2001 --controle-a http://127.0.0.1:7071 \
              --b 127.0.0.1:7002 --controle-b http://127.0.0.1:7070 --casos DIFF-05,DIFF-07
```

`--controle-a` is treated as the driver and `--controle-b` as the pump-sim API
(`--controle-a-tipo`/`--controle-b-tipo` swap them). DIFF-17 does 1001 fuelings through the screen
(~2 h); `--diff17-n 20` shortens it.

## Contract

HTTP on loopback only (403 otherwise), JSON both ways.

- `GET /estado` → `{ ok, estado: { pid, aba, canal, dips{1..6}, velocidade, modelo, automacao,
  rede_ac, porta, botoes{esquerdo,direito}, bicos{esquerdo,direito} }, modais_fechados }`
- `POST /acao` with `content-type: application/json` (otherwise 415) and `{ tipo, ...params }` →
  `{ ok: true, detalhe, estado, modais_fechados: [{ts, texto}] }`; error = 400 `{ ok: false, erro }`.

Every action starts and ends by closing the open MessageBoxes (and returns their text), because
with a modal open a `BM_CLICK` on the main window is ignored.

| `tipo` | params | On the 2.7.2 (driver) | On pump-sim (side B, `src/diff/acoes.ts`) |
| --- | --- | --- | --- |
| `canal` | `n` 1–8 | click on the channel tab (TTabControl) | screen state only |
| `aba` | `nome` | click on the page (TPageControl) | nothing |
| `bico_radio` | `lado`, `alt` | nozzle radio (04 × 44) | screen state only |
| `retirar` / `recolocar` | `lado` | `BM_CLICK` on the panel button, waits for the caption to change (idempotent) | the same on the mirrored caption: `get_displays`, `retirar_bico` / `recolocar_bico` of the nozzle on screen only if needed, wait for the caption |
| `abastecer` | `lado`, `segundos` (3) | lift, wait, hang up | button (lift), `aguardar`, button (hang up) |
| `dip` | `n` 1–4, `ligado` | checkbox, only if different | `set_dip {n, on}` |
| `velocidade` | `valor` Lento/Normal/Rapido | radio | `set_velocidade` (lento/normal/rapido) |
| `modelo` | `valor` Horustech/CBC-06/CBC-05/CBC-02 | combo + `CBN_SELCHANGE`, checks the readback | `set_modelo` |
| `automacao` | `valor` Ligado/Desligado | combo | `set_automacao {on}` |
| `porta` | `valor` 2001/1771/7002 | radio on the Comunicação tab | `abrir_porta` (swaps the single port) |
| `config_padrao` | — | "Carregar configuração padrão" button | `carregar_config_padrao` |
| `fechar_modais` | — | only closes and logs | `liberar_travamento` |
| `remapear` | — | rediscovers the HWNDs | (driver only) |

2.7.2 screen: one channel at a time, left panel = address 1, right = address 2 (channel 1 =
04/05, channel 2 = 08/09), `alt` radio = position 1 (44). The script always sets channel and radio before
lifting/hanging up, because target A's screen persists between cases.

## Adjustments measured on the bench (differ from the contract)

- `TCM_SETCURSEL` does not switch the VCL page: tabs and channels via `WM_LBUTTONDOWN/UP` posted at the
  centre of `TCM_GETITEMRECT` (read through a buffer in the target process). No mouse movement.
- VCL buttons, checkboxes and radios have no UIA pattern: everything is `BM_CLICK` on the HWND.
- The 10053 modal has no IDOK, only IDCANCEL; the driver tries IDOK, IDCANCEL and the "OK" button of
  `TMessageForm`.
- A control on a hidden page: the driver shows the page, acts and goes back to the previous one.
- Lift/hang up is **one** button per side ("Retirar Bico" → "Abastecendo.." → "Concluindo.." →
  "Retirar Bico"); the caption lags the click by ~0.5–1 s, so the driver waits for the state
  (up to 4 s) and treats "Concluindo.." as already hung up.
- Two more captions, measured in the diff r4b run (17/10, `docs/DECISIONS.md` §18): **"Bicos
  Bloqueados"** = blocked panel at rest (after `?C` or `&M B`; clicking it lifts the nozzle) and
  **"Aguarda liberação"** = lifted nozzle waiting for release (clicking it hangs up). Before the fix
  the driver took "Bicos Bloqueados" as lifted: `retirar` did not click and `recolocar` timed out
  (`'Bicos Bloqueados' -> 'Aguarda liberação'`). Now the at-rest set is "Retirar Bico",
  "Retira Bico", "Concluindo..", "Bicos Bloqueados"; anything else is lifted. The remap also finds a
  button that shows any of the seven captions.
- **"Retira Bico"** (without the "r") is what a freshly created panel shows, at start or right after
  "Carregar configuração padrão", until the next tick rewrites it (bench 17/10, under Wine). It is at
  rest: read as "lifted", `retirar` skipped the click and no fueling happened. The Go driver
  (`tools/driver-go`, `LegendaRetiraInicial`) treats it the same way.
- The pump-sim side mirrors this (`clicarBotaoPainel` in `src/diff/executor.ts`): same at-rest set,
  click only when needed, wait up to 4 s for the caption. On `simulador-2.7.2` the caption follows
  the state timer like on the 2.7.2: a lift shows "Abastecendo.." once the fueling starts, or "Aguarda
  liberação" once a tick left it waiting, so both targets return from `retirar` at the same point.

## Outside the driver

- IDF/card (DIFF-14/15): the panel has no control with an HWND. Those steps stay `manual`
  and are reported as skipped on side A, with the reason.
- Two nozzles of the same panel at the same time (EQUIV-MOTOR #66): one button per panel.
- Price levels: only through the protocol (`&U`).
