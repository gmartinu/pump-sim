package main

// Background modal watcher (-vigia): the Go counterpart of the Windows bench's vigia-modais.ps1. Every Periodo it
// closes the MessageBoxes / TMessageForm of the 2.7.2 exactly like the action-time close (FecharModais: IDOK, else
// IDCANCEL, else the TButton captioned OK, else the first button) and appends one tab-separated line per modal to a
// file in the vigia-modais.ps1 format ("fonte ts cls acao texto"). Without it, a reply the 2.7.2 only sends after
// the user dismisses a modal never leaves inside the step (Wine has no separate watcher process).

import (
	"fmt"
	"strings"
	"time"
)

// Vigia is the timing/format shell; Fechar is the OS part (WinSim.VigiaTick on Windows).
type Vigia struct {
	Periodo  time.Duration
	Fechar   func() ([]Modal, error) // one pass; must return quickly when there is nothing to close
	Escrever func(string)            // appends text to the vigia file
}

// CabecalhoVigia is the two header lines vigia-modais.ps1 writes.
func CabecalhoVigia(inicio string) string {
	return fmt.Sprintf("# modais do 2.7.2 — vigia do driver Go (%s até o fim)\r\n# fonte\tts\tcls\tacao\ttexto\r\n", inicio)
}

// LinhaVigia formats one closed modal; tabs and line breaks inside fields become spaces so one modal is one line.
func LinhaVigia(m Modal) string {
	limpa := func(s string) string {
		return strings.NewReplacer("\t", " ", "\r\n", " ", "\r", " ", "\n", " ").Replace(s)
	}
	return "vigia\t" + limpa(m.Ts) + "\t" + limpa(m.Cls) + "\t" + limpa(m.Acao) + "\t" + limpa(m.Texto) + "\r\n"
}

// Passo runs one pass and writes its lines; it returns how many modals it closed or described.
func (v *Vigia) Passo() int {
	ms, err := v.Fechar()
	if err != nil || len(ms) == 0 {
		return 0
	}
	var b strings.Builder
	for _, m := range ms {
		b.WriteString(LinhaVigia(m))
	}
	if v.Escrever != nil {
		v.Escrever(b.String())
	}
	return len(ms)
}

// Rodar loops until parar is closed. A zero or negative Periodo falls back to 250 ms.
func (v *Vigia) Rodar(parar <-chan struct{}) {
	p := v.Periodo
	if p <= 0 {
		p = 250 * time.Millisecond
	}
	t := time.NewTicker(p)
	defer t.Stop()
	for {
		select {
		case <-parar:
			return
		case <-t.C:
			v.Passo()
		}
	}
}
