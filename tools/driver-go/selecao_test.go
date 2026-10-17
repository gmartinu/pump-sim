package main

import "testing"

func idxs(cs []Candidato) []int {
	var r []int
	for _, c := range cs {
		r = append(r, c.Idx)
	}
	return r
}

func igual(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestSelecionarVisiveis(t *testing.T) {
	casos := []struct {
		nome     string
		in       []Candidato
		min, max int
		want     []int
		excesso  int
	}{
		{"bancada r7: terceiro painel oculto em x=1292", []Candidato{{0, 1292, false}, {1, 400, true}, {2, 800, true}}, 2, 2, []int{1, 2}, 0},
		{"tres visiveis: 2 mais a esquerda + aviso", []Candidato{{0, 900, true}, {1, 100, true}, {2, 500, true}}, 2, 2, []int{1, 2}, 1},
		{"nenhum botao", nil, 2, 2, nil, 0},
		{"todos ocultos (aba inativa): fallback em todos", []Candidato{{0, 300, false}, {1, 100, false}}, 2, 2, []int{1, 0}, 0},
		{"um visivel, um oculto: fallback ordenado", []Candidato{{0, 300, true}, {1, 100, false}}, 2, 2, []int{1, 0}, 0},
		{"ocultos em excesso no fallback", []Candidato{{0, 3, false}, {1, 1, false}, {2, 2, false}}, 2, 2, []int{1, 2}, 1},
		{"sem max: so filtra", []Candidato{{0, 5, true}, {1, 1, false}, {2, 3, true}}, 0, 0, []int{2, 0}, 0},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			got, ex := SelecionarVisiveis(c.in, c.min, c.max)
			if !igual(idxs(got), c.want) || ex != c.excesso {
				t.Fatalf("got %v excesso %d, want %v excesso %d", idxs(got), ex, c.want, c.excesso)
			}
		})
	}
}
