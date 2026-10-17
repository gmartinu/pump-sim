/**
 * 2.7.2 × pump-sim equivalence, the per-nozzle block and dispatch round: the
 * DIFERENTE / SÓ NO 2.7.2 rows of the behavioral-equivalence verdict that slices 1–3 left out
 * (#3, #5, #7, #10, #18, #21, #24, #25, #29, #31, #51, #52, #55, #59, #78). For each row:
 * the verdict's frame with the expected reply on the `simulador-2.7.2` profile and, next to it, the same
 * frame on `cbc-32`, which follows the manual (the cbc-32 literals are what it replied BEFORE
 * the round and must not change). A red test here is a production defect, not a test defect.
 * At the end: the `acao` steps of the whole script against a fake driver (an HTTP server that mimics
 * the bench driver's `POST /acao`).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Hub,
  ManualClock,
  acaoParaPumpSim,
  clicarBotaoPainel,
  estadoUiInicial,
  executarComando,
  executarDiff,
  selecionarRoteiros,
  type AlvoDiff,
  type PassoAcao,
  type PerfilId,
} from '../src/index.js';
import { criar, kk } from './golden-util.js';
import { passo } from './util.js';

const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

type Sim = ReturnType<typeof criar>['sim'];
type Clock = ReturnType<typeof criar>['clock'];
const novo272 = () => criar('simulador-2.7.2');
const novoCbc32 = () => criar('cbc-32');

/** Nozzle volume in &V (hundredths of a liter), or null if the nozzle does not show. */
function volumeV(v: string | null, bb: string): number | null {
  const corpo = (v ?? '').slice(1, -1);
  for (let i = 0; i + 8 <= corpo.length; i += 8) if (corpo.slice(i, i + 2) === bb) return Number(corpo.slice(i + 2, i + 8));
  return null;
}
const letraS = (sim: Sim) => (sim.pedir('(&S)') ?? '').slice(2, 3);

/** Lifts 04, waits 3 s and returns the letter of the 1st nozzle and the volume of 04 in &V. */
function retirarEMedir(sim: Sim, clock: Clock) {
  sim.conc.retirarBico(0x04);
  passo(sim, clock, 3000);
  return { letra: letraS(sim), vol: volumeV(sim.pedir('(&V)'), '04') };
}

describe('os quadros do veredito têm o KK certo', () => {
  it('KK conferido pelo checksum do próprio simulador', () => {
    expect([kk('&M04B'), kk('&M04A'), kk('&M04H'), kk('&M04L'), kk('&M3FZ'), kk('&T04L'), kk('?C001010000'), kk('?D')]).toEqual([
      '(&M04B19)',
      '(&M04A18)',
      '(&M04H1F)',
      '(&M04L23)',
      '(&M3FZ46)',
      '(&T04L2A)',
      '(?C00101000034)',
      '(?D83)',
    ]);
  });
});

describe('#3: 1º caractere livre (só o `&` na 2ª posição)', () => {
  it('2.7.2: `X&S)` responde o &S', () => {
    const { sim } = novo272();
    const r = sim.pedir('X&S)');
    expect(r).not.toBeNull();
    expect(r).toMatch(/^\(S[LF]{32}/);
    expect(r).toBe(sim.pedir('(&S)'));
  });
  it('cbc-32: segue mudo', () => {
    expect(novoCbc32().sim.pedir('X&S)')).toBeNull();
  });
});

describe('#5: `?` com 02/06/32 nas posições 7–8 vai à Horustech antes de ?F/?C/?LF', () => {
  it('2.7.2: `(?LF000697)` → `>!…06…`; `(?C00102000035)` → `>!…02…`', () => {
    const { sim } = novo272();
    const lf = sim.pedir('(?LF000697)');
    expect(lf).not.toBeNull();
    expect(lf).toMatch(/^>!/);
    expect(lf!.slice(2, 10)).toContain('06');
    const c = sim.pedir('(?C00102000035)');
    expect(c).not.toBeNull();
    expect(c).toMatch(/^>!/);
    expect(c!.slice(2, 10)).toContain('02');
  });
  it('2.7.2: o `?C` desviado não configura o endereço (o sensor do IDF segue desligado)', () => {
    const { sim } = novo272();
    sim.pedir('(?C00102000035)');
    expect(sim.conc.lado(1, 1)!.sensorIdf).toBeFalsy();
  });
  it('cbc-32: os dois quadros seguem sem resposta', () => {
    const { sim } = novoCbc32();
    expect(sim.pedir('(?LF000697)')).toBeNull();
    expect(sim.pedir('(?C00102000035)')).toBeNull();
  });
});

describe('#7: `>!` no CBC-06 é ERRO CMD (só o `>?` entra)', () => {
  it('2.7.2 (CBC-06): `>!000202` fica mudo', () => {
    expect(novo272().sim.pedir('>!000202')).toBeNull();
  });
  it('cbc-32: segue mudo', () => {
    expect(novoCbc32().sim.pedir('>!000202')).toBeNull();
  });
});

describe('#6: com o modelo Horustech o ramo `?` aceita qualquer quadro', () => {
  it('2.7.2: modelo Horustech responde `>!000202` (no CBC-06 fica mudo, #7)', () => {
    const { sim } = novo272();
    sim.conc.setModelo('Horustech');
    expect(sim.pedir('>!000202')).toMatch(/^>!/);
  });
  it('perfis reais: cbc-32 com modelo Horustech segue mudo para o mesmo quadro', () => {
    const { sim } = novoCbc32();
    sim.conc.setModelo('Horustech');
    expect(sim.pedir('>!000202')).toBeNull();
  });
});

describe('#18: &T L sem cortar os dígitos', () => {
  it('2.7.2: encerrante 1234567 L → `TL04123456700` (9 dígitos)', () => {
    const { sim } = novo272();
    expect(sim.pedir('(&E0401234567)')).toBe('((TL0401234567C8)');
    expect(sim.pedir('(&T04L2A)')).toBe(kk('TL04123456700'));
  });
  it('cbc-32: o &E não existe e o &T L segue zerado', () => {
    const { sim } = novoCbc32();
    expect(sim.pedir('(&E0401234567)')).toBeNull();
    expect(sim.pedir('(&T04L2A)')).toBe('(TL040000000084)');
  });
});

describe('#21: &T num bico desconfigurado (n=0) mantém o código BB e responde TL com 0', () => {
  it('2.7.2: `(&CW013A010000B6)` e `(&T04L2A)` → `TL0400000000`', () => {
    const { sim } = novo272();
    sim.pedir('(&CW013A010000B6)');
    expect(sim.pedir('(&T04L2A)')).toBe(kk('TL0400000000'));
  });
  it('cbc-32: segue o que respondia (`TL` com 0 e o &R sem a linha C)', () => {
    const { sim } = novoCbc32();
    expect(sim.pedir('(&CW013A010000B6)')).toBeNull();
    expect(sim.pedir('(&T04L2A)')).toBe('(TL040000000084)');
    expect(sim.pedir('(&R)')).toBe('(REL 16:40:10 12/02/20)');
  });
});

describe('#31: &M com modo inválido fica mudo, mesmo com bico inexistente', () => {
  it('2.7.2: `(&M3FZ46)` → mudo', () => {
    expect(novo272().sim.pedir('(&M3FZ46)')).toBeNull();
  });
  it('cbc-32: `(M?b)` como antes', () => {
    expect(novoCbc32().sim.pedir('(&M3FZ46)')).toBe('(M?b)');
  });
});

describe('#52/#51: `?C` liga o sensor e o bloqueio; `?D` pelo status do bico 1', () => {
  it('2.7.2: `(?C00101000034)` → `&S` mostra B no 1º bico e `(?D83)` → `RI01FF`', () => {
    const { sim } = novo272();
    sim.pedir('(?C00101000034)');
    expect(letraS(sim)).toBe('B');
    expect(sim.pedir('(?D83)')).toContain('RI01FF');
  });
  it('cbc-32: o `?C` só liga o sensor (o bico fica L e o `?D` não responde)', () => {
    const { sim } = novoCbc32();
    expect(sim.pedir('(?C00101000034)')).toBeNull();
    expect(letraS(sim)).toBe('L');
    expect(sim.pedir('(?D83)')).toBeNull();
  });
});

describe('#55: ?F L basta o KK', () => {
  it('2.7.2: `(?F00L31)` limpa, fica mudo e não trava em modal (bancada diff r4b, EQUIV-PENDENTES)', () => {
    // Bench diff r4b (17/10, real 2.7.2): `(?F00L31)` on a fresh state → no reply in 1.5 s and the
    // socket keeps answering. The old `not.toBeNull()` contradicted it (§17 "Stopped", §18).
    const { sim } = novo272();
    expect(sim.pedir('(?F01G1234567890ABCDEF0000000000000000CF)')).not.toBeNull();
    expect(sim.pedir('(?F00L31)')).toBeNull();
    expect(sim.conc.estaTravado()).toBe(false);
    expect(sim.conc.cartoes.quantidade).toBe(0);
    expect(sim.pedir('(&S)')).toMatch(/^\(S/);
  });
  it('cbc-32: segue mudo', () => {
    expect(novoCbc32().sim.pedir('(?F00L31)')).toBeNull();
  });
});

describe('#59: Horustech 32 sem bico na tabela fica mudo', () => {
  it('2.7.2: `>?000B320300011112D` → mudo', () => {
    expect(novo272().sim.pedir('>?000B320300011112D')).toBeNull();
  });
  it('cbc-32: segue mudo', () => {
    expect(novoCbc32().sim.pedir('>?000B320300011112D')).toBeNull();
  });
});

describe('#24: &M A num bico em E zera o bloqueio e pré-autoriza', () => {
  const fluxo = (sim: Sim, clock: Clock) => {
    sim.pedir('(&M04B19)');
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 1000);
    sim.pedir('(&M04A18)');
    sim.conc.recolocarBico(0x04);
    passo(sim, clock, 2500);
    return retirarEMedir(sim, clock);
  };
  it('2.7.2: `(&M04B19)`, retirar, `(&M04A18)`, recolocar, retirar → abastece', () => {
    const { sim, clock } = novo272();
    const r = fluxo(sim, clock);
    expect(r.letra).toBe('A');
    expect(r.vol).toBeGreaterThan(0);
  });
  it('cbc-32: o mesmo fluxo abastece como antes', () => {
    const { sim, clock } = novoCbc32();
    const r = fluxo(sim, clock);
    expect(r.letra).toBe('A');
    expect(r.vol).toBeGreaterThan(0);
  });
});

describe('#25: &M L zera o bloqueio, o sensor não bloqueia', () => {
  it('2.7.2: `(&M04H1F)`, `(&M04L23)`, retirar → abastece', () => {
    const { sim, clock } = novo272();
    sim.pedir('(&M04H1F)');
    sim.pedir('(&M04L23)');
    const r = retirarEMedir(sim, clock);
    expect(r.letra).toBe('A');
    expect(r.vol).toBeGreaterThan(0);
  });
  it('cbc-32: o sensor ainda bloqueia (E, sem volume)', () => {
    const { sim, clock } = novoCbc32();
    sim.pedir('(&M04H1F)');
    sim.pedir('(&M04L23)');
    expect(retirarEMedir(sim, clock)).toEqual({ letra: 'E', vol: null });
  });
});

describe('#29: &M H/I só mexe no sensor; o bloqueio sobe no início do abastecimento', () => {
  it('2.7.2: `(&M04H1F)`, retirar → abastece', () => {
    const { sim, clock } = novo272();
    sim.pedir('(&M04H1F)');
    const r = retirarEMedir(sim, clock);
    expect(r.letra).toBe('A');
    expect(r.vol).toBeGreaterThan(0);
  });
  it('cbc-32: o sensor bloqueia na hora (E, sem volume)', () => {
    const { sim, clock } = novoCbc32();
    sim.pedir('(&M04H1F)');
    expect(retirarEMedir(sim, clock)).toEqual({ letra: 'E', vol: null });
  });
});

describe('#10: CBC-02 não escreve o caractere 39 do &S', () => {
  const tipo = (sim: Sim) => /DD(\d)V/.exec(sim.pedir('(&S)') ?? '')?.[1];
  it('2.7.2: CBC-06 → CBC-02 mantém o dígito anterior (6)', () => {
    const { sim } = novo272();
    expect(tipo(sim)).toBe('6');
    sim.conc.setModelo('CBC-02');
    expect(tipo(sim)).toBe('6');
  });
  it('cbc-32: o dígito é o do perfil e não muda com o Modelo (6, como antes)', () => {
    const { sim } = novoCbc32();
    sim.conc.setModelo('CBC-02');
    expect(tipo(sim)).toBe('6');
  });
});

describe('#78: Default config zera os ponteiros de escrita e de leitura', () => {
  const abastecerUm = (sim: Sim, clock: Clock) => {
    sim.conc.retirarBico(0x04);
    passo(sim, clock, 3000);
    sim.conc.recolocarBico(0x04);
    passo(sim, clock, 2500);
  };
  it('2.7.2: abastece, Default config, `(&A)` → `(0)`', () => {
    const { sim, clock } = novo272();
    abastecerUm(sim, clock);
    expect(sim.pedir('(&A)')).not.toBe('(0)');
    sim.conc.carregarConfigPadrao();
    expect(sim.pedir('(&A)')).toBe('(0)');
  });
  it('cbc-32: o registro continua lá depois da config padrão', () => {
    const { sim, clock } = novoCbc32();
    abastecerUm(sim, clock);
    sim.conc.carregarConfigPadrao();
    expect(sim.pedir('(&A)')).not.toBe('(0)');
  });
});

/** Fake driver: HTTP server with the contract `POST /acao {tipo, ...params}` → `{ok, erro?, detalhe?, modais_fechados?}`. */
async function driverFalso(perfil: PerfilId = 'simulador-2.7.2') {
  const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
  const hub = new Hub({ clock, host: '127.0.0.1', mapa: { 2001: 0, 1771: 0, 857: 0, 7002: 0 } });
  fechar.push(() => hub.fechar());
  const rt = await hub.criar('default', perfil);
  const ui = estadoUiInicial();
  const recebidas: Record<string, unknown>[] = [];
  const srv = http.createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (d: Buffer) => partes.push(d));
    req.on('end', () => {
      const responder = (status: number, corpo: object) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(corpo));
      };
      void (async () => {
        if (req.method !== 'POST' || req.url !== '/acao') return responder(404, { ok: false, erro: 'rota desconhecida' });
        const corpo = JSON.parse(Buffer.concat(partes).toString('utf8')) as { tipo?: string } & Record<string, unknown>;
        recebidas.push(corpo);
        const { tipo, ...params } = corpo;
        try {
          for (const it of acaoParaPumpSim({ acao: tipo as PassoAcao['acao'], params }, ui)) {
            if ('aguardar' in it) {
              clock.advance(it.aguardar);
              rt.tick();
            } else if ('botao' in it) {
              await clicarBotaoPainel(
                it.botao,
                (c, a) => executarComando(hub, c, a),
                async (ms) => {
                  clock.advance(ms);
                  rt.tick();
                },
              );
            } else await executarComando(hub, it.comando, it.args);
          }
          responder(200, { ok: true, detalhe: null, modais_fechados: [] });
        } catch (e) {
          responder(400, { ok: false, erro: e instanceof Error ? e.message : String(e) });
        }
      })();
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  fechar.push(() => new Promise<void>((r) => srv.close(() => r())));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const alvo: AlvoDiff = { nome: 'A', alvo: { host: '127.0.0.1', porta: rt.servidor!.portas()[0]!.fisica }, driver: url };
  return { hub, rt, clock, alvo, url, recebidas };
}

async function alvoPumpSim(perfil: PerfilId = 'simulador-2.7.2') {
  const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
  const hub = new Hub({ clock, host: '127.0.0.1', mapa: { 2001: 0, 1771: 0, 857: 0, 7002: 0 } });
  fechar.push(() => hub.fechar());
  const rt = await hub.criar('default', perfil);
  const alvo: AlvoDiff = { nome: 'B', alvo: { host: '127.0.0.1', porta: rt.servidor!.portas()[0]!.fisica }, controle: 'B' };
  return { hub, rt, clock, alvo };
}

describe('passos de ação do diff contra o driver falso (HTTP)', () => {
  const casos = () =>
    selecionarRoteiros('todos', { diff17N: 2 }).filter(
      (c) => c.passos.some((p) => 'acao' in p) && !c.passos.some((p) => 'enviar' in p && p.porta !== undefined) &&
        // IDF/card and the synthetic modal have no driver (side A skips the step and the targets diverge by construction).
        !c.passos.some((p) => ('semDriver' in p && p.semDriver) || ('soPumpSim' in p && p.soPumpSim)),
    );

  it('o roteiro tem casos com ação e cada tipo usado chega ao driver como {tipo, ...params}', () => {
    expect(casos().length).toBeGreaterThan(5);
  });

  it('todo caso com ação: o driver falso (A) e a API do pump-sim (B) respondem igual, sem ação falha e sem pulo', async () => {
    const a = await driverFalso();
    const b = await alvoPumpSim();
    const lista = casos();
    const rel = await executarDiff(lista, a.alvo, b.alvo, {
      timeoutMs: 120,
      ociosoMs: 30,
      chamarControle: (_u, c, args) => executarComando(b.hub, c, args),
      esperar: async (ms, x) => {
        const t = x.nome === 'A' ? a : b;
        t.clock.advance(ms);
        t.rt.tick();
      },
    });
    expect(rel.casos.map((c) => c.id)).toEqual(lista.map((c) => c.id));
    for (const c of rel.casos) {
      expect(c.acoes.filter((x) => !x.ok).map((x) => `${c.id} ${x.alvo} ${x.passo}: ${x.erro}`)).toEqual([]);
      expect(c.pulados.filter((p) => !/IDF|sem /.test(p.texto)).map((p) => `${c.id} ${p.texto}`)).toEqual([]);
      expect(c.divergencias, c.id).toBe(0);
    }
    // Every script action reached the driver, in order, with the contract body.
    const esperadas = lista.flatMap((c) => c.passos.filter((p): p is PassoAcao => 'acao' in p).map((p) => ({ tipo: p.acao, ...(p.params ?? {}) })));
    expect(a.recebidas).toEqual(esperadas);
  }, 120_000);

  it('ação desconhecida: o driver falso devolve 400 {ok:false} e o relatório marca a ação como falha', async () => {
    const a = await driverFalso();
    const b = await alvoPumpSim();
    const caso = { id: 'X', titulo: 'x', resolve: 'x', passos: [{ acao: 'nao_existe' as PassoAcao['acao'] }, { enviar: '(&V)' }] };
    const rel = await executarDiff([caso], a.alvo, b.alvo, {
      timeoutMs: 120,
      ociosoMs: 30,
      chamarControle: (_u, c, args) => executarComando(b.hub, c, args),
    });
    const falhas = rel.casos[0]!.acoes.filter((x) => !x.ok);
    expect(falhas.map((x) => x.alvo)).toContain('A');
    expect(rel.casos[0]!.passos[0]!.a.texto).toBe('(0)');
  }, 20_000);
});
