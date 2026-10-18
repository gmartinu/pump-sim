// Tráfego: every socket read/write of the ports (the `trafego` event stream), fault events and
// parser errors; filters, pause, export; decode of a selected &A 52; and the fault injection panel.
import { baixar, classeKK, decodificarA52, e, horaMs, lerNum, verbo } from '../fmt.js';
import { cabecalho, seg, vazio } from './comum.js';

const VERBOS = ['Todos', '&S', '&A', '&V', '&I', '&T', '?A', 'Falhas'];
const FALHAS = [
  ['atraso', 'Atraso', 'segura a resposta por N ms'],
  ['sem_resposta', 'Sem resposta', 'o quadro é engolido; o cliente espera o timeout'],
  ['frame_corrompido', 'Frame corrompido', 'troca N bytes da resposta'],
  ['truncado', 'Frame truncado', 'corta os últimos N bytes da resposta'],
  ['checksum_errado', 'Checksum errado', 'responde com KK inválido'],
  ['desconectar', 'Desconectar', 'fecha a conexão (RST ou FIN)'],
  ['travamento', 'Travar UI (modal)', 'congela como o MessageBox do 2.7.2 até liberar (sem ms) ou por N ms'],
];

function ui(app) {
  app.ui.trafego ??= { verbo: 'Todos', porta: 'todas', busca: '', pausado: null, sel: null, tipo: 'atraso', ms: '800', bytes: '1', modo: 'rst', prefixo: '&S', fporta: 'todas', vezes: '1', prob: '100' };
  return app.ui.trafego;
}

/**
 * Rows of the console with, for a tx row, the verb of its request (the last rx on the same
 * connection), and the frames an injected fault touched. The `falha` event comes between the request
 * and the reply it changes (rx → falha → tx, measured over the WS): the fault is tied to the last rx
 * of its frame on its port before the event, and to the first tx answering that same rx. A fault that
 * swallows the reply (`sem_resposta`, `desconectar`) ties only the rx: the next reply answers another
 * request. Linked rows carry `falhaTipo`; the event row carries `alvo` (the n of the changed tx).
 */
export function ligarFalhas(base) {
  const ultimoRx = new Map(); // conexao → rx row
  const rxPorPorta = new Map(); // porta → rx rows, newest last
  const esperando = new Map(); // n of the rx row → event row
  const out = [];
  for (const r0 of base) {
    const r = { ...r0, verbo: '' };
    if (r.dir === 'rx') {
      r.verbo = verbo(r.texto);
      ultimoRx.set(r.conexao, r);
      const l = rxPorPorta.get(r.porta) ?? [];
      l.push(r);
      if (l.length > 16) l.shift();
      rxPorPorta.set(r.porta, l);
    } else if (r.dir === 'tx') {
      const req = ultimoRx.get(r.conexao);
      r.verbo = req?.verbo ?? '';
      const ev = req ? esperando.get(req.n) : undefined;
      if (ev) {
        esperando.delete(req.n);
        r.falhaTipo = ev.falhaTipo;
        r.falhaN = ev.n;
        ev.alvo = r.n;
      }
    } else if (r.falha) {
      const req = [...(rxPorPorta.get(r.porta) ?? [])].reverse().find((x) => r.quadroFalha === undefined || x.texto === r.quadroFalha);
      if (req) {
        req.falhaTipo ??= r.falhaTipo;
        esperando.set(req.n, r);
      }
    }
    out.push(r);
  }
  return out;
}

/** Rows after the filters. */
function linhas(app) {
  const u = ui(app);
  const out = ligarFalhas(u.pausado ?? app.trafego);
  const busca = u.busca.trim().toUpperCase();
  return out.filter((r) => {
    if (u.porta !== 'todas' && String(r.porta) !== u.porta) return false;
    if (u.verbo === 'Falhas' && !r.falha && !r.falhaTipo) return false;
    if (u.verbo !== 'Todos' && u.verbo !== 'Falhas' && r.verbo !== u.verbo) return false;
    if (busca && !String(r.texto).toUpperCase().includes(busca)) return false;
    return true;
  });
}

/** Whether a scrollable element is at (or within `folga` px of) its bottom. */
export function noFundo(el, folga = 8) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= folga;
}

/**
 * Moves the console to the last line when live ("Ao vivo") and following. Returns whether it moved.
 * The scroll event of a user scroll can land after the next render: a scrollTop below the one this
 * function last set, away from the bottom, is the user scrolling up, so following stops there instead
 * of snapping back.
 */
export function seguirFim(u, el) {
  if (!el || u.pausado || u.seguir === false) return false;
  if (u.el !== el) u.topo = undefined; // a new console element (screen re-entered, first frame)
  u.el = el;
  if (u.topo !== undefined && el.scrollTop < u.topo - 1 && !noFundo(el)) {
    u.seguir = false;
    return false;
  }
  el.scrollTop = el.scrollHeight;
  u.topo = el.scrollTop;
  return true;
}

const fmtFalha = (f) => {
  const porta = f.porta === null ? 'todas as portas' : `porta ${f.porta}`;
  const vezes = f.restantes === null ? 'sempre' : `${f.restantes} restante${f.restantes === 1 ? '' : 's'}`;
  const prob = f.probabilidade < 1 ? ` · ${Math.round(f.probabilidade * 100)} %` : '';
  const ms = f.param?.ms !== undefined ? ` · ${f.param.ms === null ? 'até liberar' : `${f.param.ms} ms`}` : '';
  return { t: `${f.tipo} · ${f.verbo === '*' ? 'todos' : f.verbo}`, d: `${porta} · ${vezes}${prob}${ms} · ${f.disparos} aplicada${f.disparos === 1 ? '' : 's'}` };
};

export default {
  id: 'trafego',
  render(app) {
    const est = app.estado;
    const u = ui(app);
    const portas = est.portas.map((p) => p.logica);
    const ls = linhas(app);
    const vis = ls.slice(-400);
    const porN = new Map(vis.map((r) => [r.n, r]));
    const rows = vis
      .map((r) => {
        const k = r.dir === 'ev' ? 'na' : classeKK(r.texto, r.dir, r.dir === 'tx' ? r.falhaTipo : undefined);
        const dcls = r.dir === 'rx' ? 'c-rx' : r.dir === 'tx' ? 'c-tx' : 'c-ev';
        const alvo = r.falha && r.alvo !== undefined ? porN.get(r.alvo) : undefined;
        const nota = r.dir === 'tx' ? `${r.texto.length} chars` : alvo ? `→ TX ${horaMs(alvo.ts, true)}` : '';
        const marca = r.falha ? ' falha' : r.falhaTipo ? ' afetado' : '';
        const tag = r.falhaTipo && !r.falha ? ` <span class="c-ftag">${e(r.falhaTipo)}</span>` : '';
        // Clicking the fault event selects the frame it changed.
        const n = alvo ? alvo.n : r.n;
        return `<div class="con-row${marca}${u.sel === r.n || (alvo && u.sel === alvo.n) ? ' sel' : ''}" data-act="sel" data-n="${n}" data-key="t${r.n}"${r.falhaTipo && !r.falha ? ` title="Quadro afetado pela falha injetada ${e(r.falhaTipo)}"` : ''}><span class="c-ts">${horaMs(r.ts, true)}</span><span>${e(r.porta)}</span><span>${r.conexao ? `#${r.conexao}` : ''}</span>
          <span class="${dcls}">${r.dir.toUpperCase()}</span><span class="c-fr">${e(r.texto)}${tag} <span class="c-na">${nota}</span></span>
          <span class="${k === 'ok' ? 'c-ok' : k === 'bad' ? 'c-bad' : 'c-na'}">${r.dir === 'ev' ? '—' : k === 'ok' ? 'válido' : k === 'bad' ? 'inválido' : 'sem KK'}</span></div>`;
      })
      .join('');
    const sel = ls.find((r) => r.n === u.sel);
    const campos = sel && sel.dir === 'tx' ? decodificarA52(sel.texto) : null;
    const dec = campos
      ? `<div class="dec-h"><span class="c-tx">TX ${horaMs(sel.ts, true)}</span><span class="c-na">&amp;A · layout 52</span></div>
         <div class="dec">${campos.map(([k, v]) => `<div><span class="k">${e(k)}</span><span class="v">${e(v)}</span></div>`).join('')}</div>`
      : sel
        ? `<div class="dec-h"><span class="${sel.dir === 'rx' ? 'c-rx' : 'c-tx'}">${sel.dir.toUpperCase()} ${horaMs(sel.ts, true)}</span><span class="c-na">${e(sel.texto)} · ${sel.texto.length} chars${sel.dir === 'tx' ? ' · decodificação só para o &amp;A 52' : ''}</span></div>`
        : '';
    const painel = app.trafego.length
      ? `<div class="con" style="border-radius:0 0 8px 8px">
          <div class="con-row con-head"><span>Hora</span><span>Porta</span><span>Con.</span><span>Dir</span><span>Quadro</span><span>Checksum</span></div>
          <div class="con-body">${rows || '<div class="con-row"><span></span><span></span><span></span><span></span><span class="c-na">nada casa com o filtro</span><span></span></div>'}</div>${dec}</div>`
      : vazio('swap_vert', 'Nenhum quadro ainda', `${portas.length ? `A porta ${portas.join(', ')} está escutando.` : 'Nenhuma porta aberta.'} O console começa a encher quando um cliente mandar o primeiro quadro.`, portas.length ? `<span class="mono small faint">printf '(&amp;S)' | nc 127.0.0.1 ${est.portas[0].fisica}</span>` : '');

    // Faults
    const tipos = FALHAS.map(([id, rot, desc]) => `<div class="ftipo${u.tipo === id ? ' on' : ''}" data-act="tipo" data-v="${id}"><span class="radio${u.tipo === id ? ' on' : ''}"></span><span class="fx col gap2"><b class="fw6">${rot}</b><span class="small muted">${desc}</span></span></div>`).join('');
    let param;
    if (u.tipo === 'atraso' || u.tipo === 'travamento') param = `<div class="fcell"><span class="lbl">${u.tipo === 'atraso' ? 'Atraso' : 'Duração (vazio = até liberar)'}</span><div class="field mono"><input data-campo="ms" value="${e(u.ms)}"><span class="faint">ms</span></div></div>`;
    else if (u.tipo === 'frame_corrompido' || u.tipo === 'truncado') param = `<div class="fcell"><span class="lbl">Bytes</span><div class="field mono"><input data-campo="bytes" value="${e(u.bytes)}"></div></div>`;
    else if (u.tipo === 'desconectar') param = `<div class="fcell"><span class="lbl">Modo</span>${seg([['rst', 'RST'], ['fin', 'FIN']], u.modo, 'modo')}</div>`;
    else param = '<div class="fcell"><span class="lbl">Parâmetro</span><div class="field faint">—</div></div>';
    const ativas = (est.falhas ?? [])
      .map((f) => {
        const x = fmtFalha(f);
        return `<div class="ativa"><span class="fx col gap2"><span class="mono fw6">${e(x.t)}</span><span class="small muted">${e(x.d)}</span></span><button class="btn sm ghost" data-act="remover" data-id="${f.id}" aria-label="Remover"><span class="ms s14">close</span></button></div>`;
      })
      .join('');
    const pausado = Boolean(u.pausado);
    const parado = !pausado && u.seguir === false && app.trafego.length > 0;
    return `<div class="main scr-trafego">
      ${cabecalho('Tráfego', 'Tudo o que entra e sai das portas, quadro a quadro. RX = cliente → simulador.')}
      <div class="cols"><section class="card">
        <div class="tool"><span class="live${pausado ? ' off' : ''}"><span class="dot${pausado ? ' off' : ' pulse'}"></span>${pausado ? 'Pausado' : 'Ao vivo'}</span>${parado ? '<button class="btn sm" data-act="fim" title="Voltar a seguir as linhas novas"><span class="ms s14">south</span>Ir para o fim</button>' : ''}
          <span class="lbl" style="margin-left:8px">Verbo</span>${VERBOS.map((v) => `<span class="vchip${u.verbo === v ? ' on' : ''}" data-act="verbo" data-v="${e(v)}">${e(v)}</span>`).join('')}
          <div style="margin-left:auto">${seg([['todas', 'Todas'], ...portas.map((p) => [String(p), String(p)])], u.porta, 'porta')}</div></div>
        <div class="tool"><div class="field" style="flex:1"><span class="ms s16">search</span><input data-campo="busca" value="${e(u.busca)}" placeholder="Buscar no quadro (ex.: 04, TG99)"></div>
          <button class="btn" data-act="pausar"><span class="ms s16">${pausado ? 'play_arrow' : 'pause'}</span>${pausado ? 'Continuar' : 'Pausar'}</button>
          <button class="btn" data-act="limpar"><span class="ms s16">delete_sweep</span>Limpar</button>
          <button class="btn pri" data-act="exportar"${app.trafego.length ? '' : ' disabled'}><span class="ms s16">download</span>Exportar JSONL</button></div>
        ${painel}
      </section>
      <section class="card">
        <div class="card-h"><span class="ms s16">bug_report</span><span class="h2">Falhas</span><span class="small faint">casam por porta e prefixo do quadro</span></div>
        ${tipos}<div class="sep"></div>
        <div class="fgrid">${param}
          <div class="fcell"><span class="lbl">Prefixo do quadro</span><div class="field mono"><input data-campo="prefixo" value="${e(u.prefixo)}" placeholder="* = todos"></div></div>
          <div class="fcell"><span class="lbl">Porta</span><select class="field" data-campo="fporta"><option value="todas"${u.fporta === 'todas' ? ' selected' : ''}>Todas</option>${portas.map((p) => `<option value="${p}"${u.fporta === String(p) ? ' selected' : ''}>${p}</option>`).join('')}</select></div>
          <div class="fcell"><span class="lbl">Vezes</span>${seg([['1', '1'], ['5', '5'], ['sempre', 'sempre']], u.vezes, 'vezes')}</div>
          <div class="fcell" style="grid-column: span 2"><span class="lbl">Probabilidade</span><div class="field mono"><input data-campo="prob" value="${e(u.prob)}"><span class="faint">%</span></div></div>
        </div>
        <div class="row gap8" style="padding:0 14px 14px"><button class="btn pri wide" data-act="aplicar"><span class="ms s16">play_arrow</span>Aplicar falha</button></div>
        <div class="sep"></div>
        <div class="card-h" style="border-bottom:0;padding-bottom:4px"><span class="lbl">Ativas</span>${est.travamento ? '<button class="btn sm" data-act="liberar">Liberar travamento</button>' : ''}<button class="btn sm ghost" style="margin-left:auto" data-act="limpar-falhas"${ativas ? '' : ' disabled'}>Limpar falhas</button></div>
        ${ativas || '<div class="card-b small faint" style="padding-top:4px">Nenhuma falha ativa.</div>'}
      </section></div></div>`;
  },
  /** Scroll inside the console: following stops when the user leaves the bottom, resumes at the bottom. */
  aoRolar(app, el) {
    if (!el?.classList?.contains('con-body')) return;
    const u = ui(app);
    u.seguir = noFundo(el);
    if (!u.seguir) u.topo = undefined;
  },
  /** After each render: while live and following, keep the console at the last line. */
  aposRender(app, raiz) {
    seguirFim(ui(app), raiz?.querySelector?.('.scr-trafego .con-body'));
  },
  acoes: {
    fim(app) {
      const u = ui(app);
      u.seguir = true;
      u.topo = undefined;
    },
    verbo(app, d) {
      ui(app).verbo = d.v;
    },
    porta(app, d) {
      ui(app).porta = d.v;
    },
    sel(app, d) {
      const u = ui(app);
      u.sel = u.sel === Number(d.n) ? null : Number(d.n);
    },
    pausar(app) {
      const u = ui(app);
      u.pausado = u.pausado ? null : [...app.trafego];
      if (!u.pausado) {
        u.seguir = true;
        u.topo = undefined;
      }
    },
    limpar(app) {
      app.trafego.length = 0;
      const u = ui(app);
      if (u.pausado) u.pausado = [];
      u.sel = null;
      u.topo = undefined;
    },
    exportar(app) {
      const ls = linhas(app);
      const hex = (t) => [...t].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      const txt = ls.map((r) => JSON.stringify(r.dir === 'ev' ? { ts: r.ts, porta: r.porta, conexao: r.conexao ?? 0, dir: 'evento', texto: r.texto } : { ts: r.ts, porta: r.porta, conexao: r.conexao, dir: r.dir, bytes: hex(r.texto), texto: r.texto })).join('\n');
      baixar(`trafego-${app.estado.relogio.agora}.jsonl`, txt + '\n', 'application/x-ndjson');
    },
    tipo(app, d) {
      ui(app).tipo = d.v;
    },
    modo(app, d) {
      ui(app).modo = d.v;
    },
    vezes(app, d) {
      ui(app).vezes = d.v;
    },
    async aplicar(app) {
      const u = ui(app);
      const param = {};
      if (u.tipo === 'atraso') param.ms = Number(u.ms);
      if (u.tipo === 'travamento') param.ms = u.ms.trim() === '' ? null : Number(u.ms);
      if (u.tipo === 'frame_corrompido' || u.tipo === 'truncado') param.bytes = Number(u.bytes);
      if (u.tipo === 'desconectar') param.modo = u.modo;
      const prob = lerNum(u.prob);
      const args = { tipo: u.tipo, verbo: u.prefixo.trim() || '*', vezes: u.vezes === 'sempre' ? 'sempre' : Number(u.vezes), param };
      if (u.fporta !== 'todas') args.porta = Number(u.fporta);
      if (!Number.isNaN(prob) && prob < 100) args.probabilidade = Math.max(0, prob) / 100;
      const r = await app.chamar('injetar_falha', args);
      if (r) app.aviso(`Falha ${r.tipo} #${r.id} ativa`, 'info');
    },
    async remover(app, d) {
      await app.chamar('limpar_falhas', { id: Number(d.id) });
    },
    async 'limpar-falhas'(app) {
      await app.chamar('limpar_falhas');
    },
    async liberar(app) {
      await app.chamar('liberar_travamento');
    },
  },
};
