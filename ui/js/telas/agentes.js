// Gravação & agentes: record raw traffic to JSONL, list/download/replay recordings, and show the
// control API and MCP status with the recent agent calls (the UI's own calls are not listed).
import { diaHoraMs, duracao, e, horaMs, num, tamanho } from '../fmt.js';
import { cabecalho, seg } from './comum.js';

const GRUPOS = ['leitura', 'protocolo', 'controle', 'infra'];

function ui(app) {
  app.ui.agentes ??= { modo: 'cliente', alvo: '', vel: '1', arquivo: null, rodando: false, resultado: null };
  return app.ui.agentes;
}

export default {
  id: 'agentes',
  polls: [
    { chave: 'gravacoes', nome: 'list_gravacoes', cada: 2000 },
    { chave: 'catalogo', get: '/api/catalogo', cada: 60000 },
  ],
  render(app) {
    const est = app.estado;
    const u = ui(app);
    const g = est.gravacao;
    const agora = est.relogio.agora;
    const recbar = g
      ? `<div class="recbar"><span class="recdot rec"></span><span class="fx col gap2"><span class="big">${duracao(agora - g.inicio)}</span><span class="small muted">gravando · ${num(g.quadros, 0)} quadros · ${tamanho(g.bytes)}</span></span>
          <span class="mono small muted">${e(g.arquivo ? g.arquivo.split(/[\\/]/).pop() : 'em memória')}</span>
          <button class="btn pri" style="margin-left:auto" data-act="parar"><span class="ms s16 fill">stop</span>Parar</button></div>`
      : `<div class="recbar idle"><span class="recdot"></span><span class="fx col gap2"><span class="big">00:00</span><span class="small muted">parado · grava um arquivo novo na pasta de gravações</span></span>
          <button class="btn pri" style="margin-left:auto" data-act="gravar"><span class="ms s16 fill">fiber_manual_record</span>Gravar</button></div>`;
    const lg = app.dados.gravacoes;
    const sessoes = (lg?.gravacoes ?? [])
      .map((x) => `<div class="gr" data-key="${e(x.nome)}"><span class="fx col gap2" style="min-width:0"><span class="mono" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e(x.nome)}</span><span class="small faint">${tamanho(x.tamanho)}${x.erro ? ` · ${e(x.erro)}` : ''}</span></span>
        <span class="mono small">${e(x.perfil ?? '—')}</span><span class="mono small faint" style="white-space:nowrap">${diaHoraMs(x.inicio)}</span>
        <span class="mono small">${x.inicio ? duracao(x.fim - x.inicio) : '—'}</span><span class="mono small">${x.quadros !== undefined ? num(x.quadros, 0) : '—'}</span>
        <span class="row gap4"><button class="btn sm" data-act="escolher" data-arq="${e(x.arquivo)}"${x.erro ? ' disabled' : ''}><span class="ms s14">replay</span>Replay</button><a class="btn sm ghost" href="/api/gravacoes/${encodeURIComponent(x.nome)}" download title="Baixar"><span class="ms s14">download</span></a></span></div>`)
      .join('');
    const arq = u.arquivo;
    const res = u.resultado;
    let corpoReplay = '';
    if (u.rodando) corpoReplay = '<div class="fx col gap6"><div class="row gap8 small"><span class="muted">rodando… o resultado aparece no fim (sem progresso parcial)</span></div><div class="bar"><i class="ind"></i></div></div>';
    else if (res?.servidor) corpoReplay = `<div class="row gap8 small"><span class="muted">servindo a gravação em ${res.servidor.portas.map((p) => `${p.porta} → ${p.fisica}`).join(', ')} (${e(res.servidor.enquadramento)})</span><button class="btn sm" style="margin-left:auto" data-act="parar-replay">Parar</button></div>`;
    else if (res?.cliente) {
      const dv = res.cliente.divergencias ?? [];
      corpoReplay = `<div class="row gap8 small"><span class="muted">${num(res.cliente.trocas, 0)} trocas · ${num(res.cliente.iguais, 0)} iguais</span><span class="st st-${dv.length ? 'falha' : 'abastecendo'}" style="margin-left:auto"><span class="ms">${dv.length ? 'difference' : 'check_circle'}</span>${dv.length} divergência${dv.length === 1 ? '' : 's'}</span></div>`;
    }
    const divs = (res?.cliente?.divergencias ?? [])
      .slice(0, 50)
      .map((d) => `<div class="div"><span class="faint">#${num(d.indice + 1, 0)}</span><span>${e(d.esperado || 'silêncio')}</span><span style="color:var(--err)">${e(d.obtido || 'silêncio')}</span></div>`)
      .join('');
    const s = app.servidor;
    const origem = location.origin;
    const cat = Array.isArray(app.dados.catalogo) ? app.dados.catalogo : [];
    const grupos = GRUPOS.map((gr) => {
      const nomes = cat.filter((c) => c.grupo === gr).map((c) => c.nome);
      return `<div class="grp"><span class="mono fw6">${gr}</span><span class="small muted ell" title="${e(nomes.join(', '))}">${e(nomes.slice(0, 6).join(', '))}${nomes.length > 6 ? '…' : ''}</span></div>`;
    }).join('');
    const mcp = s?.mcp;
    const mcpOk = Boolean(mcp && s.agora - mcp.ultima < 120000);
    // Same layout as the design (args on one line); still valid JSON to paste.
    const mcpJson = `{\n  "mcpServers": {\n    "pump-sim": {\n      "command": "pump-sim",\n      "args": ${JSON.stringify(['mcp', '--control', origem]).replace(/","/g, '", "')}\n    }\n  }\n}`;
    const chamadas = (s?.chamadas ?? [])
      .slice(0, 12)
      .map((c) => `<div class="ag"><span class="mono small faint">${horaMs(c.ts)}</span><span class="mono small fw6 ell" title="${e(c.comando)} · ${e(c.origem)}${c.cliente ? ` · ${e(c.cliente)}` : ''}">${e(c.comando)}</span><span class="args">${e(c.args)}</span><span class="${c.ok ? 'res-ok' : 'res-err'}" title="${e(c.resumo)}">${c.ok ? 'ok' : e(c.resumo)}</span></div>`)
      .join('');
    return `<div class="main scr-agentes">
      ${cabecalho('Gravação &amp; agentes', 'Grave o tráfego bruto em JSONL, reproduza contra um cliente ou como concentrador, e conecte agentes de IA pela API ou pelo MCP.')}
      <div class="cols"><div class="stack">
        <section class="card"><div class="card-h"><span class="ms s16">fiber_manual_record</span><span class="h2">Gravação</span><span class="small faint ell" title="${e(lg?.dir ?? '')}">formato pump-sim/trafego@1 · pasta ${e(lg?.dir ?? '')}</span></div>
          ${recbar}
          <div class="gr hd lbl"><span>Sessão</span><span>Perfil</span><span>Quando</span><span>Duração</span><span>Quadros</span><span></span></div>
          ${sessoes || '<div class="card-b small faint">Nenhuma gravação na pasta ainda.</div>'}</section>
        <section class="card"><div class="card-h"><span class="ms s16">replay</span><span class="h2">Replay</span><span class="mono small faint">${e(arq ? arq.split(/[\\/]/).pop() : 'escolha uma gravação')}</span></div>
          <div class="card-b fx col gap12">
            ${seg([['servidor', 'Servidor · faz o papel do concentrador gravado'], ['cliente', 'Cliente · manda os rx e compara os tx']], u.modo, 'modo')}
            <div class="row gap8">${u.modo === 'cliente' ? `<div class="field mono" style="flex:1"><span class="ms s16">my_location</span><input data-campo="alvo" value="${e(u.alvo)}" placeholder="padrão: 127.0.0.1 e a porta gravada"></div>` : '<span class="small muted" style="flex:1">escuta nas portas gravadas: se for a mesma do simulador, feche-a antes em Configuração</span>'}
              ${seg([['1', '1×'], ['2', '2×'], ['10', '10×'], ['0', 'máx.']], u.vel, 'vel')}
              <button class="btn pri" data-act="rodar"${arq && !u.rodando ? '' : ' disabled'}><span class="ms s16">play_arrow</span>Rodar</button></div>
            ${corpoReplay}
          </div>
          ${divs ? `<div class="div lbl"><span>Quadro</span><span>Gravado (tx)</span><span>Agora</span></div>${divs}` : ''}</section>
      </div><div class="stack">
        <section class="card"><div class="card-h"><span class="dot"></span><span class="h2">API de controle</span><span class="small faint">HTTP + WebSocket</span></div>
          <div class="kv"><span class="k">Endereço</span><span class="mono">${e(origem)}</span>
            <span class="k">WebSocket</span><span class="mono">${e(origem.replace(/^http/, 'ws'))}/ws <span class="faint">· ${s?.wsClientes ?? '—'} cliente${s?.wsClientes === 1 ? '' : 's'}</span></span>
            <span class="k">Catálogo</span><span class="mono">GET /api/catalogo <span class="faint">· ${cat.length} comandos</span></span>
            <span class="k">Acesso</span><span class="small muted">só loopback, sem autenticação; recusa Origin e Host de fora</span></div>
          <div class="sep"></div>${grupos}</section>
        <section class="card"><div class="card-h"><span class="dot${mcpOk ? '' : ' off'}"></span><span class="h2">MCP</span><span class="small faint">${mcp ? `${mcpOk ? 'conectado' : 'parado'}${mcp.cliente ? ` · ${e(mcp.cliente)}` : ''} · última chamada ${horaMs(mcp.ultima)}` : 'nenhuma chamada do MCP ainda'}</span></div>
          <div class="card-b fx col gap10"><span class="small muted">As tools do MCP são o catálogo da API; cada chamada vira um POST /api/comandos/&lt;tool&gt;. Cole no cliente MCP:</span>
            <div class="codewrap"><div class="code">${e(mcpJson)}</div><button class="btn sm" data-act="g:copiar" data-texto="${e(mcpJson)}"><span class="ms s14">content_copy</span>Copiar</button></div></div>
          <div class="sep"></div>
          <div class="card-h" style="border-bottom:0;padding-bottom:4px"><span class="lbl">Últimas chamadas de agentes</span><span class="small faint">MCP, HTTP e WS; as da própria interface ficam de fora</span></div>
          ${chamadas || '<div class="card-b small faint" style="padding-top:4px">Nenhuma chamada ainda.</div>'}</section>
      </div></div></div>`;
  },
  acoes: {
    async gravar(app) {
      const r = await app.chamar('gravar_inicio', { na_pasta: true });
      if (r) app.aviso(`Gravando em ${r.arquivo}`, 'info');
    },
    async parar(app) {
      const r = await app.chamar('gravar_fim');
      if (r) app.aviso(`Gravação encerrada: ${r.linhas} linhas`, 'info');
    },
    escolher(app, d) {
      const u = ui(app);
      u.arquivo = d.arq;
      u.resultado = null;
    },
    modo(app, d) {
      ui(app).modo = d.v;
    },
    vel(app, d) {
      ui(app).vel = d.v;
    },
    async rodar(app) {
      const u = ui(app);
      u.rodando = true;
      u.resultado = null;
      app.render();
      const args = { arquivo: u.arquivo, modo: u.modo, velocidade: Number(u.vel) };
      if (u.modo === 'cliente' && u.alvo.trim()) args.alvo = u.alvo.trim();
      const r = await app.chamar('replay', args);
      u.rodando = false;
      if (r) u.resultado = u.modo === 'servidor' ? { servidor: r } : { cliente: r };
    },
    async 'parar-replay'(app) {
      await app.chamar('replay_parar');
      ui(app).resultado = null;
    },
  },
};
