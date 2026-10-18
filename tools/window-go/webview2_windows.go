//go:build windows

package main

// Minimal WebView2 COM client: only the vtable slots the host calls. Slot numbers follow the
// interface order of WebView2.idl (IUnknown is 0..2); every interface used here is from the first
// public release except ICoreWebView2Settings9 (non-client regions), which is optional.

import (
	"errors"
	"fmt"
	"os"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

var (
	iidIUnknown                  = windows.GUID{Data1: 0x00000000, Data2: 0x0000, Data3: 0x0000, Data4: [8]byte{0xc0, 0, 0, 0, 0, 0, 0, 0x46}}
	iidIAgileObject              = windows.GUID{Data1: 0x94ea2b94, Data2: 0xe9cc, Data3: 0x49e0, Data4: [8]byte{0xc0, 0xff, 0xee, 0x64, 0xca, 0x8f, 0x5b, 0x90}}
	iidEnvironmentCompleted      = windows.GUID{Data1: 0x4e8a3389, Data2: 0xc9d8, Data3: 0x4bd2, Data4: [8]byte{0xb6, 0xb5, 0x12, 0x4f, 0xee, 0x6c, 0xc1, 0x4d}}
	iidControllerCompleted       = windows.GUID{Data1: 0x6c4819f3, Data2: 0xc9b7, Data3: 0x4260, Data4: [8]byte{0x81, 0x27, 0xc9, 0xf5, 0xbd, 0xe7, 0xf6, 0x8c}}
	iidWebMessageReceivedHandler = windows.GUID{Data1: 0x57213f19, Data2: 0x00e6, Data3: 0x49fa, Data4: [8]byte{0x8e, 0x07, 0x89, 0x8e, 0xa0, 0x1e, 0xcb, 0xd2}}
	iidICoreWebView2Settings9    = windows.GUID{Data1: 0x0528a73b, Data2: 0xe92d, Data3: 0x49f4, Data4: [8]byte{0x92, 0x7a, 0xe5, 0x47, 0xdd, 0xda, 0xa3, 0x7d}}
)

// vtable slots.
const (
	slotQueryInterface = 0
	slotAddRef         = 1
	slotRelease        = 2

	// ICoreWebView2Environment
	envCreateController = 3

	// ICoreWebView2Controller
	ctlPutBounds         = 6
	ctlMoveFocus         = 12
	ctlNotifyParentMoved = 23
	ctlClose             = 24
	ctlGetCoreWebView2   = 25

	// ICoreWebView2
	wvGetSettings           = 3
	wvNavigate              = 5
	wvPostWebMessageAsJSON  = 32
	wvAddWebMessageReceived = 34

	// ICoreWebView2Settings (…9)
	setPutIsStatusBarEnabled              = 10
	setPutIsNonClientRegionSupportEnabled = 38

	// ICoreWebView2WebMessageReceivedEventArgs
	argGetWebMessageAsJSON = 4

	moveFocusProgrammatic = 0

	eNoInterface = 0x80004002
)

func falhou(hr uintptr) bool { return int32(uint32(hr)) < 0 }

// chamar calls slot i of a COM object's vtable. Callers keep Go buffers they pass alive themselves
// (runtime.KeepAlive): the uintptr conversions happen outside the SyscallN expression.
func chamar(obj uintptr, i int, args ...uintptr) uintptr {
	vt := *(*uintptr)(ptr(obj))
	fn := *(*uintptr)(ptr(vt + uintptr(i)*unsafe.Sizeof(uintptr(0))))
	r, _, _ := syscall.SyscallN(fn, append([]uintptr{obj}, args...)...)
	return r
}

// ───────────────────────── handlers implemented in Go ─────────────────────────

// handler is a COM object with one Invoke(this, a, b) method (every WebView2 completed/event handler
// the host needs has that shape). Instances live forever in handlers (three of them per run), so the
// pointer WebView2 keeps never dangles and AddRef/Release can be no-ops.
type handler struct {
	vtbl   *[4]uintptr
	iid    windows.GUID
	invoke func(a, b uintptr) uintptr
}

var (
	handlers = map[uintptr]*handler{}

	vtblHandler = [4]uintptr{
		windows.NewCallback(func(this, riid, out uintptr) uintptr {
			h := handlers[this]
			g := *(*windows.GUID)(ptr(riid))
			if h != nil && (g == iidIUnknown || g == iidIAgileObject || g == h.iid) {
				*(*uintptr)(ptr(out)) = this
				return 0
			}
			*(*uintptr)(ptr(out)) = 0
			return eNoInterface
		}),
		windows.NewCallback(func(uintptr) uintptr { return 1 }),
		windows.NewCallback(func(uintptr) uintptr { return 1 }),
		windows.NewCallback(func(this, a, b uintptr) uintptr {
			if h := handlers[this]; h != nil {
				return h.invoke(a, b)
			}
			return 0
		}),
	}
)

func novoHandler(iid windows.GUID, f func(a, b uintptr) uintptr) uintptr {
	h := &handler{vtbl: &vtblHandler, iid: iid, invoke: f}
	p := uintptr(unsafe.Pointer(h))
	handlers[p] = h
	return p
}

// ───────────────────────── runtime lookup ─────────────────────────

var errSemRuntime = errors.New("WebView2 Runtime não encontrado")

func versoesRegistro() []string {
	var out []string
	chaves := []struct {
		raiz registry.Key
		path string
	}{
		{registry.LOCAL_MACHINE, `SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\` + ClienteWebView2},
		{registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\EdgeUpdate\Clients\` + ClienteWebView2},
		{registry.CURRENT_USER, `Software\Microsoft\EdgeUpdate\Clients\` + ClienteWebView2},
	}
	for _, c := range chaves {
		k, err := registry.OpenKey(c.raiz, c.path, registry.QUERY_VALUE|registry.WOW64_64KEY)
		if err != nil {
			continue
		}
		if v, _, err := k.GetStringValue("pv"); err == nil {
			out = append(out, v)
		}
		k.Close()
	}
	return out
}

// acharDll returns the first EmbeddedBrowserWebView.dll that exists.
func acharDll() (string, error) {
	raizes := RaizesRuntime(os.Getenv)
	porRaiz := map[string][]string{}
	for _, r := range raizes {
		if es, err := os.ReadDir(r); err == nil {
			for _, e := range es {
				if e.IsDir() {
					porRaiz[r] = append(porRaiz[r], e.Name())
				}
			}
		}
	}
	for _, p := range CandidatosDll(versoesRegistro(), raizes, porRaiz, "x64") {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p, nil
		}
	}
	return "", errSemRuntime
}

// procCriarAmbiente loads the runtime and returns its environment factory
// (CreateWebViewEnvironmentWithOptionsInternal, what WebView2Loader.dll calls).
func procCriarAmbiente() (uintptr, error) {
	dll, err := acharDll()
	if err != nil {
		return 0, err
	}
	const loadLibrarySearchDllLoadDir, loadLibrarySearchDefaultDirs = 0x100, 0x1000
	h, err := windows.LoadLibraryEx(dll, 0, loadLibrarySearchDllLoadDir|loadLibrarySearchDefaultDirs)
	if err != nil {
		return 0, fmt.Errorf("%w: %s: %v", errSemRuntime, dll, err)
	}
	p, err := windows.GetProcAddress(h, "CreateWebViewEnvironmentWithOptionsInternal")
	if err != nil {
		return 0, fmt.Errorf("%w: %s: %v", errSemRuntime, dll, err)
	}
	return p, nil
}

// criarAmbiente starts the environment; done runs on the UI thread with the environment or an error.
func criarAmbiente(proc uintptr, dadosUsuario string, done func(env uintptr, err error)) error {
	pasta, err := windows.UTF16PtrFromString(dadosUsuario)
	if err != nil {
		return err
	}
	h := novoHandler(iidEnvironmentCompleted, func(hr, env uintptr) uintptr {
		if falhou(hr) || env == 0 {
			done(0, fmt.Errorf("ambiente WebView2: HRESULT 0x%08x", uint32(hr)))
		} else {
			done(env, nil)
		}
		return 0
	})
	// (checkRunningInstance = true, runtimeType = installed, user data folder, no options, handler)
	hr, _, _ := syscall.SyscallN(proc, 1, 0, uintptr(unsafe.Pointer(pasta)), 0, h)
	runtime.KeepAlive(pasta)
	if falhou(hr) {
		return fmt.Errorf("%w: HRESULT 0x%08x", errSemRuntime, uint32(hr))
	}
	return nil
}

// ───────────────────────── controller and webview ─────────────────────────

type webview struct {
	controller uintptr
	core       uintptr
	regiao     bool
}

// criarController creates the controller on hwnd; done gets the ready webview (settings applied,
// message handler registered, not navigated yet).
func criarController(env, hwnd uintptr, aoMensagem func(json string), done func(*webview, error)) error {
	h := novoHandler(iidControllerCompleted, func(hr, ctl uintptr) uintptr {
		if falhou(hr) || ctl == 0 {
			done(nil, fmt.Errorf("controller WebView2: HRESULT 0x%08x", uint32(hr)))
			return 0
		}
		chamar(ctl, slotAddRef)
		w := &webview{controller: ctl}
		chamar(ctl, ctlGetCoreWebView2, uintptr(unsafe.Pointer(&w.core)))
		if w.core == 0 {
			done(nil, errors.New("controller WebView2 sem CoreWebView2"))
			return 0
		}
		var settings uintptr
		chamar(w.core, wvGetSettings, uintptr(unsafe.Pointer(&settings)))
		if settings != 0 {
			chamar(settings, setPutIsStatusBarEnabled, 0)
			var s9 uintptr
			if !falhou(chamar(settings, slotQueryInterface, uintptr(unsafe.Pointer(&iidICoreWebView2Settings9)), uintptr(unsafe.Pointer(&s9)))) && s9 != 0 {
				w.regiao = !falhou(chamar(s9, setPutIsNonClientRegionSupportEnabled, 1))
				chamar(s9, slotRelease)
			}
			chamar(settings, slotRelease)
		}
		msgs := novoHandler(iidWebMessageReceivedHandler, func(_, args uintptr) uintptr {
			var p *uint16
			if !falhou(chamar(args, argGetWebMessageAsJSON, uintptr(unsafe.Pointer(&p)))) && p != nil {
				texto := windows.UTF16PtrToString(p)
				pCoTaskMemFree.Call(uintptr(unsafe.Pointer(p)))
				aoMensagem(texto)
			}
			return 0
		})
		var token int64
		chamar(w.core, wvAddWebMessageReceived, msgs, uintptr(unsafe.Pointer(&token)))
		done(w, nil)
		return 0
	})
	if hr := chamar(env, envCreateController, hwnd, h); falhou(hr) {
		return fmt.Errorf("CreateCoreWebView2Controller: HRESULT 0x%08x", uint32(hr))
	}
	return nil
}

// ICoreWebView2Controller::put_Bounds takes a RECT by value; the Windows x64 ABI passes a 16-byte
// struct as a pointer to a copy.
func (w *webview) bounds(r rect) {
	chamar(w.controller, ctlPutBounds, uintptr(unsafe.Pointer(&r)))
	runtime.KeepAlive(&r)
}

func (w *webview) focar()        { chamar(w.controller, ctlMoveFocus, moveFocusProgrammatic) }
func (w *webview) janelaMovida() { chamar(w.controller, ctlNotifyParentMoved) }
func (w *webview) fechar()       { chamar(w.controller, ctlClose) }

func (w *webview) navegar(url string) {
	p, err := windows.UTF16PtrFromString(url)
	if err != nil {
		return
	}
	chamar(w.core, wvNavigate, uintptr(unsafe.Pointer(p)))
	runtime.KeepAlive(p)
}

func (w *webview) postarJSON(json string) {
	p, err := windows.UTF16PtrFromString(json)
	if err != nil {
		return
	}
	chamar(w.core, wvPostWebMessageAsJSON, uintptr(unsafe.Pointer(p)))
	runtime.KeepAlive(p)
}
