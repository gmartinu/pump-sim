package main

// Panel button caption state machine (driver.ps1 Invoke-Bico / Test-Retirado). Pure: the Win32 side passes the
// caption reader and the click, so the transitions are unit-tested with a fake button.

import (
	"fmt"
	"time"
)

const (
	LegendaRetirar = "Retirar Bico"
	// LegendaRetiraInicial is the caption a freshly created 2.7.2 panel shows (at start, or right
	// after "Carregar configuração padrão"), without the final "r", until the next state tick rewrites
	// it. Under Wine the driver read it on the first action after config_padrao (bench 17/10), took it
	// for "lifted" and skipped the click, so no fueling happened.
	LegendaRetiraInicial = "Retira Bico"
	LegendaAbastecendo   = "Abastecendo.."
	LegendaRecolocar     = "Recolocar Bico" // contract's caption; not seen on the bench
	LegendaConcluindo    = "Concluindo.."
	LegendaBloqueados    = "Bicos Bloqueados"
	LegendaAguarda       = "Aguarda liberação"
)

// LegendasRepouso: at rest. "Concluindo.." already counts as hung up (a click there would lift again);
// "Bicos Bloqueados" is a blocked panel at rest (clicking it lifts). Anything else is lifted.
var LegendasRepouso = []string{LegendaRetirar, LegendaRetiraInicial, LegendaConcluindo, LegendaBloqueados}

// LegendasBotao: every caption the panel toggle button can show; the remap uses it to find the two buttons.
var LegendasBotao = []string{LegendaRetirar, LegendaRetiraInicial, LegendaAbastecendo, LegendaRecolocar, LegendaConcluindo, LegendaBloqueados, LegendaAguarda}

// Retirado reports whether a caption means the nozzle is lifted.
func Retirado(legenda string) bool { return !contem(LegendasRepouso, legenda) }

// EhLegendaBotao reports whether a TButton caption is one of the panel toggle captions.
func EhLegendaBotao(legenda string) bool { return contem(LegendasBotao, legenda) }

// Botao is one panel toggle button.
type Botao interface {
	Legenda() string
	Clicar() error
}

// Timing of the bench-measured caption lag (driver.ps1: 40 x 100 ms).
const (
	passoEspera  = 100 * time.Millisecond
	passosEspera = 40
)

// AcionarBico lifts (retirar=true) or hangs up the nozzle of one side, idempotently: it clicks only when the
// caption is not already in the wanted state, waits for a running "Concluindo.." to finish before lifting
// again, and then waits up to 4 s for the caption to reach the wanted state.
func AcionarBico(b Botao, lado string, retirar bool, sleep func(time.Duration)) (string, error) {
	antes := b.Legenda()
	if Retirado(antes) != retirar {
		if antes == LegendaConcluindo {
			for k := 0; k < passosEspera && b.Legenda() == LegendaConcluindo; k++ {
				sleep(passoEspera)
			}
		}
		if err := b.Clicar(); err != nil {
			return "", fmt.Errorf("clique no botão do %s falhou: %v", lado, err)
		}
		for k := 0; k < passosEspera && Retirado(b.Legenda()) != retirar; k++ {
			sleep(passoEspera)
		}
	}
	depois := b.Legenda()
	if Retirado(depois) != retirar {
		return "", fmt.Errorf("botão do %s não chegou ao estado esperado em 4 s: '%s' -> '%s'", lado, antes, depois)
	}
	return fmt.Sprintf("botão %s '%s' -> '%s'", lado, antes, depois), nil
}
