// Window controls of the pump-sim window host (tools/window-go, DECISIONS §32). Inside the host the
// top bar is the title bar: it drags the window and draws minimize / maximize-restore / close at its
// right end. Nothing here runs in a browser: the host is detected by its WebView2 bridge
// (window.chrome.webview) answering "pronto" with a {tipo:"janela"} state message. The message
// shapes are pinned by tools/window-go/testdata/protocolo.json (Go and vitest both read it).

/** Page → host message. */
export function mensagem(acao, extra) {
  return { tipo: 'janela', acao, ...extra };
}

/** "#rrggbb" of an "rgb(r, g, b)" / "rgba(...)" string, or null. */
export function hexDeRgb(s) {
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(String(s));
  if (!m) return null;
  return `#${m.slice(1, 4).map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('')}`;
}

/** Any CSS color (the UI's tokens are oklch) as "#rrggbb", through a 1×1 canvas. */
function hexDeCor(cor, doc) {
  try {
    const c = doc.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = cor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return hexDeRgb(`rgb(${r}, ${g}, ${b})`);
  } catch {
    return null;
  }
}

/**
 * The window bridge. `webview` is window.chrome.webview (or a stub in tests); `aoMudar` re-renders
 * when the host state changes. Without a bridge everything is a no-op and `estado.ativa` stays false.
 */
export function criarJanela(webview, aoMudar = () => {}) {
  const estado = { ativa: false, maximizada: false, regiao: false };
  const ok = Boolean(webview && typeof webview.postMessage === 'function' && typeof webview.addEventListener === 'function');
  let ultimaCor = '';
  const enviar = (acao, extra) => {
    if (ok) webview.postMessage(mensagem(acao, extra));
  };
  if (ok) {
    webview.addEventListener('message', (ev) => {
      const d = ev?.data;
      if (!d || typeof d !== 'object' || d.tipo !== 'janela') return;
      const antes = `${estado.ativa}${estado.maximizada}${estado.regiao}`;
      estado.ativa = true;
      estado.maximizada = Boolean(d.maximizada);
      estado.regiao = Boolean(d.regiao);
      if (antes !== `${estado.ativa}${estado.maximizada}${estado.regiao}`) aoMudar();
    });
    enviar('pronto');
  }
  return {
    estado,
    /** minimizar | maximizar | fechar | arrastar */
    acao(nome) {
      if (estado.ativa && ['minimizar', 'maximizar', 'fechar', 'arrastar'].includes(nome)) enviar(nome);
    },
    /** Sends the bar color (paints the host's top resize band) when it changed. */
    cor(hex, escuro) {
      if (!estado.ativa || !/^#[0-9a-f]{6}$/i.test(hex ?? '')) return;
      const cor = hex.toLowerCase();
      const chave = `${cor}${Boolean(escuro)}`;
      if (chave === ultimaCor) return;
      ultimaCor = chave;
      enviar('cor', { cor, escuro: Boolean(escuro) });
    },
    /** After a render: read the bar's real background and send it (deferred until the DOM has the new theme). */
    tema(escuro, doc) {
      if (!estado.ativa) return;
      setTimeout(() => {
        const barra = doc.querySelector('.tbw');
        if (!barra) return;
        const cor = doc.defaultView?.getComputedStyle(barra).backgroundColor;
        this.cor(hexDeRgb(cor) ?? hexDeCor(cor, doc), escuro);
      }, 0);
    },
  };
}

// Caption glyphs drawn like Windows 11's (10 px, 1 px strokes), inline so no icon font is involved.
const GLIFOS = {
  minimizar: '<path d="M0 5.5h10"/>',
  maximizar: '<rect x="0.5" y="0.5" width="9" height="9" rx="1"/>',
  restaurar: '<rect x="0.5" y="2.5" width="7" height="7" rx="1"/><path d="M2.5 2.5v-1a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1"/>',
  fechar: '<path d="M0.5 0.5l9 9M9.5 0.5l-9 9"/>',
};

const svg = (g) => `<svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">${GLIFOS[g]}</svg>`;

/** The three caption buttons, or '' outside the host. */
export function botoesJanela(estado) {
  if (!estado.ativa) return '';
  const max = estado.maximizada;
  return `<div class="janela-ctl">
      <button type="button" data-act="g:janela" data-acao="minimizar" title="Minimizar" aria-label="Minimizar">${svg('minimizar')}</button>
      <button type="button" data-act="g:janela" data-acao="maximizar" title="${max ? 'Restaurar' : 'Maximizar'}" aria-label="${max ? 'Restaurar' : 'Maximizar'}">${svg(max ? 'restaurar' : 'maximizar')}</button>
      <button type="button" class="x" data-act="g:janela" data-acao="fechar" title="Fechar" aria-label="Fechar">${svg('fechar')}</button>
    </div>`;
}

/** Whether a mousedown on the bar should drag the window (fallback without app-region support). */
export function arrastavel(alvo) {
  return Boolean(alvo?.closest?.('.tb') && !alvo.closest('button, a, input, select, textarea, [data-act], .janela-ctl'));
}
