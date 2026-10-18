package main

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestPosicaoIdaEVolta(t *testing.T) {
	p := Posicao{X: -1200, Y: 40, Largura: 1280, Altura: 820, Maximizada: true}
	got, ok := LerPosicao(p.JSON())
	if !ok || got != p {
		t.Fatalf("got %+v %v", got, ok)
	}
}

func TestPosicaoRejeitada(t *testing.T) {
	for _, s := range []string{
		``, `{`, `[]`, `{}`,
		`{"x":0,"y":0,"largura":639,"altura":800}`,
		`{"x":0,"y":0,"largura":800,"altura":399}`,
		`{"x":0,"y":0,"largura":40000,"altura":800}`,
		`{"x":32000,"y":0,"largura":800,"altura":600}`,
		`{"x":-40000,"y":0,"largura":800,"altura":600}`,
		`{"x":"a","y":0,"largura":800,"altura":600}`,
	} {
		if p, ok := LerPosicao([]byte(s)); ok {
			t.Errorf("%s accepted as %+v", s, p)
		}
	}
	if _, ok := LerPosicao([]byte(`{"x":0,"y":0,"largura":640,"altura":400}`)); !ok {
		t.Error("minimum size rejected")
	}
}

// pump-sim.ico is a copy of tools/icon/pump-sim.ico (go:embed cannot reach outside the module).
func TestIcoIgualAoDoProjeto(t *testing.T) {
	orig, err := os.ReadFile(filepath.Join("..", "icon", "pump-sim.ico"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(orig, icoPumpSim) {
		t.Fatal("tools/window-go/pump-sim.ico differs from tools/icon/pump-sim.ico: copy it again")
	}
}

func TestLerIcoDoProjeto(t *testing.T) {
	imgs, err := lerIco(icoPumpSim)
	if err != nil {
		t.Fatal(err)
	}
	var lados []int
	for _, im := range imgs {
		lados = append(lados, im.Lado)
		if !bytes.HasPrefix(im.Dados, []byte("\x89PNG")) {
			t.Errorf("%d px entry is not PNG", im.Lado)
		}
	}
	// DECISIONS §22 I1: 16, 24, 32, 48, 64, 128, 256.
	if !reflect.DeepEqual(lados, []int{16, 24, 32, 48, 64, 128, 256}) {
		t.Fatalf("sizes %v", lados)
	}
	for lado, want := range map[int]int{16: 16, 20: 24, 32: 32, 40: 48, 300: 256, 1: 16} {
		if im, _ := escolherIco(imgs, lado); im.Lado != want {
			t.Errorf("escolherIco(%d) = %d, want %d", lado, im.Lado, want)
		}
	}
}

func TestLerIcoInvalido(t *testing.T) {
	ruim := func(n uint16, off, tam uint32) []byte {
		b := make([]byte, 6+16)
		binary.LittleEndian.PutUint16(b[2:], 1)
		binary.LittleEndian.PutUint16(b[4:], n)
		binary.LittleEndian.PutUint32(b[6+8:], tam)
		binary.LittleEndian.PutUint32(b[6+12:], off)
		return b
	}
	for i, b := range [][]byte{nil, {0, 0, 2, 0, 1, 0}, ruim(0, 22, 1), ruim(1, 22, 100), ruim(1, 0, 4), ruim(2, 22, 0)} {
		if _, err := lerIco(b); err == nil {
			t.Errorf("case %d accepted", i)
		}
	}
	if _, ok := escolherIco(nil, 16); ok {
		t.Error("escolherIco(nil) ok")
	}
}

func TestVersoes(t *testing.T) {
	if got := MaiorVersao([]string{"120.0.2210.91", "130.0.2849.56", "99.1.1.1", "0.0.0.0", "SetupMetrics", "130.0.2849.6"}); got != "130.0.2849.56" {
		t.Errorf("MaiorVersao = %q", got)
	}
	if got := MaiorVersao([]string{"0.0.0.0", "x", ""}); got != "" {
		t.Errorf("MaiorVersao = %q", got)
	}
}

func TestCandidatosDll(t *testing.T) {
	env := map[string]string{"ProgramFiles(x86)": `C:\Program Files (x86)`, "LOCALAPPDATA": `C:\Users\u\AppData\Local\`}
	raizes := RaizesRuntime(func(k string) string { return env[k] })
	pm, pu := `C:\Program Files (x86)\Microsoft\EdgeWebView\Application`, `C:\Users\u\AppData\Local\Microsoft\EdgeWebView\Application`
	if !reflect.DeepEqual(raizes, []string{pm, pu}) {
		t.Fatalf("raizes %v", raizes)
	}
	got := CandidatosDll([]string{"130.0.2849.56", "0.0.0.0", "", "130.0.2849.56"}, raizes, map[string][]string{pm: {"129.0.1.1", "130.0.2849.56"}, pu: {"131.0.1.2"}}, "x64")
	want := []string{
		pm + `\130.0.2849.56\EBWebView\x64\EmbeddedBrowserWebView.dll`,
		pu + `\130.0.2849.56\EBWebView\x64\EmbeddedBrowserWebView.dll`,
		pu + `\131.0.1.2\EBWebView\x64\EmbeddedBrowserWebView.dll`,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v\nwant %v", got, want)
	}
	if got := CandidatosDll(nil, nil, nil, "x64"); len(got) != 0 {
		t.Fatalf("empty: %v", got)
	}
}
