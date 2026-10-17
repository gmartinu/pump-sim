package main

import (
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const versao = "0.1.0"

func main() {
	listen := flag.String("listen", "127.0.0.1:7071", "address to listen on; a non-loopback address requires -token")
	token := flag.String("token", "", "shared secret non-loopback peers must send (X-Driver-Token or Authorization: Bearer)")
	processo := flag.String("process", "SimuladorCBC Vr 2.7.2", "image name of the 2.7.2 process (without .exe)")
	exe := flag.String("exe", "", `full path of the 2.7.2 exe, for reset_estado (e.g. C:\Companytec\SimuladorCBC Vr 2.7.2.exe)`)
	ini := flag.String("ini", `C:\simcnf.ini`, "the 2.7.2 config file that reset_estado deletes or rewrites")
	portaTCP := flag.Int("tcp-port", 2001, "TCP port reset_estado waits for after restarting the 2.7.2")
	logPath := flag.String("log", filepath.Join(os.TempDir(), "driver-simuladorcbc.log"), "log file")
	vigia := flag.Bool("vigia", false, "background modal watcher: close the 2.7.2 dialogs every -vigia-periodo, like vigia-modais.ps1")
	vigiaPeriodo := flag.Duration("vigia-periodo", 250*time.Millisecond, "period of the -vigia watcher")
	vigiaLog := flag.String("vigia-log", filepath.Join(os.TempDir(), "vigia-modais.txt"), "file the -vigia watcher appends to (fonte, ts, cls, acao, texto)")
	flag.Parse()

	if err := validarListen(*listen, *token); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	if *exe != "" && !strings.EqualFold(strings.TrimSuffix(filepath.Base(strings.ReplaceAll(*exe, `\`, "/")), filepath.Ext(*exe)), *processo) {
		fmt.Fprintf(os.Stderr, "aviso: -exe %q não bate com -process %q; reset_estado vai procurar o processo por -process\n", *exe, *processo)
	}

	var logMu sync.Mutex
	logf := func(msg string) {
		logMu.Lock()
		defer logMu.Unlock()
		f, err := os.OpenFile(*logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return
		}
		defer f.Close()
		fmt.Fprintf(f, "%s %s\r\n", Agora(), msg)
	}

	sim := &WinSim{Processo: *processo, Exe: *exe, Ini: *ini, PortaTCP: *portaTCP, Log: logf, Inicio: time.Now()}
	srv := &Server{Sim: sim, Token: *token, Log: logf}

	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	logf(fmt.Sprintf("driver %s no ar em http://%s/ (pid %d)", versao, ln.Addr(), os.Getpid()))
	fmt.Printf("driver-simuladorcbc %s em http://%s/\n", versao, ln.Addr())
	if _, err := sim.Estado(); err != nil {
		logf("mapa inicial falhou: " + err.Error())
	}
	if *vigia {
		escrever := func(txt string) {
			f, err := os.OpenFile(*vigiaLog, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
			if err != nil {
				return
			}
			defer f.Close()
			f.WriteString(txt)
		}
		escrever(CabecalhoVigia(Agora()))
		v := &Vigia{Periodo: *vigiaPeriodo, Fechar: sim.VigiaTick, Escrever: escrever}
		go v.Rodar(make(chan struct{}))
		logf(fmt.Sprintf("vigia de modais ligado: %s, %s", *vigiaPeriodo, *vigiaLog))
	}
	hs := &http.Server{Handler: srv, ReadHeaderTimeout: 10 * time.Second}
	if err := hs.Serve(ln); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// validarListen: loopback by default; anything else needs a token.
func validarListen(addr, token string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("-listen inválido: %v", err)
	}
	if HostLoopback(host) {
		return nil
	}
	if len(token) < 16 {
		return fmt.Errorf("-listen %s não é loopback: exige -token com pelo menos 16 caracteres", addr)
	}
	return nil
}
