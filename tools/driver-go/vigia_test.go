package main

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestLinhaVigiaFormato(t *testing.T) {
	m := Modal{Ts: "2026-10-17T14:50:50.97-03:00", Cls: "#32770", Acao: "BM_CLICK IDCANCEL; fechado", Texto: "Invalid argument to date encode."}
	got := LinhaVigia(m)
	want := "vigia\t2026-10-17T14:50:50.97-03:00\t#32770\tBM_CLICK IDCANCEL; fechado\tInvalid argument to date encode.\r\n"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestLinhaVigiaUmaLinhaPorModal(t *testing.T) {
	got := LinhaVigia(Modal{Ts: "t", Cls: "TMessageForm", Acao: "a", Texto: "linha1\r\nlinha2\tcol\nfim\r"})
	if strings.Count(got, "\t") != 4 || strings.Count(got, "\n") != 1 || !strings.HasSuffix(got, "\r\n") {
		t.Fatalf("not one line of five fields: %q", got)
	}
	if !strings.Contains(got, "linha1 linha2 col fim ") {
		t.Fatalf("text not flattened: %q", got)
	}
}

func TestLinhaVigiaTextoVazio(t *testing.T) {
	got := LinhaVigia(Modal{Ts: "t", Cls: "TMessageForm", Acao: "BM_CLICK TButton OK; ainda aberto"})
	if got != "vigia\tt\tTMessageForm\tBM_CLICK TButton OK; ainda aberto\t\r\n" {
		t.Fatalf("got %q", got)
	}
}

func TestCabecalhoVigia(t *testing.T) {
	h := CabecalhoVigia("X")
	ls := strings.Split(strings.TrimSuffix(h, "\r\n"), "\r\n")
	if len(ls) != 2 || !strings.HasPrefix(ls[0], "# ") || !strings.Contains(ls[0], "X") || ls[1] != "# fonte\tts\tcls\tacao\ttexto" {
		t.Fatalf("header %q", h)
	}
}

func TestPassoEscreveSoQuandoFechou(t *testing.T) {
	var escrito []string
	fila := [][]Modal{nil, {{Ts: "a", Cls: "c", Acao: "x", Texto: "um"}, {Ts: "b", Cls: "c", Acao: "y", Texto: "dois"}}}
	v := &Vigia{
		Fechar: func() ([]Modal, error) {
			m := fila[0]
			fila = fila[1:]
			return m, nil
		},
		Escrever: func(s string) { escrito = append(escrito, s) },
	}
	if n := v.Passo(); n != 0 || len(escrito) != 0 {
		t.Fatalf("empty pass wrote: n=%d %v", n, escrito)
	}
	if n := v.Passo(); n != 2 || len(escrito) != 1 || strings.Count(escrito[0], "\r\n") != 2 {
		t.Fatalf("n=%d escrito=%q", n, escrito)
	}
}

func TestPassoIgnoraErro(t *testing.T) {
	escreveu := false
	v := &Vigia{
		Fechar:   func() ([]Modal, error) { return []Modal{{Texto: "x"}}, errors.New("sem processo") },
		Escrever: func(string) { escreveu = true },
	}
	if v.Passo() != 0 || escreveu {
		t.Fatal("an error pass must not write")
	}
}

func TestRodarParaEPeriodoPadrao(t *testing.T) {
	var mu sync.Mutex
	n := 0
	v := &Vigia{Periodo: 5 * time.Millisecond, Fechar: func() ([]Modal, error) {
		mu.Lock()
		n++
		mu.Unlock()
		return nil, nil
	}}
	parar := make(chan struct{})
	fim := make(chan struct{})
	go func() { v.Rodar(parar); close(fim) }()
	time.Sleep(60 * time.Millisecond)
	close(parar)
	select {
	case <-fim:
	case <-time.After(time.Second):
		t.Fatal("Rodar did not stop")
	}
	mu.Lock()
	defer mu.Unlock()
	if n < 3 {
		t.Fatalf("only %d passes in 60 ms at 5 ms", n)
	}
}
