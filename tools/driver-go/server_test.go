package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeSim struct {
	modais  [][]Modal
	execs   []Comando
	semProc bool
	errExec error
	detalhe string
}

func (f *fakeSim) FecharModais() ([]Modal, error) {
	if f.semProc {
		return nil, errors.New("esperava 1 processo 'SimuladorCBC Vr 2.7.2', achei 0")
	}
	if len(f.modais) == 0 {
		return nil, nil
	}
	m := f.modais[0]
	f.modais = f.modais[1:]
	return m, nil
}

func (f *fakeSim) Estado() (*Estado, error) {
	aba := "Canais CBC"
	vel := "Normal"
	porta := 2001
	return &Estado{Pid: 42, Aba: &aba, Canal: 1, Dips: map[string]bool{"1": true, "2": false, "3": false, "4": false, "5": false, "6": false},
		Velocidade: &vel, Modelo: "CBC-06", Automacao: "Ligado", Porta: &porta,
		Botoes: Lados{"Retirar Bico", "Retirar Bico"}, Bicos: Lados{"04", "05"}}, nil
}

func (f *fakeSim) Executar(c Comando) (string, error) {
	f.execs = append(f.execs, c)
	if c.Tipo == "reset_estado" {
		f.semProc = false
	}
	return f.detalhe, f.errExec
}

func (f *fakeSim) Saude() map[string]any { return map[string]any{"versao": versao} }

func req(t *testing.T, s *Server, method, path, ctype, body string, mod ...func(*http.Request)) (int, map[string]any) {
	t.Helper()
	r := httptest.NewRequest(method, "http://127.0.0.1:7071"+path, strings.NewReader(body))
	r.RemoteAddr = "127.0.0.1:50000"
	if ctype != "" {
		r.Header.Set("Content-Type", ctype)
	}
	for _, m := range mod {
		m(r)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("resposta não é JSON: %q", w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("content-type %q", ct)
	}
	return w.Code, out
}

func TestEstado(t *testing.T) {
	f := &fakeSim{}
	s := &Server{Sim: f}
	code, out := req(t, s, "GET", "/estado", "", "")
	if code != 200 || out["ok"] != true {
		t.Fatalf("%d %v", code, out)
	}
	e := out["estado"].(map[string]any)
	for _, k := range []string{"pid", "aba", "canal", "dips", "velocidade", "modelo", "automacao", "rede_ac", "porta", "botoes", "bicos"} {
		if _, ok := e[k]; !ok {
			t.Errorf("estado sem %s", k)
		}
	}
	if e["rede_ac"] != nil {
		t.Errorf("rede_ac ausente deve ser null")
	}
	if m, ok := out["modais_fechados"].([]any); !ok || len(m) != 0 {
		t.Errorf("modais_fechados deve ser [] e não null: %#v", out["modais_fechados"])
	}
	// trailing slash, like driver.ps1 TrimEnd('/')
	if code, _ := req(t, s, "GET", "/estado/", "", ""); code != 200 {
		t.Errorf("/estado/ -> %d", code)
	}
}

func TestAcaoFluxo(t *testing.T) {
	f := &fakeSim{modais: [][]Modal{{{Texto: "antes"}}, {{Texto: "depois"}}}, detalhe: "botão esquerdo 'Retirar Bico' -> 'Abastecendo..'"}
	s := &Server{Sim: f}
	code, out := req(t, s, "POST", "/acao", "application/json; charset=utf-8", `{"tipo":"retirar","lado":"esquerdo"}`)
	if code != 200 || out["ok"] != true {
		t.Fatalf("%d %v", code, out)
	}
	if out["detalhe"] != f.detalhe {
		t.Errorf("detalhe %v", out["detalhe"])
	}
	m := out["modais_fechados"].([]any)
	if len(m) != 2 || m[0].(map[string]any)["texto"] != "antes" || m[1].(map[string]any)["texto"] != "depois" {
		t.Errorf("modais_fechados %v", m)
	}
	if len(f.execs) != 1 || f.execs[0].Lado != "esquerdo" {
		t.Errorf("execs %+v", f.execs)
	}
	f.detalhe = ""
	_, out = req(t, s, "POST", "/acao", "application/json", `{"tipo":"canal","n":1}`)
	if v, ok := out["detalhe"]; !ok || v != nil {
		t.Errorf("detalhe vazio deve ser null: %#v", out["detalhe"])
	}
}

func TestAcaoErros(t *testing.T) {
	f := &fakeSim{}
	s := &Server{Sim: f}
	if code, out := req(t, s, "POST", "/acao", "text/plain", `{"tipo":"canal","n":1}`); code != 415 || out["ok"] != false {
		t.Errorf("sem json: %d %v", code, out)
	}
	if code, out := req(t, s, "POST", "/acao", "application/json", `{"tipo":"canal","n":9}`); code != 400 || out["erro"] != "canal fora de 1..8: 9" {
		t.Errorf("validação: %d %v", code, out)
	}
	if len(f.execs) != 0 {
		t.Error("ação inválida não pode chegar à UI")
	}
	f.errExec = errors.New("não consegui selecionar o canal 1")
	if code, out := req(t, s, "POST", "/acao", "application/json", `{"tipo":"canal","n":1}`); code != 400 || out["erro"] != "não consegui selecionar o canal 1" {
		t.Errorf("erro da UI: %d %v", code, out)
	}
	if code, out := req(t, s, "GET", "/acao", "", ""); code != 404 || out["erro"] != "rota desconhecida: GET /acao" {
		t.Errorf("rota: %d %v", code, out)
	}
	if code, _ := req(t, s, "POST", "/acao", "application/json", strings.Repeat(" ", maxCorpo+1)); code != 400 {
		t.Errorf("corpo grande: %d", code)
	}
}

func TestResetSemProcesso(t *testing.T) {
	f := &fakeSim{semProc: true}
	s := &Server{Sim: f}
	if code, _ := req(t, s, "POST", "/acao", "application/json", `{"tipo":"canal","n":1}`); code != 400 {
		t.Errorf("ação normal sem processo deveria falhar: %d", code)
	}
	code, out := req(t, s, "POST", "/acao", "application/json", `{"tipo":"reset_estado"}`)
	if code != 200 || out["ok"] != true {
		t.Fatalf("reset sem processo: %d %v", code, out)
	}
}

func TestSaude(t *testing.T) {
	s := &Server{Sim: &fakeSim{semProc: true}}
	code, out := req(t, s, "GET", "/saude", "", "")
	if code != 200 || out["ok"] != true || out["versao"] != versao {
		t.Fatalf("%d %v", code, out)
	}
}

func TestGuardas(t *testing.T) {
	s := &Server{Sim: &fakeSim{}}
	remoto := func(r *http.Request) { r.RemoteAddr = "192.168.0.5:40000" }
	if code, out := req(t, s, "GET", "/estado", "", "", remoto); code != 403 || out["erro"] != "só loopback" {
		t.Errorf("remoto sem token: %d %v", code, out)
	}
	if code, _ := req(t, s, "GET", "/estado", "", "", func(r *http.Request) { r.Header.Set("Origin", "http://evil") }); code != 403 {
		t.Errorf("Origin: %d", code)
	}
	if code, _ := req(t, s, "GET", "/estado", "", "", func(r *http.Request) { r.Host = "evil.example:7071" }); code != 403 {
		t.Errorf("DNS rebinding: %d", code)
	}
	if code, _ := req(t, s, "GET", "/estado", "", "", func(r *http.Request) { r.Host = "localhost:7071" }); code != 200 {
		t.Errorf("localhost: %d", code)
	}
	if code, _ := req(t, s, "GET", "/estado", "", "", func(r *http.Request) { r.RemoteAddr = "[::1]:1"; r.Host = "[::1]:7071" }); code != 200 {
		t.Errorf("::1: %d", code)
	}

	s.Token = "0123456789abcdef"
	if code, out := req(t, s, "GET", "/estado", "", "", remoto); code != 403 || out["erro"] != "token inválido" {
		t.Errorf("remoto token ausente: %d %v", code, out)
	}
	if code, _ := req(t, s, "GET", "/estado", "", "", remoto, func(r *http.Request) { r.Header.Set("X-Driver-Token", "errado") }); code != 403 {
		t.Errorf("token errado: %d", code)
	}
	if code, _ := req(t, s, "GET", "/estado", "", "", remoto, func(r *http.Request) { r.Header.Set("X-Driver-Token", s.Token) }); code != 200 {
		t.Errorf("X-Driver-Token: %d", code)
	}
	if code, _ := req(t, s, "GET", "/estado", "", "", remoto, func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+s.Token) }); code != 200 {
		t.Errorf("Bearer: %d", code)
	}
	// loopback peers (pump-sim diff) keep working without a token
	if code, _ := req(t, s, "GET", "/estado", "", ""); code != 200 {
		t.Errorf("loopback com token configurado: %d", code)
	}
}

func TestValidarListen(t *testing.T) {
	if err := validarListen("127.0.0.1:7071", ""); err != nil {
		t.Error(err)
	}
	if err := validarListen("localhost:7071", ""); err != nil {
		t.Error(err)
	}
	if err := validarListen("0.0.0.0:7071", ""); err == nil {
		t.Error("0.0.0.0 sem token deveria falhar")
	}
	if err := validarListen("0.0.0.0:7071", "curto"); err == nil {
		t.Error("token curto deveria falhar")
	}
	if err := validarListen("0.0.0.0:7071", "0123456789abcdef"); err != nil {
		t.Error(err)
	}
	if err := validarListen("7071", ""); err == nil {
		t.Error("endereço inválido")
	}
}
