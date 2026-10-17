package main

// HTTP layer: routes, guards and JSON shapes of the driver contract. Pure (the UI is behind Sim).

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Modal is one MessageBox the driver closed (or could not close).
type Modal struct {
	Ts     string `json:"ts"`
	Cls    string `json:"cls"`
	Titulo string `json:"titulo"`
	Texto  string `json:"texto"`
	Acao   string `json:"acao"`
}

// Lados holds one value per panel side.
type Lados struct {
	Esquerdo string `json:"esquerdo"`
	Direito  string `json:"direito"`
}

// Estado is the `estado` object of GET /estado and POST /acao (same field order as driver.ps1).
type Estado struct {
	Pid        int             `json:"pid"`
	Aba        *string         `json:"aba"`
	Canal      int             `json:"canal"`
	Dips       map[string]bool `json:"dips"`
	Velocidade *string         `json:"velocidade"`
	Modelo     string          `json:"modelo"`
	Automacao  string          `json:"automacao"`
	RedeAc     *string         `json:"rede_ac"`
	Porta      *int            `json:"porta"`
	Botoes     Lados           `json:"botoes"`
	Bicos      Lados           `json:"bicos"`
}

// Sim is the 2.7.2 UI as the HTTP layer sees it. The Windows implementation drives Win32 messages.
type Sim interface {
	FecharModais() ([]Modal, error)
	Estado() (*Estado, error)
	// Executar runs one validated action; detalhe is null in the reply when empty.
	Executar(c Comando) (detalhe string, err error)
	// Saude never touches the UI (no modal closing, no remap).
	Saude() map[string]any
}

// Server serialises every request: the 2.7.2 UI is a single shared resource (driver.ps1 was single-threaded).
type Server struct {
	Sim   Sim
	Token string // when set, non-loopback peers must send it
	Log   func(string)
	mu    sync.Mutex
}

const maxCorpo = 1 << 20

func (s *Server) logf(format string, a ...any) {
	if s.Log != nil {
		s.Log(fmt.Sprintf(format, a...))
	}
}

func enviar(w http.ResponseWriter, status int, obj any) {
	b, err := json.Marshal(obj)
	if err != nil {
		status, b = 500, []byte(`{"ok":false,"erro":"falha ao serializar a resposta"}`)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(b)
}

func erro(w http.ResponseWriter, status int, msg string) {
	enviar(w, status, map[string]any{"ok": false, "erro": msg})
}

// PeerLoopback reports whether a RemoteAddr ("ip:port") is a loopback address.
func PeerLoopback(remote string) bool {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		host = remote
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// HostLoopback reports whether a Host header names the loopback interface (DNS-rebinding guard).
func HostLoopback(host string) bool {
	h := host
	if hh, _, err := net.SplitHostPort(host); err == nil {
		h = hh
	}
	h = strings.Trim(h, "[]")
	if strings.EqualFold(h, "localhost") {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

func (s *Server) tokenOk(r *http.Request) bool {
	if s.Token == "" {
		return false
	}
	got := r.Header.Get("X-Driver-Token")
	if got == "" {
		if a := r.Header.Get("Authorization"); strings.HasPrefix(a, "Bearer ") {
			got = strings.TrimPrefix(a, "Bearer ")
		}
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(s.Token)) == 1
}

// guarda returns "" when the request may proceed, else the 403 reason.
func (s *Server) guarda(r *http.Request) string {
	if r.Header.Get("Origin") != "" {
		return "requisição de navegador recusada"
	}
	if PeerLoopback(r.RemoteAddr) {
		// Loopback clients (pump-sim diff) send no token; the Host check stops DNS rebinding from a browser.
		if HostLoopback(r.Host) || s.tokenOk(r) {
			return ""
		}
		return "host não é loopback"
	}
	if s.tokenOk(r) {
		return ""
	}
	if s.Token == "" {
		return "só loopback"
	}
	return "token inválido"
}

func nunca(m []Modal) []Modal {
	if m == nil {
		return []Modal{}
	}
	return m
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if motivo := s.guarda(r); motivo != "" {
		erro(w, 403, motivo)
		return
	}
	path := strings.TrimRight(r.URL.Path, "/")
	switch {
	case r.Method == http.MethodGet && path == "/saude":
		// Not under the lock: it must answer while a long action (abastecer, reset) runs.
		saude := s.Sim.Saude()
		saude["ok"] = true
		enviar(w, 200, saude)
	case r.Method == http.MethodGet && path == "/estado":
		s.mu.Lock()
		defer s.mu.Unlock()
		fech, err := s.Sim.FecharModais()
		if err == nil {
			var e *Estado
			if e, err = s.Sim.Estado(); err == nil {
				enviar(w, 200, map[string]any{"ok": true, "estado": e, "modais_fechados": nunca(fech)})
				return
			}
		}
		s.logf("erro: %v", err)
		erro(w, 400, err.Error())
	case r.Method == http.MethodPost && path == "/acao":
		if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
			erro(w, 415, "content-type deve ser application/json")
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, maxCorpo+1))
		if err == nil && len(body) > maxCorpo {
			err = errors.New("corpo maior que 1 MiB")
		}
		if err != nil {
			erro(w, 400, err.Error())
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		s.logf("acao: %s", resumir(body))
		resp, err := s.acao(body)
		if err != nil {
			s.logf("erro: %v", err)
			erro(w, 400, err.Error())
			return
		}
		enviar(w, 200, resp)
	default:
		erro(w, 404, fmt.Sprintf("rota desconhecida: %s %s", r.Method, path))
	}
}

func (s *Server) acao(body []byte) (map[string]any, error) {
	c, err := ParseAcao(body)
	if err != nil {
		return nil, err
	}
	fech, err := s.Sim.FecharModais()
	if err != nil && c.Tipo != "reset_estado" { // reset must work with the 2.7.2 closed or gone
		return nil, err
	}
	detalhe, err := s.Sim.Executar(c)
	if err != nil {
		return nil, err
	}
	fech2, err := s.Sim.FecharModais()
	if err != nil {
		return nil, err
	}
	e, err := s.Sim.Estado()
	if err != nil {
		return nil, err
	}
	var d any
	if detalhe != "" {
		d = detalhe
	}
	return map[string]any{"ok": true, "detalhe": d, "estado": e, "modais_fechados": append(nunca(fech), fech2...)}, nil
}

// resumir keeps the log line short when a reset carries a whole ini body.
func resumir(b []byte) string {
	if len(b) > 300 {
		return string(b[:300]) + fmt.Sprintf("... (%d bytes)", len(b))
	}
	return string(b)
}

// Agora is the timestamp format of modais_fechados[].ts and the log.
func Agora() string { return time.Now().Format(time.RFC3339Nano) }
