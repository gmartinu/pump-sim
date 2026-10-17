package main

import "sort"

// Candidato is one control of a group mapped by count (nozzle buttons, nozzle radios, DIP checkboxes).
// Idx points back into the caller's slice so the Win32 side stays out of this pure logic.
type Candidato struct {
	Idx     int
	X       int32
	Visivel bool
}

// SelecionarVisiveis keeps the visible candidates and, when more than max remain, the max leftmost by screen x
// (excesso reports how many were dropped, for a warning). The 2.7.2 can keep a hidden "Retirar Bico" panel
// alive (IsWindowVisible=false) after long runs; counting it broke every nozzle action. If fewer than min are
// visible (controls on an inactive tab sheet report invisible), it falls back to all candidates so a group on a
// hidden page still maps. The result is sorted by ascending x.
func SelecionarVisiveis(cs []Candidato, min, max int) (sel []Candidato, excesso int) {
	for _, c := range cs {
		if c.Visivel {
			sel = append(sel, c)
		}
	}
	if len(sel) < min {
		sel = append([]Candidato(nil), cs...)
	}
	sort.SliceStable(sel, func(i, j int) bool { return sel[i].X < sel[j].X })
	if max > 0 && len(sel) > max {
		excesso = len(sel) - max
		sel = sel[:max]
	}
	return sel, excesso
}
