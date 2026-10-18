package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

type fixtureProtocolo struct {
	Mensagens []struct {
		Envio  json.RawMessage `json:"envio"`
		Acao   string          `json:"acao"`
		CorRef uint32          `json:"corRef"`
		Escuro bool            `json:"escuro"`
	} `json:"mensagens"`
	Estado struct {
		Maximizada bool   `json:"maximizada"`
		Regiao     bool   `json:"regiao"`
		JSON       string `json:"json"`
	} `json:"estado"`
}

func lerFixture(t *testing.T) fixtureProtocolo {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "protocolo.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f fixtureProtocolo
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

// The page side (ui/js/janela.js) is checked against the same file by test/janela.test.ts.
func TestMensagensDaFixture(t *testing.T) {
	f := lerFixture(t)
	if len(f.Mensagens) != 6 {
		t.Fatalf("fixture: %d mensagens", len(f.Mensagens))
	}
	for _, m := range f.Mensagens {
		got, err := LerMensagem(string(m.Envio))
		if err != nil {
			t.Fatalf("%s: %v", m.Envio, err)
		}
		want := Mensagem{Acao: Acao(m.Acao), Cor: m.CorRef, Escuro: m.Escuro}
		if got != want {
			t.Errorf("%s: got %+v want %+v", m.Envio, got, want)
		}
	}
}

func TestEstadoDaFixture(t *testing.T) {
	f := lerFixture(t)
	got := Estado{Maximizada: f.Estado.Maximizada, Regiao: f.Estado.Regiao}.JSON()
	if got != f.Estado.JSON {
		t.Errorf("got %s want %s", got, f.Estado.JSON)
	}
	if s := (Estado{}).JSON(); s != `{"tipo":"janela","maximizada":false,"regiao":false}` {
		t.Errorf("zero: %s", s)
	}
}

func TestMensagemRejeitada(t *testing.T) {
	for _, s := range []string{
		``,
		`null`,
		`"minimizar"`,
		`{"acao":"fechar"}`,
		`{"tipo":"outro","acao":"fechar"}`,
		`{"tipo":"janela","acao":"navegar"}`,
		`{"tipo":"janela"}`,
		`{"tipo":"janela","acao":"cor"}`,
		`{"tipo":"janela","acao":"cor","cor":"1a2b3c"}`,
		`{"tipo":"janela","acao":"cor","cor":"#1a2b3"}`,
		`{"tipo":"janela","acao":"cor","cor":"#gg0000"}`,
		`{"tipo":"janela","acao":"cor","cor":"#+12345"}`,
	} {
		if m, err := LerMensagem(s); !errors.Is(err, errMensagem) {
			t.Errorf("%q: got %+v, %v; want errMensagem", s, m, err)
		}
	}
}

func TestCorRef(t *testing.T) {
	for in, want := range map[string]uint32{"#000000": 0, "#ff0000": 0x0000ff, "#00ff00": 0x00ff00, "#0000ff": 0xff0000, "#FDFDFE": 0xfefdfd} {
		if got, err := corRef(in); err != nil || got != want {
			t.Errorf("%s: got %06x, %v; want %06x", in, got, err, want)
		}
	}
	if corInicial != mustCor(t, "#fdfdfe") {
		t.Error("corInicial must be #fdfdfe")
	}
}

func mustCor(t *testing.T, s string) uint32 {
	t.Helper()
	c, err := corRef(s)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestValidarURL(t *testing.T) {
	for _, s := range []string{"http://127.0.0.1:7070/", "http://localhost:7089/", "http://[::1]:7070/", "http://127.0.0.1:7071/#/pista"} {
		if got, err := ValidarURL(s); err != nil || got != s {
			t.Errorf("%s: got %q, %v", s, got, err)
		}
	}
	for _, s := range []string{
		"", "127.0.0.1:7070", "https://127.0.0.1:7070/", "http://127.0.0.1/", "http://example.com:7070/",
		"http://10.0.0.5:7070/", "http://u:p@127.0.0.1:7070/", "file:///C:/x.html", "http://127.0.0.1:0/", "http://127.0.0.1:70000/",
		"javascript:alert(1)",
	} {
		if _, err := ValidarURL(s); err == nil {
			t.Errorf("%q accepted", s)
		}
	}
}

func TestLerArgs(t *testing.T) {
	c, err := lerArgs([]string{"-url", "http://127.0.0.1:7071/"}, io.Discard)
	if err != nil || !reflect.DeepEqual(c, config{URL: "http://127.0.0.1:7071/"}) {
		t.Fatalf("got %+v, %v", c, err)
	}
	for _, a := range [][]string{nil, {"-url", "http://evil.example:80/"}, {"-url", "http://127.0.0.1:7070/", "extra"}, {"-x"}} {
		var buf bytes.Buffer
		if _, err := lerArgs(a, &buf); err == nil {
			t.Errorf("%v accepted", a)
		}
	}
}

// -erro (the fatal-error dialog, DECISIONS §34) needs no -url and excludes it.
func TestLerArgsErro(t *testing.T) {
	msg := "erro ao iniciar: porta já em uso\n\nDetalhes no log: C:\\u\\pump-sim.log"
	c, err := lerArgs([]string{"-erro", msg}, io.Discard)
	if err != nil || !reflect.DeepEqual(c, config{Erro: msg}) {
		t.Fatalf("got %+v, %v", c, err)
	}
	if c, err := lerArgs([]string{"--erro", "-começa com hífen"}, io.Discard); err != nil || c.Erro != "-começa com hífen" {
		t.Fatalf("got %+v, %v", c, err)
	}
	if _, err := lerArgs([]string{"-erro", "x", "-url", "http://127.0.0.1:7070/"}, io.Discard); err == nil {
		t.Error("-erro with -url accepted")
	}
}

// The pump-sim launcher (src/ui/janela.ts) falls back to a browser on this exact code.
func TestCodigoSemWebView2(t *testing.T) {
	if codigoSemWebView2 != 3 {
		t.Fatal("codigoSemWebView2 must stay 3 (CODIGO_SEM_WEBVIEW2 in src/ui/janela.ts)")
	}
}
