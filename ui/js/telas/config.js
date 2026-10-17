// Configuração: profile, DIP1–4, model, Automação, AC mains, speed, battery, TCP ports, CBC clock and
// the channel table — the 2.7.2 configuration tab, through the control API.
import { e, num, pad } from '../fmt.js';
import { cabecalho, lados, seg, sw } from './comum.js';

const DIPS = [
  ['Stream de eventos na serial', 'no 2.7.2 manda os eventos (ON, MEM, OFF…) sem ser pedido; o pump-sim não tem serial'],
  ['Reservada', 'sem efeito conhecido no 2.7.2'],
  ['&A com 52 caracteres', 'desligada: &A com 36 no 2.7.2 (34 no CBC-05)'],
  ['Habilita a simulação', 'com Automação ligada, a bomba anda'],
];
// One-line profile captions from the design; the profile's full description stays in the tooltip.
const RESUMO = {
  'simulador-2.7.2': 'igual ao SimuladorCBC 2.7.2, com os quirks ligados',
  'cbc-32': 'CBC-06 real (DT435): &A 52, erros completos, ponteiro por porta',
  'cbc05-dip3': 'CBC-05: &A 34 ou 52 pela DIP3, sem Identfid',
  cbc01: 'CBC-01: &A 34, sem &L e &T99P',
  'horustech-cbc-36': '&S com 36 posições, 9 canais, &LR 82',
  'horustech-48': '12 canais, &S com 48 posições sem trailer',
  'concept-48': 'igual ao horustech-48, memória maior',
};
/** Where each profile's behavior comes from: the bench for 2.7.2, the Companytec manuals for the rest. */
const ORIGEM = {
  'simulador-2.7.2': { ref: 'SimuladorCBC 2.7.2', medido: true },
  'cbc-32': { ref: 'DT435' },
  'cbc05-dip3': { ref: 'DT435 p.3-4' },
  cbc01: { ref: 'DT435 p.4' },
  'horustech-cbc-36': { ref: 'DT435 p.22' },
  'horustech-48': { ref: 'DT435 p.22, DT277 p.7' },
  'concept-48': { ref: 'DT432 p.4' },
};
const SELO = { medido: 'medido contra o SimuladorCBC 2.7.2 real', manual: 'segundo o manual, não validado em hardware' };
const USO = { 2001: 'pista: PDV e DLL nova', 1771: 'configuração: CBCManager, DLL antiga', 7002: 'rádio do 2.7.2 (uso desconhecido)', 857: 'segunda aplicação' };
const VEL = [['lento', 'Lento · 450 ms', 450], ['normal', 'Normal · 300 ms', 300], ['rapido', 'Rápido · 150 ms', 150]];

function ui(app) {
  app.ui.config ??= { canal: 1, trocar: null, data: null, hora: null };
  return app.ui.config;
}

export default {
  id: 'config',
  polls: [
    { chave: 'perfis', nome: 'list_perfis', cada: 60000 },
    { chave: 'relogio', nome: 'get_relogio', cada: 1000 },
  ],
  render(app) {
    const est = app.estado;
    const u = ui(app);
    const eq = est.equipamento;
    const perfis = app.dados.perfis?.perfis ?? [{ id: est.perfil.id, descricao: est.perfil.descricao }];
    const listaPerfis = perfis
      .map((p) => {
        const on = p.id === est.perfil.id;
        const o = ORIGEM[p.id];
        const pend = p.id === u.trocar;
        return `<div class="perf${on ? ' on' : pend ? ' pend' : ''}" data-act="escolher-perfil" data-id="${e(p.id)}"><span class="radio${on ? ' on' : ''}"></span><span class="mono fw6">${e(p.id)}</span><span class="small muted" title="${e(p.descricao)}">${e(RESUMO[p.id] ?? p.descricao)}${o ? ` <span class="mono faint">· ${e(o.ref)}</span>` : ''}</span>${o ? `<span class="selo${o.medido ? ' ok' : ''}">${o.medido ? SELO.medido : SELO.manual}</span>` : '<span></span>'}</div>`;
      })
      .join('');
    const aviso = u.trocar
      ? `<div class="banner warn confirm"><span class="ms fill">warning</span><div class="fx col gap4"><b class="t">Trocar para ${e(u.trocar)} muda o protocolo e os quirks.</b>
          <span class="small">O estado físico (bicos, encerrantes, preços, buffer, ponteiros, cartões e relógio) passa para o novo perfil. As portas reabrem se o perfil usar outras, e aí as conexões caem.</span></div>
          <div class="row gap8" style="margin-left:auto"><button class="btn sm" data-act="cancelar-perfil">Cancelar</button><button class="btn sm pri" data-act="trocar-perfil">Trocar para ${e(u.trocar)}</button></div></div>`
      : '';
    const dips = DIPS.map(([t, ef], i) => {
      const on = eq.dips[i];
      return `<div class="dip">${sw(on, 'dip', `data-n="${i + 1}" data-on="${on ? 0 : 1}"`)}<span class="dipn">DIP${i + 1}</span><span class="fx col gap2"><b class="fw6">${e(t)}</b><span class="small muted">${e(ef)}</span></span><span class="mono small faint">${on ? 'ligada' : 'desligada'}</span></div>`;
    }).join('');
    const velAtual = VEL.find((v) => v[2] === est.timers.tickVazaoMs)?.[0] ?? '';
    const um = est.perfil.escutaTcp === 'umaPorVez';
    const abertas = new Set(est.portas.map((p) => p.logica));
    const opcoes = um ? est.perfil.opcoesPortaTcp : est.perfil.portas.filter((p) => p.tipo === 'tcp').map((p) => Number(p.porta));
    const portas = opcoes
      .map((p) => {
        const on = abertas.has(p);
        const erro = est.erroPorta?.porta === p;
        return `<div class="porta" data-act="porta" data-p="${p}" data-on="${on ? 1 : 0}"><span class="${um ? `radio${on ? ' on' : ''}` : `chk${on ? ' on' : ''}`}">${!um && on ? '<span class="ms s14">check</span>' : ''}</span><span class="mono fw6">${p}</span><span class="small muted">${erro ? `<span style="color:var(--err)">${e(est.erroPorta.codigo)}: em uso por outro processo</span>` : e(USO[p] ?? '')}</span><span class="dot${erro ? ' err' : on ? '' : ' off'}"></span></div>`;
      })
      .join('');
    const rel = app.dados.relogio;
    const r = rel?.rtc;
    const dataTxt = u.data ?? (r ? `${pad(r.dia, 2)}/${pad(r.mes, 2)}/${r.ano}` : '');
    const horaTxt = u.hora ?? (r ? `${pad(r.hora, 2)}:${pad(r.minuto, 2)}:${pad(r.segundo, 2)}` : '');
    const canal = Number(u.canal);
    const ends = [1, 2, 3, 4]
      .map((n) => {
        const l = lados(app).find((x) => x.canal === canal && x.endereco === n && x.configurado);
        return l
          ? `<div class="cfgr mono"><span>${n}</span><span>${e(l.tipoBomba)}</span><span>${e(l.virgula)}</span><span>${l.nBicos}</span><span class="faint">${l.bicos.map((b) => b.codigo).join(' · ')}</span></div>`
          : `<div class="cfgr mono"><span>${n}</span><span>—</span><span>—</span><span>0</span><span class="faint">—</span></div>`;
      })
      .join('');
    const chans = Array.from({ length: est.perfil.canais }, (_, i) => `<span class="${i + 1 === canal ? 'on' : ''}" data-act="canal" data-c="${i + 1}">C${i + 1}</span>`).join('');
    return `<div class="main scr-config">
      ${cabecalho('Configuração', 'As mudanças valem na hora, sem reiniciar.', '<button class="btn" data-act="padrao"><span class="ms s16">settings_backup_restore</span>Carregar configuração padrão</button>')}
      <div class="cols"><div class="stack">
        <section class="card"><div class="card-h"><span class="h2">Perfil</span><span class="small faint">o que o simulador responde em protocolo</span></div>${listaPerfis}${aviso}</section>
        <section class="card"><div class="card-h"><span class="h2">Chaves DIP</span><span class="small faint">como no painel do concentrador</span></div>${dips}</section>
        <section class="card"><div class="card-h"><span class="h2">Concentrador</span></div>
          <div class="opt"><div class="opt-l"><b>Modelo</b><span class="small faint">tipo no char 39 do &amp;S</span></div>${seg([['Horustech', 'Horustech'], ['CBC-06', 'CBC-06'], ['CBC-05', 'CBC-05'], ['CBC-02', 'CBC-02']], eq.modelo, 'modelo')}</div>
          <div class="opt"><div class="opt-l"><b>Automação</b><span class="small faint">com a DIP4, libera a simulação</span></div>${seg([[1, 'Ligado'], [0, 'Desligado']], eq.automacao ? 1 : 0, 'automacao')}</div>
          <div class="opt"><div class="opt-l"><b>Rede AC</b><span class="small faint">letra P do &amp;S: G ou B</span></div>${seg([[1, 'Ligado'], [0, 'Desligado']], eq.redeAC ? 1 : 0, 'rede')}</div>
          <div class="opt"><div class="opt-l"><b>Velocidade</b><span class="small faint">tick da vazão${velAtual ? '' : ` · agora ${est.timers.tickVazaoMs} ms`}</span></div>${seg(VEL.map((v) => [v[0], v[1]]), velAtual, 'velocidade')}</div>
          <div class="opt"><div class="opt-l"><b>Bateria</b><span class="small faint">byte T do &amp;S</span></div>
            <div class="row gap8"><button class="btn sm" data-act="bateria" data-d="-0.1" aria-label="Diminuir"><span class="ms s14">remove</span></button>
            <div class="field mono" style="width:72px;justify-content:center">${num(eq.bateriaVolts, 1)} V</div>
            <button class="btn sm" data-act="bateria" data-d="0.1" aria-label="Aumentar"><span class="ms s14">add</span></button>
            <span class="small faint">firmware ${e(eq.firmware)} · monitor ${e(eq.monitor)}</span></div></div>
        </section>
      </div><div class="stack">
        <section class="card"><div class="card-h"><span class="h2">Portas TCP</span><span class="small faint">${um ? `${e(est.perfil.id)}: uma porta por vez, ponteiro único` : 'escutam ao mesmo tempo, cada uma com o próprio ponteiro'}</span></div>
          ${portas}<div class="sep"></div>
          <div class="card-b note"><span class="ms s14">info</span> Nos perfis reais (cbc-32, horustech-48, concept-48…) as portas <span class="mono">857</span>, <span class="mono">1771</span> e <span class="mono">2001</span> escutam ao mesmo tempo, cada uma com o próprio ponteiro de leitura. A <span class="mono">7002</span> só existe no 2.7.2.</div></section>
        <section class="card"><div class="card-h"><span class="h2">Relógio do CBC</span><span class="small faint">o que o &amp;R devolve e o que data os registros</span></div>
          <div class="card-b fx col gap12">
            <div class="row gap8"><div class="field mono"><span class="ms s16">calendar_today</span><input data-campo="data" value="${e(dataTxt)}" style="width:90px" aria-label="Data"></div>
              <div class="field mono"><span class="ms s16">schedule</span><input data-campo="hora" value="${e(horaTxt)}" style="width:70px" aria-label="Hora"></div>
              <button class="btn" data-act="ler-relogio"><span class="ms s16">download</span>Ler</button>
              <button class="btn pri" data-act="ajustar-relogio"><span class="ms s16">upload</span>Ajustar</button></div>
            <div class="row gap10">${sw(est.relogio.manual, '', '', true)}<span class="fx col gap2"><b class="fw6">Relógio manual</b><span class="small muted">o tempo só anda por avancar_tempo; deixa o CI determinístico. Só na partida: <span class="mono">--relogio-manual</span></span></span></div>
            <div class="row gap10">${sw(rel?.dataRegistro === 'pc', 'fonte-data', `data-on="${rel?.dataRegistro === 'pc' ? 0 : 1}"`)}<span class="fx col gap2"><b class="fw6">Data dos registros pelo relógio do PC</b><span class="small muted">como o 2.7.2 faz (quirk Q5); desligue para usar o relógio simulado</span></span></div>
          </div></section>
        <section class="card"><div class="card-h"><span class="h2">Canais e bicos</span></div>
          <div class="card-b fx col gap12"><div class="chan">${chans}</div>
            <div class="cfgt"><div class="cfgr lbl"><span>End.</span><span>Tipo</span><span>C.V.</span><span>Bicos</span><span>Códigos</span></div>${ends}</div>
            <div class="note">Padrão: 8 canais × 2 endereços × 2 bicos. C.V. = código de vírgula (casas de total, volume e preço).</div></div></section>
      </div></div></div>`;
  },
  acoes: {
    'escolher-perfil'(app, d) {
      ui(app).trocar = d.id === app.estado.perfil.id ? null : d.id;
    },
    'cancelar-perfil'(app) {
      ui(app).trocar = null;
    },
    async 'trocar-perfil'(app) {
      const u = ui(app);
      const r = await app.chamar('set_perfil', { perfil: u.trocar });
      if (r) u.trocar = null;
    },
    async dip(app, d) {
      await app.chamar('set_dip', { n: Number(d.n), on: d.on === '1' });
    },
    async modelo(app, d) {
      await app.chamar('set_modelo', { modelo: d.v });
    },
    async automacao(app, d) {
      await app.chamar('set_automacao', { on: d.v === '1' });
    },
    async rede(app, d) {
      await app.chamar('set_rede_ac', { ligada: d.v === '1' });
    },
    async velocidade(app, d) {
      await app.chamar('set_velocidade', { velocidade: d.v });
    },
    async bateria(app, d) {
      const v = Math.round((app.estado.equipamento.bateriaVolts + Number(d.d)) * 10) / 10;
      await app.chamar('set_bateria', { volts: v });
    },
    async porta(app, d) {
      const est = app.estado;
      if (est.perfil.escutaTcp === 'umaPorVez' || d.on === '0') await app.chamar('abrir_porta', { porta: Number(d.p) });
      else await app.chamar('fechar_porta', { porta: Number(d.p) });
    },
    'ler-relogio'(app) {
      const u = ui(app);
      u.data = null;
      u.hora = null;
    },
    async 'ajustar-relogio'(app) {
      const u = ui(app);
      const r = app.dados.relogio?.rtc;
      const data = u.data ?? (r ? `${pad(r.dia, 2)}/${pad(r.mes, 2)}/${r.ano}` : '');
      const hora = u.hora ?? (r ? `${pad(r.hora, 2)}:${pad(r.minuto, 2)}:${pad(r.segundo, 2)}` : '');
      const md = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(data.trim());
      const mh = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hora.trim());
      if (!md || !mh) return app.aviso('Use data dd/mm/aaaa e hora hh:mm:ss');
      const iso = `${md[3]}-${pad(md[2], 2)}-${pad(md[1], 2)}T${pad(mh[1], 2)}:${mh[2]}:${mh[3] ?? '00'}`;
      const ok = await app.chamar('set_relogio', { datahora: iso });
      if (ok) {
        u.data = null;
        u.hora = null;
        app.aviso('Relógio do CBC ajustado', 'info');
      }
    },
    async 'fonte-data'(app, d) {
      await app.chamar('set_relogio_simulado', { fonte_data_registro: d.on === '1' ? 'pc' : 'simulado' });
    },
    canal(app, d) {
      ui(app).canal = Number(d.c);
    },
    padrao(app) {
      app.abrirModal({
        titulo: 'Carregar configuração padrão',
        corpo: () =>
          `<span class="small">O botão do 2.7.2: 8 canais × 2 endereços × 2 bicos, com os preços de fábrica${app.estado.quirks.PADRAO_272 ? '; neste perfil a escrita e a leitura do buffer também voltam à posição 1' : ''}.</span>`,
        rotulo: 'Carregar',
        async confirmar() {
          await app.chamar('carregar_config_padrao');
        },
      });
    },
  },
};
