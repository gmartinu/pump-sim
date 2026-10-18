package main

// The window icon (pure Go): pump-sim.ico is embedded (a copy of tools/icon/pump-sim.ico, kept equal
// by icone_test.go) and one image is picked per requested size for CreateIconFromResourceEx. The
// host exe itself carries no icon resource: it is never shown in Explorer (it lives in
// %LOCALAPPDATA%\pump-sim), and the taskbar and Alt+Tab use the window's WM_SETICON icons.

import (
	_ "embed"
	"encoding/binary"
	"errors"
)

//go:embed pump-sim.ico
var icoPumpSim []byte

// imagemIco is one entry of an .ico file: its nominal size and the image bytes (PNG or DIB).
type imagemIco struct {
	Lado  int
	Dados []byte
}

var errIco = errors.New("ico inválido")

// lerIco parses an ICONDIR (type 1) and its entries. A width byte of 0 means 256.
func lerIco(b []byte) ([]imagemIco, error) {
	if len(b) < 6 || binary.LittleEndian.Uint16(b[0:]) != 0 || binary.LittleEndian.Uint16(b[2:]) != 1 {
		return nil, errIco
	}
	n := int(binary.LittleEndian.Uint16(b[4:]))
	if n == 0 || len(b) < 6+16*n {
		return nil, errIco
	}
	out := make([]imagemIco, 0, n)
	for i := 0; i < n; i++ {
		e := b[6+16*i:]
		lado := int(e[0])
		if lado == 0 {
			lado = 256
		}
		tam := int(binary.LittleEndian.Uint32(e[8:]))
		off := int(binary.LittleEndian.Uint32(e[12:]))
		if tam <= 0 || off < 6+16*n || off+tam > len(b) {
			return nil, errIco
		}
		out = append(out, imagemIco{Lado: lado, Dados: b[off : off+tam]})
	}
	return out, nil
}

// escolherIco picks the smallest image at least lado px wide, else the largest one: Windows scales
// down well and up badly.
func escolherIco(imgs []imagemIco, lado int) (imagemIco, bool) {
	if len(imgs) == 0 {
		return imagemIco{}, false
	}
	var melhor, maior *imagemIco
	for i := range imgs {
		im := &imgs[i]
		if maior == nil || im.Lado > maior.Lado {
			maior = im
		}
		if im.Lado >= lado && (melhor == nil || im.Lado < melhor.Lado) {
			melhor = im
		}
	}
	if melhor == nil {
		melhor = maior
	}
	return *melhor, true
}
