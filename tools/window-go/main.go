// Command pump-sim-janela is the frameless Windows window of the pump-sim executable: a Win32 window
// without the Windows title bar (resizable, Windows 11 rounded corners, native snap) hosting WebView2
// on the pump-sim UI. The UI's top bar is the drag region and draws minimize / maximize / close
// itself (DECISIONS §32). Pure Go, no cgo: golang.org/x/sys/windows and the WebView2 COM API.
//
//	pump-sim-janela.exe -url http://127.0.0.1:7070/
//	pump-sim-janela.exe -erro "mensagem"
//
// -erro shows a native error dialog (MessageBoxW, title pump-sim) and exits 0 once it is closed:
// the pump-sim executable is a GUI-subsystem program with no console, so a fatal startup error is
// shown this way (DECISIONS §34). -url and -erro are exclusive.
//
// Exit codes: 0 closed by the user, 1 other error, 2 bad arguments, 3 WebView2 runtime missing or
// unusable (the pump-sim executable then falls back to Edge --app / the default browser).
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
)

type config struct {
	URL  string
	Erro string
}

func lerArgs(args []string, saida io.Writer) (config, error) {
	fs := flag.NewFlagSet("pump-sim-janela", flag.ContinueOnError)
	fs.SetOutput(saida)
	u := fs.String("url", "", "URL da UI do pump-sim (loopback, ex.: http://127.0.0.1:7070/)")
	e := fs.String("erro", "", "mostra esta mensagem de erro numa caixa de diálogo e sai")
	if err := fs.Parse(args); err != nil {
		return config{}, err
	}
	if fs.NArg() > 0 {
		return config{}, fmt.Errorf("argumento inesperado: %s", fs.Arg(0))
	}
	if *e != "" {
		if *u != "" {
			return config{}, fmt.Errorf("-erro e -url não andam juntos")
		}
		return config{Erro: *e}, nil
	}
	if *u == "" {
		return config{}, fmt.Errorf("falta -url")
	}
	v, err := ValidarURL(*u)
	if err != nil {
		return config{}, err
	}
	return config{URL: v}, nil
}

func main() {
	c, err := lerArgs(os.Args[1:], os.Stderr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[pump-sim-janela] %v\n", err)
		os.Exit(codigoUso)
	}
	if c.Erro != "" {
		os.Exit(mostrarErro(c.Erro))
	}
	os.Exit(executar(c))
}
