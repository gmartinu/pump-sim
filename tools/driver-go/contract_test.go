package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestParseAcaoValidos(t *testing.T) {
	casos := []struct {
		corpo string
		quer  Comando
	}{
		{`{"tipo":"canal","n":3}`, Comando{Tipo: "canal", N: 3}},
		{`{"tipo":"canal","n":"8"}`, Comando{Tipo: "canal", N: 8}},
		{`{"tipo":"aba","nome":"Comunicação"}`, Comando{Tipo: "aba", Nome: "Comunicação"}},
		{`{"tipo":"bico_radio","lado":"direito","alt":true}`, Comando{Tipo: "bico_radio", Lado: "direito", Alt: true}},
		{`{"tipo":"bico_radio"}`, Comando{Tipo: "bico_radio", Lado: "esquerdo"}},
		{`{"tipo":"retirar","lado":"esquerdo"}`, Comando{Tipo: "retirar", Lado: "esquerdo"}},
		{`{"tipo":"recolocar","lado":"direito"}`, Comando{Tipo: "recolocar", Lado: "direito"}},
		{`{"tipo":"abastecer","lado":"esquerdo","segundos":3}`, Comando{Tipo: "abastecer", Lado: "esquerdo", Segundos: 3}},
		{`{"tipo":"abastecer"}`, Comando{Tipo: "abastecer", Lado: "esquerdo", Segundos: 3}},
		{`{"tipo":"abastecer","segundos":0}`, Comando{Tipo: "abastecer", Lado: "esquerdo", Segundos: 3}},
		{`{"tipo":"abastecer","segundos":0.5}`, Comando{Tipo: "abastecer", Lado: "esquerdo", Segundos: 0.5}},
		{`{"tipo":"dip","n":2,"ligado":true}`, Comando{Tipo: "dip", N: 2, Ligado: true}},
		{`{"tipo":"dip","n":4,"ligado":false}`, Comando{Tipo: "dip", N: 4}},
		{`{"tipo":"dip","n":1}`, Comando{Tipo: "dip", N: 1}},
		{`{"tipo":"velocidade","valor":"Rapido"}`, Comando{Tipo: "velocidade", Valor: "Rapido"}},
		{`{"tipo":"velocidade","valor":"Rápido"}`, Comando{Tipo: "velocidade", Valor: "Rapido"}},
		{`{"tipo":"velocidade","valor":"lento"}`, Comando{Tipo: "velocidade", Valor: "Lento"}},
		{`{"tipo":"velocidade","velocidade":"Normal"}`, Comando{Tipo: "velocidade", Valor: "Normal"}},
		{`{"tipo":"modelo","valor":"CBC-06"}`, Comando{Tipo: "modelo", Valor: "CBC-06"}},
		{`{"tipo":"modelo","modelo":"Horustech"}`, Comando{Tipo: "modelo", Valor: "Horustech"}},
		{`{"tipo":"automacao","valor":"Desligado"}`, Comando{Tipo: "automacao", Valor: "Desligado"}},
		{`{"tipo":"porta","valor":1771}`, Comando{Tipo: "porta", Valor: "1771"}},
		{`{"tipo":"porta","valor":"7002"}`, Comando{Tipo: "porta", Valor: "7002"}},
		{`{"tipo":"porta","porta":2001}`, Comando{Tipo: "porta", Valor: "2001"}},
		{`{"tipo":"config_padrao"}`, Comando{Tipo: "config_padrao"}},
		{`{"tipo":"fechar_modais"}`, Comando{Tipo: "fechar_modais"}},
		{`{"tipo":"remapear"}`, Comando{Tipo: "remapear"}},
		{`{"tipo":"reset_estado"}`, Comando{Tipo: "reset_estado"}},
		{`{"tipo":"reset_estado","aguardar_porta":1771}`, Comando{Tipo: "reset_estado", AguardarPorta: 1771}},
	}
	for _, c := range casos {
		got, err := ParseAcao([]byte(c.corpo))
		if err != nil {
			t.Errorf("%s: erro %v", c.corpo, err)
			continue
		}
		if got.Tipo != c.quer.Tipo || got.N != c.quer.N || got.Lado != c.quer.Lado || got.Alt != c.quer.Alt ||
			got.Ligado != c.quer.Ligado || got.Segundos != c.quer.Segundos || got.Valor != c.quer.Valor ||
			got.Nome != c.quer.Nome || got.AguardarPorta != c.quer.AguardarPorta || got.Ini != nil {
			t.Errorf("%s: got %+v, quer %+v", c.corpo, got, c.quer)
		}
	}
}

func TestParseAcaoErros(t *testing.T) {
	casos := map[string]string{
		`nope`:                                   "JSON inválido",
		`null`:                                   "objeto JSON",
		`{}`:                                     "tipo ausente",
		`{"tipo":"voar"}`:                        "tipo desconhecido: voar",
		`{"tipo":"canal","n":0}`:                 "canal fora de 1..8: 0",
		`{"tipo":"canal","n":9}`:                 "canal fora de 1..8: 9",
		`{"tipo":"canal","n":1.5}`:               "n inválido",
		`{"tipo":"dip","n":5,"ligado":true}`:     "dip fora de 1..4: 5",
		`{"tipo":"dip","n":1,"ligado":"talvez"}`: "ligado deve ser booleano",
		`{"tipo":"retirar","lado":"meio"}`:       "lado inválido: meio",
		`{"tipo":"velocidade","valor":"Turbo"}`:  "velocidade inválida: Turbo",
		`{"tipo":"porta","valor":8080}`:          "porta inválida: 8080",
		`{"tipo":"porta"}`:                       "porta inválida: 0",
		`{"tipo":"abastecer","segundos":-1}`:     "segundos fora",
		`{"tipo":"abastecer","segundos":601}`:    "segundos fora",
		`{"tipo":"reset_estado","ini":5}`:        "ini deve ser texto",
		`{"tipo":"reset_estado","ini":"a","ini_base64":"YQ=="}`: "não os dois",
		`{"tipo":"reset_estado","ini_base64":"!!"}`:             "ini_base64 inválido",
		`{"tipo":"reset_estado","aguardar_porta":70000}`:        "aguardar_porta fora",
		`{"tipo":"reset_estado","ini":"x=日本"}`:                  "não existe em Windows-1252",
	}
	for corpo, quer := range casos {
		_, err := ParseAcao([]byte(corpo))
		if err == nil || !strings.Contains(err.Error(), quer) {
			t.Errorf("%s: erro %v, queria conter %q", corpo, err, quer)
		}
	}
}

func TestResetIni(t *testing.T) {
	c, err := ParseAcao([]byte(`{"tipo":"reset_estado","ini":"[Geral]\nModelo=CBC-06\nNome=Configuração €\n"}`))
	if err != nil {
		t.Fatal(err)
	}
	quer := []byte("[Geral]\r\nModelo=CBC-06\r\nNome=Configura\xe7\xe3o \x80\r\n")
	if !bytes.Equal(c.Ini, quer) {
		t.Fatalf("ini = %q, quer %q", c.Ini, quer)
	}
	c, err = ParseAcao([]byte(`{"tipo":"reset_estado","ini":""}`))
	if err != nil || c.Ini == nil || len(c.Ini) != 0 {
		t.Fatalf("ini vazio deve escrever arquivo vazio (não apagar): %v %#v", err, c.Ini)
	}
	c, err = ParseAcao([]byte(`{"tipo":"reset_estado","ini_base64":"AP8NCg=="}`))
	if err != nil || !bytes.Equal(c.Ini, []byte{0, 0xff, '\r', '\n'}) {
		t.Fatalf("ini_base64: %v %q", err, c.Ini)
	}
}

func TestIniBytesCRLF(t *testing.T) {
	b, err := IniBytes("a=1\r\nb=2\rc=3\n")
	if err != nil || string(b) != "a=1\r\nb=2\r\nc=3\r\n" {
		t.Fatalf("%v %q", err, b)
	}
}

func TestTodosOsTiposDoReadmeSaoAceitos(t *testing.T) {
	for _, tipo := range TiposAcao {
		corpo := `{"tipo":"` + tipo + `","n":1,"valor":"Normal","porta":2001}`
		if tipo == "porta" {
			corpo = `{"tipo":"porta","valor":2001}`
		}
		if _, err := ParseAcao([]byte(corpo)); err != nil {
			t.Errorf("%s: %v", tipo, err)
		}
	}
}
