// Gravação & agentes: record raw traffic to JSONL, list/download/replay recordings, and show the
// control API and MCP status with the recent agent calls (the UI's own calls are not listed). The MCP
// card switches the HTTP endpoint `/mcp` on/off and hands out the client configs (DECISIONS §33). In the
// Windows executable (no console) the "Log do executável" card shows the log file's tail (§34).
import { diaHoraMs, duracao, e, horaMs, num, tamanho } from '../fmt.js';
import { cabecalho, seg, sw } from './comum.js';

const GRUPOS = ['leitura', 'protocolo', 'controle', 'infra'];

function ui(app) {
  app.ui.agentes ??= { modo: 'cliente', alvo: '', vel: '1', arquivo: null, rodando: false, resultado: null, cliente: 'claude-code', comando: false };
  return app.ui.agentes;
}

const json = (v) => JSON.stringify(v, null, 2);

/** The executable's log card: only when the server reports a log file (`/api/servidor` `log.ativo`). */
function cartaoLog(app, u) {
  const lg = app.servidor?.log;
  if (!lg?.ativo) return '';
  const v = u.log;
  const corpo = v
    ? `<pre class="mono small logtxt" style="margin:0;max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-all">${e(v.texto || 'log vazio')}</pre>`
    : '<div class="card-b small faint">A saída do executável (sem console) vai para este arquivo.</div>';
  const botoes = v
    ? `<button class="btn sm" data-act="ver-logs"><span class="ms s14">refresh</span>Atualizar</button><button class="btn sm ghost" data-act="ocultar-logs">Ocultar</button>`
    : '<button class="btn sm" data-act="ver-logs"><span class="ms s14">terminal</span>Ver logs</button>';
  return `<section class="card"><div class="card-h"><span class="ms s16">terminal</span><span class="h2">Log do executável</span><span class="mono small faint ell" title="${e(lg.arquivo)}">${e(lg.arquivo)}</span><span class="row gap4" style="margin-left:auto">${botoes}</span></div>${corpo}</section>`;
}

/**
 * MCP client configs for the HTTP endpoint at `url` (the control API's real port, after a fallback
 * too). Claude Desktop's config file only starts stdio servers, so it gets the stdio bridge
 * (`pump-sim mcp`, over the control API at `controle`) through npx.
 */
export function configsMcp(url, controle) {
  return {
    'claude-code': { rot: 'Claude Code', onde: '.mcp.json na raiz do projeto (ou use o comando abaixo)', texto: json({ mcpServers: { 'pump-sim': { type: 'http', url } } }) },
    'claude-desktop': {
      rot: 'Claude Desktop',
      onde: 'claude_desktop_config.json: o arquivo só aceita servidores stdio, então o npx sobe a ponte pump-sim mcp para esta API (precisa do Node)',
      texto: json({ mcpServers: { 'pump-sim': { command: 'npx', args: ['-y', 'pump-sim', 'mcp', '--control', controle] } } }),
    },
    cursor: { rot: 'Cursor', onde: '~/.cursor/mcp.json (global) ou .cursor/mcp.json (projeto)', texto: json({ mcpServers: { 'pump-sim': { url } } }) },
    vscode: { rot: 'VS Code', onde: '.vscode/mcp.json do projeto', texto: json({ servers: { 'pump-sim': { type: 'http', url } } }) },
  };
}

/** The `claude mcp add` command for the endpoint (shown to copy; the UI runs nothing on the machine). */
export const comandoClaudeCode = (url) => `claude mcp add --transport http pump-sim ${url}`;

function cartaoMcp(app, u, origem) {
  const s = app.servidor;
  const h = s?.mcpHttp;
  const ativo = h ? h.ativo : true;
  const sessoes = h?.sessoes ?? [];
  const url = h?.url ?? `${origem}/mcp`;
  const controle = url.replace(/\/mcp$/, '');
  const ultima = s?.mcp;
  const recente = Boolean(ultima && s.agora - ultima.ultima < 120000);
  const ok = ativo && (sessoes.length > 0 || recente);
  const estado = !ativo
    ? 'HTTP desligado'
    : sessoes.length
      ? `${sessoes.length} cliente${sessoes.length === 1 ? '' : 's'} conectado${sessoes.length === 1 ? '' : 's'}`
      : 'ligado · nenhum cliente conectado';
  const cfgs = configsMcp(url, controle);
  const cfg = cfgs[u.cliente] ?? cfgs['claude-code'];
  const cmd = comandoClaudeCode(url);
  const linhasSessoes = sessoes
    .map((x) => `<div class="ses"><span class="mono small fw6 ell" title="sessão ${e(x.id)}">${e(x.cliente || 'cliente sem nome')}${x.versao ? ` <span class="faint">${e(x.versao)}</span>` : ''}</span><span class="small faint">desde ${horaMs(x.desde)}</span><span class="small">${num(x.chamadas, 0)} chamada${x.chamadas === 1 ? '' : 's'}</span><span class="small faint">última ${horaMs(x.ultima)}</span></div>`)
    .join('');
  return `<section class="card"><div class="card-h"><span class="dot${ok ? '' : ' off'}"></span><span class="h2">MCP</span><span class="small faint ell">${estado}${ultima ? ` · última chamada ${horaMs(ultima.ultima)}${ultima.cliente ? ` (${e(ultima.cliente)})` : ''}` : ''}</span>
      <span class="row gap8" style="margin-left:auto"><span class="small muted">HTTP</span>${sw(ativo, 'mcp-ligar', `title="${ativo ? 'Desligar' : 'Ligar'} o MCP por HTTP (${e(url)})"`)}</span></div>
    <div class="kv"><span class="k">Endereço</span><span class="mono${ativo ? '' : ' faint'}">${e(url)}</span>
      <span class="k">Transporte</span><span class="small muted">HTTP streamable, no mesmo processo; só loopback, recusa Origin e Host de fora</span>
      <span class="k">stdio</span><span class="mono small">pump-sim mcp --control ${e(controle)}</span></div>
    ${linhasSessoes ? `<div class="sessoes">${linhasSessoes}</div>` : ''}
    <div class="sep"></div>
    <div class="card-b fx col gap10">
      <span class="lbl">Configurar um cliente</span>
      ${seg(Object.entries(cfgs).map(([k, c]) => [k, c.rot]), u.cliente in cfgs ? u.cliente : 'claude-code', 'mcp-cliente')}
      <span class="small muted">${e(cfg.onde)}</span>
      <div class="codewrap"><div class="code">${e(cfg.texto)}</div><button class="btn sm" data-act="g:copiar" data-texto="${e(cfg.texto)}"><span class="ms s14">content_copy</span>Copiar config</button></div>
      <div class="row gap8"><button class="btn sm${u.comando ? ' on' : ''}" data-act="mcp-comando"><span class="ms s14">terminal</span>Adicionar ao Claude Code</button>${ativo ? '' : '<span class="small" style="color:var(--warn)">ligue o MCP por HTTP para o cliente conectar</span>'}</div>
      ${u.comando ? `<span class="small muted">Rode no terminal, na pasta do projeto (a interface não executa nada na sua máquina):</span><div class="codewrap"><div class="code">${e(cmd)}</div><button class="btn sm" data-act="g:copiar" data-texto="${e(cmd)}"><span class="ms s14">content_copy</span>Copiar</button></div>` : ''}
    </div>`;
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
        ${cartaoMcp(app, u, origem)}
          <div class="sep"></div>
          <div class="card-h" style="border-bottom:0;padding-bottom:4px"><span class="lbl">Últimas chamadas de agentes</span><span class="small faint">MCP, HTTP e WS; as da própria interface ficam de fora</span></div>
          ${chamadas || '<div class="card-b small faint" style="padding-top:4px">Nenhuma chamada ainda.</div>'}</section>
        ${cartaoLog(app, u)}
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
    'mcp-cliente'(app, d) {
      ui(app).cliente = d.v;
    },
    'mcp-comando'(app) {
      const u = ui(app);
      u.comando = !u.comando;
    },
    async 'mcp-ligar'(app) {
      const ativo = !(app.servidor?.mcpHttp?.ativo ?? true);
      try {
        const st = await app.api.post('/api/mcp', { ativo });
        if (app.servidor) app.servidor.mcpHttp = st;
        app.aviso(ativo ? `MCP por HTTP ligado em ${st.url}` : 'MCP por HTTP desligado: as sessões abertas foram encerradas', 'info');
      } catch (err) {
        app.aviso(`MCP: ${err.message}`, 'err');
      }
    },
    async 'ver-logs'(app) {
      try {
        const r = await app.api.get('/api/logs');
        ui(app).log = { texto: r.texto, tamanho: r.tamanho };
      } catch (err) {
        app.aviso(`Log: ${err.message}`, 'err');
      }
    },
    'ocultar-logs'(app) {
      ui(app).log = null;
    },
    async 'parar-replay'(app) {
      await app.chamar('replay_parar');
      ui(app).resultado = null;
    },
  },
};
