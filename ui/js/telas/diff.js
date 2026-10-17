// Diff: runs the differential script (diff_executar) against targets A and B and shows the
// byte-by-byte comparison. The run is one call: no partial progress until it ends.
import { baixar, e } from '../fmt.js';
import { seg, sw } from './comum.js';

const ROTEIROS = [
  ['paridade', 'Paridade com o 2.7.2 · DIFF-01…20, 30', (id) => /^DIFF-/.test(id)],
  ['equiv', 'Equivalência comportamental · EQUIV-*', (id) => /^EQUIV-/.test(id)],
  ['bancada', 'Bancada · BANCADA-*', (id) => /^BANCADA-/.test(id)],
  ['todos', 'Todos os casos', () => true],
];

function ui(app) {
  app.ui.diff ??= { roteiro: 'paridade', fora: {}, alvoA: '', ctlA: '', tipoA: 'driver', alvoB: '', ctlB: '', tipoB: 'pump-sim', drenar: false, rodando: false, rel: null, sel: null, erro: null };
  return app.ui.diff;
}

/** Byte segments of x against y: different bytes in red; if the step was judged equal anyway, masked. */
function segs(x, y, igual) {
  const out = [];
  let cur = null;
  for (let i = 0; i < x.length; i++) {
    const c = x[i] === y[i] ? 'd-eq' : igual ? 'd-mask' : 'd-bad';
    if (cur && cur.c === c) cur.t += x[i];
    else out.push((cur = { t: x[i], c }));
  }
  return out.map((s) => `<span class="${s.c}">${e(s.t)}</span>`).join('') || '<span class="d-sil">silêncio</span>';
}

const resCaso = (r) => (r.pulado ? ['st st-livre', 'pulado'] : r.divergencias ? ['st st-falha', 'diverge'] : ['st st-abastecendo', 'igual']);

export default {
  id: 'diff',
  polls: [{ chave: 'roteiros', nome: 'list_roteiros_diff', cada: 600000 }],
  entrar(app) {
    const u = ui(app);
    const est = app.estado;
    if (!u.alvoB && est?.portas[0]) u.alvoB = `127.0.0.1:${est.portas[0].fisica}`;
    if (!u.ctlB) u.ctlB = location.origin;
  },
  render(app) {
    const u = ui(app);
    this.entrar(app);
    const todos = app.dados.roteiros?.casos ?? [];
    const filtro = ROTEIROS.find((r) => r[0] === u.roteiro)?.[2] ?? (() => true);
    const casos = todos.filter((c) => filtro(c.id));
    const marcados = casos.filter((c) => !u.fora[c.id]);
    const porId = new Map((u.rel?.casos ?? []).map((r) => [r.id, r]));
    const lista = casos
      .map((c) => {
        const r = porId.get(c.id);
        const [cls, txt] = r ? resCaso(r) : ['small faint', ''];
        const on = !u.fora[c.id];
        return `<div class="cs${u.sel === c.id ? ' sel' : ''}" data-act="ver" data-id="${e(c.id)}" data-key="${e(c.id)}"><span class="chk${on ? ' on' : ''}" data-act="marcar" data-id="${e(c.id)}">${on ? '<span class="ms s14">check</span>' : ''}</span>
          <span class="mono small fw6">${e(c.id)}</span><span class="t" title="${e(c.titulo)}">${e(c.titulo)}</span><span class="${cls}">${txt}</span></div>`;
      })
      .join('');
    const alvo = (k, rot, sub) => {
      const A = k === 'A';
      return `<div class="alvo"><div class="row gap8"><span class="ab">${k}</span><b>${rot}</b><span class="small faint">${sub}</span></div>
        <div class="flab"><span class="lbl">Host:porta</span><input class="inp" data-campo="alvo${k}" value="${e(A ? u.alvoA : u.alvoB)}" placeholder="${A ? '192.0.2.10:2001' : '127.0.0.1:2001'}"></div>
        <div class="flab"><span class="lbl">Controle</span><input class="inp" data-campo="ctl${k}" value="${e(A ? u.ctlA : u.ctlB)}" placeholder="opcional: http://host:porta"></div>
        ${seg([['driver', 'driver de UI'], ['pump-sim', 'API de controle']], A ? u.tipoA : u.tipoB, `tipo${k}`)}</div>`;
    };
    const rel = u.rel;
    let resultado = '';
    if (u.rodando) resultado = '<section class="card"><div class="empty"><span class="ms">hourglass_top</span><b style="color:var(--ink)">Rodando o diff…</b><span class="small">O resultado aparece quando o último caso terminar. DIFF-17 sozinho leva cerca de 2 h.</span></div></section>';
    else if (u.erro) resultado = `<div class="banner err"><span class="ms fill">error</span><span class="small t">${e(u.erro)}</span></div>`;
    else if (rel) {
      const iguais = rel.casos.filter((r) => !r.pulado && !r.divergencias).length;
      const div = rel.casos.filter((r) => !r.pulado && r.divergencias).length;
      const pul = rel.casos.filter((r) => r.pulado).length;
      const caso = rel.casos.find((r) => r.id === u.sel) ?? rel.casos.find((r) => r.divergencias) ?? rel.casos[0];
      const passos = (caso?.passos ?? [])
        .map((p) => `<div class="stp"><span class="c-na">${p.indice + 1}</span><span class="c-rx fr">${e(p.quadro)}</span><span class="fr">${segs(p.a.texto, p.b.texto, p.igual)}</span><span class="fr">${segs(p.b.texto, p.a.texto, p.igual)}</span><span class="${p.pulado ? 'c-na' : p.igual ? 'res-eq' : 'res-dv'}"${p.pulado ? ` title="${e(p.pulado)}"` : ''}>${p.pulado ? 'pulado' : p.tolerancia ? 'igual (tolerância wine)' : p.igual ? 'igual' : 'diverge'}</span></div>`)
        .join('');
      const json = JSON.stringify(rel, null, 2);
      resultado = `<section class="card"><div class="sum"><span class="h2">Resultado</span>
          <span class="st st-abastecendo"><span class="ms">check_circle</span>${iguais} iguais</span><span class="st st-falha"><span class="ms">difference</span>${div} divergentes</span><span class="st st-livre"><span class="ms">skip_next</span>${pul} pulado${pul === 1 ? '' : 's'}</span>
          <span class="small faint" style="margin-left:auto">${e(rel.alvoA)} × ${e(rel.alvoB)}</span></div>
        ${caso ? `<div class="card-h"><span class="mono fw6">${e(caso.id)}</span><span class="h2">${e(caso.titulo)}</span><span class="${resCaso(caso)[0]}" style="margin-left:auto">${caso.pulado ? e(caso.pulado) : `${caso.divergencias} de ${caso.passos.length} passos diverge${caso.divergencias === 1 ? '' : 'm'}`}</span></div>
        <div class="con" style="border-radius:0 0 8px 8px"><div class="stp hd"><span>#</span><span>TX</span><span>RX A</span><span>RX B</span><span>Resultado</span></div>${passos || '<div class="stp"><span></span><span class="c-na">sem passos comparados</span></div>'}
          <div class="leg"><span><span class="sw2 d-bad"></span>byte diferente</span><span><span class="sw2 d-mask"></span>diferente mas mascarado (tensão, relógio)</span></div></div>` : ''}
      </section>
      <section class="card"><div class="card-h"><span class="ms s16">data_object</span><span class="h2">Relatório JSON</span><span class="small faint">o mesmo que pump-sim diff --json</span><button class="btn sm" style="margin-left:auto" data-act="g:copiar" data-texto="${e(json)}"><span class="ms s14">content_copy</span>Copiar</button></div>
        <div class="card-b"><div class="code">${e(json.length > 20000 ? json.slice(0, 20000) + '\n…' : json)}</div></div></section>`;
    }
    return `<div class="main scr-diff">
      <div class="row gap16"><div class="fx col gap4"><h1 class="h1">Teste diferencial</h1><div class="muted">Roda o mesmo roteiro no alvo A (o SimuladorCBC 2.7.2 ou um console real) e no B (o pump-sim) e compara cada resposta byte a byte.</div></div>
        <div class="row gap8" style="margin-left:auto"><button class="btn" data-act="exportar"${rel ? '' : ' disabled'}><span class="ms s16">download</span>Exportar JSON</button>
        <button class="btn pri" data-act="rodar"${marcados.length && !u.rodando ? '' : ' disabled'}><span class="ms s16">play_arrow</span>Rodar ${marcados.length} caso${marcados.length === 1 ? '' : 's'}</button></div></div>
      <div class="cols"><section class="card">
        <div class="card-h" style="flex-direction:column;align-items:stretch;gap:8px"><span class="lbl">Roteiro</span>
          <select class="field" data-campo="roteiro">${ROTEIROS.map((r) => `<option value="${r[0]}"${r[0] === u.roteiro ? ' selected' : ''}>${e(r[1])}</option>`).join('')}</select>
          <div class="row gap8"><span class="chk${marcados.length === casos.length ? ' on' : ''}" data-act="todos">${marcados.length === casos.length ? '<span class="ms s14">check</span>' : ''}</span><span class="small">Selecionar todos</span><span class="small faint" style="margin-left:auto">${marcados.length} de ${casos.length}</span></div></div>
        <div class="casos">${lista}</div></section>
      <div class="stack">
        <section class="card"><div class="alvos">${alvo('A', 'Referência', 'SimuladorCBC 2.7.2 ou console real')}${alvo('B', 'Sob teste', `este pump-sim · ${e(app.estado.perfil.id)}`)}</div>
          <div class="sep"></div>
          <div class="row gap16 wrap" style="padding:10px 14px">
            <span class="row gap8">${sw(true, '', '', true)}<span class="small">Mascarar o byte de tensão do &amp;S <span class="faint">(sempre)</span></span></span>
            <span class="row gap8">${sw(false, '', '', true)}<span class="small">Interativo <span class="faint">(só pela CLI: --interativo)</span></span></span>
            <span class="row gap8">${sw(true, '', '', true)}<span class="small">Conexões novas por caso <span class="faint">(sempre)</span></span></span>
            <span class="row gap8">${sw(u.drenar, 'drenar')}<span class="small">Drenar o alvo A antes do 1º caso</span></span></div></section>
        ${resultado}
      </div></div></div>`;
  },
  acoes: {
    marcar(app, d) {
      const u = ui(app);
      u.fora[d.id] = !u.fora[d.id];
    },
    todos(app) {
      const u = ui(app);
      const filtro = ROTEIROS.find((r) => r[0] === u.roteiro)?.[2] ?? (() => true);
      const casos = (app.dados.roteiros?.casos ?? []).filter((c) => filtro(c.id));
      const todosOn = casos.every((c) => !u.fora[c.id]);
      for (const c of casos) u.fora[c.id] = todosOn;
    },
    ver(app, d, _el, ev) {
      if (ev.target.closest('.chk')) return;
      ui(app).sel = d.id;
    },
    tipoA(app, d) {
      ui(app).tipoA = d.v;
    },
    tipoB(app, d) {
      ui(app).tipoB = d.v;
    },
    drenar(app) {
      const u = ui(app);
      u.drenar = !u.drenar;
    },
    async rodar(app) {
      const u = ui(app);
      const filtro = ROTEIROS.find((r) => r[0] === u.roteiro)?.[2] ?? (() => true);
      const ids = (app.dados.roteiros?.casos ?? []).filter((c) => filtro(c.id) && !u.fora[c.id]).map((c) => c.id);
      if (!u.alvoA.trim() || !u.alvoB.trim()) return app.aviso('Informe host:porta dos dois alvos');
      const args = { roteiro: ids, alvo_a: u.alvoA.trim(), alvo_b: u.alvoB.trim(), drenar_antes: u.drenar };
      if (u.ctlA.trim()) Object.assign(args, { controle_a: u.ctlA.trim(), tipo_controle_a: u.tipoA });
      if (u.ctlB.trim()) Object.assign(args, { controle_b: u.ctlB.trim(), tipo_controle_b: u.tipoB });
      u.rodando = true;
      u.erro = null;
      app.render();
      try {
        u.rel = await app.api.chamar('diff_executar', args);
        u.sel = null;
      } catch (err) {
        u.erro = err.message;
      } finally {
        u.rodando = false;
      }
    },
    exportar(app) {
      const u = ui(app);
      if (u.rel) baixar('diff.json', JSON.stringify(u.rel, null, 2));
    },
  },
};
