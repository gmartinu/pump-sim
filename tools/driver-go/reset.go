package main

// reset_estado orchestration (Gabriel's decision, 17/10): close the 2.7.2, replace or delete its ini, restart it,
// wait for its TCP port, load the default config when no ini was given, remap. Pure: the OS side is Ambiente.

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// Ambiente is what reset_estado needs from the OS.
type Ambiente interface {
	// Processos returns the pids of the 2.7.2 processes currently running.
	Processos() ([]uint32, error)
	// FecharJanelas posts WM_CLOSE to the process' top-level windows.
	FecharJanelas(pid uint32) error
	// AguardarSaida waits up to d for the process to exit.
	AguardarSaida(pid uint32, d time.Duration) (bool, error)
	Terminar(pid uint32) error
	// DescreverModais lists the open dialogs of pid without clicking them.
	DescreverModais(pid uint32) []string
	ApagarIni() (existia bool, err error)
	EscreverIni(b []byte) error
	Iniciar() (uint32, error)
	PortaEscutando(porta int, pid uint32) bool
	// JanelaPronta reports whether the main form (TForm1) of pid is visible.
	JanelaPronta(pid uint32) bool
	// ConfigPadrao clicks "Carregar configuração padrão" (remapping first) and closes the modals it raises.
	ConfigPadrao() ([]Modal, error)
	Remapear() error
	Dormir(d time.Duration)
	Agora() time.Time
}

// OpcoesReset are the timeouts; zero values take the defaults.
type OpcoesReset struct {
	Porta        int
	SaidaTimeout time.Duration // WM_CLOSE -> exit
	PortaTimeout time.Duration // start -> TCP listening + window visible
	Assentar     time.Duration // pause after the window shows, before touching it
	MapaTimeout  time.Duration // how long the first config_padrao/remap may keep failing while the form builds
}

func (o *OpcoesReset) padroes() {
	if o.Porta == 0 {
		o.Porta = 2001
	}
	if o.SaidaTimeout == 0 {
		o.SaidaTimeout = 15 * time.Second
	}
	if o.PortaTimeout == 0 {
		o.PortaTimeout = 30 * time.Second
	}
	if o.Assentar == 0 {
		o.Assentar = 1500 * time.Millisecond
	}
	if o.MapaTimeout == 0 {
		o.MapaTimeout = 10 * time.Second
	}
}

// insistir retries f every 500 ms until it succeeds or d (fake-clock time) passed. Under Wine/CrossOver the
// 2.7.2's form is visible and listening before all its controls exist (bench 17/10: right after the restart
// the remap found no 6-checkbox DIP group, the same call seconds later succeeded), so the first touch of the
// UI after a restart must tolerate a not-yet-built form instead of failing the whole reset.
func insistir(env Ambiente, d time.Duration, f func() error) (int, error) {
	limite := env.Agora().Add(d)
	for n := 1; ; n++ {
		err := f()
		if err == nil || !env.Agora().Before(limite) {
			return n, err
		}
		env.Dormir(500 * time.Millisecond)
	}
}

// ResetEstado runs the sequence and returns a one-line detalhe of what it did.
func ResetEstado(env Ambiente, ini []byte, o OpcoesReset) (string, error) {
	o.padroes()
	var passos []string
	pids, err := env.Processos()
	if err != nil {
		return "", err
	}
	if len(pids) > 1 {
		return "", fmt.Errorf("esperava no máximo 1 processo do simulador, achei %d", len(pids))
	}
	if len(pids) == 1 {
		pid := pids[0]
		if err := env.FecharJanelas(pid); err != nil {
			return "", fmt.Errorf("WM_CLOSE falhou: %v", err)
		}
		saiu, err := env.AguardarSaida(pid, o.SaidaTimeout)
		if err != nil {
			return "", err
		}
		if saiu {
			passos = append(passos, fmt.Sprintf("pid %d fechado (WM_CLOSE)", pid))
		} else {
			// Do not click whatever is open: a close-confirmation answered with Cancel would keep it running.
			modais := env.DescreverModais(pid)
			if err := env.Terminar(pid); err != nil {
				return "", fmt.Errorf("pid %d não saiu em %s após WM_CLOSE e TerminateProcess falhou: %v", pid, o.SaidaTimeout, err)
			}
			if ok, _ := env.AguardarSaida(pid, 5*time.Second); !ok {
				return "", fmt.Errorf("pid %d não saiu nem após TerminateProcess", pid)
			}
			p := fmt.Sprintf("pid %d não saiu em %s após WM_CLOSE; TerminateProcess", pid, o.SaidaTimeout)
			if len(modais) > 0 {
				p += " (modais abertos: " + strings.Join(modais, " | ") + ")"
			}
			passos = append(passos, p)
		}
	} else {
		passos = append(passos, "simulador não estava rodando")
	}

	if ini == nil {
		existia, err := env.ApagarIni()
		if err != nil {
			return "", fmt.Errorf("apagar ini: %v", err)
		}
		if existia {
			passos = append(passos, "ini apagado")
		} else {
			passos = append(passos, "ini não existia")
		}
	} else {
		if err := env.EscreverIni(ini); err != nil {
			return "", fmt.Errorf("escrever ini: %v", err)
		}
		passos = append(passos, fmt.Sprintf("ini escrito (%d bytes)", len(ini)))
	}

	pid, err := env.Iniciar()
	if err != nil {
		return "", fmt.Errorf("iniciar o simulador: %v", err)
	}
	inicio := env.Agora()
	limite := inicio.Add(o.PortaTimeout)
	porta, janela := false, false
	for {
		if !porta {
			porta = env.PortaEscutando(o.Porta, pid)
		}
		if !janela {
			janela = env.JanelaPronta(pid)
		}
		if porta && janela {
			break
		}
		if !env.Agora().Before(limite) {
			return "", fmt.Errorf("pid %d iniciado, mas em %s: porta %d escutando=%v, janela visível=%v (%s)",
				pid, o.PortaTimeout, o.Porta, porta, janela, strings.Join(passos, "; "))
		}
		env.Dormir(200 * time.Millisecond)
	}
	passos = append(passos, fmt.Sprintf("pid %d no ar, TCP %d em %.1fs", pid, o.Porta, env.Agora().Sub(inicio).Seconds()))
	env.Dormir(o.Assentar)

	if ini == nil {
		var modais []Modal
		n, err := insistir(env, o.MapaTimeout, func() error {
			var e error
			modais, e = env.ConfigPadrao()
			return e
		})
		if err != nil {
			return "", fmt.Errorf("Carregar configuração padrão (%d tentativas): %v", n, err)
		}
		p := "Carregar configuração padrão"
		if n > 1 {
			p += fmt.Sprintf(" (na tentativa %d)", n)
		}
		if len(modais) > 0 {
			var t []string
			for _, m := range modais {
				t = append(t, m.Texto)
			}
			p += " (modais: " + strings.Join(t, " | ") + ")"
		}
		passos = append(passos, p)
	}
	n, err := insistir(env, o.MapaTimeout, env.Remapear)
	if err != nil {
		return "", errors.Join(fmt.Errorf("remapear (%d tentativas): %v", n, err), errors.New(strings.Join(passos, "; ")))
	}
	if n > 1 {
		passos = append(passos, fmt.Sprintf("remapeado (na tentativa %d)", n))
	} else {
		passos = append(passos, "remapeado")
	}
	return strings.Join(passos, "; "), nil
}
