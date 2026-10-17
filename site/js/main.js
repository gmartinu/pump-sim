// pump-sim homepage: language and theme toggles, copy buttons, and the live sample forecourt.
// No network: everything renders from data.js and i18n.js.
(function () {
  'use strict';
  const { HP, PS } = window.PumpSite;

  const THEME_KEY = 'pump-sim-site:theme';
  const LANG_KEY = 'pump-sim-site:lang';

  const store = {
    get(k) {
      try {
        return window.localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        /* storage blocked: the choice just is not remembered */
      }
    },
  };

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let lang = store.get(LANG_KEY) === 'en' ? 'en' : 'pt';
  const t = () => HP[lang];
  const pick = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

  /* ---------- language ---------- */
  function applyLang() {
    const L = t();
    document.documentElement.lang = L.lang;
    document.title = L.title;
    $$('[data-i18n]').forEach((el) => {
      const v = pick(L, el.dataset.i18n);
      if (typeof v === 'string') el.textContent = v;
    });
    $$('[data-i18n-aria]').forEach((el) => {
      const v = pick(L, el.dataset.i18nAria);
      if (typeof v === 'string') el.setAttribute('aria-label', v);
    });
    $$('[data-copy]').forEach((el) => el.setAttribute('aria-label', L.ui.copy));
    $$('[data-lang]').forEach((b) => {
      const on = b.dataset.lang === lang;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $('#mcp').textContent = L.ag.mcp;
    $('#mcp-m').textContent = L.ag.mcpM;
    applyThemeLabels();
  }

  /* ---------- theme (dark by default) ---------- */
  const isDark = () => document.body.classList.contains('th-dark');
  function applyThemeLabels() {
    const dark = isDark();
    const label = dark ? t().ui.themeLight : t().ui.themeDark;
    $$('[data-theme-ic]').forEach((el) => (el.textContent = dark ? 'light_mode' : 'dark_mode'));
    $$('[data-theme-label]').forEach((el) => (el.textContent = label));
    $$('[data-theme-toggle]').forEach((el) => el.setAttribute('aria-label', label));
  }
  function toggleTheme() {
    const dark = !isDark();
    document.body.classList.toggle('th-dark', dark);
    document.body.classList.toggle('th-light', !dark);
    store.set(THEME_KEY, dark ? 'dark' : 'light');
    applyThemeLabels();
  }

  /* ---------- copy ---------- */
  function copyText(text, iconEl) {
    const done = () => {
      if (!iconEl) return;
      iconEl.textContent = 'check';
      setTimeout(() => (iconEl.textContent = 'content_copy'), 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => {});
    }
  }

  /* ---------- live forecourt ---------- */
  function ladoHTML(ca, l, opts) {
    const k = ca.n + '-' + l.end;
    const bicos = l.bicos
      .map(
        (b, i) =>
          `<div class="${b.cls}"><span class="${b.rcls}"></span><span class="hex">${esc(b.cod)}</span>` +
          `<span class="prod"><b>${esc(b.prod)}</b><small data-v="${k}:${i}:l">${esc(b.encL)} L</small>` +
          (opts.encV ? `<small data-v="${k}:${i}:v">R$ ${esc(b.encV)}</small>` : '') +
          `</span><span class="ppl">${esc(b.preco)}</span></div>`,
      )
      .join('');
    const btn = opts.btn ? `<button class="${l.btnCls}" tabindex="-1"><span class="ms s14">${l.bic}</span>${esc(l.btn)}</button>` : '';
    return (
      `<div class="${l.lcls}"><div class="lado-h"><span class="endtag">END ${l.end}</span>` +
      `<span class="${l.cls}"><span class="ms">${l.ic}</span>${esc(l.rot)}</span>${btn}</div>` +
      `<div class="disp"><div><span class="dl">Total R$</span><span class="${l.dcls}" data-g="8888,88" data-v="${k}:t">${l.total}</span></div>` +
      `<div><span class="dl">Volume L</span><span class="${l.dcls}" data-g="888,888" data-v="${k}:q">${l.volume}</span></div>` +
      `<div><span class="dl">Preço</span><span class="dv" data-g="8,888">${l.preco}</span></div>` +
      (l.fluxo ? '<span class="flow"></span>' : '') +
      `</div><div class="bicos">${bicos}</div></div>`
    );
  }
  function canalHTML(ca, opts) {
    return (
      `<section class="canal"><div class="canal-h"><span class="canal-n">C${ca.n}</span>` +
      `<span class="h2">${esc(ca.nome)}</span><span class="small faint">${esc(ca.resumo)}</span></div>` +
      ca.lados.map((l) => ladoHTML(ca, l, opts)).join('') +
      '</section>'
    );
  }

  function render() {
    const canais = PS.vista();
    const hero = canais.find((c) => c.resumo) || canais[0];
    $('#hero-card').innerHTML = canalHTML(hero, { btn: false, encV: false });
    $('#grid').innerHTML = canais.map((ca) => canalHTML(ca, { btn: true, encV: true })).join('');
    $('#tb-clock').textContent = PS.relogio();
  }

  /* Tick: update only the changing numbers, so the flow animation is not restarted. */
  function update() {
    const vals = new Map();
    PS.vista().forEach((ca) =>
      ca.lados.forEach((l) => {
        const k = ca.n + '-' + l.end;
        vals.set(k + ':t', l.total);
        vals.set(k + ':q', l.volume);
        l.bicos.forEach((b, i) => {
          vals.set(k + ':' + i + ':l', b.encL + ' L');
          vals.set(k + ':' + i + ':v', 'R$ ' + b.encV);
        });
      }),
    );
    $$('[data-v]').forEach((el) => {
      const v = vals.get(el.dataset.v);
      if (v != null && el.textContent !== v) el.textContent = v;
    });
    $('#tb-clock').textContent = PS.relogio();
  }

  function renderStatic() {
    $('#legend').innerHTML =
      '<span class="lbl">Lados</span>' +
      PS.contagem()
        .map((k) => `<span class="${k.cls}"><span class="ms">${k.ic}</span>${esc(k.rot)}</span>`)
        .join('');
    $('#con').innerHTML = PS.trafego(7)
      .map(
        (r) =>
          `<div class="cr"><span class="c-ts">${r.ts}</span><span class="${r.dcls}">${r.dir}</span>` +
          `<span class="c-fr">${esc(r.quadro)}</span><span class="c-na">${esc(r.nota)}</span></div>`,
      )
      .join('');
  }

  /* The interface shot is drawn at 1440 px, like the app, and scaled to the frame (desktop). */
  const mobile = window.matchMedia('(max-width: 760px)');
  function fitShot() {
    const win = $('#win');
    const inner = $('#win-in');
    inner.style.zoom = mobile.matches ? '0.5' : String(win.clientWidth / 1440);
  }

  /* ---------- wiring ---------- */
  function init() {
    applyLang();
    renderStatic();
    render();
    fitShot();
    window.addEventListener('resize', fitShot);
    mobile.addEventListener('change', fitShot);

    const tick = () => {
      PS.step();
      update();
    };
    let timer = setInterval(tick, 300);
    document.addEventListener('visibilitychange', () => {
      clearInterval(timer);
      if (!document.hidden) timer = setInterval(tick, 300);
    });

    $$('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => {
        lang = b.dataset.lang;
        store.set(LANG_KEY, lang);
        applyLang();
      }),
    );
    $$('[data-theme-toggle]').forEach((b) => b.addEventListener('click', toggleTheme));

    const menuBtn = $('#menu-btn');
    const mnav = $('#mnav');
    const setMenu = (open) => {
      mnav.hidden = !open;
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.querySelector('.ms').textContent = open ? 'close' : 'menu';
    };
    menuBtn.addEventListener('click', () => setMenu(mnav.hidden));
    mnav.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
    mobile.addEventListener('change', () => setMenu(false));

    $$('[data-copy]').forEach((b) =>
      b.addEventListener('click', () => {
        const src = b.parentElement.querySelector('[data-copy-src]');
        copyText(src.textContent, b.querySelector('.ms'));
      }),
    );
    $('[data-copy-mcp]').addEventListener('click', (e) => copyText(t().ag.mcp, e.currentTarget.querySelector('.ms')));

    $$('[data-qs-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        const sel = b.dataset.qsTab;
        $$('[data-qs-tab]').forEach((x) => {
          $('#qs-' + x.dataset.qsTab).hidden = x.dataset.qsTab !== sel;
        });
        $$('[data-qs-tab]').forEach((x) => {
          const on = x === b;
          x.classList.toggle('on', on);
          x.setAttribute('aria-selected', String(on));
        });
      }),
    );
  }

  init();
})();
