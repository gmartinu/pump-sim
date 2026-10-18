// pump-sim web UI shell: top bar, tabs, the refresh loop and event delegation. Every change goes
// through the control API (Api.chamar); the screen modules only render state and map clicks to commands.
import { Api } from './api.js';
import { e, horaMs, rtcCurto } from './fmt.js';
import { instalarDicas } from './dica.js';
import { arrastavel, botoesJanela, criarJanela } from './janela.js';
import { morph } from './morph.js';
import agentes from './telas/agentes.js';
import comandos from './telas/comandos.js';
import comunicacao from './telas/comunicacao.js';
import config from './telas/config.js';
import diff from './telas/diff.js';
import identfid from './telas/identfid.js';
import pista from './telas/pista.js';
import precos from './telas/precos.js';
import trafego from './telas/trafego.js';

const ABAS = [
  ['pista', 'local_gas_station', 'Pista'],
  ['comandos', 'list_alt', 'Comandos básicos'],
  ['comunicacao', 'settings_input_hdmi', 'Comunicação'],
  ['precos', 'sell', 'Preços'],
  ['config', 'tune', 'Configuração'],
  ['trafego', 'swap_vert', 'Tráfego'],
  ['identfid', 'badge', 'Identfid'],
  ['diff', 'difference', 'Diff'],
  ['agentes', 'smart_toy', 'Gravação & agentes'],
];
const TELAS = { pista, comandos, comunicacao, precos, config, trafego, identfid, diff, agentes };
// Window host bridge (DECISIONS §32); inert until iniciar() finds window.chrome.webview.
let janela = criarJanela(null);
// Page tooltips (dica.js); inert until iniciar().
let dicas = { atualizar() {} };
const MAX_TRAFEGO = 3000;

const guardado = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const guardar = (k, v) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private window: per-viewer conveniences only */
  }
};

const api = new Api();
const app = {
  api,
  tela: 'pista',
  ui: {},
  dados: {},
  ultimo: {},
  estado: null,
  displays: null,
  servidor: null,
  trafego: [],
  toast: null,
  modal: null,
  menu: null,
  // Set once "Encerrar pump-sim" went through: the process is gone, the page only says so.
  encerrado: false,
  // ?tema=claro|escuro forces the theme for this page load (screenshots, demos).
  tema: new URLSearchParams(location.search).get('tema') ?? guardado('pump-sim.tema'),

  /** Runs a command; errors become a toast and the promise resolves to undefined. */
  async chamar(comando, args = {}, { silencioso = false } = {}) {
    try {
      const r = await api.chamar(comando, args);
      forcarAtualizacao();
      return r;
    } catch (err) {
      if (!silencioso) app.aviso(`${comando}: ${err.message}`, 'err');
      return undefined;
    }
  },
  aviso(texto, tipo = 'err') {
    app.toast = { texto, tipo, ate: performance.now() + (tipo === 'err' ? 7000 : 3500) };
    render();
  },
  ir(tela) {
    if (!TELAS[tela]) return;
    location.hash = `#/${tela}`;
  },
  abrirModal(m) {
    app.modal = m;
    app.ui.modal = { ...(m.valores ?? {}) };
    render();
  },
  render: () => render(),
};

// ───────────────────────── events pushed by the API ─────────────────────────

api.ouvir((msg) => {
  if (msg.tipo === 'trafego') {
    const d = msg.dados;
    if (d.dir === 'rx' || d.dir === 'tx') pushTrafego({ ...d });
    else pushTrafego({ ...d, dir: 'ev', texto: d.dir === 'abre' ? 'conexão aberta' : 'conexão fechada' });
  } else if (msg.tipo === 'falha') {
    const d = msg.dados;
    pushTrafego({ ts: d.ts, porta: d.porta, conexao: null, dir: 'ev', falha: true, falhaTipo: d.regra.tipo, quadroFalha: d.quadro, texto: `falha injetada: ${d.regra.tipo}${d.regra.param?.ms ? ` ${d.regra.param.ms} ms` : ''} (${d.regra.verbo === '*' ? 'todos' : d.regra.verbo}) em ${d.quadro}` });
  } else if (msg.tipo === 'log' && (msg.dados.dir === 'ERRO' || msg.dados.dir === 'INFO')) {
    const d = msg.dados;
    const porta = Number(String(d.porta).replace(/^tcp:/, '')) || d.porta;
    pushTrafego({ ts: d.t, porta, conexao: null, dir: 'ev', texto: `${d.dir}: ${d.texto}` });
  } else if (msg.tipo === 'perfil' || msg.tipo === 'reset') {
    forcarAtualizacao();
  }
});
let seqTrafego = 1;
function pushTrafego(r) {
  r.n = seqTrafego++;
  app.trafego.push(r);
  if (app.trafego.length > MAX_TRAFEGO) app.trafego.splice(0, app.trafego.length - MAX_TRAFEGO);
}

// ───────────────────────── refresh loop ─────────────────────────

let acordar = null;
function forcarAtualizacao() {
  app.ultimo = {};
  if (acordar) acordar();
}

async function ciclo() {
  if (api.estado === 'ok') {
    try {
      const [est, disp] = await Promise.all([api.chamar('get_estado_simulador'), api.chamar('get_displays')]);
      app.estado = est;
      app.displays = disp.enderecos;
    } catch {
      /* the next round retries */
    }
    const tela = TELAS[app.tela];
    const agora = performance.now();
    const polls = (tela.polls ?? []).filter((p) => (!p.quando || p.quando(app)) && (app.ultimo[p.chave] === undefined || agora - app.ultimo[p.chave] >= (p.cada ?? 1000)));
    await Promise.all(
      polls.map(async (p) => {
        app.ultimo[p.chave] = agora;
        try {
          app.dados[p.chave] = p.get ? await api.get(p.get) : await api.chamar(p.nome, p.args ? p.args(app) : {});
        } catch (err) {
          app.dados[p.chave] = { erro: err.message };
        }
      }),
    );
    if (app.ultimo._servidor === undefined || agora - app.ultimo._servidor >= 2000) {
      app.ultimo._servidor = agora;
      try {
        app.servidor = await api.get('/api/servidor');
      } catch {
        /* shown as API off by the WS state */
      }
    }
  }
  if (app.toast && performance.now() > app.toast.ate) app.toast = null;
  render();
  await new Promise((r) => {
    acordar = r;
    setTimeout(r, 300);
  });
  acordar = null;
  ciclo();
}

// ───────────────────────── rendering ─────────────────────────

/**
 * Dark unless the viewer picked light with the toggle (remembered) or `?tema=claro` (DECISIONS §33 U2).
 * The class also goes on <html>, so the page's own scrollbar gets the theme tokens.
 */
function aplicarTema() {
  const escuro = app.tema !== 'claro';
  const cls = escuro ? 'th-dark' : 'th-light';
  document.body.className = cls;
  if (document.documentElement) document.documentElement.className = cls;
  return escuro;
}

function topo() {
  const est = app.estado;
  const perfil = est?.perfil.id ?? '—';
  const portas = est?.portas.map((p) => p.logica) ?? [];
  const erro = est?.erroPorta;
  const conex = est?.conexoes.length ?? 0;
  const apiOk = api.estado === 'ok';
  // MCP dot: on when the HTTP endpoint has a client, or any MCP call (HTTP or stdio) came in the last 2 min.
  const mcp = app.servidor?.mcp;
  const mcpHttp = app.servidor?.mcpHttp;
  const mcpOk = (mcpHttp?.ativo ?? true) && Boolean((mcpHttp?.sessoes?.length ?? 0) > 0 || (mcp && app.servidor.agora - mcp.ultima < 120000));
  const portaApi = location.port || '80';
  const escuro = aplicarTema();
  const portasTxt = portas.length ? portas.join(' · ') : erro ? String(erro.porta) : '—';
  const jn = janela.estado;
  janela.tema(escuro, document);
  // The pills collapse first (dica: .tb-right wraps its overflow out of sight, last in the markup
  // first); the theme/menu buttons and the window controls never shrink (DECISIONS §35).
  const menu = app.menu === 'topo' ? `<div class="menu" role="menu"><button type="button" role="menuitem" data-act="g:encerrar"><span class="ms s16">power_settings_new</span>Encerrar pump-sim</button></div>` : '';
  return `<div class="tbw${jn.ativa ? ` em-janela${jn.regiao ? '' : ' sem-regiao'}` : ''}"><div class="tb">
    <div class="brand"><img class="brand-mark" src="/ui/icone.svg" alt="" width="18" height="18">pump-sim</div>
    <div class="pill clk tb-perfil" data-act="g:ir" data-tela="config" title="Trocar de perfil"><span class="ms s16 faint">memory</span><span class="mono ell">${e(perfil)}</span><span class="ms s16 faint">expand_more</span></div>
    <div class="tb-right">
      <div class="pill clk" data-act="g:ir" data-tela="agentes"><span class="dot${apiOk ? '' : ' err'}"></span><span class="k">API</span><span class="mono">:${e(portaApi)}</span><span class="dot${mcpOk ? '' : ' off'}"></span><span class="k">MCP</span></div>
      <div class="pill"><span class="dot${erro || !portas.length ? ' err' : ''}"></span><span class="k">Portas</span><span class="mono">${e(portasTxt)}</span>${erro ? '<span class="small">ocupada</span>' : ''}</div>
      <div class="pill"><span class="ms s16 faint">cable</span><span class="mono">${conex}</span>${conex === 1 ? 'conexão' : 'conexões'}</div>
      <div class="pill" title="Relógio do concentrador (&amp;R)"><span class="ms s16 faint">schedule</span><span class="mono">${rtcCurto(est?.relogio.rtc)}</span></div>
    </div>
    <div class="tb-fixos rel">
      <button class="btn ghost sm" data-act="g:tema" title="Tema claro/escuro"><span class="ms s16">${escuro ? 'light_mode' : 'dark_mode'}</span></button>
      ${app.servidor?.encerrar ? `<button class="btn ghost sm${app.menu === 'topo' ? ' on' : ''}" data-act="g:menu" data-menu="topo" title="Mais opções" aria-haspopup="menu" aria-expanded="${app.menu === 'topo'}"><span class="ms s16">more_vert</span></button>${menu}` : ''}
    </div>${botoesJanela(jn)}</div>
    <nav class="tabs">${ABAS.map(([id, ic, rot]) => `<div class="tab${id === app.tela ? ' on' : ''}" data-act="g:ir" data-tela="${id}"><span class="ms s16">${ic}</span>${rot}</div>`).join('')}</nav></div>`;
}

function camadas() {
  let h = '';
  if (app.encerrado) {
    return `<div class="offline"><section class="card"><div class="card-h"><span class="dot off"></span><span class="h2">pump-sim encerrado</span></div>
      <div class="empty"><span class="ms">power_settings_new</span><b style="color:var(--ink)">O pump-sim foi encerrado</b>
      <span class="small">As portas do concentrador e a API de controle foram fechadas e o processo terminou. Pode fechar esta ${janela.estado.ativa ? 'janela' : 'aba'}. Para usar de novo, abra o pump-sim outra vez.</span></div></section></div>`;
  }
  if (app.modal) {
    const m = app.modal;
    h += `<div class="scrim" data-act="g:fechar-modal" data-fundo="1"><div class="modal" role="dialog" aria-label="${e(m.titulo)}">
      <div class="card-h"><span class="h2">${e(m.titulo)}</span><button class="btn ghost sm" style="margin-left:auto" data-act="g:fechar-modal"><span class="ms s16">close</span></button></div>
      <div class="card-b">${m.corpo(app.ui.modal)}</div>
      <div class="foot"><button class="btn" data-act="g:fechar-modal">Cancelar</button><button class="btn pri${m.perigo ? ' danger' : ''}" data-act="g:confirmar-modal">${e(m.rotulo ?? 'OK')}</button></div></div></div>`;
  }
  if (app.toast) {
    const t = app.toast;
    h += `<div class="toast"><div class="banner ${t.tipo === 'err' ? 'err' : 'info'}"><span class="ms fill">${t.tipo === 'err' ? 'error' : 'check_circle'}</span><span class="small t">${e(t.texto)}</span>
      <button class="btn ghost sm" data-act="g:fechar-toast"><span class="ms s14">close</span></button></div></div>`;
  }
  if (api.estado === 'off') {
    h += `<div class="offline"><section class="card"><div class="card-h"><span class="dot off"></span><span class="h2">API de controle</span><span class="small faint">desligada</span></div>
      <div class="empty"><span class="ms">power_off</span><b style="color:var(--ink)">A API de controle não está rodando</b>
      <span class="small">A interface perdeu a conexão com o pump-sim e tenta de novo a cada 1,5 s. Sem a API o MCP também não tem a quem chamar. Suba o pump-sim com a opção --ui (ou --control):</span>
      <span class="code" style="text-align:left">pump-sim --profile simulador-2.7.2 --ui</span></div></section></div>`;
  }
  return h;
}

let raiz;
function render() {
  if (!raiz) return;
  const tela = TELAS[app.tela];
  let corpo;
  try {
    corpo = app.estado ? tela.render(app) : '<div class="main"><div class="empty"><span class="ms">hourglass_top</span><span class="small">Conectando ao pump-sim…</span></div></div>';
  } catch (err) {
    corpo = `<div class="main"><div class="banner err"><span class="ms fill">error</span><span class="small t">Erro ao desenhar a tela: ${e(err.message)}</span></div></div>`;
    console.error(err);
  }
  morph(raiz, topo() + corpo + camadas());
  dicas.atualizar();
  try {
    tela.aposRender?.(app, raiz);
  } catch (err) {
    console.error(err);
  }
}

// ───────────────────────── event delegation ─────────────────────────

const GLOBAIS = {
  ir(_app, d) {
    app.ir(d.tela);
  },
  tema() {
    const escuro = document.body.classList.contains('th-dark');
    app.tema = escuro ? 'claro' : 'escuro';
    guardar('pump-sim.tema', app.tema);
  },
  menu(_app, d) {
    app.menu = app.menu === d.menu ? null : d.menu;
  },
  'fechar-modal'(_app, d, el, ev) {
    if (d.fundo && ev.target !== el) return;
    app.modal = null;
  },
  async 'confirmar-modal'() {
    const m = app.modal;
    if (!m) return;
    try {
      const fechar = await m.confirmar(app.ui.modal);
      if (fechar !== false) app.modal = null;
    } catch (err) {
      app.aviso(err.message, 'err');
    }
  },
  janela(_app, d) {
    janela.acao(d.acao);
  },
  encerrar() {
    app.menu = null;
    app.abrirModal({
      titulo: 'Encerrar pump-sim',
      rotulo: 'Encerrar',
      perigo: true,
      corpo: () =>
        `<span class="small">Fecha as portas do concentrador${app.estado?.conexoes.length ? ` (${app.estado.conexoes.length === 1 ? 'há 1 conexão aberta' : `há ${app.estado.conexoes.length} conexões abertas`})` : ''}, a API de controle e o MCP, e termina o processo.</span>`,
      async confirmar() {
        await api.post('/api/encerrar', {});
        app.encerrado = true;
        api.parar();
      },
    });
  },
  'fechar-toast'() {
    app.toast = null;
  },
  async copiar(_app, d) {
    try {
      await navigator.clipboard.writeText(d.texto);
      app.aviso('Copiado', 'info');
    } catch {
      app.aviso('O navegador não deixou copiar', 'err');
    }
  },
};

async function despachar(el, ev) {
  const act = el.dataset.act;
  if (el.disabled) return;
  const [escopo, nome] = act.startsWith('g:') ? [GLOBAIS, act.slice(2)] : [TELAS[app.tela].acoes ?? {}, act];
  const f = escopo[nome];
  if (!f) return;
  ev.stopPropagation();
  await f(app, el.dataset, el, ev);
  render();
}

function campo(el) {
  const escopo = el.dataset.escopo === 'modal' ? 'modal' : app.tela;
  app.ui[escopo] ??= {};
  app.ui[escopo][el.dataset.campo] = el.value;
  const tela = TELAS[app.tela];
  tela.aoMudar?.(app, el.dataset.campo, el.value);
  render();
}

function iniciar() {
  raiz = document.getElementById('app');
  janela = criarJanela(window.chrome?.webview, () => render());
  dicas = instalarDicas(raiz, document);
  // Without app-region support in the runtime, the bar drags the window through the host.
  raiz.addEventListener('mousedown', (ev) => {
    if (ev.button === 0 && ev.detail === 1 && janela.estado.ativa && !janela.estado.regiao && arrastavel(ev.target)) janela.acao('arrastar');
  });
  raiz.addEventListener('dblclick', (ev) => {
    if (janela.estado.ativa && !janela.estado.regiao && arrastavel(ev.target)) janela.acao('maximizar');
  });
  raiz.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || !el.closest('.menu')) {
      if (app.menu && !(el && el.dataset.act === 'g:menu')) {
        app.menu = null;
        if (!el) render();
      }
    }
    if (el) void despachar(el, ev);
  });
  // Scroll does not bubble: listen in the capture phase and hand it to the screen (console follow).
  raiz.addEventListener(
    'scroll',
    (ev) => {
      TELAS[app.tela].aoRolar?.(app, ev.target);
    },
    true,
  );
  raiz.addEventListener('input', (ev) => {
    if (ev.target.dataset?.campo && ev.target.tagName !== 'SELECT') campo(ev.target);
  });
  raiz.addEventListener('change', (ev) => {
    if (ev.target.dataset?.campo && ev.target.tagName === 'SELECT') campo(ev.target);
  });
  raiz.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.dataset?.enter) {
      const alvo = raiz.querySelector(`[data-act="${ev.target.dataset.enter}"]`);
      if (alvo) void despachar(alvo, ev);
    }
    if (ev.key === 'Escape' && app.modal) {
      app.modal = null;
      render();
    }
  });
  const rota = () => {
    const t = location.hash.replace(/^#\/?/, '');
    app.tela = TELAS[t] ? t : 'pista';
    app.menu = null;
    forcarAtualizacao();
    TELAS[app.tela].entrar?.(app);
    render();
  };
  window.addEventListener('hashchange', rota);
  api.aoMudar = () => {
    forcarAtualizacao();
    render();
  };
  rota();
  api.conectar();
  void ciclo();
}

export { app, horaMs };
iniciar();
