//go:build !windows

package main

// Non-Windows stub: the binary still builds (and serves the contract with errors) so the pure parts and the HTTP
// layer can be exercised on macOS/Linux. The real driver only makes sense as GOOS=windows.

import (
	"errors"
	"os"
	"time"
)

var errSoWindows = errors.New("driver só funciona no Windows (GOOS=windows)")

type WinSim struct {
	Processo, Exe, Ini string
	PortaTCP           int
	Log                func(string)
	Inicio             time.Time
}

func (s *WinSim) FecharModais() ([]Modal, error)   { return nil, errSoWindows }
func (s *WinSim) VigiaTick() ([]Modal, error)      { return nil, errSoWindows }
func (s *WinSim) Estado() (*Estado, error)         { return nil, errSoWindows }
func (s *WinSim) Executar(Comando) (string, error) { return "", errSoWindows }
func (s *WinSim) Saude() map[string]any {
	return map[string]any{"versao": versao, "driver_pid": os.Getpid(), "erro": errSoWindows.Error()}
}
