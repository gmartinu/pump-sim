//go:build !windows

package main

import (
	"fmt"
	"os"
)

// executar: the window host is Windows only; elsewhere it builds (for the tests) and exits with
// the "no WebView2" code, so a caller would fall back to a browser.
func executar(config) int {
	fmt.Fprintln(os.Stderr, "[pump-sim-janela] só roda no Windows")
	return codigoSemWebView2
}

// mostrarErro: no dialog outside Windows; the message goes to stderr.
func mostrarErro(msg string) int {
	fmt.Fprintf(os.Stderr, "[pump-sim] %s\n", msg)
	return codigoOk
}
