package main

import (
	"errors"
	"strings"
	"testing"
	"time"
)

type fakeAmb struct {
	t           *testing.T
	pids        []uint32
	saiComClose bool
	log         []string
	agora       time.Time
	portaApos   time.Duration // after Iniciar, port listens once this much fake time passed
	janelaApos  time.Duration
	iniciado    time.Time
	iniExiste   bool
	ini         []byte
	modaisCfg   []Modal
	errRemap    error
	cfgFalhas   int // ConfigPadrao fails this many times first (form still building under Wine)
}

func (f *fakeAmb) reg(s string) { f.log = append(f.log, s) }

func (f *fakeAmb) Processos() ([]uint32, error) { return f.pids, nil }
func (f *fakeAmb) FecharJanelas(pid uint32) error {
	f.reg("WM_CLOSE")
	if f.saiComClose {
		f.pids = nil
	}
	return nil
}
func (f *fakeAmb) AguardarSaida(pid uint32, d time.Duration) (bool, error) {
	f.reg("aguardar")
	return len(f.pids) == 0, nil
}
func (f *fakeAmb) Terminar(pid uint32) error { f.reg("terminar"); f.pids = nil; return nil }
func (f *fakeAmb) DescreverModais(uint32) []string {
	return []string{"Confirma saída?"}
}
func (f *fakeAmb) ApagarIni() (bool, error) {
	f.reg("apagar")
	e := f.iniExiste
	f.iniExiste = false
	return e, nil
}
func (f *fakeAmb) EscreverIni(b []byte) error { f.reg("escrever"); f.ini = b; return nil }
func (f *fakeAmb) Iniciar() (uint32, error) {
	if len(f.pids) != 0 {
		f.t.Error("iniciou com o antigo ainda rodando")
	}
	f.reg("iniciar")
	f.iniciado = f.agora
	f.pids = []uint32{77}
	return 77, nil
}
func (f *fakeAmb) PortaEscutando(porta int, pid uint32) bool {
	return pid == 77 && f.agora.Sub(f.iniciado) >= f.portaApos
}
func (f *fakeAmb) JanelaPronta(pid uint32) bool { return f.agora.Sub(f.iniciado) >= f.janelaApos }
func (f *fakeAmb) ConfigPadrao() ([]Modal, error) {
	f.reg("config_padrao")
	if f.cfgFalhas > 0 {
		f.cfgFalhas--
		return nil, errors.New("grupo de DIPs (6 TCheckBox) não encontrado")
	}
	return f.modaisCfg, nil
}
func (f *fakeAmb) Remapear() error        { f.reg("remapear"); return f.errRemap }
func (f *fakeAmb) Dormir(d time.Duration) { f.agora = f.agora.Add(d) }
func (f *fakeAmb) Agora() time.Time       { return f.agora }

func TestResetSemIni(t *testing.T) {
	f := &fakeAmb{t: t, pids: []uint32{10}, saiComClose: true, iniExiste: true, portaApos: 3 * time.Second, janelaApos: time.Second,
		modaisCfg: []Modal{{Texto: "Configuração padrão carregada"}}}
	det, err := ResetEstado(f, nil, OpcoesReset{})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(f.log, ","); got != "WM_CLOSE,aguardar,apagar,iniciar,config_padrao,remapear" {
		t.Fatalf("sequência %s", got)
	}
	for _, p := range []string{"pid 10 fechado (WM_CLOSE)", "ini apagado", "pid 77 no ar, TCP 2001 em 3.0s", "Carregar configuração padrão (modais: Configuração padrão carregada)", "remapeado"} {
		if !strings.Contains(det, p) {
			t.Errorf("detalhe sem %q: %s", p, det)
		}
	}
}

func TestResetComIniNaoCarregaPadrao(t *testing.T) {
	f := &fakeAmb{t: t, pids: []uint32{10}, saiComClose: true}
	det, err := ResetEstado(f, []byte("[x]\r\n"), OpcoesReset{Porta: 1771})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(f.log, ","); got != "WM_CLOSE,aguardar,escrever,iniciar,remapear" {
		t.Fatalf("sequência %s", got)
	}
	if string(f.ini) != "[x]\r\n" || !strings.Contains(det, "ini escrito (5 bytes)") || !strings.Contains(det, "TCP 1771") {
		t.Fatalf("%q %s", f.ini, det)
	}
}

func TestResetSimuladorFechado(t *testing.T) {
	f := &fakeAmb{t: t}
	det, err := ResetEstado(f, nil, OpcoesReset{})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(f.log, ","); got != "apagar,iniciar,config_padrao,remapear" {
		t.Fatalf("sequência %s", got)
	}
	if !strings.Contains(det, "simulador não estava rodando") || !strings.Contains(det, "ini não existia") {
		t.Fatal(det)
	}
}

func TestResetWmCloseIgnoradoTermina(t *testing.T) {
	f := &fakeAmb{t: t, pids: []uint32{10}, saiComClose: false}
	det, err := ResetEstado(f, nil, OpcoesReset{})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(f.log, ","); !strings.HasPrefix(got, "WM_CLOSE,aguardar,terminar,aguardar,apagar,iniciar") {
		t.Fatalf("sequência %s", got)
	}
	if !strings.Contains(det, "TerminateProcess (modais abertos: Confirma saída?)") {
		t.Fatal(det)
	}
}

func TestResetPortaNaoSobe(t *testing.T) {
	f := &fakeAmb{t: t, portaApos: time.Hour}
	_, err := ResetEstado(f, nil, OpcoesReset{PortaTimeout: 5 * time.Second})
	if err == nil || !strings.Contains(err.Error(), "porta 2001 escutando=false, janela visível=true") {
		t.Fatalf("erro %v", err)
	}
	for _, s := range f.log {
		if s == "config_padrao" || s == "remapear" {
			t.Fatal("não pode mexer na UI se o simulador não subiu")
		}
	}
}

func TestResetDoisProcessos(t *testing.T) {
	f := &fakeAmb{t: t, pids: []uint32{1, 2}}
	if _, err := ResetEstado(f, nil, OpcoesReset{}); err == nil || !strings.Contains(err.Error(), "achei 2") {
		t.Fatalf("erro %v", err)
	}
	if len(f.log) != 0 {
		t.Fatalf("não pode agir com 2 processos: %v", f.log)
	}
}

func TestResetInsisteEnquantoOFormMonta(t *testing.T) {
	f := &fakeAmb{t: t, cfgFalhas: 2}
	det, err := ResetEstado(f, nil, OpcoesReset{})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(f.log, ","); got != "apagar,iniciar,config_padrao,config_padrao,config_padrao,remapear" {
		t.Fatalf("sequência %s", got)
	}
	if !strings.Contains(det, "Carregar configuração padrão (na tentativa 3)") {
		t.Fatalf("detalhe %s", det)
	}
}

func TestResetDesisteDoConfigPadraoNoLimite(t *testing.T) {
	f := &fakeAmb{t: t, cfgFalhas: 1000}
	_, err := ResetEstado(f, nil, OpcoesReset{MapaTimeout: 2 * time.Second})
	if err == nil || !strings.Contains(err.Error(), "5 tentativas") || !strings.Contains(err.Error(), "DIPs") {
		t.Fatalf("erro %v", err)
	}
	if strings.Contains(strings.Join(f.log, ","), "remapear") {
		t.Fatal("remapeou depois do config_padrao falhar")
	}
}
