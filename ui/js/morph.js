// Minimal DOM morph: re-render the screen as HTML and patch the live tree in place, so a 300 ms
// refresh keeps focus, caret, scroll and the value of what is being typed. Every `title` becomes
// `data-dica` on the way in: the page draws its own tooltips, kept inside the window (dica.js).
import { trocarTitulos } from './dica.js';

export function morph(alvo, html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  trocarTitulos(t.content);
  filhos(alvo, t.content);
}

const chave = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') : null);

function filhos(a, b) {
  const an = [...a.childNodes];
  const bn = [...b.childNodes];
  for (let i = 0; i < bn.length; i++) {
    const x = an[i];
    const y = bn[i];
    if (!x) {
      a.appendChild(y);
      continue;
    }
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName || chave(x) !== chave(y)) {
      a.replaceChild(y, x);
      continue;
    }
    if (x.nodeType !== 1) {
      if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue;
      continue;
    }
    atributos(x, y);
    if (x.tagName === 'INPUT' || x.tagName === 'TEXTAREA') {
      const v = y.getAttribute('value') ?? '';
      if (document.activeElement !== x && x.value !== v) x.value = v;
      continue;
    }
    filhos(x, y);
    if (x.tagName === 'SELECT' && document.activeElement !== x) {
      const sel = y.querySelector('option[selected]');
      if (sel) x.value = sel.getAttribute('value') ?? sel.textContent;
    }
  }
  for (let i = an.length - 1; i >= bn.length; i--) a.removeChild(an[i]);
}

function atributos(x, y) {
  for (const at of [...x.attributes]) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
  for (const at of [...y.attributes]) if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
}
