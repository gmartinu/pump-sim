# window-go

The window of the pump-sim Windows executable: a Win32 window **without the Windows title bar** that hosts
WebView2 on the pump-sim UI (DECISIONS §32). It resizes and snaps like any Windows 11 window (rounded
corners, shadow, snap layouts), remembers its size and position in `%APPDATA%\pump-sim\janela.json`, and
lets the UI's top bar act as the title bar: the bar drags the window and draws minimize / maximize-restore /
close, wired to the host through `window.chrome.webview.postMessage`.

Pure Go, no cgo, no `WebView2Loader.dll`: `golang.org/x/sys/windows` plus the WebView2 COM interfaces it
calls. It finds the installed WebView2 Evergreen runtime itself (registry, then the install folders).

## Build

```sh
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w -H windowsgui" -o pump-sim-janela.exe .
go test ./...          # pure parts (protocol, saved position, icon, runtime lookup), on any OS
```

You normally do not build it by hand: `npm run build:sea:win` (`tools/build-sea.mjs`) builds it and embeds it
in `pump-sim-win-x64.exe` with its sha256. On a non-Windows OS the binary builds with a stub that exits 3.

## Running

```bat
pump-sim-janela.exe -url http://127.0.0.1:7070/
```

Only `http://` on loopback (`127.0.0.1`, `localhost`, `[::1]`) with a port is accepted. Exit codes: 0 the
user closed the window, 1 other error, 2 bad arguments, 3 the WebView2 runtime is missing or unusable (the
executable then opens the UI in Edge `--app` / the default browser). The pump-sim executable stops the
simulator when the host exits with any other code (DECISIONS §34).

```bat
pump-sim-janela.exe -erro "erro ao iniciar: ..."
```

Shows the message in a native error dialog (`MessageBoxW`, title `pump-sim`) and exits 0 when it is closed.
The pump-sim executable has no console (GUI subsystem, DECISIONS §34), so this is how it shows a fatal
startup error. `-erro` and `-url` are exclusive.

## Messages

Page → host: `{"tipo":"janela","acao":"pronto"|"minimizar"|"maximizar"|"fechar"|"arrastar"}` and
`{"tipo":"janela","acao":"cor","cor":"#rrggbb","escuro":true}`. Host → page:
`{"tipo":"janela","maximizada":false,"regiao":true}`. `testdata/protocolo.json` pins both sides; the page
side is `ui/js/janela.js`.

## Files

| File | |
| --- | --- |
| `main.go` | arguments |
| `protocol.go` | message protocol, URL check, exit codes |
| `posicao.go` | `janela.json` |
| `icone.go`, `pump-sim.ico` | window icon (copy of `../icon/pump-sim.ico`, kept equal by a test) |
| `runtime.go` | where the WebView2 runtime is |
| `janela_windows.go` | the frameless window |
| `webview2_windows.go` | WebView2 COM client |
| `win32_windows.go` | Win32 procs and structs |
| `janela_other.go` | non-Windows stub |
