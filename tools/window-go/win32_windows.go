//go:build windows

package main

// Thin Win32 layer (no cgo): user32/gdi32/dwmapi/ole32/kernel32 through golang.org/x/sys/windows lazy
// procs. amd64 only (the pump-sim executable is win-x64): pointers and LRESULTs are 64-bit.

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	gdi32    = windows.NewLazySystemDLL("gdi32.dll")
	dwmapi   = windows.NewLazySystemDLL("dwmapi.dll")
	ole32    = windows.NewLazySystemDLL("ole32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	pRegisterClassExW              = user32.NewProc("RegisterClassExW")
	pCreateWindowExW               = user32.NewProc("CreateWindowExW")
	pDefWindowProcW                = user32.NewProc("DefWindowProcW")
	pDestroyWindow                 = user32.NewProc("DestroyWindow")
	pGetMessageW                   = user32.NewProc("GetMessageW")
	pTranslateMessage              = user32.NewProc("TranslateMessage")
	pDispatchMessageW              = user32.NewProc("DispatchMessageW")
	pPostQuitMessage               = user32.NewProc("PostQuitMessage")
	pPostMessageW                  = user32.NewProc("PostMessageW")
	pSendMessageW                  = user32.NewProc("SendMessageW")
	pShowWindow                    = user32.NewProc("ShowWindow")
	pIsZoomed                      = user32.NewProc("IsZoomed")
	pGetClientRect                 = user32.NewProc("GetClientRect")
	pGetWindowRect                 = user32.NewProc("GetWindowRect")
	pSetWindowPos                  = user32.NewProc("SetWindowPos")
	pGetWindowPlacement            = user32.NewProc("GetWindowPlacement")
	pSetWindowPlacement            = user32.NewProc("SetWindowPlacement")
	pMonitorFromRect               = user32.NewProc("MonitorFromRect")
	pLoadCursorW                   = user32.NewProc("LoadCursorW")
	pBeginPaint                    = user32.NewProc("BeginPaint")
	pEndPaint                      = user32.NewProc("EndPaint")
	pFillRect                      = user32.NewProc("FillRect")
	pInvalidateRect                = user32.NewProc("InvalidateRect")
	pCreateIconFromResourceEx      = user32.NewProc("CreateIconFromResourceEx")
	pGetSystemMetricsForDpi        = user32.NewProc("GetSystemMetricsForDpi")
	pGetDpiForWindow               = user32.NewProc("GetDpiForWindow")
	pGetDpiForSystem               = user32.NewProc("GetDpiForSystem")
	pSetProcessDpiAwarenessContext = user32.NewProc("SetProcessDpiAwarenessContext")
	pMessageBoxW                   = user32.NewProc("MessageBoxW")
	pCreateSolidBrush              = gdi32.NewProc("CreateSolidBrush")
	pDeleteObject                  = gdi32.NewProc("DeleteObject")
	pDwmExtendFrameIntoClientArea  = dwmapi.NewProc("DwmExtendFrameIntoClientArea")
	pDwmSetWindowAttribute         = dwmapi.NewProc("DwmSetWindowAttribute")
	pCoInitializeEx                = ole32.NewProc("CoInitializeEx")
	pCoTaskMemFree                 = ole32.NewProc("CoTaskMemFree")
	pGetModuleHandleW              = kernel32.NewProc("GetModuleHandleW")
)

const (
	wsOverlappedWindow = 0x00CF0000
	wsClipChildren     = 0x02000000
	cwUseDefault       = 0x80000000

	wmDestroy       = 0x0002
	wmMove          = 0x0003
	wmSize          = 0x0005
	wmActivate      = 0x0006
	wmSetFocus      = 0x0007
	wmPaint         = 0x000F
	wmClose         = 0x0010
	wmEraseBkgnd    = 0x0014
	wmGetMinMaxInfo = 0x0024
	wmSetIcon       = 0x0080
	wmNcCalcSize    = 0x0083
	wmNcHitTest     = 0x0084
	wmSysCommand    = 0x0112
	wmMoving        = 0x0216
	wmEnterSizeMove = 0x0231
	wmExitSizeMove  = 0x0232
	wmDpiChanged    = 0x02E0

	scMinimize = 0xF020
	scMaximize = 0xF030
	scRestore  = 0xF120
	scMove     = 0xF010

	htClient   = 1
	htCaption  = 2
	htTop      = 12
	htTopLeft  = 13
	htTopRight = 14

	swHide          = 0
	swShowNormal    = 1
	swShowMinimized = 2
	swShowMaximized = 3

	sizeMinimized = 1

	swpNoSize       = 0x0001
	swpNoMove       = 0x0002
	swpNoZOrder     = 0x0004
	swpNoActivate   = 0x0010
	swpFrameChanged = 0x0020

	wpfRestoreToMaximized = 0x0002

	smCxIcon         = 11
	smCxFrame        = 32
	smCyFrame        = 33
	smCxSmIcon       = 49
	smCxPaddedBorder = 92

	iconSmall = 0
	iconBig   = 1

	idcArrow = 32512

	dwmwaUseImmersiveDarkMode   = 20
	dwmwaWindowCornerPreference = 33
	dwmwcpRound                 = 2

	coinitApartmentThreaded = 0x2

	dpiAwarenessPerMonitorV2 = ^uintptr(3) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = (HANDLE)-4
)

type point struct{ X, Y int32 }

type rect struct{ Left, Top, Right, Bottom int32 }

type wndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	IconSm     uintptr
}

type msg struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      point
	Private uint32
}

type windowPlacement struct {
	Length    uint32
	Flags     uint32
	ShowCmd   uint32
	MinPos    point
	MaxPos    point
	NormalPos rect
}

type paintStruct struct {
	Hdc       uintptr
	Erase     int32
	Paint     rect
	Restore   int32
	IncUpdate int32
	Reserved  [32]byte
}

type minMaxInfo struct {
	Reserved     point
	MaxSize      point
	MaxPosition  point
	MinTrackSize point
	MaxTrackSize point
}

type margins struct{ Left, Right, Top, Bottom int32 }

// ptr reads a uintptr handed over by Windows (lParam, a COM out value) as a pointer to memory that
// Windows owns. Reinterpreting the word avoids a uintptr → unsafe.Pointer conversion that go vet's
// unsafeptr check would flag; the memory is never Go-managed.
func ptr(u uintptr) unsafe.Pointer {
	return *(*unsafe.Pointer)(unsafe.Pointer(&u))
}

func loword(u uintptr) int32 { return int32(int16(uint16(u))) }
func hiword(u uintptr) int32 { return int32(int16(uint16(u >> 16))) }

func defWindowProc(h, m, w, l uintptr) uintptr {
	r, _, _ := pDefWindowProcW.Call(h, m, w, l)
	return r
}

func postar(h uintptr, m, w, l uintptr) {
	pPostMessageW.Call(h, m, w, l)
}

func clientRect(h uintptr) rect {
	var r rect
	pGetClientRect.Call(h, uintptr(unsafe.Pointer(&r)))
	return r
}

func windowRect(h uintptr) rect {
	var r rect
	pGetWindowRect.Call(h, uintptr(unsafe.Pointer(&r)))
	return r
}

func zoomed(h uintptr) bool {
	r, _, _ := pIsZoomed.Call(h)
	return r != 0
}

// dpiDe is the window's dpi (96 when the API is missing: Windows 10 before 1607).
func dpiDe(h uintptr) uint32 {
	if pGetDpiForWindow.Find() == nil && h != 0 {
		if r, _, _ := pGetDpiForWindow.Call(h); r != 0 {
			return uint32(r)
		}
	}
	if pGetDpiForSystem.Find() == nil {
		if r, _, _ := pGetDpiForSystem.Call(); r != 0 {
			return uint32(r)
		}
	}
	return 96
}

func metrica(indice int, dpi uint32) int32 {
	if pGetSystemMetricsForDpi.Find() != nil {
		return 0
	}
	r, _, _ := pGetSystemMetricsForDpi.Call(uintptr(indice), uintptr(dpi))
	return int32(r)
}

func escalar(v int, dpi uint32) int32 { return int32(v * int(dpi) / 96) }

func dwmAtributo(h uintptr, atributo uint32, valor int32) {
	if pDwmSetWindowAttribute.Find() != nil {
		return
	}
	pDwmSetWindowAttribute.Call(h, uintptr(atributo), uintptr(unsafe.Pointer(&valor)), unsafe.Sizeof(valor))
}

// criarIcone makes an HICON of the given side from the embedded .ico (0 on failure).
func criarIcone(lado int32) uintptr {
	imgs, err := lerIco(icoPumpSim)
	if err != nil {
		return 0
	}
	im, ok := escolherIco(imgs, int(lado))
	if !ok {
		return 0
	}
	r, _, _ := pCreateIconFromResourceEx.Call(uintptr(unsafe.Pointer(&im.Dados[0])), uintptr(len(im.Dados)), 1, 0x00030000, uintptr(lado), uintptr(lado), 0)
	return r
}
