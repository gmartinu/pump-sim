// Comunicação: "Simular comando" (the user types the verb and parameters; parentheses and KK are added),
// TCP clients, serial (not in the simulator yet) and "Gravar totais" (the 2.7.2 totals button).
import { classeKK, e, horaMs, kk, lerNum, num, tamanho } from '../fmt.js';
import { bicoPorCodigo, cabecalho, opcoesBicos, rotuloBico, seg } from './comum.js';

function ui(app) {
  app.ui.comunicacao ??= { texto: '&T99P', modoKK: 'auto', entrega: 'local', hist: [], ultimo: null, bico: null, valor: '', unidade: 'litros' };
  return app.ui.comunicacao;
}

function quadroDe(u) {
  const t = String(u.texto ?? '').replace(/^\(/, '').replace(/\)$/, '');
  if (u.modoKK === 'auto') return { quadro: `(${t}${kk(t)})`, kk: kk(t), corpo: t };
  return { quadro: `(${t})`, kk: null, corpo: t };
}

async function enviar(app, quadro) {
  const u = ui(app);
  const portas = app.estado.portas.map((p) => p.logica);
  const porta = Number(u.porta ?? portas[0] ?? 2001);
  const inicio = performance.now();
  let r;
  if (u.entrega === 'porta') {
    const x = await app.chamar('enviar_pela_porta', { quadro, porta });
    if (!x) return;
    r = { resposta: x.resposta, latencia: x.latenciaMs, caiu: x.caiu };
  } else {
    const x = await app.chamar('enviar_comando_cru', { quadro, porta });
    if (!x) return;
    r = { resposta: x.respostas.filter(Boolean).join('') || null, latencia: Math.round(performance.now() - inicio) };
  }
  u.ultimo = { quadro, ...r, ts: app.estado.relogio.agora, porta, entrega: u.entrega };
  u.hist.unshift(u.ultimo);
  u.hist.splice(10);
}

export default {
  id: 'comunicacao',
  render(app) {
    const est = app.estado;
    const u = ui(app);
    const portas = est.portas.map((p) => p.logica);
    const porta = Number(u.porta ?? portas[0] ?? 2001);
    const q = quadroDe(u);
    const chipKK = u.modoKK === 'auto' ? `KK ${q.kk} · CALCULADO` : u.modoKK === 'sem' ? 'SEM KK' : 'KK MANUAL';
    const entregaOpts = [['local', 'Parser local'], ...portas.map((p) => [`porta:${p}`, `Pela porta ${p}`])];
    const entregaAtual = u.entrega === 'porta' ? `porta:${porta}` : 'local';
    const ult = u.ultimo;
    const kkRx = ult ? classeKK(ult.quadro, 'rx') : null;
    const resp = ult
      ? `<div class="con" style="margin:0 14px 14px">
          <div class="resp"><span class="c-rx">RX</span><span>${e(ult.quadro)}</span><span class="${kkRx === 'ok' ? 'c-ok' : kkRx === 'bad' ? 'c-bad' : 'c-na'}">${kkRx === 'ok' ? 'KK ok' : kkRx === 'bad' ? 'KK inválido' : 'sem KK'}</span></div>
          <div class="resp" style="padding-top:0"><span class="c-tx">TX</span><span>${ult.resposta ? e(ult.resposta) : '<span class="c-na">silêncio</span>'}</span><span class="c-na">${horaMs(ult.ts)} · ${ult.latencia ?? '—'} ms</span></div>
          <div class="resp" style="padding-top:0"><span></span><span class="c-na">${ult.entrega === 'porta' ? `por uma conexão TCP na porta ${ult.porta}${ult.caiu ? ' · a conexão caiu' : ''}` : `parser local, como a porta ${ult.porta}`}</span><span></span></div></div>`
      : '';
    const hist = u.hist
      .map((h, i) => `<div class="hist"><span class="faint">${horaMs(h.ts)}</span><span class="q">${e(h.quadro)}</span><span class="r">${h.resposta ? e(h.resposta) : 'silêncio'}</span><button class="btn sm ghost" data-act="repetir" data-i="${i}">Repetir</button></div>`)
      .join('');
    const clientes = est.conexoes
      .map((c) => `<div class="cli"><span class="mono faint">#${c.id}</span><span class="mono">${c.logica}</span><span class="mono">${e(c.remoto)} <span class="faint">· desde ${horaMs(c.desde)} · ${tamanho(c.rxBytes)} rx · ${tamanho(c.txBytes)} tx</span></span><button class="btn sm ghost danger" data-act="desconectar" data-id="${c.id}">Desconectar</button></div>`)
      .join('');

    // Gravar totais
    const bicoCod = u.bico ?? est.lados[0]?.bicos[0]?.codigo;
    const b = bicoPorCodigo(app, bicoCod);
    const atual = b ? (u.unidade === 'valor' ? b.encerranteValorMil : b.encerranteMl) / 1000 : null;
    const novo = lerNum(u.valor);
    const e272 = est.quirks.E_272;
    return `<div class="main scr-comunicacao">
      ${cabecalho('Comunicação', 'Mandar um quadro à mão, ver os clientes TCP e gravar totais (encerrante) direto no bico.')}
      <div class="cols"><div class="stack">
        <section class="card">
          <div class="card-h"><span class="ms s16">terminal</span><span class="h2">Simular comando</span><span class="small faint">digite o comando; os parênteses e o KK entram sozinhos</span></div>
          <div class="card-b fx col gap12">
            <div class="row gap8"><label class="inp cmd" style="flex:1"><span class="faint">(</span><input data-campo="texto" data-enter="enviar" value="${e(u.texto)}" spellcheck="false" aria-label="Comando"><span class="faint">)</span></label>
              ${seg([['auto', 'KK automático'], ['sem', 'Sem KK'], ['manual', 'Manual']], u.modoKK, 'modoKK')}</div>
            <div class="prev"><span class="faint">quadro</span><span>(${e(q.corpo)}${q.kk ? `<span class="kk">${q.kk}</span>` : ''})</span><span class="chip">${chipKK}</span></div>
            <div class="row gap8"><span class="lbl">Entregar</span>${seg(entregaOpts, entregaAtual, 'entrega')}
              <span class="small faint">${u.entrega === 'porta' ? 'abre uma conexão TCP: passa pelas falhas, pela gravação e mexe no ponteiro da porta' : 'sem conexão: só o parser, com o ponteiro da porta escolhida'}</span>
              <button class="btn pri" style="margin-left:auto" data-act="enviar"><span class="ms s16">send</span>Enviar</button></div>
          </div>
          ${resp}
          ${hist ? `<div class="sep"></div><div class="card-h" style="border-bottom:0;padding-bottom:4px"><span class="lbl">Histórico</span></div>${hist}` : ''}
        </section>
        <section class="card">
          <div class="card-h"><span class="ms s16">lan</span><span class="h2">Clientes TCP</span><span class="small faint">${portas.length ? `porta${portas.length > 1 ? 's' : ''} ${portas.join(', ')}` : 'nenhuma porta aberta'}</span></div>
          ${clientes || '<div class="card-b small faint">Nenhum cliente conectado.</div>'}
        </section>
      </div><div class="stack">
        <section class="card">
          <div class="card-h"><span class="ms s16">settings_input_hdmi</span><span class="h2">Serial</span><span class="dot off" style="margin-left:auto"></span><span class="small">não disponível</span></div>
          <div class="card-b fx col gap12">
            <div class="banner info"><span class="ms">info</span><span class="small"><b class="t">O pump-sim ainda não abre porta serial.</b> Precisaria de uma dependência nativa (serialport). Por enquanto use uma ponte externa (com0com ou socat → TCP ${portas[0] ?? 2001}).</span></div>
            <span class="small faint">Fala o mesmo protocolo das portas TCP.</span>
          </div>
        </section>
        <section class="card">
          <div class="card-h"><span class="ms s16">counter_5</span><span class="h2">Gravação de totais</span><span class="small faint">grava o encerrante no bico</span></div>
          <div class="card-b fx col gap12">
            <div class="flab"><span class="lbl">Bico</span><select class="field" data-campo="bico">${opcoesBicos(app, bicoCod)}</select></div>
            <div class="row gap8" style="align-items:flex-end">
              <div class="flab" style="flex:1"><span class="lbl">Valor</span><input class="inp" data-campo="valor" value="${e(u.valor)}" placeholder="${atual !== null ? num(atual, 2) : ''}"></div>
              ${seg([['litros', 'Litros'], ['valor', 'Dinheiro']], u.unidade, 'unidade')}</div>
            <div class="enc"><div class="encd"><span class="dl">Atual ${u.unidade === 'valor' ? 'R$' : 'L'}</span><span class="v">${atual !== null ? num(atual, 2) : '—'}</span></div>
              <span class="ms faint">arrow_forward</span>
              <div class="encd"><span class="dl">Novo ${u.unidade === 'valor' ? 'R$' : 'L'}</span><span class="v">${Number.isNaN(novo) ? '—' : num(novo, 2)}</span></div></div>
            <div class="small muted">${b ? e(rotuloBico(b)) + '. ' : ''}${e272 ? 'No simulador-2.7.2 é o botão "Gravar totais" (o mesmo que o <span class="mono">&amp;E</span> chama): só litros, e cria um registro de volume zero quando o encerrante muda.' : 'Grava o encerrante do bico (o <span class="mono">&amp;E</span> do 2.7.2 responde <span class="mono">(TL BB valor KK)</span>).'} Gera o evento "Encerrante Gravado".</div>
            <button class="btn pri" data-act="gravar-totais"${Number.isNaN(novo) ? ' disabled' : ''}><span class="ms s16">save</span>Gravar encerrante</button>
          </div>
        </section>
      </div></div></div>`;
  },
  acoes: {
    modoKK(app, d) {
      ui(app).modoKK = d.v;
    },
    entrega(app, d) {
      const u = ui(app);
      if (d.v === 'local') u.entrega = 'local';
      else {
        u.entrega = 'porta';
        u.porta = Number(d.v.slice(6));
      }
    },
    unidade(app, d) {
      ui(app).unidade = d.v;
    },
    async enviar(app) {
      await enviar(app, quadroDe(ui(app)).quadro);
    },
    async repetir(app, d) {
      const h = ui(app).hist[Number(d.i)];
      if (h) await enviar(app, h.quadro);
    },
    async desconectar(app, d) {
      await app.chamar('desconectar', { cliente: Number(d.id) });
    },
    async 'gravar-totais'(app) {
      const u = ui(app);
      const bico = u.bico ?? app.estado.lados[0]?.bicos[0]?.codigo;
      const v = lerNum(u.valor);
      if (Number.isNaN(v) || v < 0 || v >= 1e7) return app.aviso('Valor inválido (até 7 dígitos inteiros)');
      const r = await app.chamar('gravar_encerrante', { bico, valor: Math.round(v * 1000), unidade: u.unidade, painel: true });
      if (r) {
        u.valor = '';
        app.aviso(`Encerrante do bico ${bico} gravado`, 'info');
      }
    },
  },
};
