// Pista (forecourt): parity with the 2.7.2 panels — one toggle button per side with the driver's
// captions ("Retirar Bico" ↔ "Abastecendo..", "Concluindo..", "Bicos Bloqueados", "Aguarda liberação"),
// the nozzle radio, displays and totalizers. Horustech/Concept (more than 8 channels) get the compact grid.
import { chip, e, estadoDe, num, numTxt } from '../fmt.js';
import { bicoDoBotao, display, ehHorustechVisao, lado, lados, opcoesBicos, precoBico, seg } from './comum.js';

const VEL = { 450: 'Lento', 300: 'Normal', 150: 'Rápido' };

/** Ghost "8" behind a display value, aligned with its own format (comma in the same place). */
const fantasma = (v, largura) => {
  const g = String(v).replace(/[0-9]/g, '8').replace(/\./g, '');
  return '8'.repeat(Math.max(0, largura - g.replace(',', '').length)) + g;
};

function ui(app) {
  app.ui.pista ??= { radio: {} };
  return app.ui.pista;
}

function botaoLado(app, l, d, compacto) {
  if (l.falha) {
    return compacto
      ? `<button class="ib" title="Limpar falha" data-act="falha" data-c="${l.canal}" data-e="${l.endereco}" data-on="0"><span class="ms s16">restart_alt</span></button>`
      : `<button class="btn sm" data-act="falha" data-c="${l.canal}" data-e="${l.endereco}" data-on="0"><span class="ms s14">restart_alt</span>Limpar falha</button>`;
  }
  const legenda = d?.statusTexto || 'Retirar Bico';
  const { bico, fora } = bicoDoBotao(app, l);
  const ocupado = legenda === 'Concluindo..';
  const dados = `data-act="botao" data-bico="${bico.codigo}" data-retirar="${fora ? 0 : 1}"${ocupado ? ' disabled' : ''}`;
  const ic = fora ? 'back_hand' : 'pan_tool_alt';
  if (compacto) return `<button class="ib${fora ? ' pri' : ''}" title="${e(legenda)}" ${dados}><span class="ms s16">${ic}</span></button>`;
  return `<button class="btn sm${fora ? ' pri' : ''}" ${dados}><span class="ms s14">${ic}</span>${e(legenda)}</button>`;
}

/** Display text: the 2.7.2 blink (888888, Q6) goes out raw; numbers in pt-BR. */
const dtxt = (d, k) => (d?.piscando ? String(d[k]) : numTxt(d?.[k]));

function ladoDetalhado(app, l) {
  const d = display(app, l.canal, l.endereco);
  const s = estadoDe(l.letra);
  const corre = l.bicos.some((b) => b.corrente);
  const dcls = corre ? 'dv' : 'dv off';
  const { bico: ativo } = bicoDoBotao(app, l);
  const bicos = l.bicos
    .map((b) => {
      const on = b.codigo === ativo.codigo;
      const p = b.casas?.preco ?? 3;
      return `<div class="bico${on ? ' on' : ''}" data-act="radio" data-c="${l.canal}" data-e="${l.endereco}" data-bico="${b.codigo}">
        <span class="radio${on ? ' on' : ''}"></span><span class="hex">${b.codigo}</span>
        <span class="prod"><b>Bico ${b.posicao}${b.combustivel ? ` · comb. ${b.combustivel}` : ''}</b><small title="Encerrante do bico (&amp;T L / &amp;T $): soma o abastecimento quando ele termina">${num(b.encerranteMl / 1000, 2)} L</small><small title="Encerrante do bico (&amp;T L / &amp;T $): soma o abastecimento quando ele termina">R$ ${num(b.encerranteValorMil / 1000, 2)}</small></span>
        <span class="ppl">${num(precoBico(b, l.nivelPreco), p)}</span></div>`;
    })
    .join('');
  const espera =
    l.letra === 'E'
      ? `<div class="row gap8"><button class="btn sm wide" data-act="apresentar" data-c="${l.canal}" data-e="${l.endereco}"><span class="ms s14">badge</span>Apresentar cartão</button>
         <button class="btn sm wide" data-act="liberar" data-bico="${ativo.codigo}"><span class="ms s14">lock_open</span>Liberar (&amp;M A)</button></div>`
      : '';
  return `<div class="lado l-${s.id}" data-key="l${l.canal}-${l.endereco}">
    <div class="lado-h"><span class="endtag">END ${l.endereco}</span>${chip(l.letra)}${botaoLado(app, l, d, false)}</div>
    <div class="disp">
      <div><span class="dl">Total R$</span><span class="${dcls}" data-g="${fantasma(dtxt(d, 'total').replace(/\./g, ''), 6)}">${dtxt(d, 'total')}</span></div>
      <div><span class="dl">Volume L</span><span class="${dcls}" data-g="${fantasma(dtxt(d, 'volume').replace(/\./g, ''), 6)}">${dtxt(d, 'volume')}</span></div>
      <div><span class="dl">Preço</span><span class="dv" data-g="${fantasma(dtxt(d, 'preco'), 4)}">${dtxt(d, 'preco')}</span></div>
      ${l.letra === 'A' ? '<span class="flow"></span>' : ''}
    </div>
    <div class="bicos">${bicos}</div>${espera}</div>`;
}

function ladoCompacto(app, l) {
  const d = display(app, l.canal, l.endereco);
  const s = estadoDe(l.letra);
  const corre = l.bicos.some((b) => b.corrente);
  const { bico: ativo } = bicoDoBotao(app, l);
  const dc = corre ? 'mdon' : 'mdoff';
  const hx = l.bicos
    .map((b) => `<span class="${b.codigo === ativo.codigo ? 'on' : ''}" data-act="radio" data-c="${l.canal}" data-e="${l.endereco}" data-bico="${b.codigo}">${b.codigo}</span>`)
    .join('');
  return `<div class="er l-${s.id}" data-key="e${l.canal}-${l.endereco}">
    <span class="endtag mono small faint">E${l.endereco}</span>${chip(l.letra)}
    <span class="mini"><span class="md"><span class="${dc}">${dtxt(d, 'total')}</span><span class="${dc}">${dtxt(d, 'volume')}</span></span><span class="hx">${hx}</span></span>
    ${botaoLado(app, l, d, true)}</div>`;
}

function menuCanal(app, c, ls) {
  if (app.menu !== `canal-${c}`) return '';
  const itens = ls
    .map((l) => `<button data-act="falha" data-c="${c}" data-e="${l.endereco}" data-on="${l.falha ? 0 : 1}"><span class="ms s16">${l.falha ? 'restart_alt' : 'error'}</span>${l.falha ? 'Limpar falha' : 'Simular falha'} do END ${l.endereco}</button>`)
    .join('');
  return `<div class="menu">${itens || '<span class="small faint" style="padding:8px">Sem endereços configurados</span>'}</div>`;
}

function canal(app, c, compacto) {
  const ls = lados(app).filter((l) => l.canal === c);
  const n = ls.filter((l) => l.letra === 'A').length;
  const corpo = ls.length
    ? ls.map((l) => (compacto ? ladoCompacto(app, l) : ladoDetalhado(app, l))).join('')
    : '<div class="vazio small faint">sem endereços configurados</div>';
  return `<section class="canal" data-key="c${c}">
    <div class="canal-h"><span class="canal-n">C${c}</span><span class="h2">Canal ${c}</span><span class="small faint">${n ? `${n} abastecendo` : ''}</span>
      <span class="ms s16 faint thbtn" style="margin-left:auto" data-act="g:menu" data-menu="canal-${c}" title="Ações do canal">more_horiz</span>${menuCanal(app, c, ls)}</div>
    ${corpo}</section>`;
}

function banners(app) {
  const est = app.estado;
  const out = [];
  if (est.erroPorta) {
    const p = est.erroPorta.porta;
    const alt = (est.perfil.opcoesPortaTcp ?? []).find((x) => x !== p);
    out.push(`<div class="banner err"><span class="ms fill">error</span>
      <div class="fx col gap4"><b class="t">A porta ${p} já está em uso por outro processo (${e(est.erroPorta.codigo)}).</b>
      <span class="small">Feche o outro simulador ou o SimuladorCBC, ou escolha outra porta. A pista continua simulando; só não há como o software de pista conectar.</span></div>
      <div class="row gap8" style="margin-left:auto">${alt ? `<button class="btn sm" data-act="porta" data-p="${alt}">Usar ${alt}</button>` : ''}
      <button class="btn sm pri" data-act="porta" data-p="${p}"><span class="ms s14">refresh</span>Tentar de novo</button></div></div>`);
  } else if (est.portas.length && !est.conexoes.length) {
    const p = est.portas[0].fisica;
    const cmd = `printf '(&S)' | nc 127.0.0.1 ${p}`;
    out.push(`<div class="banner info"><span class="ms">cable</span>
      <div class="fx col gap4"><b class="t">Nenhum software de pista conectado.</b>
      <span class="small">Aponte o PDV ou a automação para <span class="mono">127.0.0.1:${p}</span>. Teste rápido: <span class="mono">${e(cmd)}</span></span></div>
      <button class="btn sm" style="margin-left:auto" data-act="g:copiar" data-texto="${e(cmd)}"><span class="ms s14">content_copy</span>Copiar comando</button></div>`);
  }
  return out.join('');
}

/** Design caption of the 48-position line: "48 posições · sem trailer" when the frame is only state letters. */
function rotuloS(q) {
  const m = /^\(S([LPACBEF]+)\)$/.exec(q);
  return m ? `${m[1].length} posições · sem trailer` : `${q.length} chars`;
}

export default {
  id: 'pista',
  polls: [{ chave: 'statusPista', nome: 'get_status', cada: 600, quando: (app) => ehHorustechVisao(app) }],
  render(app) {
    const est = app.estado;
    if (!est) return '';
    const u = ui(app);
    const horus = ehHorustechVisao(app);
    const compacto = (u.vista ?? (horus ? 'compacta' : 'detalhada')) === 'compacta';
    const ls = lados(app);
    const nBicos = ls.reduce((s, l) => s + l.bicos.length, 0);
    const tick = est.timers.tickVazaoMs;
    const eq = est.equipamento;
    const sub = horus
      ? `${est.perfil.canais} canais · ${ls.length} endereços · ${nBicos} bicos · memória de ${num(est.ponteiros.capacidade, 0)} registros`
      : `${est.perfil.canais} canais · ${ls.length} lados · ${nBicos} bicos · tick de ${tick} ms${VEL[tick] ? ` (${VEL[tick]})` : ''} · Automação ${eq.automacao ? 'ligada' : 'desligada'} · DIP4 ${eq.dips[3] ? 'ligada' : 'desligada'}`;
    const cont = {};
    for (const l of ls) cont[l.letra] = (cont[l.letra] ?? 0) + 1;
    const legenda = ['L', 'P', 'A', 'C', 'B', 'E', 'F']
      .map((k) => {
        const s = estadoDe(k);
        return `<span class="st st-${s.id}"><span class="ms">${s.ic}</span>${s.rot} ${cont[k] ?? 0}</span>`;
      })
      .join('');
    const vistaSeg = horus ? seg([['compacta', 'Compacta'], ['detalhada', 'Detalhada']], compacto ? 'compacta' : 'detalhada', 'vista') : '';
    const s48 = horus && app.dados.statusPista?.quadro ? `<div class="sline"><span class="k">&amp;S</span><span>${e(app.dados.statusPista.quadro)}</span><span class="k" style="margin-left:auto">${rotuloS(app.dados.statusPista.quadro)}</span></div>` : '';
    const canais = Array.from({ length: est.perfil.canais }, (_, i) => canal(app, i + 1, compacto)).join('');
    return `<div class="main scr-pista">
      <div class="ph"><div class="ph-t"><h1 class="h1">Pista</h1><div class="muted">${sub}</div></div>
        <div class="ph-a">${vistaSeg}<button class="btn" data-act="gerar"><span class="ms s16">bolt</span>Gerar abastecimentos</button>
        <button class="btn" data-act="recolocar-todos"><span class="ms s16">restart_alt</span>Recolocar todos</button></div></div>
      ${banners(app)}
      <div class="legend"><span class="lbl">${horus ? 'Endereços' : 'Lados'}</span>${legenda}</div>
      ${s48}
      <div class="${compacto ? 'g12' : 'grid4'}">${canais}</div></div>`;
  },
  acoes: {
    vista(app, d) {
      ui(app).vista = d.v;
    },
    radio(app, d) {
      const l = lado(app, Number(d.c), Number(d.e));
      if (l && l.bicos.some((b) => b.estado === 'retirado' || b.estado === 'abastecendo')) return;
      ui(app).radio[`${d.c}-${d.e}`] = d.bico;
    },
    async botao(app, d) {
      await app.chamar(d.retirar === '1' ? 'retirar_bico' : 'recolocar_bico', { bico: d.bico });
    },
    async falha(app, d) {
      app.menu = null;
      await app.chamar('set_falha_endereco', { canal: Number(d.c), endereco: Number(d.e), ativo: d.on === '1' });
    },
    async liberar(app, d) {
      await app.chamar('set_modo', { bico: d.bico, modo: 'autoriza' });
    },
    apresentar(app, d) {
      app.ui.identfid = { ...(app.ui.identfid ?? {}), alvo: `${d.c}-${d.e}` };
      app.ir('identfid');
    },
    async porta(app, d) {
      await app.chamar('abrir_porta', { porta: Number(d.p) });
    },
    async 'recolocar-todos'(app) {
      for (const l of lados(app)) for (const b of l.bicos) if (b.estado === 'retirado' || b.estado === 'abastecendo') await app.chamar('recolocar_bico', { bico: b.codigo });
    },
    gerar(app) {
      const primeiro = lados(app)[0]?.bicos[0]?.codigo;
      app.abrirModal({
        titulo: 'Gerar abastecimentos',
        valores: { bico: primeiro, quantidade: '10', litros: '20,00' },
        corpo: (m) => `<div class="flab"><span class="lbl">Bico</span><select class="field" data-campo="bico" data-escopo="modal">${opcoesBicos(app, m.bico)}</select></div>
          <div class="row gap8"><div class="flab" style="flex:1"><span class="lbl">Quantidade</span><input class="inp" data-campo="quantidade" data-escopo="modal" value="${e(m.quantidade)}"></div>
          <div class="flab" style="flex:1"><span class="lbl">Litros por abastecimento</span><input class="inp" data-campo="litros" data-escopo="modal" value="${e(m.litros)}"></div></div>
          <span class="small muted">Grava os registros completos na hora, sem esperar a vazão (o bico precisa estar no descanso).</span>`,
        rotulo: 'Gerar',
        async confirmar(m) {
          const litros = Number(String(m.litros).replace(/\./g, '').replace(',', '.'));
          await app.chamar('gerar_abastecimentos', { bico: m.bico, quantidade: Number(m.quantidade), volume: Math.round(litros * 1000) });
          app.aviso(`${m.quantidade} abastecimento(s) gravado(s) no bico ${m.bico}`, 'info');
        },
      });
    },
  },
};
