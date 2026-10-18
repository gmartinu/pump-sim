package main

// Remembered window size and position (pure Go): %APPDATA%\pump-sim\janela.json.

import (
	"encoding/json"
)

const (
	// Smallest restored size accepted from the file and enforced while resizing (at 96 dpi).
	larguraMinima = 640
	alturaMinima  = 400
	// Default restored size on first run (at 96 dpi).
	larguraPadrao = 1280
	alturaPadrao  = 820
	// Win32 coordinates are 16-bit signed in practice; anything beyond is a corrupt file.
	coordMaxima = 32767
)

// Posicao is the restored rectangle of the window (GetWindowPlacement's rcNormalPosition, in
// workspace coordinates) plus whether it was maximized when it closed.
type Posicao struct {
	X          int  `json:"x"`
	Y          int  `json:"y"`
	Largura    int  `json:"largura"`
	Altura     int  `json:"altura"`
	Maximizada bool `json:"maximizada"`
}

// LerPosicao parses janela.json. A missing, corrupt or implausible file gives ok=false, and the
// host opens at the default size (the monitor check is done by the Win32 side).
func LerPosicao(b []byte) (Posicao, bool) {
	var p Posicao
	if err := json.Unmarshal(b, &p); err != nil {
		return Posicao{}, false
	}
	if p.Largura < larguraMinima || p.Altura < alturaMinima || p.Largura > coordMaxima || p.Altura > coordMaxima {
		return Posicao{}, false
	}
	if p.X < -coordMaxima || p.Y < -coordMaxima || p.X+p.Largura > coordMaxima || p.Y+p.Altura > coordMaxima {
		return Posicao{}, false
	}
	return p, true
}

// JSON is the file content.
func (p Posicao) JSON() []byte {
	b, _ := json.MarshalIndent(p, "", "  ")
	return append(b, '\n')
}
