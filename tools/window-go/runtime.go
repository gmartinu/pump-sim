package main

// Where the WebView2 runtime lives (pure Go). The host does not ship WebView2Loader.dll: like the
// pure-Go loaders of go-webview2 and Wails, it finds the installed Evergreen runtime itself and calls
// the runtime's EmbeddedBrowserWebView.dll, which is what the loader does after its own lookup.
//
// Lookup, per Microsoft's "detect if a WebView2 Runtime is installed": the `pv` value (version) of
// the EdgeUpdate client key {F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}, per machine under
// HKLM\SOFTWARE\WOW6432Node (64-bit Windows) or HKLM\SOFTWARE, per user under HKCU\Software. A missing
// key, an empty pv or "0.0.0.0" means not installed. The runtime then sits in
// <root>\Microsoft\EdgeWebView\Application\<pv>\ with root %ProgramFiles(x86)%, %ProgramFiles% or
// (per user) %LOCALAPPDATA%; when the registry has no usable version, the highest version folder
// found there is used.

import (
	"strconv"
	"strings"
)

// ClienteWebView2 is the EdgeUpdate client GUID of the WebView2 Evergreen runtime.
const ClienteWebView2 = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

// versaoValida: a dotted version of four numbers that is not 0.0.0.0.
func versaoValida(v string) bool {
	p := strings.Split(v, ".")
	if len(p) != 4 {
		return false
	}
	zero := true
	for _, s := range p {
		n, err := strconv.Atoi(s)
		if err != nil || n < 0 {
			return false
		}
		if n != 0 {
			zero = false
		}
	}
	return !zero
}

// compararVersao orders two valid versions numerically (-1, 0, 1).
func compararVersao(a, b string) int {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < 4; i++ {
		x, _ := strconv.Atoi(pa[i])
		y, _ := strconv.Atoi(pb[i])
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	return 0
}

// MaiorVersao is the highest valid version among folder names ("" when none).
func MaiorVersao(nomes []string) string {
	m := ""
	for _, n := range nomes {
		if versaoValida(n) && (m == "" || compararVersao(n, m) > 0) {
			m = n
		}
	}
	return m
}

// RaizesRuntime are the folders that hold <version>\ of the runtime, in lookup order.
func RaizesRuntime(env func(string) string) []string {
	var out []string
	for _, v := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		if r := env(v); r != "" {
			out = append(out, strings.TrimRight(r, `\`)+`\Microsoft\EdgeWebView\Application`)
		}
	}
	return out
}

// CandidatosDll lists the EmbeddedBrowserWebView.dll paths to try, in order: every registry version
// in every root, then the highest version folder of each root (versoesPorRaiz). arq is the runtime's
// architecture folder ("x64" for this amd64 host).
func CandidatosDll(versoesRegistro []string, raizes []string, versoesPorRaiz map[string][]string, arq string) []string {
	var out []string
	visto := map[string]bool{}
	add := func(raiz, v string) {
		p := raiz + `\` + v + `\EBWebView\` + arq + `\EmbeddedBrowserWebView.dll`
		if !visto[p] {
			visto[p] = true
			out = append(out, p)
		}
	}
	for _, v := range versoesRegistro {
		if !versaoValida(v) {
			continue
		}
		for _, r := range raizes {
			add(r, v)
		}
	}
	for _, r := range raizes {
		if v := MaiorVersao(versoesPorRaiz[r]); v != "" {
			add(r, v)
		}
	}
	return out
}
