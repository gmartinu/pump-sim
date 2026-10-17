// Comandos básicos: live &S/&V, read pointers per port and the fueling buffer the &A serves.
import { e, num, pad } from '../fmt.js';
import { cabecalho, seg } from './comum.js';

const USO = { 2001: 'PDV', 1771: 'CBCManager', 857: 'segunda aplicação', 7002: 'rádio do 2.7.2' };
const MK = ['mk mk-r', 'mk mk-r2', 'mk mk-r3'];

function portas(app) {
  const est = app.estado;
  const pt = app.dados.ponteiros;
  const unico = est.quirks.Q3;
  return est.portas.map((p, i) => {
    const grupo = unico ? 'unico' : `tcp:${p.logica}`;
    const leitura = typeof pt?.leitura === 'object' ? pt.leitura[grupo] : undefined;
    return { n: p.logica, mk: MK[i % 3], leitura, grupo };
  });
}

function pendentes(pt, leitura) {
  if (!pt || leitura === undefined) return undefined;
  const cap = pt.capacidade;
  return (((pt.escrita - leitura) % cap) + cap) % cap;
}

function dentro(pos, de, ate, cap) {
  if (de === undefined) return false;
  return de <= ate ? pos >= de && pos < ate : pos >= de || pos < ate || cap === 0;
}

export default {
  id: 'comandos',
  polls: [
    { chave: 'status', nome: 'get_status', cada: 500 },
    { chave: 'visual', nome: 'get_visualizacao', cada: 500 },
    { chave: 'ponteiros', nome: 'get_ponteiros', cada: 500 },
    { chave: 'buffer', nome: 'list_abastecimentos', args: () => ({ limite: 60, com_quadro: true }), cada: 1000 },
  ],
  render(app) {
    const est = app.estado;
    const u = (app.ui.comandos ??= { filtro: 'todos', lido: {} });
    const pt = app.dados.ponteiros;
    const st = app.dados.status?.quadro ?? null;
    const vis = app.dados.visual;
    const ps = portas(app);
    const cartoesPortas = ps
      .map((p) => {
        const pend = pendentes(pt, p.leitura);
        const lido = u.lido[p.n];
        return `<section class="card ptr" data-key="p${p.n}">
          <div class="row gap8"><span class="${p.mk}">${p.n}</span><span class="h2">Porta ${p.n}</span><span class="small faint">${USO[p.n] ?? ''}</span></div>
          <div class="ptr-n"><div><span class="lbl">Leitura</span><b>${p.leitura === undefined ? '—' : pad(p.leitura, 4)}</b></div>
            <div><span class="lbl">Escrita</span><b class="faint">${pt ? pad(pt.escrita, 4) : '—'}</b></div>
            <div><span class="lbl">Pendentes</span><b>${pend ?? '—'}</b></div></div>
          <div class="row gap8"><button class="btn sm" data-act="ler" data-p="${p.n}"><span class="ms s14">south</span>Ler próximo (&amp;A)</button>
            <button class="btn sm" data-act="incrementar" data-p="${p.n}"><span class="ms s14">done</span>Incrementar (&amp;I)</button>
            <button class="btn sm ghost" data-act="ajustar" data-p="${p.n}">Ajustar…</button></div>
          ${lido ? `<span class="lido">${e(lido)}</span>` : ''}</section>`;
      })
      .join('');
    const nota = est.quirks.Q3
      ? `Perfil ${e(est.perfil.id)}: o ponteiro de leitura é único para todas as portas (quirk Q3).`
      : `Perfil ${e(est.perfil.id)}: cada porta tem o próprio ponteiro. No simulador-2.7.2 o ponteiro é único para todas as portas (quirk Q3).`;

    // Buffer rows: the stored records plus the empty slots a pointer points at.
    const regs = app.dados.buffer?.registros ?? [];
    const porPos = new Map(regs.map((r) => [r.posicao, r]));
    const marcas = new Map();
    const marcar = (pos, m) => {
      if (pos === undefined) return;
      if (!marcas.has(pos)) marcas.set(pos, []);
      marcas.get(pos).push(m);
    };
    if (pt) marcar(pt.escrita, { t: 'escrita', c: 'mk mk-w' });
    for (const p of ps) marcar(p.leitura, { t: `${est.quirks.Q3 ? 'leitura' : p.n} ▸`, c: p.mk });
    const posicoes = [...new Set([...porPos.keys(), ...marcas.keys()])].sort((a, b) => a - b);
    const prim = ps[0];
    const linhas = posicoes
      .filter((pos) => u.filtro !== 'pendentes' || (pt && dentro(pos, prim?.leitura, pt.escrita, pt.capacidade)))
      .map((pos) => {
        const r = porPos.get(pos);
        const mks = (marcas.get(pos) ?? []).map((m) => `<span class="${m.c}">${e(m.t)}</span>`).join('');
        // Design: the next record to read is 'nx'; the latest record written (just behind the write pointer) is 'w'.
        const ultimo = pt && pt.capacidade ? (pt.escrita - 1 + pt.capacidade) % pt.capacidade : undefined;
        const cls = !r ? 'bg vazio' : pos === prim?.leitura ? 'bg nx' : pos === ultimo ? 'bg w' : 'bg';
        if (!r) return `<div class="${cls}" data-key="r${pos}"><span class="mono fw6">${pad(pos, 4)}</span><span class="mks">${mks}</span><span class="hex">—</span><span class="mono num">—</span><span class="mono num">—</span><span class="mono num">—</span><span class="mono small faint">—</span><span class="raw">vazio · o &amp;A desta posição devolve (0)</span></div>`;
        const c = { total: r.virgula & 3, volume: (r.virgula >> 2) & 3, preco: (r.virgula >> 4) & 3 };
        const d = r.data;
        return `<div class="${cls}" data-key="r${pos}"><span class="mono fw6">${pad(pos, 4)}</span><span class="mks">${mks}</span><span class="hex">${pad(r.codigoBico.toString(16).toUpperCase(), 2)}</span>
          <span class="mono num">${num(r.volumeMl / 1000, c.volume)}</span><span class="mono num">${num(r.totalMil / 1000, c.total)}</span><span class="mono num">${num(r.precoUnit / 10 ** c.preco, c.preco)}</span>
          <span class="mono small faint">${pad(d.dia, 2)}/${pad(d.mes, 2)} ${pad(d.hora, 2)}:${pad(d.minuto, 2)}</span><span class="raw" title="${e(r.quadro)}">${e(r.quadro)}</span></div>`;
      })
      .join('');
    const layout = regs.length ? regs[regs.length - 1].quadro.length : null;
    const dip3 = est.equipamento.dips[2];
    return `<div class="main scr-comandos">
      ${cabecalho('Comandos básicos', 'Buffer de abastecimentos (o que o &amp;A devolve), ponteiros de leitura por porta e as respostas ao vivo do &amp;S e do &amp;V.')}
      <section class="con">
        <div class="live2"><span class="k">&amp;S</span><span class="v">${e(st ?? 'silêncio (o perfil não responde &S)')}</span><span class="c-na">${st ? `${st.length} chars · a cada tick` : ''}</span></div>
        <div class="live2"><span class="k">&amp;V</span><span class="v">${e(vis?.quadro ?? '—')}</span><span class="c-na">${vis?.abastecendo ? `${vis.abastecendo.length} bico${vis.abastecendo.length === 1 ? '' : 's'} abastecendo` : ''}</span></div>
      </section>
      <div class="ptrs">${cartoesPortas || '<div class="small faint">Nenhuma porta TCP aberta.</div>'}</div>
      <div class="small muted"><span class="ms s14">info</span> ${nota}</div>
      <section class="card">
        <div class="card-h"><span class="h2">Buffer de abastecimentos</span>
          <span class="small faint">${est.registros} de ${pt ? num(pt.capacidade, 0) : '—'} posições${layout ? ` · layout &amp;A ${layout}` : ''} (DIP3 ${dip3 ? 'ligada' : 'desligada'})</span>
          <div class="row gap8" style="margin-left:auto">${seg([['todos', 'Todos'], ['pendentes', 'Pendentes']], u.filtro, 'filtro')}
            <button class="btn" disabled title="Ainda não existe no simulador (K20 carregar_arquivo_buffer)"><span class="ms s16">upload_file</span>Carregar de arquivo</button>
            <button class="btn danger" data-act="limpar"><span class="ms s16">delete</span>Limpar buffer</button></div></div>
        <div class="bg hd lbl"><span>Registro</span><span>Ponteiros</span><span>Bico</span><span class="num">Volume L</span><span class="num">Total R$</span><span class="num">Preço</span><span>Data</span><span>Quadro &amp;A</span></div>
        <div class="bgbody">${linhas || '<div class="empty"><span class="ms">inventory_2</span><span class="small">Buffer vazio.</span></div>'}</div>
      </section></div>`;
  },
  acoes: {
    filtro(app, d) {
      app.ui.comandos.filtro = d.v;
    },
    async ler(app, d) {
      const r = await app.chamar('get_abastecimento', { porta: Number(d.p) });
      if (r) app.ui.comandos.lido[d.p] = r.vazio ? `posição ${r.posicao}: (0) — nada a ler` : `posição ${r.posicao}: ${r.quadro}`;
    },
    async incrementar(app, d) {
      await app.chamar('incrementar_ponteiro', { porta: Number(d.p) });
    },
    ajustar(app, d) {
      app.abrirModal({
        titulo: `Ajustar o ponteiro da porta ${d.p}`,
        valores: { valor: '' },
        corpo: (m) => `<div class="flab"><span class="lbl">Nova posição de leitura</span><input class="inp" data-campo="valor" data-escopo="modal" value="${e(m.valor)}" placeholder="vazio = sincronizar com a escrita"></div>
          <span class="small muted">Sem valor, a leitura passa a ser igual à escrita (nada pendente).</span>`,
        rotulo: 'Ajustar',
        async confirmar(m) {
          await app.chamar('set_ponteiro', m.valor === '' ? { porta: Number(d.p) } : { porta: Number(d.p), valor: Number(m.valor) });
        },
      });
    },
    limpar(app) {
      app.abrirModal({
        titulo: 'Limpar o buffer',
        perigo: true,
        corpo: () => '<span class="small">Apaga todos os registros de abastecimento. A escrita e a leitura de todas as portas voltam à primeira posição. Encerrantes, preços e cartões ficam.</span>',
        rotulo: 'Limpar buffer',
        async confirmar() {
          await app.chamar('limpar_buffer');
        },
      });
    },
  },
};
