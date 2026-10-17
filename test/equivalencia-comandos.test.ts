/**
 * 2.7.2 × pump-sim equivalence, slice 2 (commands): the DIFERENTE / SÓ NO 2.7.2 /
 * SÓ NO PUMP-SIM rows of the behavioral-equivalence verdict fixed on the `simulador-2.7.2` profile
 * (#8, #32–#36, #38–#40, #42–#45 and E3 of the error catalog). The clock literals are
 * the bench's (step 9, DIFF-12); the other frames are the verdict's, with the KK checked.
 * Real profiles follow the manual: none of these quirks applies to them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Hub, ManualClock, PERFIS, executarComando, executarDiff, selecionarRoteiros } from '../src/index.js';
import { avancarCampos } from '../src/core/datahora.js';
import { strToFloatDelphi } from '../src/core/numeros.js';
import { criar, kk } from './golden-util.js';

const CARTAO = '(?F01G1234567890ABCDEF0000000000000000CF)';
const QUIRKS_NOVOS = ['P_272', 'M99_272', 'U_272', 'C_272', 'E_272'] as const;

describe('quirks da fatia 2', () => {
  it('ligados só no simulador-2.7.2', () => {
    for (const [id, p] of Object.entries(PERFIS))
      for (const q of [...QUIRKS_NOVOS, 'RTC_272'] as const) expect(p.quirks[q], `${id} ${q}`).toBe(id === 'simulador-2.7.2');
  });
});

describe('#40: relógio por campos', () => {
  it('etapa 9: o mês 13 vale até o 1º tick e vira janeiro do ano seguinte (WW mantido)', () => {
    const { sim, clock } = criar('simulador-2.7.2');
    expect(sim.pedir('(&KW126131606143000BA)')).toBe('(KW12613160614300094)');
    clock.advance(100);
    expect(sim.pedir('(&KR1F4)')).toBe(kk('KR12613160614300' + '0'));
    clock.advance(2000);
    // Bench: `27 01 16 06 14:30:02` at t = 2.1 s.
    expect(sim.pedir('(&KR1F4)')).toBe('(KR1270116061430028F)');
    expect(sim.pedir('(&R)')).toMatch(/^\(REL 14:30:02 16\/01\/27\)/);
  });

  it('todo mês tem 31 dias: 30/04 23:59:59 + 3 s = 31/04 00:00:02', () => {
    const { sim, clock } = criar('simulador-2.7.2');
    expect(sim.pedir('(&KW126043006235958CE)')).toBe(kk('KW126043006235958'));
    clock.advance(3000);
    expect(sim.pedir('(&KR1F4)')).toBe(kk('KR126043106000001'));
  });

  it('igualdade a cada tick: hora 25 só volta depois de dar a volta no byte; dia 32 e mês 13 rolam no 1º tick', () => {
    const base = { ano: 26, mes: 1, dia: 1, diaSemana: 5, hora: 25, minuto: 59, segundo: 59 };
    expect(avancarCampos(base, 1)).toMatchObject({ hora: 26, minuto: 0, segundo: 0, dia: 1 });
    expect(avancarCampos({ ...base, hora: 0, minuto: 0, segundo: 0, dia: 32 }, 1)).toMatchObject({ dia: 1, mes: 2 });
    expect(avancarCampos({ ...base, hora: 0, minuto: 0, segundo: 0, mes: 13 }, 1)).toMatchObject({ mes: 1, ano: 27 });
    // The shortcut (skipping seconds) gives the same as tick by tick.
    let x = { ...base, hora: 23, minuto: 58, segundo: 10, dia: 31, mes: 12 };
    const direto = avancarCampos(x, 5000);
    for (let i = 0; i < 5000; i++) x = avancarCampos(x, 1);
    expect(direto).toEqual(x);
    expect(direto).toMatchObject({ ano: 27, mes: 1, dia: 1, diaSemana: 5 });
  });
});

describe('#39/#38: &KW e &H do 2.7.2', () => {
  it('&KW sem conferir o KK, hora 25 aceita, não numérico → E9 e silêncio (nunca a hora atual)', () => {
    const { sim } = criar('simulador-2.7.2');
    expect(sim.pedir('(&KW126101606143000B8)')).toBe('(KW12610160614300091)');
    expect(sim.pedir(kk('&KW126101606250000'))).toBe(kk('KW126101606250000'));
    expect(sim.pedir('(&KR1F4)')).toBe(kk('KR126101606250000'));
    expect(sim.pedir('(&KW1261016XX143000BA)')).toBeNull();
    // Text as the bench watcher read it (diff r4b): doubled quotes and a final dot.
    expect(sim.conc.eventos.at(-1)?.texto).toBe("''XX'' is not a valid integer value.");
    // The `1` is not checked; the dispatch only looks at `KW`.
    expect(sim.pedir('(&KW926101606143000C0)')).toBe('(KW12610160614300091)');
  });

  it('&H sem faixa: hora 25 → (&H) e o RTC mostra 25', () => {
    const { sim } = criar('simulador-2.7.2');
    expect(sim.pedir('(&H012500)')).toBe('(&H)');
    expect(sim.pedir('(&KR1F4)')).toMatch(/^\(KR1\d{4}01\d{2}2500/);
    expect(sim.pedir('(&H01ZZ00)')).toBeNull();
  });

  it('perfis reais: &KW com KK errado fica mudo e o inválido responde a hora atual (como antes)', () => {
    const { sim } = criar('cbc-32');
    expect(sim.pedir('(&KW126101606143000B8)')).toBeNull();
    expect(sim.pedir(kk('&KW126101606250000'))).toMatch(/^\(KW1\d{14}[0-9A-F]{2}\)$/);
    expect(sim.pedir('(&KR1F4)')!.slice(12, 14)).not.toBe('25');
  });
});

describe('#35: &P', () => {
  it('pré-autoriza o bico e põe P; sem teste de tamanho; (P?t) só com o próprio bico em A', () => {
    const { sim, clock } = criar('simulador-2.7.2');
    expect(sim.pedir('(&P04000500FF)')).toBe('(P04)');
    expect(sim.pedir('(&S)')).toMatch(/^\(SP/);
    // Slice 3 (BICO_272, verdict #73): the preset belongs to the nozzle, not the side.
    expect(sim.conc.bico(0x04)!.presetCentavos).toBe(500);
    expect(sim.conc.ladoDoBico(sim.conc.bico(0x04)!).presetCentavos).toBeNull();
    expect(sim.pedir(kk('&P050005000'))).toBe('(P05)');
    // Blocked: &P releases anyway.
    expect(sim.pedir(kk('&M08B'))).toBe('(M08)');
    expect(sim.pedir(kk('&P08000500'))).toBe('(P08)');
    sim.conc.retirarBico(0x08);
    clock.advance(1000);
    sim.atualizar();
    expect(sim.conc.bico(0x08)!.status).toBe('A');
    expect(sim.pedir(kk('&P08000500'))).toBe('(P?t)');
    expect(sim.pedir(kk('&P3F000500'))).toBe('(P?t)');
  });

  it('valor não numérico: E8, sem resposta, com o bico já marcado em P e sem preset', () => {
    const { sim } = criar('simulador-2.7.2');
    expect(sim.pedir(kk('&P0400X500'))).toBeNull();
    expect(sim.conc.eventos.at(-1)?.texto).toBe("'00X5,00' is not a valid floating point value.");
    expect(sim.conc.bico(0x04)!.status).toBe('P');
    expect(sim.conc.bico(0x04)!.presetCentavos ?? null).toBeNull();
  });

  it('perfis reais: só guarda o preset, sem P; tamanho ≠ 14 mudo', () => {
    const { sim } = criar('cbc-32');
    expect(sim.pedir('(&P04000500FF)')).toBe('(P04)');
    expect(sim.pedir('(&S)')).toMatch(/^\(SL/);
    expect(sim.pedir(kk('&P050005000'))).toBeNull();
  });
});

describe('#32: &M99 = coluna do cadastro de cartões', () => {
  it('(M99) se o cartão está cadastrado, (M?f) se não; BB livre; sem capacidade', () => {
    const { sim } = criar('simulador-2.7.2');
    expect(sim.pedir('(&M99b1234567890ABCDEFE9)')).toBe('(M?f)');
    expect(sim.pedir(CARTAO)).not.toBeNull();
    expect(sim.pedir('(&M99b1234567890ABCDEFE9)')).toBe('(M99)');
    expect(sim.conc.estaNaListaNegra('1234567890ABCDEF')).toBe(true);
    expect(sim.conc.listaNegra).toEqual([]);
    expect(sim.pedir('(&M12b1234567890ABCDEFDA)')).toBe('(M99)');
    // Any op other than `b` marks "nao", including `c` and an invalid letter.
    expect(sim.pedir(kk('&M99Z1234567890ABCDEF'))).toBe('(M99)');
    expect(sim.conc.estaNaListaNegra('1234567890ABCDEF')).toBe(false);
    expect(sim.pedir(kk('&M99b1234567890abcdef'))).toBe('(M?f)');
    // The short form replies (M99) and touches nothing (empty routine).
    sim.pedir('(&M99b1234567890ABCDEFE9)');
    expect(sim.pedir('(&M99c48)')).toBe('(M99)');
    expect(sim.conc.estaNaListaNegra('1234567890ABCDEF')).toBe(true);
    // The marked card is refused at the reader.
    expect(sim.conc.apresentarCartao(1, 1, '1234567890ABCDEF')).toMatchObject({ aceito: false, motivo: 'listaNegra' });
  });

  it('perfis reais: lista própria de 20, só com BB 99', () => {
    const { sim } = criar('cbc-32');
    expect(sim.pedir('(&M99b1234567890ABCDEFE9)')).toBe('(M99)');
    expect(sim.conc.listaNegra).toEqual(['1234567890ABCDEF']);
    expect(sim.pedir('(&M12b1234567890ABCDEFDA)')).not.toBe('(M99)');
  });
});

describe('#43/#36/#45: &C e &CH', () => {
  it('reduzir não desativa; reenviar reinicia preço; n=0 zera encerrantes e o &R segue listando', () => {
    const { sim } = criar('simulador-2.7.2');
    sim.pedir('(&CW013A010400BA)');
    sim.pedir('(&CW013A010200B8)');
    expect(sim.pedir('(&TC4L3D)')).toBe('(TLC40000000097)');
    expect(sim.pedir(kk('&U04005899'))).toBe('(U04)');
    sim.pedir('(&CW013A010200B8)');
    expect(sim.pedir(kk('&T04U'))).toBe(kk('TU0400001123'));
    sim.pedir('(&E0400001234)');
    sim.conc.bico(0x04)!.status = 'B';
    sim.conc.ladoDoBico(sim.conc.bico(0x04)!).bloqueado = true;
    sim.pedir('(&CW013A010200B8)');
    expect([sim.conc.bico(0x04)!.status, sim.conc.ladoDoBico(sim.conc.bico(0x04)!).bloqueado]).toEqual(['L', false]);
    sim.pedir('(&CW013A010000B6)');
    expect(sim.pedir('(&R)')).toContain('(C01W3A010000)');
    sim.pedir('(&CW013A010200B8)');
    expect(sim.pedir('(&T04L2A)')).toBe('(TL040000000084)');
  });

  it('&CH = &C com tipo H (não existe verbo &CH); quadro curto → E6 e nada muda', () => {
    const { sim } = criar('simulador-2.7.2');
    expect(sim.pedir('(&CH013A010200A9)')).toBeNull();
    expect(sim.pedir('(&F)')).toMatch(/^\(FRH61RW61/);
    expect(sim.pedir(kk('&CH02'))).toBeNull();
    expect(sim.conc.eventos.at(-1)?.texto).toBe(`Erro na configuração: ${kk('&CH02')}`);
  });

  it('perfis reais: reduzir desativa e n=0 mantém o encerrante (como antes)', () => {
    const { sim } = criar('cbc-32');
    sim.pedir('(&CW013A010400BA)');
    sim.pedir('(&CW013A010200B8)');
    expect(sim.pedir('(&TC4L3D)')).toBeNull();
  });
});

describe('#44: &c', () => {
  it('copia os 3 campos de 2 chars para o bico (B: bb, cc, tt do PAF) e não responde', () => {
    const { sim } = criar('simulador-2.7.2');
    expect(sim.pedir('(&c00411223349)')).toBeNull();
    const b = sim.conc.bico(0x04)!;
    // Bench diff r4b (EQUIV-COMANDOS #44): the PAF prints `113322`, so cmd[8..9] is where the PAF
    // prints the tank and cmd[10..11] the fuel (the labels are B; the byte order is measured).
    expect([b.numeroPista, b.combustivel, b.tanque]).toEqual([11, 33, 22]);
    expect(criar('cbc-32').sim.pedir('(&c00411223349)')).toBeNull();
  });
});

describe('#42: &E', () => {
  it('((TL…KK) com o KK somando o `(`, litros inteiros, registro e resposta sem bico', () => {
    const { sim } = criar('simulador-2.7.2');
    expect(sim.pedir('(&A)')).toBe('(0)');
    expect(sim.pedir('(&E0400001234)')).toBe('((TL0400001234B6)');
    expect(sim.pedir('(&T04L2A)')).toBe(kk('TL0400123400'));
    expect(sim.pedir('(&A)')).not.toBe('(0)');
    sim.pedir('(&I)');
    // The same value again: does not change, does not store.
    sim.pedir('(&E0400001234)');
    expect(sim.pedir('(&A)')).toBe('(0)');
    expect(sim.pedir('(&E7700001234)')).toBe('((TL7700001234C0)');
    expect(sim.pedir('(&E04000012X4)')).toBeNull();
    // Bench diff r4b: "'000012X4' is not a valid floating point value."
    expect(sim.conc.eventos.at(-1)?.texto).toBe("'000012X4' is not a valid floating point value.");
  });

  it('sem E_272: (TL…) com 2 casas e sem registro (como antes); os perfis reais nem têm o &E', () => {
    const { sim } = criar('simulador-2.7.2');
    sim.conc.quirks.E_272 = false;
    expect(sim.pedir('(&E0400001234)')).toBe(kk('TL0400001234'));
    expect(sim.pedir('(&A)')).toBe('(0)');
    expect(criar('cbc-32').sim.pedir('(&E0400001234)')).toBeNull();
  });
});

describe('#33/#34: &U 14 e 16', () => {
  it('&U 14 nível inválido → modal e (U04) depois do OK, sem mudar o preço; preço não numérico → E8', () => {
    const { sim } = criar('simulador-2.7.2');
    const antes = [...sim.conc.bico(0x04)!.precosPendentes];
    expect(sim.pedir('(&U0420058917)')).toBe('(U04)');
    expect(sim.conc.bico(0x04)!.precosPendentes).toEqual(antes);
    expect(sim.pedir(kk('&U04005X99'))).toBeNull();
    expect(sim.conc.eventos.at(-1)?.texto).toBe("'5,X99' is not a valid floating point value.");
  });

  it('&U 16: preço em cmd[9..12]; com vírgula 2x o nível 1/2 cai no 0; nível inválido → (U?t) depois do OK', () => {
    const { sim } = criar('simulador-2.7.2');
    sim.pedir('(&CW012A010200B7)');
    const nivel1 = sim.conc.precoConfigurado(sim.conc.bico(0x04)!, 1);
    expect(sim.pedir('(&U04100012346A)')).toBe('(U04)');
    expect(sim.pedir('(&T04u53)')).toBe(kk('TU04' + String(nivel1).padStart(4, '0') + '1234' + '0000'));
    expect(sim.pedir(kk('&U0430000012'))).toBe('(U?t)');
    // comma 3A: the level applies and the price comes from the last 4 digits (cmd[7..8] ignored).
    expect(sim.pedir(kk('&U0510992345'))).toBe('(U05)');
    expect(sim.conc.bico(0x05)!.precosPendentes[1]).toBe(2345);
  });

  it('perfis reais: nível inválido mudo, sem modal; o de 16 lê 6 dígitos', () => {
    const { sim } = criar('cbc-32');
    expect(sim.pedir('(&U0420058917)')).toBeNull();
    expect(sim.pedir(kk('&U0410001234'))).toBe('(U04)');
    expect(sim.conc.bico(0x04)!.precosPendentes[1]).toBe(1234);
  });
});

describe('#8 + E3: o modal não cala o socket; a resposta do ShowMessage sai no OK', () => {
  it('modal até liberar: outros quadros respondem; o (U04) sai no OK', async () => {
    const { sim } = criar('simulador-2.7.2');
    sim.conc.travamentoMs = null;
    const r = sim.processarQuadro('(&U0420058917)');
    expect(r.resposta).toBeNull();
    let depois: string | null = null;
    void r.adiada?.then((t) => (depois = t));
    expect(sim.pedir('(&S)')).toMatch(/^\(S/);
    expect(sim.pedir('>?000B32022001500XX')).toBeNull();
    await new Promise((res) => setImmediate(res));
    expect(depois).toBeNull();
    sim.conc.liberarTravamento();
    await new Promise((res) => setImmediate(res));
    expect(depois).toBe('(U04)');
  });

  it('roteiro EQUIV-COMANDOS: pump-sim × pump-sim sem divergência e os `esperado` conferem', async () => {
    const hubs: Hub[] = [];
    const relogios: Record<string, { clock: ManualClock; tick: () => void }> = {};
    const alvo = async (nome: string) => {
      const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
      const hub = new Hub({ clock, host: '127.0.0.1', mapa: { 2001: 0, 1771: 0, 7002: 0 } });
      hubs.push(hub);
      const rt = await hub.criar('default', 'simulador-2.7.2');
      relogios[nome] = { clock, tick: () => rt.tick() };
      return { nome, alvo: { host: '127.0.0.1', porta: rt.servidor!.portas()[0]!.fisica }, controle: nome };
    };
    fechar.push(async () => {
      for (const h of hubs) await h.fechar();
    });
    const a = await alvo('A');
    const b = await alvo('B');
    const porNome: Record<string, Hub> = { A: hubs[0]!, B: hubs[1]! };
    const rel = await executarDiff(selecionarRoteiros('EQUIV-COMANDOS'), a, b, {
      timeoutMs: 150,
      ociosoMs: 30,
      chamarControle: (url, c, args) => executarComando(porNome[url]!, c, args),
      esperar: async (ms, x) => {
        const r = relogios[x.nome]!;
        r.clock.advance(ms);
        r.tick();
      },
    });
    const caso = rel.casos[0]!;
    expect(caso.pulados).toEqual([]);
    expect(caso.acoes.filter((x) => !x.ok).map((x) => `${x.alvo} ${x.passo}: ${x.erro}`)).toEqual([]);
    expect(caso.passos.filter((p) => p.aConfere === false).map((p) => `${p.quadro} → ${p.a.texto}`)).toEqual([]);
    expect(rel.total.casosComDivergencia).toEqual([]);
    const txt = (q: string) => caso.passos.filter((p) => p.quadro === q).map((p) => p.a.texto);
    // §18: no pump-sim-only hold any more; the (U04) of the OK comes in its own step, as on the bench.
    expect(txt('(&U0420058917)')[0]).toBe('(U04)');
    expect(txt(kk('&T04U'))[1]).toMatch(/^\(TU04/);
    expect(txt('(&TC4L3D)')[0]).toBe('(TLC40000000097)');
  }, 40_000);
});

describe('StrToFloat do Delphi (pt-BR)', () => {
  it('vírgula decimal, espaços e sinal; ponto ou letra → null', () => {
    expect([strToFloatDelphi('05,89'), strToFloatDelphi(' 5,890'), strToFloatDelphi('-1,5'), strToFloatDelphi('00001234')]).toEqual([5.89, 5.89, -1.5, 1234]);
    expect([strToFloatDelphi('5.89'), strToFloatDelphi('1,11F'), strToFloatDelphi(','), strToFloatDelphi('')]).toEqual([null, null, null, null]);
  });
});

const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});
