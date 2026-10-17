// Preços por nível: levels 0/1/2 per nozzle (&U), staged locally and applied with set_preco.
import { e, lerNum, num } from '../fmt.js';
import { cabecalho, lados, seg } from './comum.js';

function ui(app) {
  app.ui.precos ??= { grupo: 0, sujo: {}, produto: null, nivel: '0', preco: '' };
  return app.ui.precos;
}
const chave = (cod, n) => `${cod}:${n}`;
const produtoDe = (b) => (b.combustivel ? `Combustível ${b.combustivel}` : 'Sem combustível');

export default {
  id: 'precos',
  render(app) {
    const est = app.estado;
    const u = ui(app);
    const grupos = Math.ceil(est.perfil.canais / 4);
    const opcoesGrupo = Array.from({ length: grupos }, (_, i) => [i, `Canais ${i * 4 + 1}–${Math.min(est.perfil.canais, i * 4 + 4)}`]);
    const todos = lados(app).flatMap((l) => l.bicos.map((b) => ({ b, l })));
    const produtos = [...new Set(todos.map(({ b }) => produtoDe(b)))];
    const produto = u.produto ?? produtos[0];
    const nProd = todos.filter(({ b }) => produtoDe(b) === produto).length;
    const visiveis = todos.filter(({ l }) => Math.floor((l.canal - 1) / 4) === Number(u.grupo));
    const linhas = visiveis
      .map(({ b, l }) => {
        const casas = b.casas?.preco ?? 3;
        const cel = (n) => {
          const k = chave(b.codigo, n);
          const sujo = u.sujo[k] !== undefined;
          const v = sujo ? u.sujo[k] : num(b.precos[n] / 10 ** casas, casas);
          return `<div class="cell${sujo ? ' dirty' : ''}"><span class="u">R$</span><input data-campo="cel:${k}" value="${e(v)}" aria-label="Nível ${n} do bico ${b.codigo}"></div>`;
        };
        const pend = b.precosPendentes.some((x) => x !== null && x !== undefined);
        const sujo = [0, 1, 2].some((n) => u.sujo[chave(b.codigo, n)] !== undefined);
        const abast = b.estado === 'abastecendo';
        const sit = sujo ? ['st st-pronta', 'alterado'] : pend ? ['st st-espera', abast ? 'pendente · abastecendo' : 'pendente'] : ['small faint', 'aplicado'];
        return `<div class="pr" data-key="${b.codigo}"><span class="hex">${b.codigo}</span><span class="mono small">C${l.canal} · end ${l.endereco}</span><span>${e(produtoDe(b))}</span>
          ${cel(0)}${cel(1)}${cel(2)}<span class="mono small muted">nível ${l.nivelPreco}</span><span class="${sit[0]}">${sit[1]}</span></div>`;
      })
      .join('');
    const n = Object.keys(u.sujo).length;
    return `<div class="main scr-precos">
      ${cabecalho('Preços por nível', 'Até três níveis por bico (0, 1 e 2). O preço novo vale no próximo abastecimento; até lá fica pendente.', grupos > 1 ? seg(opcoesGrupo, u.grupo, 'grupo') : '')}
      <section class="card">
        <div class="bulk">
          <div class="flab"><span class="lbl">Produto</span><select class="field" style="width:200px" data-campo="produto">${produtos.map((p) => `<option${p === produto ? ' selected' : ''}>${e(p)}</option>`).join('')}</select></div>
          <div class="flab"><span class="lbl">Nível</span>${seg([[0, '0'], [1, '1'], [2, '2']], u.nivel, 'nivel')}</div>
          <div class="flab"><span class="lbl">Preço R$/L</span><input class="inp" style="width:120px;text-align:right" data-campo="preco" value="${e(u.preco)}" placeholder="0,000"></div>
          <button class="btn" data-act="lote">Aplicar a todos os bicos de ${e(produto)}</button>
          <span class="small faint" style="margin-left:auto">${nProd} bico${nProd === 1 ? '' : 's'}</span>
        </div>
        <div class="pr hd lbl"><span>Bico</span><span>Canal · end</span><span>Produto</span><span>Nível 0</span><span>Nível 1</span><span>Nível 2</span><span>Vigente</span><span>Situação</span></div>
        ${linhas || '<div class="empty"><span class="ms">sell</span><span class="small">Nenhum bico configurado nestes canais.</span></div>'}
        <div class="foot"><span class="small muted"><span class="ms s14">info</span> Pelo protocolo: <span class="mono">&amp;U</span> de 4 dígitos aceita nível 0 ou 1; o de 6 dígitos aceita 0 a 2. No simulador-2.7.2, nível inválido abre o MessageBox modal.</span>
          <div class="row gap8" style="margin-left:auto"><button class="btn ghost" data-act="descartar"${n ? '' : ' disabled'}>Descartar</button>
          <button class="btn pri" data-act="aplicar"${n ? '' : ' disabled'}><span class="ms s16">check</span>${n ? `Aplicar ${n} alteraç${n === 1 ? 'ão' : 'ões'}` : 'Aplicar alterações'}</button></div></div>
      </section></div>`;
  },
  aoMudar(app, campo, valor) {
    if (!campo.startsWith('cel:')) return;
    const u = ui(app);
    const k = campo.slice(4);
    u.sujo[k] = valor;
    delete app.ui.precos[campo];
  },
  acoes: {
    grupo(app, d) {
      ui(app).grupo = Number(d.v);
    },
    nivel(app, d) {
      ui(app).nivel = d.v;
    },
    lote(app) {
      const u = ui(app);
      const v = lerNum(u.preco);
      if (Number.isNaN(v)) return app.aviso('Informe o preço');
      const produto = u.produto ?? null;
      for (const l of lados(app))
        for (const b of l.bicos) if (produto === null || produtoDe(b) === produto) u.sujo[chave(b.codigo, u.nivel)] = num(v, b.casas?.preco ?? 3);
    },
    descartar(app) {
      ui(app).sujo = {};
    },
    async aplicar(app) {
      const u = ui(app);
      const casasDe = (cod) => lados(app).flatMap((l) => l.bicos).find((b) => b.codigo === cod)?.casas?.preco ?? 3;
      for (const [k, txt] of Object.entries(u.sujo)) {
        const [bico, nivel] = k.split(':');
        const v = lerNum(txt);
        if (Number.isNaN(v)) {
          app.aviso(`Preço inválido no bico ${bico}, nível ${nivel}`);
          continue;
        }
        const r = await app.chamar('set_preco', { bico, nivel: Number(nivel), preco: Math.round(v * 10 ** casasDe(bico)) });
        if (r) delete u.sujo[k];
      }
    },
  },
};
