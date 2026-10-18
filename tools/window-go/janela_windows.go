//go:build windows

package main

// The frameless window. It keeps the standard WS_OVERLAPPEDWINDOW style (so DWM keeps the shadow,
// the Windows 11 rounded corners, the min/max animations, Aero Snap and the snap layouts) and only
// removes the caption: WM_NCCALCSIZE gives the caption's height back to the client area, while the
// left, right and bottom resize borders stay native non-client area (invisible on Windows 10/11).
// The top resize edge is a thin band of the client area that the WebView does not cover
// (WM_NCHITTEST answers HTTOP there); the host paints it in the color of the UI's top bar.

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

func init() {
	// COM (STA) and the window belong to the thread that runs main.
	runtime.LockOSThread()
}

var j struct {
	hwnd       uintptr
	wv         *webview
	url        string
	brush      uintptr
	maximizada bool
	codigo     int
	// emLaco is true inside a user move/resize loop (WM_ENTERSIZEMOVE..WM_EXITSIZEMOVE).
	emLaco bool
}

func registrar(msg string, a ...any) { fmt.Fprintf(os.Stderr, "[pump-sim-janela] "+msg+"\n", a...) }

func dirConfig() string {
	if d := os.Getenv("APPDATA"); d != "" {
		return filepath.Join(d, "pump-sim")
	}
	d, _ := os.UserConfigDir()
	return filepath.Join(d, "pump-sim")
}

func dirDadosWebView() string {
	if d := os.Getenv("LOCALAPPDATA"); d != "" {
		return filepath.Join(d, "pump-sim", "WebView2")
	}
	d, _ := os.UserCacheDir()
	return filepath.Join(d, "pump-sim", "WebView2")
}

func arquivoPosicao() string { return filepath.Join(dirConfig(), "janela.json") }

// faixaTopo is the height of the top resize band (0 when maximized: nothing to resize).
func faixaTopo(h uintptr) int32 {
	if zoomed(h) {
		return 0
	}
	if f := metrica(smCyFrame, dpiDe(h)); f > 0 {
		return f
	}
	return escalar(4, dpiDe(h))
}

func atualizarBounds() {
	if j.wv == nil {
		return
	}
	r := clientRect(j.hwnd)
	r.Top += faixaTopo(j.hwnd)
	j.wv.bounds(r)
}

func postarEstado() {
	if j.wv != nil {
		j.wv.postarJSON(Estado{Maximizada: zoomed(j.hwnd), Regiao: j.wv.regiao}.JSON())
	}
}

func trocarCor(cor uint32) {
	b, _, _ := pCreateSolidBrush.Call(uintptr(cor))
	if b == 0 {
		return
	}
	if j.brush != 0 {
		pDeleteObject.Call(j.brush)
	}
	j.brush = b
	pInvalidateRect.Call(j.hwnd, 0, 1)
}

func aoMensagem(texto string) {
	m, err := LerMensagem(texto)
	if err != nil {
		return
	}
	switch m.Acao {
	case AcaoPronto:
		postarEstado()
	case AcaoMinimizar:
		postar(j.hwnd, wmSysCommand, scMinimize, 0)
	case AcaoMaximizar:
		if zoomed(j.hwnd) {
			postar(j.hwnd, wmSysCommand, scRestore, 0)
		} else {
			postar(j.hwnd, wmSysCommand, scMaximize, 0)
		}
	case AcaoFechar:
		postar(j.hwnd, wmClose, 0, 0)
	case AcaoArrastar:
		// SC_MOVE | HTCAPTION: a move driven by the mouse button that is still down.
		postar(j.hwnd, wmSysCommand, scMove|htCaption, 0)
	case AcaoCor:
		trocarCor(m.Cor)
		escuro := int32(0)
		if m.Escuro {
			escuro = 1
		}
		dwmAtributo(j.hwnd, dwmwaUseImmersiveDarkMode, escuro)
	}
}

// salvarSeProgramatico saves janela.json after a move/resize that did not come from a user drag
// (SetWindowPos/MoveWindow from outside, Aero Snap, maximize): the drag loop saves once on
// WM_EXITSIZEMOVE instead of on every step. Saving here matters because the CLI ends the host with
// TerminateProcess on "Encerrar pump-sim", so WM_CLOSE never runs and would lose the last size.
func salvarSeProgramatico() {
	if j.wv != nil && !j.emLaco {
		salvarPosicao()
	}
}

func salvarPosicao() {
	wp := windowPlacement{Length: uint32(unsafe.Sizeof(windowPlacement{}))}
	if r, _, _ := pGetWindowPlacement.Call(j.hwnd, uintptr(unsafe.Pointer(&wp))); r == 0 {
		return
	}
	n := wp.NormalPos
	p := Posicao{
		X: int(n.Left), Y: int(n.Top), Largura: int(n.Right - n.Left), Altura: int(n.Bottom - n.Top),
		Maximizada: wp.ShowCmd == swShowMaximized || (wp.ShowCmd == swShowMinimized && wp.Flags&wpfRestoreToMaximized != 0),
	}
	if _, ok := LerPosicao(p.JSON()); !ok {
		return
	}
	if err := os.MkdirAll(dirConfig(), 0o755); err != nil {
		return
	}
	tmp := arquivoPosicao() + ".tmp"
	if os.WriteFile(tmp, p.JSON(), 0o644) == nil {
		_ = os.Rename(tmp, arquivoPosicao())
	}
}

// restaurarPosicao applies janela.json to the hidden window and returns the show command. A saved
// rectangle that no monitor holds any more (monitor unplugged) is ignored.
func restaurarPosicao() uintptr {
	b, err := os.ReadFile(arquivoPosicao())
	if err != nil {
		return swShowNormal
	}
	p, ok := LerPosicao(b)
	if !ok {
		return swShowNormal
	}
	r := rect{Left: int32(p.X), Top: int32(p.Y), Right: int32(p.X + p.Largura), Bottom: int32(p.Y + p.Altura)}
	const monitorDefaultToNull = 0
	if m, _, _ := pMonitorFromRect.Call(uintptr(unsafe.Pointer(&r)), monitorDefaultToNull); m == 0 {
		return swShowNormal
	}
	wp := windowPlacement{Length: uint32(unsafe.Sizeof(windowPlacement{})), ShowCmd: swHide, NormalPos: r}
	pSetWindowPlacement.Call(j.hwnd, uintptr(unsafe.Pointer(&wp)))
	if p.Maximizada {
		return swShowMaximized
	}
	return swShowNormal
}

func wndProc(h, m, w, l uintptr) uintptr {
	switch m {
	case wmNcCalcSize:
		if w == 0 {
			break
		}
		// lParam: NCCALCSIZE_PARAMS, whose first RECT is the proposed window rect → client rect.
		r := (*rect)(ptr(l))
		topo := r.Top
		res := defWindowProc(h, m, w, l)
		r.Top = topo
		if zoomed(h) {
			// A maximized window hangs its frame outside the monitor: keep the content on screen.
			dpi := dpiDe(h)
			r.Top += metrica(smCyFrame, dpi) + metrica(smCxPaddedBorder, dpi)
		}
		return res
	case wmNcHitTest:
		r := defWindowProc(h, m, w, l)
		if r != htClient || zoomed(h) {
			return r
		}
		wr := windowRect(h)
		x, y := loword(l), hiword(l)
		if y < wr.Top+faixaTopo(h) {
			canto := metrica(smCxFrame, dpiDe(h)) + metrica(smCxPaddedBorder, dpiDe(h))
			switch {
			case x < wr.Left+canto:
				return htTopLeft
			case x >= wr.Right-canto:
				return htTopRight
			}
			return htTop
		}
		return htClient
	case wmGetMinMaxInfo:
		mm := (*minMaxInfo)(ptr(l))
		dpi := dpiDe(h)
		mm.MinTrackSize = point{X: escalar(larguraMinima, dpi), Y: escalar(alturaMinima, dpi)}
		return 0
	case wmDpiChanged:
		s := (*rect)(ptr(l))
		pSetWindowPos.Call(h, 0, uintptr(s.Left), uintptr(s.Top), uintptr(s.Right-s.Left), uintptr(s.Bottom-s.Top), swpNoZOrder|swpNoActivate)
		return 0
	case wmSize:
		atualizarBounds()
		if w != sizeMinimized {
			if z := zoomed(h); z != j.maximizada {
				j.maximizada = z
				postarEstado()
			}
		}
		salvarSeProgramatico()
		return 0
	case wmMove, wmMoving:
		if j.wv != nil {
			j.wv.janelaMovida()
		}
		if m == wmMove {
			salvarSeProgramatico()
		}
	case wmEnterSizeMove:
		j.emLaco = true
	case wmExitSizeMove:
		j.emLaco = false
		salvarPosicao()
	case wmActivate:
		if j.wv != nil && w&0xffff != 0 {
			j.wv.focar()
		}
	case wmSetFocus:
		if j.wv != nil {
			j.wv.focar()
		}
	case wmEraseBkgnd:
		return 1
	case wmPaint:
		var ps paintStruct
		hdc, _, _ := pBeginPaint.Call(h, uintptr(unsafe.Pointer(&ps)))
		if hdc != 0 && j.brush != 0 {
			pFillRect.Call(hdc, uintptr(unsafe.Pointer(&ps.Paint)), j.brush)
		}
		pEndPaint.Call(h, uintptr(unsafe.Pointer(&ps)))
		return 0
	case wmClose:
		salvarPosicao()
		if j.wv != nil {
			j.wv.fechar()
			j.wv = nil
		}
		pDestroyWindow.Call(h)
		return 0
	case wmDestroy:
		pPostQuitMessage.Call(0)
		return 0
	}
	return defWindowProc(h, m, w, l)
}

// falhar ends the run with a code (from inside a WebView2 callback).
func falhar(codigo int, err error) {
	registrar("%v", err)
	j.codigo = codigo
	if j.hwnd != 0 {
		pDestroyWindow.Call(j.hwnd)
	} else {
		pPostQuitMessage.Call(0)
	}
}

func criarJanela() error {
	inst, _, _ := pGetModuleHandleW.Call(0)
	classe, _ := windows.UTF16PtrFromString("pump-sim-janela")
	titulo, _ := windows.UTF16PtrFromString("pump-sim")
	cursor, _, _ := pLoadCursorW.Call(0, idcArrow)
	dpi := dpiDe(0)
	grande, pequeno := criarIcone(metrica(smCxIcon, dpi)), criarIcone(metrica(smCxSmIcon, dpi))
	wc := wndClassEx{
		WndProc:   windows.NewCallback(wndProc),
		Instance:  inst,
		Icon:      grande,
		IconSm:    pequeno,
		Cursor:    cursor,
		ClassName: classe,
	}
	wc.Size = uint32(unsafe.Sizeof(wc))
	if r, _, err := pRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		return fmt.Errorf("RegisterClassExW: %v", err)
	}
	h, _, err := pCreateWindowExW.Call(0, uintptr(unsafe.Pointer(classe)), uintptr(unsafe.Pointer(titulo)),
		wsOverlappedWindow|wsClipChildren, cwUseDefault, cwUseDefault,
		uintptr(escalar(larguraPadrao, dpi)), uintptr(escalar(alturaPadrao, dpi)), 0, 0, inst, 0)
	runtime.KeepAlive(classe)
	runtime.KeepAlive(titulo)
	if h == 0 {
		return fmt.Errorf("CreateWindowExW: %v", err)
	}
	j.hwnd = h
	if grande != 0 {
		pSendMessageW.Call(h, wmSetIcon, iconBig, grande)
	}
	if pequeno != 0 {
		pSendMessageW.Call(h, wmSetIcon, iconSmall, pequeno)
	}
	trocarCor(corInicial)
	// DWM draws the frame (shadow, top border line) into the client area's first pixel row.
	if pDwmExtendFrameIntoClientArea.Find() == nil {
		mg := margins{Top: 1}
		pDwmExtendFrameIntoClientArea.Call(h, uintptr(unsafe.Pointer(&mg)))
	}
	dwmAtributo(h, dwmwaWindowCornerPreference, dwmwcpRound)
	mostrar := restaurarPosicao()
	pSetWindowPos.Call(h, 0, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoZOrder|swpNoActivate|swpFrameChanged)
	pShowWindow.Call(h, mostrar)
	j.maximizada = zoomed(h)
	return nil
}

// Flags of MessageBoxW: OK button, error icon, topmost and in the foreground (the dialog has no
// owner window and must not open behind Explorer).
const (
	mbOk            = 0x00000000
	mbIconError     = 0x00000010
	mbSetForeground = 0x00010000
	mbTopmost       = 0x00040000
)

// mostrarErro shows msg in a native error dialog titled pump-sim and returns once it is closed.
func mostrarErro(msg string) int {
	if pSetProcessDpiAwarenessContext.Find() == nil {
		pSetProcessDpiAwarenessContext.Call(dpiAwarenessPerMonitorV2)
	}
	texto, err := windows.UTF16PtrFromString(msg)
	if err != nil {
		texto, _ = windows.UTF16PtrFromString(strings.ReplaceAll(msg, "\x00", " "))
	}
	titulo, _ := windows.UTF16PtrFromString("pump-sim")
	if r, _, _ := pMessageBoxW.Call(0, uintptr(unsafe.Pointer(texto)), uintptr(unsafe.Pointer(titulo)), mbOk|mbIconError|mbSetForeground|mbTopmost); r == 0 {
		return codigoErro
	}
	return codigoOk
}

func executar(c config) int {
	j.url = c.URL
	if pSetProcessDpiAwarenessContext.Find() == nil {
		pSetProcessDpiAwarenessContext.Call(dpiAwarenessPerMonitorV2)
	}
	proc, err := procCriarAmbiente()
	if err != nil {
		registrar("%v", err)
		return codigoSemWebView2
	}
	if hr, _, _ := pCoInitializeEx.Call(0, coinitApartmentThreaded); falhou(hr) {
		registrar("CoInitializeEx: HRESULT 0x%08x", uint32(hr))
		return codigoErro
	}
	if err := criarJanela(); err != nil {
		registrar("%v", err)
		return codigoErro
	}
	_ = os.MkdirAll(dirDadosWebView(), 0o755)
	err = criarAmbiente(proc, dirDadosWebView(), func(env uintptr, err error) {
		if err != nil {
			falhar(codigoSemWebView2, err)
			return
		}
		err = criarController(env, j.hwnd, aoMensagem, func(w *webview, err error) {
			if err != nil {
				falhar(codigoSemWebView2, err)
				return
			}
			j.wv = w
			atualizarBounds()
			w.navegar(j.url)
			w.focar()
		})
		if err != nil {
			falhar(codigoSemWebView2, err)
		}
	})
	if err != nil {
		registrar("%v", err)
		pDestroyWindow.Call(j.hwnd)
		return codigoSemWebView2
	}
	var m msg
	for {
		r, _, _ := pGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		pDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
	return j.codigo
}
