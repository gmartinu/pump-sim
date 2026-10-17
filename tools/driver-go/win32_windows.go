//go:build windows

package main

// Thin Win32 layer (no cgo): user32/kernel32/iphlpapi through golang.org/x/sys/windows lazy procs.
// The driver is GOARCH=386 like the 2.7.2, so pointers and LRESULTs are 32-bit on both sides.

import (
	"encoding/binary"
	"fmt"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

type HWND = uintptr

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")
	iphlpapi = windows.NewLazySystemDLL("iphlpapi.dll")

	pEnumWindows              = user32.NewProc("EnumWindows")
	pEnumChildWindows         = user32.NewProc("EnumChildWindows")
	pGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	pIsWindowVisible          = user32.NewProc("IsWindowVisible")
	pIsWindow                 = user32.NewProc("IsWindow")
	pGetParent                = user32.NewProc("GetParent")
	pGetDlgCtrlID             = user32.NewProc("GetDlgCtrlID")
	pGetDlgItem               = user32.NewProc("GetDlgItem")
	pGetWindowRect            = user32.NewProc("GetWindowRect")
	pGetClassNameW            = user32.NewProc("GetClassNameW")
	pSendMessageW             = user32.NewProc("SendMessageW")
	pSendMessageTimeoutW      = user32.NewProc("SendMessageTimeoutW")
	pPostMessageW             = user32.NewProc("PostMessageW")

	pVirtualAllocEx = kernel32.NewProc("VirtualAllocEx")
	pVirtualFreeEx  = kernel32.NewProc("VirtualFreeEx")

	pGetExtendedTcpTable = iphlpapi.NewProc("GetExtendedTcpTable")
)

const (
	wmClose          = 0x0010
	wmGetText        = 0x000D
	wmGetTextLength  = 0x000E
	wmCommand        = 0x0111
	wmLButtonDown    = 0x0201
	wmLButtonUp      = 0x0202
	bmGetCheck       = 0x00F0
	bmClick          = 0x00F5
	cbGetCount       = 0x0146
	cbGetLBText      = 0x0148
	cbGetLBTextLen   = 0x0149
	cbSetCurSel      = 0x014E
	cbnSelChange     = 1
	tcmGetItemCount  = 0x1304
	tcmGetItemRect   = 0x130A
	tcmGetCurSel     = 0x130B
	smtoAbortIfHung  = 0x0002
	textTimeoutMs    = 2000
	clickTimeoutMs   = 3000
	processVMOp      = 0x0008
	processVMRead    = 0x0010
	processVMWrite   = 0x0020
	processQueryInfo = 0x0400
)

// LRESULTs from the 32-bit target are read as int32 (CB_ERR = -1).
func send(h HWND, msg uint32, w, l uintptr) int32 {
	r, _, _ := pSendMessageW.Call(h, uintptr(msg), w, l)
	return int32(r)
}

func sendTimeout(h HWND, msg uint32, w, l uintptr, ms uint32) (int32, bool) {
	var res uintptr
	ok, _, _ := pSendMessageTimeoutW.Call(h, uintptr(msg), w, l, smtoAbortIfHung, uintptr(ms), uintptr(unsafe.Pointer(&res)))
	return int32(res), ok != 0
}

func post(h HWND, msg uint32, w, l uintptr) bool {
	r, _, _ := pPostMessageW.Call(h, uintptr(msg), w, l)
	return r != 0
}

func winPid(h HWND) uint32 {
	var pid uint32
	pGetWindowThreadProcessId.Call(h, uintptr(unsafe.Pointer(&pid)))
	return pid
}

func visivel(h HWND) bool { r, _, _ := pIsWindowVisible.Call(h); return r != 0 }
func existe(h HWND) bool  { r, _, _ := pIsWindow.Call(h); return h != 0 && r != 0 }
func pai(h HWND) HWND     { r, _, _ := pGetParent.Call(h); return r }
func ctrlID(h HWND) int   { r, _, _ := pGetDlgCtrlID.Call(h); return int(int32(r)) }
func dlgItem(d HWND, id int) HWND {
	r, _, _ := pGetDlgItem.Call(d, uintptr(id))
	return r
}

func classe(h HWND) string {
	buf := make([]uint16, 256)
	n, _, _ := pGetClassNameW.Call(h, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	return windows.UTF16ToString(buf[:n])
}

// janelaTexto reads a window caption with WM_GETTEXT (marshalled cross-process by the system), with a timeout so a
// hung 2.7.2 cannot hang the driver.
func janelaTexto(h HWND) string {
	if h == 0 {
		return ""
	}
	n, ok := sendTimeout(h, wmGetTextLength, 0, 0, textTimeoutMs)
	if !ok || n < 0 {
		return ""
	}
	buf := make([]uint16, n+2)
	sendTimeout(h, wmGetText, uintptr(len(buf)), uintptr(unsafe.Pointer(&buf[0])), textTimeoutMs)
	return windows.UTF16ToString(buf)
}

type rect struct{ L, T, R, B int32 }

func retangulo(h HWND) rect {
	var r rect
	pGetWindowRect.Call(h, uintptr(unsafe.Pointer(&r)))
	return r
}

// EnumWindows callbacks are created once (Go limits the number of callbacks) and fed through a locked slice.
var (
	enumMu  sync.Mutex
	enumAcc []HWND
	enumCb  = windows.NewCallback(func(h, _ uintptr) uintptr { enumAcc = append(enumAcc, h); return 1 })
)

func todasTopo() []HWND {
	enumMu.Lock()
	defer enumMu.Unlock()
	enumAcc = nil
	pEnumWindows.Call(enumCb, 0)
	return append([]HWND(nil), enumAcc...)
}

func filhos(p HWND) []HWND {
	enumMu.Lock()
	defer enumMu.Unlock()
	enumAcc = nil
	pEnumChildWindows.Call(p, enumCb, 0)
	return append([]HWND(nil), enumAcc...)
}

// topo: visible top-level windows of pid.
func topo(pid uint32) []HWND {
	var l []HWND
	for _, h := range todasTopo() {
		if winPid(h) == pid && visivel(h) {
			l = append(l, h)
		}
	}
	return l
}

func clicar(h HWND) bool {
	_, ok := sendTimeout(h, bmClick, 0, 0, clickTimeoutMs)
	return ok
}

func marcado(h HWND) bool { return h != 0 && send(h, bmGetCheck, 0, 0) == 1 }

func abaQtd(h HWND) int { return int(send(h, tcmGetItemCount, 0, 0)) }
func abaAtual(h HWND) int {
	if h == 0 {
		return -1
	}
	return int(send(h, tcmGetCurSel, 0, 0))
}

// abaClicar posts WM_LBUTTONDOWN/UP at the centre of TCM_GETITEMRECT (read through a buffer allocated in the
// target process). TCM_SETCURSEL does not switch the VCL page (bench, 17/10).
func abaClicar(h HWND, i int) error {
	pid := winPid(h)
	proc, err := windows.OpenProcess(processVMOp|processVMRead|processVMWrite|processQueryInfo, false, pid)
	if err != nil {
		return fmt.Errorf("OpenProcess falhou: %v", err)
	}
	defer windows.CloseHandle(proc)
	mem, _, e := pVirtualAllocEx.Call(uintptr(proc), 0, 16, windows.MEM_COMMIT|windows.MEM_RESERVE, windows.PAGE_READWRITE)
	if mem == 0 {
		return fmt.Errorf("VirtualAllocEx falhou: %v", e)
	}
	defer pVirtualFreeEx.Call(uintptr(proc), mem, 0, windows.MEM_RELEASE)
	send(h, tcmGetItemRect, uintptr(i), mem)
	var b [16]byte
	var n uintptr
	if err := windows.ReadProcessMemory(proc, mem, &b[0], 16, &n); err != nil {
		return fmt.Errorf("ReadProcessMemory falhou: %v", err)
	}
	l := int32(binary.LittleEndian.Uint32(b[0:]))
	t := int32(binary.LittleEndian.Uint32(b[4:]))
	r := int32(binary.LittleEndian.Uint32(b[8:]))
	bo := int32(binary.LittleEndian.Uint32(b[12:]))
	x, y := (l+r)/2, (t+bo)/2
	lp := uintptr(uint32(y)<<16 | uint32(x)&0xFFFF)
	post(h, wmLButtonDown, 1, lp)
	post(h, wmLButtonUp, 0, lp)
	return nil
}

func comboItens(h HWND) []string {
	n := int(send(h, cbGetCount, 0, 0))
	if n <= 0 {
		return nil
	}
	out := make([]string, n)
	for i := 0; i < n; i++ {
		l := send(h, cbGetLBTextLen, uintptr(i), 0)
		if l < 0 {
			continue
		}
		buf := make([]uint16, l+2)
		send(h, cbGetLBText, uintptr(i), uintptr(unsafe.Pointer(&buf[0])))
		out[i] = windows.UTF16ToString(buf)
	}
	return out
}

// comboSelecionar: CB_SETCURSEL + WM_COMMAND(CBN_SELCHANGE) to the parent, which VCL turns into OnChange.
func comboSelecionar(h HWND, i int) {
	send(h, cbSetCurSel, uintptr(i), 0)
	id := ctrlID(h)
	wp := uintptr(uint32(cbnSelChange)<<16 | uint32(id)&0xFFFF)
	send(pai(h), wmCommand, wp, h)
}

func dialogos(pid uint32) []HWND {
	var l []HWND
	for _, h := range topo(pid) {
		if c := classe(h); c == "#32770" || c == "TMessageForm" {
			l = append(l, h)
		}
	}
	return l
}

// botaoDialogo: IDOK, else IDCANCEL (the 10053 box has only IDCANCEL), else the TButton captioned OK, else the
// first button.
func botaoDialogo(dlg HWND) (HWND, string) {
	if h := dlgItem(dlg, 1); h != 0 {
		return h, "IDOK"
	}
	if h := dlgItem(dlg, 2); h != 0 {
		return h, "IDCANCEL"
	}
	var primeiro HWND
	for _, c := range filhos(dlg) {
		cls := classe(c)
		if cls != "TButton" && cls != "Button" {
			continue
		}
		if primeiro == 0 {
			primeiro = c
		}
		if strings.ReplaceAll(janelaTexto(c), "&", "") == "OK" {
			return c, "TButton OK"
		}
	}
	if primeiro != 0 {
		return primeiro, "TButton (1o)"
	}
	return 0, "nenhum"
}

func textoDialogo(dlg HWND) string {
	var partes []string
	for _, c := range filhos(dlg) {
		if cls := classe(c); cls == "Static" || cls == "TLabel" {
			if t := janelaTexto(c); t != "" {
				partes = append(partes, t)
			}
		}
	}
	return strings.Join(partes, " | ")
}

// processosPorNome lists pids whose image name matches nome (case-insensitive, ".exe" optional).
func processosPorNome(nome string) ([]uint32, error) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, fmt.Errorf("CreateToolhelp32Snapshot: %v", err)
	}
	defer windows.CloseHandle(snap)
	alvo := strings.TrimSuffix(strings.ToLower(nome), ".exe")
	var pe windows.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))
	var out []uint32
	for err = windows.Process32First(snap, &pe); err == nil; err = windows.Process32Next(snap, &pe) {
		n := strings.ToLower(windows.UTF16ToString(pe.ExeFile[:]))
		// Wine may report a full path; compare the base name.
		if i := strings.LastIndexAny(n, `\/`); i >= 0 {
			n = n[i+1:]
		}
		if strings.TrimSuffix(n, ".exe") == alvo {
			out = append(out, pe.ProcessID)
		}
	}
	return out, nil
}

// tcpEscutando checks the IPv4 listener table (no connection is made to the 2.7.2). When the table reports
// owning pids, the listener must belong to pid (another program on 2001, e.g. pump-sim, does not count).
// ok=false means the table could not be read.
func tcpEscutando(porta int, pid uint32) (escutando bool, ok bool) {
	const afInet, tcpTableOwnerPidListener = 2, 3
	var size uint32
	pGetExtendedTcpTable.Call(0, uintptr(unsafe.Pointer(&size)), 0, afInet, tcpTableOwnerPidListener, 0)
	if size == 0 {
		return false, false
	}
	buf := make([]byte, size+1024)
	size = uint32(len(buf))
	r, _, _ := pGetExtendedTcpTable.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)), 0, afInet, tcpTableOwnerPidListener, 0)
	if r != 0 {
		return false, false
	}
	n := binary.LittleEndian.Uint32(buf[0:])
	for i := uint32(0); i < n; i++ {
		off := 4 + i*24 // MIB_TCPROW_OWNER_PID: state, localAddr, localPort, remoteAddr, remotePort, pid
		if int(off+24) > len(buf) {
			break
		}
		row := buf[off : off+24]
		p := int(row[8])<<8 | int(row[9]) // network byte order in the low 16 bits
		owner := binary.LittleEndian.Uint32(row[20:])
		if p == porta && (pid == 0 || owner == 0 || owner == pid) {
			return true, true
		}
	}
	return false, true
}
