package main

// Contract parsing for POST /acao, kept identical to tools/driver-simuladorcbc/driver.ps1 (README "Contract").
// Everything here is pure (no Win32), so it is unit-tested on any OS.

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Comando is a validated POST /acao body.
type Comando struct {
	Tipo     string
	N        int     // canal (1..8), dip (1..4)
	Lado     string  // "esquerdo" | "direito"
	Alt      bool    // bico_radio: position 1 radio
	Ligado   bool    // dip
	Segundos float64 // abastecer
	Valor    string  // velocidade (canonical key), modelo, automacao, porta (as text)
	Nome     string  // aba

	// reset_estado
	Ini           []byte // nil = delete the ini file; non-nil = write these bytes
	AguardarPorta int    // TCP port to wait for after restart; 0 = driver default
}

// TiposAcao lists every accepted tipo, in README order plus reset_estado.
var TiposAcao = []string{
	"canal", "aba", "bico_radio", "retirar", "recolocar", "abastecer", "dip", "velocidade",
	"modelo", "automacao", "porta", "config_padrao", "fechar_modais", "remapear", "reset_estado",
}

// Velocidades maps the canonical key to the 2.7.2 radio caption.
var Velocidades = []struct{ Chave, Legenda string }{{"Lento", "Lento"}, {"Normal", "Normal"}, {"Rapido", "Rápido"}}

// Portas are the three port radios on the Comunicação tab.
var Portas = []string{"2001", "1771", "7002"}

// maxSegundos caps abastecer so one request cannot hold the driver (and its lock) for hours.
const maxSegundos = 600

// ParseAcao decodes and validates a POST /acao body.
func ParseAcao(body []byte) (Comando, error) {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var a map[string]any
	if err := dec.Decode(&a); err != nil {
		return Comando{}, fmt.Errorf("JSON inválido: %v", err)
	}
	if a == nil {
		return Comando{}, fmt.Errorf("corpo deve ser um objeto JSON")
	}
	tipo, ok := a["tipo"].(string)
	if !ok || tipo == "" {
		return Comando{}, fmt.Errorf("tipo ausente")
	}
	c := Comando{Tipo: tipo}
	var err error
	switch tipo {
	case "fechar_modais", "remapear", "config_padrao", "retirar", "recolocar", "bico_radio", "abastecer":
		if tipo == "retirar" || tipo == "recolocar" || tipo == "bico_radio" || tipo == "abastecer" {
			if c.Lado, err = lado(a); err != nil {
				return c, err
			}
		}
		if tipo == "bico_radio" {
			if c.Alt, err = truthy(a, "alt"); err != nil {
				return c, err
			}
		}
		if tipo == "abastecer" {
			c.Segundos = 3
			if v, present := a["segundos"]; present && v != nil {
				f, e := numero(v)
				if e != nil {
					return c, fmt.Errorf("segundos inválido: %v", v)
				}
				// driver.ps1: `if ($a.segundos)` treats 0 as absent.
				if f != 0 {
					c.Segundos = f
				}
			}
			if c.Segundos < 0 || c.Segundos > maxSegundos {
				return c, fmt.Errorf("segundos fora de 0..%d: %v", maxSegundos, c.Segundos)
			}
		}
	case "aba":
		c.Nome, _ = a["nome"].(string)
	case "canal":
		if c.N, err = inteiro(a, "n"); err != nil {
			return c, err
		}
		if c.N < 1 || c.N > 8 {
			return c, fmt.Errorf("canal fora de 1..8: %d", c.N)
		}
	case "dip":
		if c.N, err = inteiro(a, "n"); err != nil {
			return c, err
		}
		if c.N < 1 || c.N > 4 {
			return c, fmt.Errorf("dip fora de 1..4: %d", c.N)
		}
		if c.Ligado, err = truthy(a, "ligado"); err != nil {
			return c, err
		}
	case "velocidade":
		v := texto(a, "valor")
		if v == "" {
			v = texto(a, "velocidade")
		}
		k, ok := VelocidadeCanonica(v)
		if !ok {
			return c, fmt.Errorf("velocidade inválida: %s", v)
		}
		c.Valor = k
	case "modelo", "automacao":
		// Validated later against the combo items read from the screen (like driver.ps1).
		c.Valor = texto(a, "valor")
		if c.Valor == "" {
			c.Valor = texto(a, tipo)
		}
	case "porta":
		p, e := inteiro(a, "valor")
		if e != nil || p == 0 {
			p, _ = inteiro(a, "porta")
		}
		s := strconv.Itoa(p)
		if !contem(Portas, s) {
			return c, fmt.Errorf("porta inválida: %s", s)
		}
		c.Valor = s
	case "reset_estado":
		if v, present := a["ini"]; present && v != nil {
			s, ok := v.(string)
			if !ok {
				return c, fmt.Errorf("ini deve ser texto")
			}
			if c.Ini, err = IniBytes(s); err != nil {
				return c, err
			}
		}
		if v, present := a["ini_base64"]; present && v != nil {
			if c.Ini != nil {
				return c, fmt.Errorf("use ini OU ini_base64, não os dois")
			}
			s, _ := v.(string)
			b, e := base64.StdEncoding.DecodeString(s)
			if e != nil {
				return c, fmt.Errorf("ini_base64 inválido: %v", e)
			}
			c.Ini = b
		}
		if _, present := a["aguardar_porta"]; present {
			if c.AguardarPorta, err = inteiro(a, "aguardar_porta"); err != nil {
				return c, err
			}
			if c.AguardarPorta < 1 || c.AguardarPorta > 65535 {
				return c, fmt.Errorf("aguardar_porta fora de 1..65535: %d", c.AguardarPorta)
			}
		}
	default:
		return c, fmt.Errorf("tipo desconhecido: %s", tipo)
	}
	return c, nil
}

// VelocidadeCanonica mirrors driver.ps1: `-replace 'á','a'` then a case-insensitive hashtable lookup.
func VelocidadeCanonica(v string) (string, bool) {
	n := strings.NewReplacer("á", "a", "Á", "a").Replace(v)
	for _, x := range Velocidades {
		if strings.EqualFold(n, x.Chave) {
			return x.Chave, true
		}
	}
	return "", false
}

func lado(a map[string]any) (string, error) {
	l := texto(a, "lado")
	if l == "" {
		l = "esquerdo"
	}
	if l != "esquerdo" && l != "direito" {
		return "", fmt.Errorf("lado inválido: %s", l)
	}
	return l, nil
}

func texto(a map[string]any, k string) string {
	switch v := a[k].(type) {
	case string:
		return v
	case json.Number:
		return v.String()
	case bool:
		if v {
			return "True"
		}
		return "False"
	}
	return ""
}

func numero(v any) (float64, error) {
	switch x := v.(type) {
	case json.Number:
		return x.Float64()
	case string:
		return strconv.ParseFloat(strings.TrimSpace(x), 64)
	}
	return 0, fmt.Errorf("não numérico")
}

// inteiro accepts a JSON number or a numeric string holding an integer; absent = 0 (PowerShell [int]$null).
func inteiro(a map[string]any, k string) (int, error) {
	v, present := a[k]
	if !present || v == nil {
		return 0, nil
	}
	f, err := numero(v)
	if err != nil || f != math.Trunc(f) || math.Abs(f) > 1<<31 {
		return 0, fmt.Errorf("%s inválido: %v", k, v)
	}
	return int(f), nil
}

// truthy: JSON bool, number (non-zero = true) or the strings true/false/1/0 (case-insensitive). Absent = false.
// Stricter than PowerShell, where any non-empty string (even "false") is $true.
func truthy(a map[string]any, k string) (bool, error) {
	v, present := a[k]
	if !present || v == nil {
		return false, nil
	}
	switch x := v.(type) {
	case bool:
		return x, nil
	case json.Number:
		f, err := x.Float64()
		return err == nil && f != 0, nil
	case string:
		switch strings.ToLower(strings.TrimSpace(x)) {
		case "true", "1":
			return true, nil
		case "false", "0", "":
			return false, nil
		}
	}
	return false, fmt.Errorf("%s deve ser booleano: %v", k, v)
}

func contem(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}

// IniBytes turns a JSON (UTF-8) ini body into the bytes the 2.7.2 reads: Windows-1252 (it is an ANSI Delphi
// app using the profile API) with CRLF line endings. Characters outside Windows-1252 are an error instead of
// being silently replaced.
func IniBytes(s string) ([]byte, error) {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	s = strings.ReplaceAll(s, "\n", "\r\n")
	out := make([]byte, 0, len(s))
	for i, r := range s {
		switch {
		case r < 0x80:
			out = append(out, byte(r))
		case r >= 0xA0 && r <= 0xFF:
			out = append(out, byte(r))
		default:
			b, ok := cp1252Alto[r]
			if !ok {
				return nil, fmt.Errorf("ini: caractere %q (posição %d) não existe em Windows-1252", r, i)
			}
			out = append(out, b)
		}
	}
	return out, nil
}

// cp1252Alto maps the Windows-1252 0x80..0x9F block (the only range that differs from Latin-1).
var cp1252Alto = map[rune]byte{
	'€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
	'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
	'–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
}
