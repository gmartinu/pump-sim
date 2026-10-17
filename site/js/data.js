// Sample forecourt for the homepage (hero card, interface shot, traffic card).
// Port of the design's pump-sim-data.js: same scene, same frames, same 300 ms tick.
(function () {
  'use strict';
  const hex2 = (n) => ('0' + n.toString(16).toUpperCase()).slice(-2);
  const kk = (s) => {
    let t = 0;
    for (let i = 0; i < s.length; i++) t += s.charCodeAt(i);
    return hex2(t & 0xff);
  };
  const cod = (canal, end, pos) => hex2(0x40 * pos + 4 + 4 * (canal - 1) + (end - 1));
  const brl = (v, d) => {
    const p = v.toFixed(d == null ? 2 : d).split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return p.join(',');
  };
  const trunc = (v, d) => {
    const f = Math.pow(10, d);
    return Math.floor(v * f + 1e-9) / f;
  };

  const PRODS = [
    ['Gasolina C', 6.29], ['Etanol', 4.39], ['Diesel S10', 6.19], ['Gasolina Aditivada', 6.49],
    ['Diesel S500', 5.99], ['Etanol', 4.39], ['Gasolina C', 6.29], ['Diesel S10', 6.19],
  ];
  // state per [channel]-[side]: [state, active nozzle (0/1), volume]
  const CENA = {
    '1-1': ['abastecendo', 0, 18.447], '2-1': ['pronta', 0, 0], '2-2': ['concluiu', 1, 32.508],
    '3-1': ['espera', 0, 0], '4-1': ['abastecendo', 1, 41.022], '4-2': ['bloqueada', 0, 0],
    '5-1': ['falha', 0, 0], '7-2': ['pronta', 1, 0], '6-2': ['concluiu', 0, 12.9],
  };
  const META = {
    livre: { rot: 'Livre', ic: 'radio_button_unchecked', btn: 'Retirar bico', bic: 'pan_tool_alt' },
    pronta: { rot: 'Pronta', ic: 'lock_open', btn: 'Retirar bico', bic: 'pan_tool_alt' },
    abastecendo: { rot: 'Abastecendo', ic: 'local_gas_station', btn: 'Recolocar bico', bic: 'back_hand' },
    concluiu: { rot: 'Concluiu', ic: 'task_alt', btn: 'Retirar bico', bic: 'pan_tool_alt' },
    bloqueada: { rot: 'Bloqueada', ic: 'lock', btn: 'Retirar bico', bic: 'pan_tool_alt' },
    espera: { rot: 'Espera', ic: 'hourglass_top', btn: 'Recolocar bico', bic: 'back_hand' },
    falha: { rot: 'Falha', ic: 'error', btn: 'Limpar falha', bic: 'restart_alt' },
  };
  const LETRA = { livre: 'L', pronta: 'P', abastecendo: 'A', concluiu: 'C', bloqueada: 'B', espera: 'E', falha: 'F' };

  const canais = [];
  for (let c = 1; c <= 8; c++) {
    const lados = [];
    for (let e = 1; e <= 2; e++) {
      const cena = CENA[c + '-' + e] || ['livre', 0, 0];
      const p0 = PRODS[(c - 1) % 8];
      const p1 = PRODS[(c + 2) % 8];
      const seed = c * 131 + e * 17;
      const bicos = [0, 1].map((pos) => {
        const pr = pos === 0 ? p0 : p1;
        const encL = 1000000 + seed * 3917.37 + pos * 512331.11;
        return { pos, cod: cod(c, e, pos), prod: pr[0], preco: pr[1], encL, encV: encL * pr[1] * 0.97 };
      });
      lados.push({ canal: c, end: e, estado: cena[0], ativo: cena[1], vol: cena[2], bicos });
    }
    canais.push({ n: c, lados });
  }

  const PS = {
    perfil: 'simulador-2.7.2',
    conexoes: 1,
    clock: new Date(Date.UTC(2026, 9, 17, 14, 32, 8)),
    canais,
    tick: 0,
  };

  PS.lado = (l) => {
    const m = META[l.estado];
    const b = l.bicos[l.ativo];
    const vol = trunc(l.vol, 3);
    const tot = trunc(vol * b.preco, 2);
    const idle = l.estado === 'livre' || l.estado === 'bloqueada' || l.estado === 'pronta' || l.estado === 'falha';
    return {
      end: l.end, estado: l.estado, rot: m.rot, ic: m.ic, btn: m.btn, bic: m.bic,
      cls: 'st st-' + l.estado, lcls: 'lado l-' + l.estado,
      total: idle ? '0,00' : brl(tot), volume: idle ? '0,000' : brl(vol, 3), preco: brl(b.preco, 3),
      dcls: idle ? 'dv off' : 'dv', fluxo: l.estado === 'abastecendo',
      btnCls: l.estado === 'abastecendo' || l.estado === 'espera' ? 'btn sm pri' : 'btn sm',
      bicos: l.bicos.map((bb) => ({
        cod: bb.cod, prod: bb.prod, preco: brl(bb.preco, 3), encL: brl(bb.encL), encV: brl(bb.encV),
        cls: bb.pos === l.ativo ? 'bico on' : 'bico', rcls: bb.pos === l.ativo ? 'radio on' : 'radio',
      })),
    };
  };

  PS.vista = () =>
    PS.canais.map((ca) => {
      const ativos = ca.lados.filter((l) => l.estado === 'abastecendo').length;
      return { n: ca.n, nome: 'Canal ' + ca.n, resumo: ativos ? ativos + ' abastecendo' : '', lados: ca.lados.map(PS.lado) };
    });

  PS.statusS = () => {
    let s = 'S';
    PS.canais.forEach((ca) => {
      s += LETRA[ca.lados[0].estado] + LETRA[ca.lados[1].estado] + 'FF';
    });
    return '(' + s + 'FFDD6V3.7M1.0G7A)';
  };

  PS.relogio = () => {
    const d = PS.clock;
    const z = (n) => ('0' + n).slice(-2);
    return z(d.getUTCDate()) + '/' + z(d.getUTCMonth() + 1) + ' ' + z(d.getUTCHours()) + ':' + z(d.getUTCMinutes()) + ':' + z(d.getUTCSeconds());
  };

  PS.contagem = () => {
    const n = { livre: 0, pronta: 0, abastecendo: 0, concluiu: 0, bloqueada: 0, espera: 0, falha: 0 };
    PS.canais.forEach((ca) => ca.lados.forEach((l) => n[l.estado]++));
    return Object.keys(n).map((k) => ({ cls: 'st st-' + k, ic: META[k].ic, rot: META[k].rot + ' ' + n[k] }));
  };

  // Traffic: real frames (KK computed).
  const A52 = '(00123400020061703A00100416101410000100001234560057)';
  const reg = (tot, vol, ppl, bico, dur, r, enc) => {
    const inner = tot + vol + ppl + '3A' + dur + bico + '17101432' + r + enc + '00';
    return '(' + inner + kk(inner) + ')';
  };
  const T = (ts, dir, quadro, verbo, nota) => ({ ts, dir, quadro, verbo, nota: nota || '' });
  const TRAFEGO = [
    T('14:32:06.118', 'rx', '(&S)', '&S'),
    T('14:32:06.121', 'tx', PS.statusS(), '&S', '49 chars'),
    T('14:32:06.420', 'rx', '(&V)', '&V'),
    T('14:32:06.422', 'tx', '(04001844)(50004102)', '&V', '2 bicos'),
    T('14:32:06.731', 'rx', '(&A)', '&A'),
    T('14:32:06.734', 'tx', A52, '&A', '52 chars'),
    T('14:32:06.902', 'rx', '(&I)', '&I', 'sem resposta (esperado)'),
    T('14:32:07.010', 'rx', '(&A)', '&A'),
    T('14:32:07.013', 'tx', reg('020447', '032508', '6290', '49', '00F2', '0177', '0001693214'), '&A', '52 chars'),
  ];

  PS.trafego = (n) =>
    TRAFEGO.slice(0, n).map((r) => ({
      ts: r.ts, dir: r.dir.toUpperCase(), dcls: r.dir === 'rx' ? 'c-rx' : 'c-tx', quadro: r.quadro, nota: r.nota || r.verbo,
    }));

  PS.step = () => {
    PS.tick++;
    PS.canais.forEach((ca) =>
      ca.lados.forEach((l) => {
        if (l.estado === 'abastecendo') {
          l.vol += 0.129;
          l.bicos[l.ativo].encL += 0.129;
          l.bicos[l.ativo].encV += 0.129 * l.bicos[l.ativo].preco;
        }
      }),
    );
    if (PS.tick % 3 === 0) PS.clock = new Date(PS.clock.getTime() + 1000);
  };

  window.PumpSite = window.PumpSite || {};
  window.PumpSite.PS = PS;
})();
