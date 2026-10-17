// Identfid: registered cards, present a card at a side (the 2.7.2 "Selecione Cartão" popup + manual
// entry), identification mode 01–14 and IDF sensor per address, and the ?A queue with its pointers.
import { CLASSES_CARTAO, chip, e, hex2, pad } from '../fmt.js';
import { cabecalho, lados } from './comum.js';

const MODOS = [
  '01 Frentista (sem turno, sem gerente)', '02 Frentista (com turno, sem gerente)', '03 Frentista (sem turno, com gerente)',
  '04 Frentista (com turno, com gerente)', '05 Gerente (sem turno)', '06 Gerente (com turno)', '07 Caixa (sem turno, P1, P2)',
  '08 Caixa (com turno, P1, P2)', '09 Funcionário (sem turno, P1)', '10 Funcionário (com turno, P1)', '11 Cliente (libera bomba)',
  '12 Cliente (não libera bomba)', '13 TAG (libera bomba)', '14 TAG (não libera bomba)',
];
const MOTIVOS = { desconhecido: 'cartão não cadastrado: entrou na fila do ?A', listaNegra: 'cartão na lista negra' };
const turno = (t) => (t ? `${t.inicio.slice(0, 2)}:${t.inicio.slice(2)}–${t.fim.slice(0, 2)}:${t.fim.slice(2)}` : '—');

function ui(app) {
  app.ui.identfid ??= {};
  const u = app.ui.identfid;
  u.busca ??= '';
  u.manual ??= '';
  return u;
}

export default {
  id: 'identfid',
  polls: [
    { chave: 'cartoes', nome: 'list_cartoes', cada: 1000 },
    { chave: 'sensores', nome: 'get_sensores', cada: 1000 },
    { chave: 'fila', nome: 'list_cartoes_desconhecidos', args: () => ({ limite: 12 }), cada: 1000 },
  ],
  render(app) {
    const est = app.estado;
    const u = ui(app);
    const cad = app.dados.cartoes;
    const cartoes = cad?.cartoes ?? [];
    const busca = u.busca.trim().toUpperCase();
    const filtrados = cartoes.filter(({ cartao, classe }) => !busca || cartao.codigo.includes(busca) || (CLASSES_CARTAO[classe]?.[0] ?? '').toUpperCase().includes(busca));
    const tabela = filtrados
      .map(({ posicao, cartao, classe, listaNegra }) => {
        const [rot, ic] = CLASSES_CARTAO[classe] ?? ['?', 'badge'];
        const menu =
          app.menu === `cartao-${cartao.codigo}`
            ? `<div class="menu" style="top:30px"><button data-act="ln" data-cod="${cartao.codigo}" data-acao="${listaNegra ? 'tira' : 'poe'}"><span class="ms s16">block</span>${listaNegra ? 'Tirar da lista negra' : 'Pôr na lista negra'}</button>
               <button data-act="excluir" data-cod="${cartao.codigo}"><span class="ms s16">delete</span>Excluir</button></div>`
            : '';
        return `<div class="tr" data-key="${cartao.codigo}"><span class="mono faint">${pad(posicao, 4)}</span><span class="mono">${cartao.codigo}</span><span class="tipo"><span class="ms s16 faint">${ic}</span>${rot}</span>
          <span class="mono">${hex2(cartao.controle)}</span><span class="mono small">${turno(cartao.turnoA)}</span><span class="mono small faint">${turno(cartao.turnoB)}</span>
          ${listaNegra ? '<span class="ln">Negra</span>' : '<span class="small faint">—</span>'}
          <span class="ms s16 faint thbtn" data-act="g:menu" data-menu="cartao-${cartao.codigo}">more_vert</span>${menu}</div>`;
      })
      .join('');
    const ls = lados(app);
    const alvo = u.alvo ?? (ls.find((l) => l.letra === 'E') ? `${ls.find((l) => l.letra === 'E').canal}-${ls.find((l) => l.letra === 'E').endereco}` : ls[0] ? `${ls[0].canal}-${ls[0].endereco}` : '');
    const [ac, ae] = alvo.split('-').map(Number);
    const la = ls.find((l) => l.canal === ac && l.endereco === ae);
    const escolha = cartoes
      .map(({ cartao, classe, listaNegra }) => {
        const on = u.escolhido === cartao.codigo;
        return `<div class="pk${on ? ' on' : ''}" data-act="escolher" data-cod="${cartao.codigo}"><span class="radio${on ? ' on' : ''}"></span><span class="mono">${cartao.codigo}</span><span class="small">${CLASSES_CARTAO[classe]?.[0] ?? ''} · CC ${hex2(cartao.controle)}</span><span class="small faint">turno A ${turno(cartao.turnoA)}${listaNegra ? ' · lista negra' : ''}</span></div>`;
      })
      .join('');
    const modo = la ? MODOS[la.modoIdentificacao - 1] : '';
    const resultado = u.resultado
      ? `<div class="banner ${u.resultado.aceito ? 'info' : 'warn'}"><span class="ms">${u.resultado.aceito ? 'check_circle' : 'info'}</span><span class="small t">${u.resultado.aceito ? `Aceito${u.resultado.libera ? ': o lado foi liberado' : ' (não libera a bomba)'}` : e(MOTIVOS[u.resultado.motivo] ?? `recusado: ${u.resultado.motivo}`)}</span></div>`
      : '';
    const sens = app.dados.sensores?.enderecos ?? [];
    const modos = sens
      .map((s) => `<div class="mr"><span class="mono small" style="white-space:nowrap">C${s.canal} · end ${s.endereco}</span>
        <span class="sw${s.sensorIdf ? ' on' : ''}" data-act="sensor" data-c="${s.canal}" data-e="${s.endereco}" data-on="${s.sensorIdf ? 0 : 1}" title="Sensor IDF"></span>
        ${s.sensorIdf
          ? `<select class="sel" data-campo="modo:${s.canal}-${s.endereco}">${MODOS.map((m, i) => `<option value="${i + 1}"${i + 1 === s.modoIdentificacao ? ' selected' : ''}>${m}</option>`).join('')}</select>`
          : `<select class="sel off" disabled title="Ligue o sensor IDF para escolher o modo (atual: ${e(MODOS[s.modoIdentificacao - 1] ?? '—')})"><option>Sem sensor IDF</option></select>`}</div>`)
      .join('');
    const fila = app.dados.fila;
    const pend = [...(fila?.pendentes ?? [])].reverse();
    const filaHtml = pend
      .map((f) => {
        const lido = fila && f.posicao < fila.leitura;
        return `<div class="fq"><span class="mono faint">${pad(f.posicao, 4)}</span><span class="mono">${f.codigo}</span><span class="hex">${hex2(f.codigoBico)}</span>
          <span class="mono small faint">${pad(f.data.dia, 2)}/${pad(f.data.mes, 2)} ${pad(f.data.hora, 2)}:${pad(f.data.minuto, 2)}</span><span class="st st-${lido ? 'livre' : 'espera'}">${lido ? 'lido' : 'pendente'}</span></div>`;
      })
      .join('');
    return `<div class="main scr-identfid">
      ${cabecalho('Identfid', 'Cartões e TAGs, modo de identificação por endereço e a fila de leituras desconhecidas (?A).')}
      <div class="cols"><div class="stack">
        <section class="card">
          <div class="card-h"><span class="h2">Cartões cadastrados</span><span class="small faint">${cad?.quantidade ?? 0} de ${cad?.capacidade ?? '—'} · gravados por ?F ou aqui</span>
            <div class="row gap8" style="margin-left:auto"><div class="field" style="width:200px"><span class="ms s16">search</span><input data-campo="busca" value="${e(u.busca)}" placeholder="Código ou tipo"></div>
            <button class="btn pri" data-act="novo"><span class="ms s16">add</span>Novo cartão</button></div></div>
          <div class="tr hd lbl"><span>Índice</span><span>Código</span><span>Tipo</span><span>CC</span><span>Turno A</span><span>Turno B</span><span>Lista</span><span></span></div>
          ${tabela || '<div class="empty"><span class="ms">badge</span><span class="small">Nenhum cartão cadastrado.</span></div>'}
        </section>
        <section class="card" id="apresentar">
          <div class="card-h"><span class="ms s16">contactless</span><span class="h2">Apresentar cartão no bico</span><span class="small faint">o lado em Espera libera se o cartão casar com o modo</span></div>
          <div class="card-b fx col gap12">
            <div class="row gap8"><span class="lbl">Lado</span>
              <select class="field" style="width:190px" data-campo="alvo">${ls.map((l) => `<option value="${l.canal}-${l.endereco}"${`${l.canal}-${l.endereco}` === alvo ? ' selected' : ''}>C${l.canal} · end ${l.endereco} · ${l.bicos.map((b) => b.codigo).join('/')}</option>`).join('')}</select>
              <span class="small muted">${la ? `modo ${e(modo)}${la.sensorIdf ? '' : ' · sem sensor IDF'}` : ''}</span>
              ${la ? `<span style="margin-left:auto">${chip(la.letra)}</span>` : ''}</div>
            ${escolha ? `<div class="pick">${escolha}</div>` : ''}
            <div class="row gap8"><div class="field mono" style="flex:1"><span class="ms s16">keyboard</span><input data-campo="manual" value="${e(u.manual)}" placeholder="Informar manualmente (16 hex) → não cadastrado vai para a fila do ?A" maxlength="16"></div>
              <button class="btn pri" data-act="apresentar"${la ? '' : ' disabled'}><span class="ms s16">contactless</span>Apresentar</button></div>
            ${resultado}
          </div>
        </section>
      </div><div class="stack">
        <section class="card">
          <div class="card-h"><span class="h2">Modo de identificação</span><span class="small faint">01–14, por endereço</span></div>
          ${modos}<div class="sep"></div>
          <div class="card-b small muted"><span class="ms s14">info</span> ${est.quirks.IDF_CC_BYTE ? 'O 2.7.2 não simula o modo, só valida o byte CC do cartão (quirk IDF_CC_BYTE): aqui o modo é só rótulo.' : 'Nos perfis reais o modo vira regra de liberação do endereço (DT435 §3.10); "com gerente" e "Caixa P1, P2" são inferência.'}</div>
        </section>
        <section class="card">
          <div class="card-h"><span class="h2">Fila do ?A</span><span class="small faint">cartões não cadastrados</span><button class="btn sm" style="margin-left:auto" data-act="ir-apresentar"><span class="ms s14">contactless</span>Apresentar cartão…</button></div>
          <div class="ptr small"><span><span class="faint">Escrita</span> <span class="mono fw6">${fila ? pad(fila.escrita, 4) : '—'}</span></span><span><span class="faint">Leitura</span> <span class="mono fw6">${fila ? pad(fila.leitura, 4) : '—'}</span></span><span class="faint">${fila ? (fila.leitura === fila.escrita ? 'nada pendente' : `o próximo (?A80) devolve a ${pad(fila.leitura, 4)}`) : ''}</span></div>
          ${filaHtml || '<div class="card-b small faint">A fila está vazia.</div>'}
        </section>
      </div></div></div>`;
  },
  async aoMudar(app, campo, valor) {
    if (!campo.startsWith('modo:')) return;
    const [c, en] = campo.slice(5).split('-').map(Number);
    const s = (app.dados.sensores?.enderecos ?? []).find((x) => x.canal === c && x.endereco === en);
    await app.chamar('configurar_sensor', { canal: c, endereco: en, ligado: s?.sensorIdf ?? false, modo_identificacao: Number(valor) });
  },
  acoes: {
    escolher(app, d) {
      const u = ui(app);
      u.escolhido = u.escolhido === d.cod ? null : d.cod;
      u.manual = '';
    },
    async apresentar(app) {
      const u = ui(app);
      const codigo = (u.manual.trim() || u.escolhido || '').toUpperCase();
      if (!/^[0-9A-F]{1,16}$/.test(codigo)) return app.aviso('Escolha um cartão ou informe até 16 hex');
      const ls = lados(app);
      const alvo = u.alvo ?? (ls[0] ? `${ls[0].canal}-${ls[0].endereco}` : '');
      const [c, en] = alvo.split('-').map(Number);
      const r = await app.chamar('apresentar_cartao', { canal: c, endereco: en, codigo });
      if (r) u.resultado = r;
    },
    async sensor(app, d) {
      await app.chamar('configurar_sensor', { canal: Number(d.c), endereco: Number(d.e), ligado: d.on === '1' });
    },
    async ln(app, d) {
      app.menu = null;
      await app.chamar('lista_negra', { acao: d.acao, codigo: d.cod });
    },
    excluir(app, d) {
      app.menu = null;
      app.abrirModal({
        titulo: 'Excluir cartão',
        perigo: true,
        corpo: () => `<span class="small">Exclui <span class="mono">${e(d.cod)}</span> do cadastro (?F A). A posição fica vaga para o próximo cartão.</span>`,
        rotulo: 'Excluir',
        async confirmar() {
          await app.chamar('excluir_cartao', { codigo: d.cod });
        },
      });
    },
    'ir-apresentar'() {
      document.getElementById('apresentar')?.scrollIntoView({ behavior: 'smooth' });
    },
    novo(app) {
      const tipos = [[1, 'TAG'], [2, 'Lavadora'], [4, 'Cliente'], [7, 'Funcionário (frentista)'], [0xd, 'Gerente'], [0xf, 'Total']];
      app.abrirModal({
        titulo: 'Novo cartão',
        valores: { codigo: '', tipo: '7', permissao: '2', ta: '', tb: '' },
        corpo: (m) => `<div class="flab"><span class="lbl">Código (16 hex)</span><input class="inp" data-campo="codigo" data-escopo="modal" value="${e(m.codigo)}" maxlength="16"></div>
          <div class="row gap8"><div class="flab" style="flex:1"><span class="lbl">Tipo</span><select class="field" data-campo="tipo" data-escopo="modal">${tipos.map(([v, r]) => `<option value="${v}"${String(v) === m.tipo ? ' selected' : ''}>${hex2(v).slice(1)} · ${r}</option>`).join('')}</select></div>
          <div class="flab" style="flex:1"><span class="lbl">Permissão</span><select class="field" data-campo="permissao" data-escopo="modal">${[2, 4, 6, 8, 10].map((v) => `<option value="${v}"${String(v) === m.permissao ? ' selected' : ''}>${v.toString(16).toUpperCase()}</option>`).join('')}</select></div></div>
          <div class="row gap8"><div class="flab" style="flex:1"><span class="lbl">Turno A (hhmm-hhmm)</span><input class="inp" data-campo="ta" data-escopo="modal" value="${e(m.ta)}" placeholder="0600-1400"></div>
          <div class="flab" style="flex:1"><span class="lbl">Turno B</span><input class="inp" data-campo="tb" data-escopo="modal" value="${e(m.tb)}" placeholder="opcional"></div></div>
          <span class="small muted">CC = permissão (nibble alto) e tipo (nibble baixo), como o ?F G grava.</span>`,
        rotulo: 'Gravar cartão',
        async confirmar(m) {
          const t = (s) => {
            const x = /^(\d{4})-(\d{4})$/.exec(String(s).trim());
            return x ? { inicio: x[1], fim: x[2] } : undefined;
          };
          if (!/^[0-9A-Fa-f]{1,16}$/.test(m.codigo)) {
            app.aviso('Código: até 16 hex');
            return false;
          }
          const args = { codigo: m.codigo.toUpperCase(), tipo: Number(m.tipo), permissao: Number(m.permissao) };
          if (t(m.ta)) args.turnoA = t(m.ta);
          if (t(m.tb)) args.turnoB = t(m.tb);
          return (await app.chamar('gravar_cartao', args)) !== undefined;
        },
      });
    },
  },
};
