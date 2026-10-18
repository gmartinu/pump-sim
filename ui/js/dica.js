// Tooltips of the web UI (DECISIONS §35). Native `title` tooltips are drawn by the browser and, inside
// the WebView2 window host, are cut at the window's edge (the MCP switch at the right end of a card
// lost half its text). So every `title` the screens render becomes `data-dica` when the DOM is patched
// (morph.js, `trocarTitulos`) and one page-level tooltip shows it, placed by `posicionarDica` so it
// always stays inside the viewport: below the target, centered, shifted left/right near an edge, and
// above the target when there is no room below.

/** Gap between the viewport edge and the tooltip, in px. */
export const MARGEM = 8;
/** Gap between the target and the tooltip, in px. */
export const FOLGA = 6;

/**
 * Position of a tooltip of size `tam` ({w, h}) for a target rect `alvo` ({left, top, right, bottom})
 * in a viewport `vista` ({w, h}). Returns {left, top, lado: 'baixo' | 'cima'}, never outside
 * [MARGEM, vista - MARGEM] when the tooltip fits the viewport at all.
 */
export function posicionarDica(alvo, tam, vista, margem = MARGEM, folga = FOLGA) {
  const cx = (alvo.left + alvo.right) / 2;
  const maxLeft = vista.w - margem - tam.w;
  const left = Math.max(margem, Math.min(cx - tam.w / 2, maxLeft));
  let top = alvo.bottom + folga;
  let lado = 'baixo';
  if (top + tam.h > vista.h - margem) {
    const acima = alvo.top - folga - tam.h;
    if (acima >= margem) {
      top = acima;
      lado = 'cima';
    } else {
      top = Math.max(margem, vista.h - margem - tam.h);
    }
  }
  return { left: Math.round(left), top: Math.round(top), lado };
}

/**
 * Moves every `title` under `raiz` (an element or a fragment) to `data-dica`, so the browser does not
 * draw its own tooltip. An element without text and without an `aria-label` keeps the text as its
 * accessible name (icon-only buttons).
 */
export function trocarTitulos(raiz) {
  for (const el of raiz.querySelectorAll('[title]')) {
    const t = el.getAttribute('title');
    el.removeAttribute('title');
    if (!t) continue;
    el.setAttribute('data-dica', t);
    if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', t);
  }
}

/**
 * Installs the page tooltip over `raiz`: hover (after `atraso` ms) or keyboard focus on an element
 * with `data-dica` shows it; leaving, a click, a key, scroll or wheel hides it. Returns
 * {atualizar}, called after every render (the target may have been replaced or its text changed).
 * Inert when the document cannot create elements (the shell's test stubs).
 */
export function instalarDicas(raiz, doc, atraso = 450) {
  const nada = { atualizar() {} };
  if (!doc || typeof doc.createElement !== 'function' || !doc.body || typeof doc.body.appendChild !== 'function') return nada;
  const caixa = doc.createElement('div');
  caixa.className = 'dica';
  caixa.setAttribute('role', 'tooltip');
  caixa.hidden = true;
  doc.body.appendChild(caixa);
  let atual = null;
  let timer = null;

  const esconder = () => {
    clearTimeout(timer);
    timer = null;
    atual = null;
    caixa.hidden = true;
  };
  const posicionar = () => {
    if (!atual) return;
    const texto = atual.getAttribute('data-dica');
    if (!atual.isConnected || !texto) return esconder();
    if (caixa.textContent !== texto) caixa.textContent = texto;
    caixa.hidden = false;
    const vista = { w: doc.documentElement.clientWidth || doc.defaultView.innerWidth, h: doc.documentElement.clientHeight || doc.defaultView.innerHeight };
    // Measure at the top-left corner so the width is not squeezed by the right edge.
    caixa.style.left = '0px';
    caixa.style.top = '0px';
    const b = caixa.getBoundingClientRect();
    const p = posicionarDica(atual.getBoundingClientRect(), { w: b.width, h: b.height }, vista);
    caixa.style.left = `${p.left}px`;
    caixa.style.top = `${p.top}px`;
    caixa.dataset.lado = p.lado;
  };
  const mostrar = (el, imediato) => {
    if (el === atual && !caixa.hidden) return;
    esconder();
    atual = el;
    if (imediato) posicionar();
    else timer = setTimeout(posicionar, atraso);
  };

  raiz.addEventListener('pointerover', (ev) => {
    const el = ev.target?.closest?.('[data-dica]');
    if (!el) return esconder();
    if (el !== atual) mostrar(el, false);
  });
  raiz.addEventListener('pointerout', (ev) => {
    if (atual && !(ev.relatedTarget && atual.contains(ev.relatedTarget))) esconder();
  });
  raiz.addEventListener('focusin', (ev) => {
    const el = ev.target?.closest?.('[data-dica]');
    if (el && el.matches?.(':focus-visible')) mostrar(el, true);
  });
  raiz.addEventListener('focusout', esconder);
  raiz.addEventListener('pointerdown', esconder);
  raiz.addEventListener('keydown', esconder);
  raiz.addEventListener('wheel', esconder, { passive: true });
  raiz.addEventListener('scroll', esconder, true);
  doc.defaultView?.addEventListener?.('blur', esconder);
  doc.defaultView?.addEventListener?.('resize', esconder);

  return {
    atualizar() {
      if (atual && !caixa.hidden) posicionar();
      else if (atual && !atual.isConnected) esconder();
    },
  };
}
