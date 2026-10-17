//go:build windows

package main

// The 2.7.2 UI driven through Win32 messages: a port of driver.ps1 Find-Map / Get-Estado / Invoke-Acao.

import (
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sys/windows"
)

type ladoMapa struct{ botao, radioPos0, radioAlt HWND }

type mapa struct {
	pid          uint32
	form, pc, tc HWND
	sheets       []string
	lado         map[string]ladoMapa
	dips         map[string]HWND
	vel          map[string]HWND // canonical key (Lento/Normal/Rapido)
	porta        map[string]HWND
	modelo       HWND
	automacao    HWND
	redeAc       HWND
	configPadrao HWND
}

// Pages each control lives on (driver.ps1 $M.pagina).
var paginas = map[string]string{
	"bico": "Canais CBC", "dip": "Configuração CBC", "velocidade": "Configuração CBC", "modelo": "Configuração CBC",
	"automacao": "Configuração CBC", "config_padrao": "Configuração CBC", "porta": "Comunicação",
}

type WinSim struct {
	Processo string // image name without .exe
	Exe      string // full path, for reset_estado
	Ini      string // c:\simcnf.ini
	PortaTCP int
	Log      func(string)
	Inicio   time.Time

	mu sync.Mutex // guards m (Saude reads it outside the server lock)
	m  *mapa

	modalMu    sync.Mutex   // one modal closer at a time: action-time FecharModais and the -vigia watcher
	pausaVigia atomic.Int32 // > 0 while reset_estado runs (its close confirmation is described, never clicked)
}

func (s *WinSim) logf(f string, a ...any) {
	if s.Log != nil {
		s.Log(fmt.Sprintf(f, a...))
	}
}

func dormir(ms int) { time.Sleep(time.Duration(ms) * time.Millisecond) }

func (s *WinSim) simPid() (uint32, error) {
	p, err := processosPorNome(s.Processo)
	if err != nil {
		return 0, err
	}
	if len(p) != 1 {
		return 0, fmt.Errorf("esperava 1 processo '%s', achei %d", s.Processo, len(p))
	}
	return p[0], nil
}

func (s *WinSim) FecharModais() ([]Modal, error) {
	pid, err := s.simPid()
	if err != nil {
		return nil, err
	}
	return s.fecharModaisPid(pid), nil
}

func (s *WinSim) fecharModaisPid(pid uint32) []Modal {
	s.modalMu.Lock()
	out := fecharDialogos(pid)
	s.modalMu.Unlock()
	for _, m := range out {
		s.logf("modal: cls=%s titulo=%q texto=%q acao=%s", m.Cls, m.Titulo, m.Texto, m.Acao)
	}
	return out
}

// VigiaTick is one -vigia pass: the same close as FecharModais, skipped while reset_estado runs, while the
// action-time close holds the dialogs, or when the 2.7.2 is not running exactly once.
func (s *WinSim) VigiaTick() ([]Modal, error) {
	if s.pausaVigia.Load() > 0 {
		return nil, nil
	}
	pid, err := s.simPid()
	if err != nil {
		return nil, err
	}
	if len(dialogos(pid)) == 0 {
		return nil, nil
	}
	if !s.modalMu.TryLock() {
		return nil, nil
	}
	out := fecharDialogos(pid)
	s.modalMu.Unlock()
	for _, m := range out {
		s.logf("vigia modal: cls=%s titulo=%q texto=%q acao=%s", m.Cls, m.Titulo, m.Texto, m.Acao)
	}
	return out, nil
}

// fecharDialogos presses the default button of each open dialog of pid (up to 10), oldest first.
func fecharDialogos(pid uint32) []Modal {
	var out []Modal
	for i := 0; i < 10; i++ {
		d := dialogos(pid)
		if len(d) == 0 {
			break
		}
		dlg := d[0]
		m := Modal{Ts: Agora(), Cls: classe(dlg), Titulo: janelaTexto(dlg), Texto: textoDialogo(dlg)}
		btn, qual := botaoDialogo(dlg)
		if btn == 0 {
			m.Acao = "sem botão"
			out = append(out, m)
			break
		}
		clicar(btn)
		dormir(200)
		fechou := !(existe(dlg) && visivel(dlg))
		estado := "ainda aberto"
		if fechou {
			estado = "fechado"
		}
		m.Acao = fmt.Sprintf("BM_CLICK %s; %s", qual, estado)
		out = append(out, m)
		if !fechou {
			break
		}
	}
	return out
}

type ctl struct {
	h      HWND
	cls    string
	text   string
	r      rect
	parent HWND
	vis    bool
}

// filtrarGrupo applies SelecionarVisiveis to a control group mapped by count and logs dropped extras.
func (s *WinSim) filtrarGrupo(rotulo string, cs []ctl, min, max int) []ctl {
	cand := make([]Candidato, len(cs))
	for i, c := range cs {
		cand[i] = Candidato{Idx: i, X: c.r.L, Visivel: c.vis}
	}
	sel, excesso := SelecionarVisiveis(cand, min, max)
	if excesso > 0 {
		s.logf("aviso: %s: %d candidatos, usando os %d mais à esquerda (descartados %d)", rotulo, len(cs), len(sel), excesso)
	}
	out := make([]ctl, len(sel))
	for i, c := range sel {
		out[i] = cs[c.Idx]
	}
	return out
}

func (s *WinSim) remapear() error {
	pid, err := s.simPid()
	if err != nil {
		return err
	}
	var form HWND
	for _, h := range topo(pid) {
		if classe(h) == "TForm1" {
			form = h
			break
		}
	}
	if form == 0 {
		return errors.New("TForm1 do simulador não encontrado")
	}
	var all []ctl
	for _, h := range filhos(form) {
		all = append(all, ctl{h: h, cls: classe(h), text: janelaTexto(h), r: retangulo(h), parent: pai(h), vis: visivel(h)})
	}
	one := func(c, t string) HWND {
		for _, x := range all {
			if x.cls == c && x.text == t {
				return x.h
			}
		}
		return 0
	}
	first := func(c string) HWND {
		for _, x := range all {
			if x.cls == c {
				return x.h
			}
		}
		return 0
	}
	m := &mapa{pid: pid, form: form, pc: first("TPageControl"), tc: first("TTabControl")}
	if m.pc == 0 || m.tc == 0 {
		return errors.New("TPageControl/TTabControl não encontrados")
	}

	// Window order is not tab order: click each tab once and see which TTabSheet becomes visible.
	var sheetWins []ctl
	for _, x := range all {
		if x.cls == "TTabSheet" && x.parent == m.pc {
			sheetWins = append(sheetWins, x)
		}
	}
	orig := abaAtual(m.pc)
	for t := 0; t < abaQtd(m.pc); t++ {
		if err := abaClicar(m.pc, t); err != nil {
			return err
		}
		for k := 0; k < 20 && abaAtual(m.pc) != t; k++ {
			dormir(50)
		}
		dormir(250)
		nome := "aba" + strconv.Itoa(t)
		for _, w := range sheetWins {
			if visivel(w.h) {
				nome = w.text
				break
			}
		}
		m.sheets = append(m.sheets, nome)
	}
	if orig >= 0 {
		_ = abaClicar(m.pc, orig)
		dormir(300)
	}

	// Nozzle panels: each has a toggle TButton and two TRadioButton siblings; left/right by screen x.
	var botoes []ctl
	for _, x := range all {
		if x.cls == "TButton" && EhLegendaBotao(x.text) {
			botoes = append(botoes, x)
		}
	}
	// Only visible buttons count: the 2.7.2 can keep a hidden 3rd "Retirar Bico" panel (bench r7).
	botoes = s.filtrarGrupo("botões de bico", botoes, 2, 2)
	// Zero buttons is a legitimate state: without simcnf.ini the 2.7.2 starts with no address configured and
	// shows no nozzle panel. Map the rest (the config page, so config_padrao and reset_estado can load the
	// default) and leave m.lado empty; nozzle actions then fail with errSemBicos, and garantirMapa remaps.
	if len(botoes) != 2 && len(botoes) != 0 {
		return fmt.Errorf("esperava 2 botões de bico, achei %d", len(botoes))
	}
	m.lado = map[string]ladoMapa{}
	for i, nome := range []string{"esquerdo", "direito"}[:len(botoes)] {
		b := botoes[i]
		var radios []ctl
		for _, x := range all {
			if x.cls == "TRadioButton" && x.parent == b.parent {
				radios = append(radios, x)
			}
		}
		radios = s.filtrarGrupo("radios de bico "+nome, radios, 2, 2)
		if len(radios) < 2 {
			return fmt.Errorf("painel %s: esperava 2 radios de bico, achei %d", nome, len(radios))
		}
		m.lado[nome] = ladoMapa{botao: b.h, radioPos0: radios[0].h, radioAlt: radios[1].h}
	}

	// DIP group: the first parent (in window order) holding exactly 6 TCheckBox; DIP n by ascending x.
	var ordem []HWND
	grupos := map[HWND][]ctl{}
	for _, x := range all {
		if x.cls == "TCheckBox" {
			if _, ok := grupos[x.parent]; !ok {
				ordem = append(ordem, x.parent)
			}
			grupos[x.parent] = append(grupos[x.parent], x)
		}
	}
	var dip []ctl
	for _, p := range ordem {
		if g := s.filtrarGrupo("DIPs", grupos[p], 6, 0); len(g) == 6 {
			dip = g
			break
		}
	}
	if dip == nil {
		return errors.New("grupo de DIPs (6 TCheckBox) não encontrado")
	}
	m.dips = map[string]HWND{}
	for i, c := range dip {
		m.dips[strconv.Itoa(i+1)] = c.h
	}

	m.vel = map[string]HWND{}
	for _, v := range Velocidades {
		m.vel[v.Chave] = one("TRadioButton", v.Legenda)
	}
	m.porta = map[string]HWND{}
	for _, p := range Portas {
		m.porta[p] = one("TRadioButton", p)
	}

	type combo struct {
		h     HWND
		items []string
		y     int32
	}
	var modelo HWND
	var liga []combo
	for _, x := range all {
		if x.cls != "TComboBox" {
			continue
		}
		c := combo{h: x.h, items: comboItens(x.h), y: x.r.T}
		if modelo == 0 && contem(c.items, "Horustech") {
			modelo = c.h
		}
		if strings.Join(c.items, ";") == "Ligado;Desligado" {
			liga = append(liga, c)
		}
	}
	sort.SliceStable(liga, func(i, j int) bool { return liga[i].y < liga[j].y })
	if modelo == 0 || len(liga) < 1 {
		return errors.New("combos de Modelo/Automação não encontrados")
	}
	m.modelo, m.automacao = modelo, liga[0].h
	if len(liga) > 1 {
		m.redeAc = liga[1].h
	}
	m.configPadrao = one("TButton", "Carregar configuração padrão")

	s.mu.Lock()
	s.m = m
	s.mu.Unlock()
	var ds []string
	for i := 1; i <= 6; i++ {
		ds = append(ds, fmt.Sprintf("%d=%d", i, m.dips[strconv.Itoa(i)]))
	}
	s.logf("remapeado: pid=%d sheets=%s botoes=%d,%d dips=%s", pid, strings.Join(m.sheets, ","),
		m.lado["esquerdo"].botao, m.lado["direito"].botao, strings.Join(ds, ","))
	return nil
}

func (s *WinSim) mapaAtual() *mapa {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.m
}

// garantirMapa = Assert-Map: remap when there is no map, the form is gone, or the pid changed.
func (s *WinSim) garantirMapa() (*mapa, error) {
	m := s.mapaAtual()
	pid, err := s.simPid()
	if err != nil {
		return nil, err
	}
	// A map without nozzle panels is redone every time: config_padrao (or a frame) may have created them.
	if m == nil || !existe(m.form) || winPid(m.form) != pid || len(m.lado) == 0 {
		if err := s.remapear(); err != nil {
			return nil, err
		}
		m = s.mapaAtual()
	}
	return m, nil
}

func (m *mapa) indiceAba(nome string) int {
	for i, x := range m.sheets {
		if x == nome {
			return i
		}
	}
	return -1
}

func (m *mapa) selecionarAba(nome string) error {
	i := m.indiceAba(nome)
	if i < 0 {
		return fmt.Errorf("aba desconhecida: %s (conhecidas: %s)", nome, strings.Join(m.sheets, ", "))
	}
	if abaAtual(m.pc) != i {
		if err := abaClicar(m.pc, i); err != nil {
			return err
		}
		for k := 0; k < 20 && abaAtual(m.pc) != i; k++ {
			dormir(50)
		}
		dormir(300)
	}
	if abaAtual(m.pc) != i {
		return fmt.Errorf("não consegui selecionar a aba %s", nome)
	}
	return nil
}

// naPagina runs body with page nome showing, then puts the previous page back.
func (m *mapa) naPagina(nome string, body func() error) error {
	antes := abaAtual(m.pc)
	if err := m.selecionarAba(nome); err != nil {
		return err
	}
	errBody := body()
	if antes >= 0 && antes < len(m.sheets) && abaAtual(m.pc) != antes {
		if err := m.selecionarAba(m.sheets[antes]); err != nil && errBody == nil {
			return err
		}
	}
	return errBody
}

func (s *WinSim) Estado() (*Estado, error) {
	m, err := s.garantirMapa()
	if err != nil {
		return nil, err
	}
	e := &Estado{Pid: int(m.pid), Dips: map[string]bool{}}
	if i := abaAtual(m.pc); i >= 0 && i < len(m.sheets) {
		e.Aba = &m.sheets[i]
	}
	e.Canal = abaAtual(m.tc) + 1
	for i := 1; i <= 6; i++ {
		k := strconv.Itoa(i)
		e.Dips[k] = marcado(m.dips[k])
	}
	for _, v := range Velocidades {
		if marcado(m.vel[v.Chave]) {
			k := v.Chave
			e.Velocidade = &k
			break
		}
	}
	for _, p := range Portas {
		if marcado(m.porta[p]) {
			n, _ := strconv.Atoi(p)
			e.Porta = &n
			break
		}
	}
	e.Modelo = janelaTexto(m.modelo)
	e.Automacao = janelaTexto(m.automacao)
	if m.redeAc != 0 {
		t := janelaTexto(m.redeAc)
		e.RedeAc = &t
	}
	e.Botoes = Lados{janelaTexto(m.lado["esquerdo"].botao), janelaTexto(m.lado["direito"].botao)}
	bico := func(l string) string {
		if marcado(m.lado[l].radioAlt) {
			return janelaTexto(m.lado[l].radioAlt)
		}
		return janelaTexto(m.lado[l].radioPos0)
	}
	e.Bicos = Lados{bico("esquerdo"), bico("direito")}
	return e, nil
}

type botaoWin HWND

func (b botaoWin) Legenda() string { return janelaTexto(HWND(b)) }
func (b botaoWin) Clicar() error {
	clicar(HWND(b)) // a timeout here usually means the click raised a modal; the caption wait decides
	return nil
}

var errSemBicos = errors.New("simulador sem painéis de bico (nenhum endereço configurado; use config_padrao ou reset_estado)")

func (s *WinSim) bico(m *mapa, lado string, retirar bool) (string, error) {
	if _, ok := m.lado[lado]; !ok {
		return "", errSemBicos
	}
	var det string
	err := m.naPagina(paginas["bico"], func() error {
		var e error
		det, e = AcionarBico(botaoWin(m.lado[lado].botao), lado, retirar, time.Sleep)
		return e
	})
	return det, err
}

func setToggle(h HWND, want bool) bool {
	if marcado(h) != want {
		clicar(h)
		dormir(200)
	}
	return marcado(h) == want
}

func (s *WinSim) Executar(c Comando) (string, error) {
	if c.Tipo == "reset_estado" {
		s.pausaVigia.Add(1)
		defer s.pausaVigia.Add(-1)
		s.mu.Lock()
		s.m = nil
		s.mu.Unlock()
		porta := c.AguardarPorta
		if porta == 0 {
			porta = s.PortaTCP
		}
		return ResetEstado(s, c.Ini, OpcoesReset{Porta: porta})
	}
	m, err := s.garantirMapa()
	if err != nil {
		return "", err
	}
	switch c.Tipo {
	case "fechar_modais":
		return "", nil
	case "remapear":
		return "", s.remapear()
	case "aba":
		return "", m.selecionarAba(c.Nome)
	case "canal":
		err := m.naPagina(paginas["bico"], func() error {
			if abaAtual(m.tc) != c.N-1 {
				if err := abaClicar(m.tc, c.N-1); err != nil {
					return err
				}
				dormir(400)
			}
			return nil
		})
		if err != nil {
			return "", err
		}
		if abaAtual(m.tc) != c.N-1 {
			return "", fmt.Errorf("não consegui selecionar o canal %d", c.N)
		}
		return "", nil
	case "bico_radio":
		if _, ok := m.lado[c.Lado]; !ok {
			return "", errSemBicos
		}
		h := m.lado[c.Lado].radioPos0
		if c.Alt {
			h = m.lado[c.Lado].radioAlt
		}
		if err := m.naPagina(paginas["bico"], func() error {
			if !marcado(h) {
				clicar(h)
				dormir(200)
			}
			return nil
		}); err != nil {
			return "", err
		}
		if !marcado(h) {
			return "", errors.New("radio do bico não marcou")
		}
		return "", nil
	case "retirar", "recolocar":
		return s.bico(m, c.Lado, c.Tipo == "retirar")
	case "abastecer":
		d1, err := s.bico(m, c.Lado, true)
		if err != nil {
			return "", err
		}
		time.Sleep(time.Duration(c.Segundos * float64(time.Second)))
		d2, err := s.bico(m, c.Lado, false)
		if err != nil {
			return "", err
		}
		_ = d1
		return d2, nil // driver.ps1 reports the last Invoke-Bico
	case "dip":
		k := strconv.Itoa(c.N)
		ok := false
		if err := m.naPagina(paginas["dip"], func() error { ok = setToggle(m.dips[k], c.Ligado); return nil }); err != nil {
			return "", err
		}
		if !ok {
			return "", fmt.Errorf("DIP%d não ficou em %v", c.N, boolPS(c.Ligado))
		}
		return "", nil
	case "velocidade":
		h := m.vel[c.Valor]
		if err := m.naPagina(paginas["velocidade"], func() error {
			if !marcado(h) {
				clicar(h)
				dormir(200)
			}
			return nil
		}); err != nil {
			return "", err
		}
		if !marcado(h) {
			return "", fmt.Errorf("velocidade não ficou em %s", c.Valor)
		}
		return "", nil
	case "modelo", "automacao":
		h := m.modelo
		if c.Tipo == "automacao" {
			h = m.automacao
		}
		items := comboItens(h)
		i := -1
		for k, x := range items {
			if x == c.Valor {
				i = k
				break
			}
		}
		if i < 0 {
			return "", fmt.Errorf("%s inválido: %s (opções: %s)", c.Tipo, c.Valor, strings.Join(items, ", "))
		}
		if err := m.naPagina(paginas[c.Tipo], func() error {
			if janelaTexto(h) != c.Valor {
				comboSelecionar(h, i)
				dormir(300)
			}
			return nil
		}); err != nil {
			return "", err
		}
		if t := janelaTexto(h); t != c.Valor {
			return "", fmt.Errorf("%s não ficou em %s (lido: %s)", c.Tipo, c.Valor, t)
		}
		return "", nil
	case "porta":
		h := m.porta[c.Valor]
		if err := m.naPagina(paginas["porta"], func() error {
			if !marcado(h) {
				clicar(h)
				dormir(300)
			}
			return nil
		}); err != nil {
			return "", err
		}
		if !marcado(h) {
			return "", fmt.Errorf("porta não ficou em %s", c.Valor)
		}
		return "", nil
	case "config_padrao":
		return "", s.configPadrao(m)
	}
	return "", fmt.Errorf("tipo desconhecido: %s", c.Tipo)
}

func boolPS(b bool) string {
	if b {
		return "True"
	}
	return "False"
}

func (s *WinSim) configPadrao(m *mapa) error {
	if m.configPadrao == 0 {
		return errors.New("botão 'Carregar configuração padrão' não encontrado")
	}
	return m.naPagina(paginas["config_padrao"], func() error {
		clicar(m.configPadrao)
		dormir(500)
		return nil
	})
}

func (s *WinSim) Saude() map[string]any {
	r := map[string]any{
		"versao":     versao,
		"driver_pid": os.Getpid(),
		"uptime_s":   int(time.Since(s.Inicio).Seconds()),
		"processo":   s.Processo,
		"exe":        s.Exe,
		"ini":        s.Ini,
	}
	pids, err := processosPorNome(s.Processo)
	if err != nil {
		r["erro_processos"] = err.Error()
	}
	if pids == nil {
		pids = []uint32{}
	}
	r["pids"] = pids
	_, e := os.Stat(s.Ini)
	r["ini_existe"] = e == nil
	var pid uint32
	if len(pids) == 1 {
		pid = pids[0]
	}
	esc, ok := tcpEscutando(s.PortaTCP, pid)
	r["porta_tcp"] = map[string]any{"porta": s.PortaTCP, "escutando": esc, "tabela_ok": ok}
	m := s.mapaAtual()
	r["mapa"] = m != nil && existe(m.form) && winPid(m.form) == pid
	return r
}

// ---- Ambiente (reset_estado) ----

func (s *WinSim) Processos() ([]uint32, error) { return processosPorNome(s.Processo) }

func (s *WinSim) FecharJanelas(pid uint32) error {
	var n int
	for _, h := range todasTopo() {
		if winPid(h) == pid && classe(h) == "TForm1" {
			post(h, wmClose, 0, 0)
			n++
		}
	}
	if n == 0 {
		// No main form visible: close every top-level window of the process (TApplication included).
		for _, h := range todasTopo() {
			if winPid(h) == pid {
				post(h, wmClose, 0, 0)
				n++
			}
		}
	}
	if n == 0 {
		return fmt.Errorf("nenhuma janela do pid %d", pid)
	}
	return nil
}

func (s *WinSim) AguardarSaida(pid uint32, d time.Duration) (bool, error) {
	h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, pid)
	if err != nil {
		// Already gone (or not ours): consider it exited if the name lookup no longer finds it.
		p, _ := processosPorNome(s.Processo)
		for _, x := range p {
			if x == pid {
				return false, fmt.Errorf("OpenProcess(SYNCHRONIZE) do pid %d: %v", pid, err)
			}
		}
		return true, nil
	}
	defer windows.CloseHandle(h)
	ev, err := windows.WaitForSingleObject(h, uint32(d.Milliseconds()))
	if err != nil {
		return false, err
	}
	return ev == windows.WAIT_OBJECT_0, nil
}

func (s *WinSim) Terminar(pid uint32) error {
	h, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, pid)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(h)
	return windows.TerminateProcess(h, 1)
}

func (s *WinSim) DescreverModais(pid uint32) []string {
	var out []string
	for _, d := range dialogos(pid) {
		out = append(out, strings.TrimSpace(janelaTexto(d)+" "+textoDialogo(d)))
	}
	return out
}

func (s *WinSim) ApagarIni() (bool, error) {
	err := os.Remove(s.Ini)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}

func (s *WinSim) EscreverIni(b []byte) error {
	tmp := s.Ini + ".driver-tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.Ini)
}

func (s *WinSim) Iniciar() (uint32, error) {
	if s.Exe == "" {
		return 0, errors.New("caminho do exe não configurado (flag -exe)")
	}
	cmd := exec.Command(s.Exe)
	cmd.Dir = filepath.Dir(s.Exe)
	if err := cmd.Start(); err != nil {
		return 0, err
	}
	pid := uint32(cmd.Process.Pid)
	_ = cmd.Process.Release()
	s.logf("simulador iniciado: pid=%d exe=%s", pid, s.Exe)
	return pid, nil
}

func (s *WinSim) PortaEscutando(porta int, pid uint32) bool {
	esc, ok := tcpEscutando(porta, pid)
	if ok {
		return esc
	}
	// Table unavailable: fall back to a connect (the 2.7.2 sees one short client).
	c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", porta), 300*time.Millisecond)
	if err != nil {
		return false
	}
	c.Close()
	return true
}

func (s *WinSim) JanelaPronta(pid uint32) bool {
	for _, h := range topo(pid) {
		if classe(h) == "TForm1" {
			return true
		}
	}
	return false
}

func (s *WinSim) ConfigPadrao() ([]Modal, error) {
	if err := s.remapear(); err != nil {
		return nil, err
	}
	pid, err := s.simPid()
	if err != nil {
		return nil, err
	}
	antes := s.fecharModaisPid(pid)
	if err := s.configPadrao(s.mapaAtual()); err != nil {
		return antes, err
	}
	return append(antes, s.fecharModaisPid(pid)...), nil
}

func (s *WinSim) Remapear() error        { return s.remapear() }
func (s *WinSim) Dormir(d time.Duration) { time.Sleep(d) }
func (s *WinSim) Agora() time.Time       { return time.Now() }
