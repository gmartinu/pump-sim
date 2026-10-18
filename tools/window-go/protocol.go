package main

// The message protocol between the pump-sim web UI and this window host (pure Go, tested on any OS).
//
// Page → host, through window.chrome.webview.postMessage(object) (the host reads it as JSON):
//
//	{"tipo":"janela","acao":"pronto"}        the page asks for the window state (feature detection)
//	{"tipo":"janela","acao":"minimizar"}
//	{"tipo":"janela","acao":"maximizar"}     toggles maximize / restore
//	{"tipo":"janela","acao":"fechar"}
//	{"tipo":"janela","acao":"arrastar"}      starts a window move (only used when the runtime has no
//	                                         non-client region support, see regiao below)
//	{"tipo":"janela","acao":"cor","cor":"#rrggbb","escuro":true}
//	                                         the top bar color (paints the top resize band) and theme
//
// Host → page, through PostWebMessageAsJson, after "pronto" and whenever the state changes:
//
//	{"tipo":"janela","maximizada":false,"regiao":true}
//
// regiao is true when the runtime accepted IsNonClientRegionSupportEnabled, so CSS app-region: drag
// moves the window by itself; when false the page sends "arrastar" on mousedown over the bar.

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// Exit codes. The pump-sim executable falls back to Edge --app / the default browser on
// codigoSemWebView2 (src/ui/janela.ts, CODIGO_SEM_WEBVIEW2: keep both equal).
const (
	codigoOk          = 0
	codigoErro        = 1
	codigoUso         = 2
	codigoSemWebView2 = 3
)

// corInicial paints the top resize band until the page sends its bar color: #fdfdfe, the light
// theme's --surface, as a COLORREF.
const corInicial = 0x00fefdfd

// Acao is one page → host request.
type Acao string

const (
	AcaoPronto    Acao = "pronto"
	AcaoMinimizar Acao = "minimizar"
	AcaoMaximizar Acao = "maximizar"
	AcaoFechar    Acao = "fechar"
	AcaoArrastar  Acao = "arrastar"
	AcaoCor       Acao = "cor"
)

// Mensagem is a parsed page → host message.
type Mensagem struct {
	Acao Acao
	// Cor is a Win32 COLORREF (0x00BBGGRR); only for AcaoCor.
	Cor uint32
	// Escuro is the page theme; only for AcaoCor.
	Escuro bool
}

var errMensagem = errors.New("mensagem desconhecida")

// LerMensagem parses the JSON text of one web message. Anything that is not a well-formed
// {"tipo":"janela"} message with a known action is rejected (the page cannot make the host do
// anything else).
func LerMensagem(texto string) (Mensagem, error) {
	var m struct {
		Tipo   string `json:"tipo"`
		Acao   string `json:"acao"`
		Cor    string `json:"cor"`
		Escuro bool   `json:"escuro"`
	}
	if err := json.Unmarshal([]byte(texto), &m); err != nil {
		return Mensagem{}, fmt.Errorf("%w: %v", errMensagem, err)
	}
	if m.Tipo != "janela" {
		return Mensagem{}, fmt.Errorf("%w: tipo %q", errMensagem, m.Tipo)
	}
	switch a := Acao(m.Acao); a {
	case AcaoPronto, AcaoMinimizar, AcaoMaximizar, AcaoFechar, AcaoArrastar:
		return Mensagem{Acao: a}, nil
	case AcaoCor:
		c, err := corRef(m.Cor)
		if err != nil {
			return Mensagem{}, err
		}
		return Mensagem{Acao: a, Cor: c, Escuro: m.Escuro}, nil
	default:
		return Mensagem{}, fmt.Errorf("%w: acao %q", errMensagem, m.Acao)
	}
}

// corRef turns "#rrggbb" into a COLORREF (0x00BBGGRR).
func corRef(s string) (uint32, error) {
	if len(s) != 7 || s[0] != '#' {
		return 0, fmt.Errorf("%w: cor %q", errMensagem, s)
	}
	v, err := strconv.ParseUint(s[1:], 16, 32)
	if err != nil {
		return 0, fmt.Errorf("%w: cor %q", errMensagem, s)
	}
	r, g, b := uint32(v>>16)&0xff, uint32(v>>8)&0xff, uint32(v)&0xff
	return b<<16 | g<<8 | r, nil
}

// Estado is the host → page state message.
type Estado struct {
	Maximizada bool
	Regiao     bool
}

// JSON is the text passed to PostWebMessageAsJson.
func (e Estado) JSON() string {
	b, _ := json.Marshal(struct {
		Tipo       string `json:"tipo"`
		Maximizada bool   `json:"maximizada"`
		Regiao     bool   `json:"regiao"`
	}{"janela", e.Maximizada, e.Regiao})
	return string(b)
}

// ValidarURL accepts only the pump-sim UI on loopback: http, host 127.0.0.1 / localhost / [::1],
// an explicit port, no credentials. The host never navigates anywhere else at startup.
func ValidarURL(s string) (string, error) {
	u, err := url.Parse(s)
	if err != nil {
		return "", fmt.Errorf("url inválida: %v", err)
	}
	if u.Scheme != "http" {
		return "", fmt.Errorf("url inválida %q: só http", s)
	}
	if u.User != nil {
		return "", fmt.Errorf("url inválida %q: sem usuário/senha", s)
	}
	host, porta, err := net.SplitHostPort(u.Host)
	if err != nil || porta == "" {
		return "", fmt.Errorf("url inválida %q: falta a porta", s)
	}
	if p, err := strconv.Atoi(porta); err != nil || p < 1 || p > 65535 {
		return "", fmt.Errorf("url inválida %q: porta %q", s, porta)
	}
	switch strings.ToLower(host) {
	case "127.0.0.1", "localhost", "::1":
	default:
		return "", fmt.Errorf("url inválida %q: só loopback", s)
	}
	return u.String(), nil
}
