package main

import (
	"strings"
	"testing"
	"time"
)

// fakeBotao simulates the 2.7.2 panel button: a click schedules caption changes that appear after some polls
// (the bench-measured ~0.5-1 s lag), like the state timer on the real form.
type fakeBotao struct {
	legenda  string
	cliques  int
	pendente []string // captions shown on successive reads after a click
	aoClicar func(atual string) []string
	espera   []string // captions shown on successive reads before any click (e.g. Concluindo.. finishing)
}

func (b *fakeBotao) Legenda() string {
	if len(b.espera) > 0 {
		b.legenda, b.espera = b.espera[0], b.espera[1:]
	} else if len(b.pendente) > 0 {
		b.legenda, b.pendente = b.pendente[0], b.pendente[1:]
	}
	return b.legenda
}

func (b *fakeBotao) Clicar() error {
	b.cliques++
	if b.aoClicar != nil {
		b.pendente = b.aoClicar(b.legenda)
	}
	return nil
}

// cicloBancada: the toggle lifecycle measured on the bench.
func cicloBancada(atual string) []string {
	switch atual {
	case LegendaRetirar, LegendaRetiraInicial, LegendaBloqueados:
		return []string{atual, atual, atual, LegendaAbastecendo}
	case LegendaAbastecendo, LegendaAguarda, LegendaRecolocar:
		return []string{atual, LegendaConcluindo}
	}
	return nil
}

func semDormir(time.Duration) {}

func TestRetirado(t *testing.T) {
	repouso := []string{LegendaRetirar, LegendaRetiraInicial, LegendaConcluindo, LegendaBloqueados}
	retirado := []string{LegendaAbastecendo, LegendaRecolocar, LegendaAguarda, "qualquer outra"}
	for _, l := range repouso {
		if Retirado(l) {
			t.Errorf("%q deveria ser repouso", l)
		}
	}
	for _, l := range retirado {
		if !Retirado(l) {
			t.Errorf("%q deveria ser retirado", l)
		}
	}
	for _, l := range LegendasBotao {
		if !EhLegendaBotao(l) {
			t.Errorf("%q deveria ser legenda de botão", l)
		}
	}
	if EhLegendaBotao("Carregar configuração padrão") {
		t.Error("botão de config não é botão de bico")
	}
	if len(LegendasBotao) != 7 {
		t.Errorf("README: a remap acha qualquer uma das sete legendas; tem %d", len(LegendasBotao))
	}
}

func TestAcionarBicoTransicoes(t *testing.T) {
	casos := []struct {
		nome    string
		inicio  string
		retirar bool
		cliques int
		final   string
	}{
		{"retirar do repouso", LegendaRetirar, true, 1, LegendaAbastecendo},
		{"retirar já retirado é idempotente", LegendaAbastecendo, true, 0, LegendaAbastecendo},
		{"recolocar", LegendaAbastecendo, false, 1, LegendaConcluindo},
		{"recolocar já em repouso é idempotente", LegendaRetirar, false, 0, LegendaRetirar},
		{"Concluindo.. já conta como recolocado", LegendaConcluindo, false, 0, LegendaConcluindo},
		// diff r4b (DECISIONS §18): blocked at rest must be clicked to lift.
		{"Bicos Bloqueados: retirar clica", LegendaBloqueados, true, 1, LegendaAbastecendo},
		{"Bicos Bloqueados: recolocar não clica", LegendaBloqueados, false, 0, LegendaBloqueados},
		{"Aguarda liberação: recolocar clica", LegendaAguarda, false, 1, LegendaConcluindo},
		{"Aguarda liberação: retirar não clica", LegendaAguarda, true, 0, LegendaAguarda},
	}
	for _, c := range casos {
		b := &fakeBotao{legenda: c.inicio, aoClicar: cicloBancada}
		det, err := AcionarBico(b, "esquerdo", c.retirar, semDormir)
		if err != nil {
			t.Errorf("%s: %v", c.nome, err)
			continue
		}
		if b.cliques != c.cliques || b.legenda != c.final {
			t.Errorf("%s: cliques=%d legenda=%q, quer %d %q", c.nome, b.cliques, b.legenda, c.cliques, c.final)
		}
		if quer := "botão esquerdo '" + c.inicio + "' -> '" + c.final + "'"; det != quer {
			t.Errorf("%s: detalhe %q, quer %q", c.nome, det, quer)
		}
	}
}

func TestAcionarBicoEsperaConcluindoAntesDeRetirar(t *testing.T) {
	b := &fakeBotao{legenda: LegendaConcluindo, aoClicar: func(atual string) []string {
		if atual != LegendaRetirar {
			t.Errorf("clicou com a legenda %q (devia esperar o Concluindo.. acabar)", atual)
		}
		return cicloBancada(atual)
	}}
	// Legenda() reads: 1 = antes, then the wait loop sees Concluindo.. twice and then Retirar Bico.
	b.espera = []string{LegendaConcluindo, LegendaConcluindo, LegendaConcluindo, LegendaRetirar}
	dormidas := 0
	_, err := AcionarBico(b, "direito", true, func(time.Duration) { dormidas++ })
	if err != nil {
		t.Fatal(err)
	}
	if b.cliques != 1 || b.legenda != LegendaAbastecendo {
		t.Fatalf("cliques=%d legenda=%q", b.cliques, b.legenda)
	}
	if dormidas == 0 {
		t.Fatal("deveria ter esperado")
	}
}

func TestAcionarBicoTimeout(t *testing.T) {
	b := &fakeBotao{legenda: LegendaBloqueados} // click never changes the caption
	dormidas := 0
	_, err := AcionarBico(b, "direito", true, func(time.Duration) { dormidas++ })
	if err == nil || !strings.Contains(err.Error(), "não chegou ao estado esperado em 4 s: 'Bicos Bloqueados' -> 'Bicos Bloqueados'") {
		t.Fatalf("erro %v", err)
	}
	if dormidas != passosEspera {
		t.Fatalf("esperou %d passos, quer %d (4 s)", dormidas, passosEspera)
	}
}

// Bench 17/10 (Wine): right after config_padrao the panel still showed the form's design-time "Retira Bico";
// retirar must click it, not report it as already lifted.
func TestAcionarBicoRetiraDoFormulario(t *testing.T) {
	b := &fakeBotao{legenda: LegendaRetiraInicial, aoClicar: cicloBancada}
	det, err := AcionarBico(b, "esquerdo", true, semDormir)
	if err != nil {
		t.Fatal(err)
	}
	if b.cliques != 1 || !strings.Contains(det, "'Retira Bico' -> 'Abastecendo..'") {
		t.Fatalf("cliques=%d det=%s", b.cliques, det)
	}
	b = &fakeBotao{legenda: LegendaRetiraInicial}
	if _, err := AcionarBico(b, "esquerdo", false, semDormir); err != nil || b.cliques != 0 {
		t.Fatalf("recolocar em repouso clicou %d vezes: %v", b.cliques, err)
	}
}
