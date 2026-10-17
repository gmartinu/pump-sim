# driver-go

Go port of [`../driver-simuladorcbc/driver.ps1`](../driver-simuladorcbc/driver.ps1): the HTTP UI driver of the
SimuladorCBC 2.7.2 that plays side A's control API in `pump-sim diff --controle-a`. The HTTP contract is the
same as in [`../driver-simuladorcbc/README.md`](../driver-simuladorcbc/README.md#contract) (that README is
normative for routes, actions, parameters, captions and bench adjustments). This one documents only the
differences.

One 32-bit static `.exe`, no PowerShell, no .NET, no cgo: pure Go plus `golang.org/x/sys/windows`
(user32/kernel32/iphlpapi through lazy DLL procs). It is meant to also run under Wine/CrossOver next to the
2.7.2.

## Build

```sh
CGO_ENABLED=0 GOOS=windows GOARCH=386 go build -trimpath -ldflags="-s -w" -o driver-simuladorcbc.exe .
go test ./...          # pure parts, on any OS
```

`GOARCH=386` because the 2.7.2 is 32-bit: the `TCM_GETITEMRECT` buffer allocated in the target process and the
LRESULTs are then 32-bit on both sides. On a non-Windows OS the binary builds with a stub that answers every
UI call with an error (useful only to exercise the HTTP layer).

## Running

```bat
driver-simuladorcbc.exe -exe "C:\Companytec\SimuladorCBC Vr 2.7.2.exe"
```

| Flag | Default | |
| --- | --- | --- |
| `-listen` | `127.0.0.1:7071` | A non-loopback address refuses to start without `-token` (16+ chars). |
| `-token` | — | Non-loopback peers must send it as `X-Driver-Token: …` or `Authorization: Bearer …`. |
| `-process` | `SimuladorCBC Vr 2.7.2` | Image name of the 2.7.2 (without `.exe`). |
| `-exe` | — | Needed only by `reset_estado` (restart). The working directory is the exe's folder. |
| `-ini` | `C:\simcnf.ini` | The file `reset_estado` deletes or rewrites. |
| `-tcp-port` | `2001` | Port `reset_estado` waits for after the restart. |
| `-log` | `%TEMP%\driver-simuladorcbc.log` | Same log file and line format as `driver.ps1`. |
| `-vigia` | off | Background modal watcher, see below. |
| `-vigia-periodo` | `250ms` | Period of the watcher. |
| `-vigia-log` | `%TEMP%\vigia-modais.txt` | Tab-separated `fonte ts cls acao texto` lines, the `vigia-modais.ps1` format. |

### `-vigia`

The Windows bench runs `vigia-modais.ps1` next to the driver, which dismisses the 2.7.2 MessageBoxes within
~500 ms; steps whose reply leaves only after the modal is closed (`&U` level MessageBox, the date/time encode
errors) depend on it. Under Wine there is no such process, so `-vigia` does the same from inside the driver:
every period it closes the dialogs of the 2.7.2 (`#32770`, `TMessageForm`) with the same button choice as the
action-time close (IDOK, else IDCANCEL, else the `OK` TButton, else the first button), logs each one to the
driver log (`vigia modal: ...`) and to `-vigia-log`. It shares one lock with the action-time close and pauses
while `reset_estado` runs, so a close confirmation during a reset is still described, never clicked.

Unchanged for the client: `pump-sim diff --controle-a http://127.0.0.1:7071 …`.

## Additions to the contract

### `POST /acao {"tipo":"reset_estado", ...}`

Gabriel's decision (17/10): put the 2.7.2 back in a known state between cases.

1. If the 2.7.2 is running, post `WM_CLOSE` to its `TForm1` and wait up to 15 s for the process to exit. If it
   does not exit, the open dialogs are **described, not clicked** (answering a close confirmation with Cancel
   would keep it alive), the process is ended with `TerminateProcess`, and the detalhe says so.
2. Without `ini`: delete `-ini`. With `ini` (text): write it as Windows-1252 with CRLF line endings (a
   character outside Windows-1252 is a 400, not a silent `?`). `ini_base64` writes exact bytes instead. An empty
   `ini` writes an empty file (it does not delete).
3. Start `-exe` (cwd = its folder) and wait up to 30 s for both a TCP listener on `aguardar_porta`
   (default `-tcp-port`) owned by the new pid (read from the IPv4 listener table: no connection is opened, and
   pump-sim listening on 2001 does not count) and a visible `TForm1`; then 1.5 s for the form to settle.
4. Only when no ini was given: remap and click "Carregar configuração padrão", closing the modals it raises
   (their text goes in the detalhe).
5. Remap. The reply is the usual `{ok, detalhe, estado, modais_fechados}`, so `estado` is the post-reset screen.

Unlike every other action, `reset_estado` works when the 2.7.2 is not running.

### `GET /saude`

Never touches the UI (no modal closing, no remap) and is not serialised behind running actions, so it answers
during a 2-minute `abastecer` or a reset:
`{ ok, versao, driver_pid, uptime_s, processo, exe, ini, pids[], ini_existe, porta_tcp{porta, escutando, tabela_ok}, mapa }`.

### Guards

- Requests with an `Origin` header are refused (403): only non-browser clients.
- From loopback, the `Host` must be a loopback name (`127.0.0.1`, `localhost`, `[::1]`), which stops DNS
  rebinding; pump-sim's `fetch` satisfies this and sends no token.
- From any other peer: 403 `só loopback` without `-token`, 403 `token inválido` with a wrong one.
- Body over 1 MiB = 400. All requests are serialised (the 2.7.2 window is one shared resource), as the
  single-threaded PowerShell listener was.

## Differences from `driver.ps1` (behaviour)

- Booleans (`alt`, `ligado`): JSON bool, number, or the strings `true`/`false`/`1`/`0`. PowerShell treated any
  non-empty string, `"false"` included, as true; here other strings are a 400.
- Integers (`n`, `valor` of `porta`): a non-integral number is a 400 (PowerShell rounded).
- `abastecer.segundos` is capped at 600 (one request could otherwise hold the lock for hours).
- Captions and texts are read with `WM_GETTEXT` through `SendMessageTimeout` (2 s, abort if hung), so a hung
  2.7.2 yields empty captions and an error instead of a hung driver.
- `abastecer` reports the hang-up step as `detalhe`, the same as `driver.ps1` (its last `Invoke-Bico`).
- The remap fails with a clear error when a panel has fewer than two nozzle radios (PowerShell indexed `$null`).
