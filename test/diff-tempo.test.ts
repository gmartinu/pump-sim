/**
 * Diff wall time (docs/DECISIONS.md §25): the reply ends on its protocol frame instead of a 150 ms
 * idle tail, steps the bench recorded as silent wait 400 ms instead of 1 s, and `drenar` has no idle
 * tail on `(&A)` and a short gap after `(&I)`. None of it changes what is sent or compared, so the
 * recorded 2.7.2 oracle is the check: every flagged silence is a recorded silence, and no recorded
 * reply is complete before its last byte.
 */
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AlvoDiff,
  type CasoDiff,
  type ConexaoTroca,
  type OpcoesTroca,
  type ResultadoTroca,
  ClienteTcp,
  Hub,
  INTERVALO_DRENAR_MS,
  ManualClock,
  ROTEIROS,
  TIMEOUT_SILENCIO_PADRAO_MS,
  executarComando,
  executarDiff,
  fimDaResposta,
  hashRoteiro,
  lerOraculo,
  roteiro,
  silencioEsperado,
} from '../src/index.js';

const oraculo = lerOraculo('test/fixtures/oracle-2.7.2');
const fechar: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of fechar.splice(0).reverse()) await f();
});

const quadroDe = (p: { enviar: string | string[] }) => (Array.isArray(p.enviar) ? p.enviar.join('') : p.enviar);

/** Each `enviar` step of a case with its index among the `enviar` steps and its recording (when the frames line up). */
function passosComGravacao(c: CasoDiff) {
  const f = oraculo.casos.get(c.id);
  let n = -1;
  return c.passos.flatMap((p, i) => {
    if (!('enviar' in p)) return [];
    n++;
    const g = f?.passos[n];
    return [{ i, p, quadro: quadroDe(p), gravado: g && g.quadro === quadroDe(p) ? g : undefined }];
  });
}

describe('fim da resposta pelo quadro', () => {
  const tem = (q: string, rx: string) => fimDaResposta(q)!(Buffer.from(rx, 'latin1'));

  it('Companytec e Identfid: completa no `)`, nunca antes', () => {
    expect(tem('(&S)', '(SLLFF')).toBe(false);
    expect(tem('(&S)', '(SLLFF)')).toBe(true);
    expect(tem('(&E0400001234)', '((TL0400001234B6)')).toBe(true);
    expect(tem('(?S92)', '(?S')).toBe(false);
    expect(tem(['(&S', ')'].join(''), '(S…)')).toBe(true);
    expect(tem('(&S)\r\n', '(S…)')).toBe(true);
  });

  it('Horustech: completa em >! + tamanho L + L + KK; cabeçalho não hex fica no silêncio ocioso', () => {
    expect(tem('>?000B320200011112C', '>!00043200AA')).toBe(true);
    expect(tem('>?000B320200011112C', '>!00043200A')).toBe(false);
    expect(tem('>?000B320200011112C', '>!00043200AA\r\n')).toBe(false);
    expect(tem('>?00020263', '>!00ZZ')).toBe(false);
  });

  it('&R (vários grupos) e envio com dois quadros mantêm a cauda ociosa', () => {
    expect(fimDaResposta('(&R)')).toBeUndefined();
    expect(fimDaResposta('(&R')).toBeUndefined();
    expect(fimDaResposta('(&S)(&V)')).toBeUndefined();
    expect(fimDaResposta('lixo')).toBeUndefined();
  });

  it('nenhuma resposta gravada do 2.7.2 fica completa antes do último byte (o corte nunca encurta)', () => {
    let conferidas = 0;
    for (const c of oraculo.casos.values()) {
      for (const p of c.passos) {
        const fim = fimDaResposta(p.quadro);
        if (!fim || p.a === null) continue;
        const b = Buffer.from(p.a, 'latin1');
        expect(fim(b), `${c.caso} ${p.quadro}: ${p.a}`).toBe(true);
        for (let n = 1; n < b.length; n++) expect(fim(b.subarray(0, n)), `${c.caso} ${p.quadro}: prefixo ${n}`).toBe(false);
        conferidas++;
      }
    }
    expect(conferidas).toBeGreaterThan(1000);
  });
});

describe('silêncio esperado', () => {
  it('flag ou esperado null; timeout próprio ou fechar_modais depois mantêm o timeout cheio', () => {
    const passos: CasoDiff['passos'] = [
      { enviar: '(&X)', silencio: true },
      { enviar: '(&I6F)', esperado: null },
      { enviar: '(&T04L00)', esperado: null, timeoutMs: 1500 },
      { enviar: '(&E04000012X4)', esperado: null },
      { acao: 'fechar_modais' },
      { enviar: '(&S)' },
    ];
    expect(passos.map((_, i) => silencioEsperado(passos, i))).toEqual([true, true, false, false, false, false]);
  });

  it('todo passo do roteiro com silêncio esperado tem silêncio gravado na bancada, sem modal', () => {
    const marcados: string[] = [];
    for (const c of ROTEIROS) {
      for (const x of passosComGravacao(c)) {
        if (!silencioEsperado(c.passos, x.i)) continue;
        if ('silencio' in x.p && x.p.silencio) expect(x.gravado, `${c.id} ${x.quadro}: sem gravação alinhada`).toBeDefined();
        if (!x.gravado) continue;
        expect(x.gravado.a, `${c.id} #${x.gravado.indice} ${x.quadro}`).toBeNull();
        expect(x.gravado.modais, `${c.id} ${x.quadro}`).toBeUndefined();
        marcados.push(`${c.id} ${x.quadro}`);
      }
    }
    // 45 `silencio` flags + the `esperado: null` steps whose recording lines up (60 shortened steps in the default run).
    expect(marcados.length).toBeGreaterThanOrEqual(50);
  });

  it('a flag fica fora do hash do roteiro (a gravação continua valendo)', () => {
    const base = roteiro('DIFF-03')!;
    const c = structuredClone(base);
    for (const p of c.passos) if ('enviar' in p) p.silencio = !p.silencio;
    expect(hashRoteiro(c)).toBe(hashRoteiro(base));
    expect(hashRoteiro(base)).toBe(oraculo.casos.get('DIFF-03')!.roteiroHash);
  });
});

/** Raw TCP server that answers each received chunk with `responder`. */
async function servidorBruto(responder: (rx: string, s: net.Socket) => void): Promise<number> {
  const sv = net.createServer((s) => s.on('data', (b) => responder(b.toString('latin1'), s)));
  await new Promise<void>((r) => sv.listen(0, '127.0.0.1', r));
  fechar.push(() => new Promise<void>((r) => sv.close(() => r())));
  return (sv.address() as net.AddressInfo).port;
}

describe('ClienteTcp: fim pelo quadro e bytes atrasados', () => {
  it('termina no quadro completo sem esperar o ocioso, e espera o resto de um quadro partido', async () => {
    const porta = await servidorBruto((rx, s) => {
      if (rx === '(&S)') s.write('(SLL)');
      if (rx === '(&V)') {
        s.write('(04');
        setTimeout(() => s.write('0000)'), 80);
      }
    });
    const c = await ClienteTcp.conectar({ host: '127.0.0.1', porta });
    fechar.push(() => c.fechar());
    const t0 = performance.now();
    const r = await c.trocar(['(&S)'], { ociosoMs: 2000, completo: fimDaResposta('(&S)') });
    expect(r.bytes.toString('latin1')).toBe('(SLL)');
    expect(performance.now() - t0).toBeLessThan(1000);
    const v = await c.trocar(['(&V)'], { ociosoMs: 2000, completo: fimDaResposta('(&V)') });
    expect(v.bytes.toString('latin1')).toBe('(040000)');
  });

  it('o que chega depois de uma resposta encerrada sai como `atrasados` na troca seguinte', async () => {
    const porta = await servidorBruto((rx, s) => {
      if (rx === '(&R)') s.write('(REL)');
      if (rx === '(&U)') {
        s.write('(U04)');
        setTimeout(() => s.write('(extra)'), 30);
      }
      if (rx === '(&S)') s.write('(SLL)');
    });
    const c = await ClienteTcp.conectar({ host: '127.0.0.1', porta });
    fechar.push(() => c.fechar());
    const u = await c.trocar(['(&U)'], { completo: fimDaResposta('(&U)') });
    expect(u.bytes.toString('latin1')).toBe('(U04)');
    expect(u.atrasados).toBeUndefined();
    await new Promise((r) => setTimeout(r, 100));
    const s = await c.trocar(['(&S)'], { completo: fimDaResposta('(&S)') });
    expect(s.bytes.toString('latin1')).toBe('(SLL)');
    expect(s.atrasados?.toString('latin1')).toBe('(extra)');
  });
});

describe('executor: tempo de parede', () => {
  async function alvo(nome: string) {
    const clock = new ManualClock(Date.UTC(2026, 9, 16, 14, 30, 0));
    const hub = new Hub({ clock, host: '127.0.0.1', mapa: { 2001: 0 } });
    fechar.push(() => hub.fechar());
    const rt = await hub.criar('default', 'simulador-2.7.2');
    const a: AlvoDiff = { nome, alvo: { host: '127.0.0.1', porta: rt.servidor!.fisica(2001)! }, controle: nome };
    return { hub, alvo: a };
  }

  it('silêncio esperado espera timeoutSilencioMs; o resto, timeoutMs; respostas sem cauda de 150 ms', async () => {
    const a = await alvo('A');
    const b = await alvo('B');
    const hubs: Record<string, Hub> = { A: a.hub, B: b.hub };
    const caso = (passos: CasoDiff['passos']): CasoDiff => ({ id: 'T', titulo: 't', resolve: 't', passos });
    const medir = async (c: CasoDiff) => {
      const t0 = performance.now();
      const rel = await executarDiff([c], a.alvo, b.alvo, {
        timeoutMs: 900,
        timeoutSilencioMs: 100,
        chamarControle: (url, cmd, args) => executarComando(hubs[url]!, cmd, args),
      });
      return { ms: performance.now() - t0, rel };
    };
    const mudo = await medir(caso([{ enviar: '(&X)', silencio: true }, { enviar: '(&X)', silencio: true }]));
    expect(mudo.rel.total.divergencias).toBe(0);
    expect(mudo.ms).toBeLessThan(4 * 900); // 4 × 100 ms, not 4 × 900 ms
    const cheio = await medir(caso([{ enviar: '(&X)' }]));
    expect(cheio.ms).toBeGreaterThanOrEqual(2 * 900 - 50);
    const respostas = await medir(caso(Array.from({ length: 10 }, () => ({ enviar: '(&S)', ignorarFim: 2 }))));
    expect(respostas.rel.total.divergencias).toBe(0);
    expect(respostas.ms).toBeLessThan(20 * 150); // 20 replies with the old idle tail would take ≥ 3 s
    expect(TIMEOUT_SILENCIO_PADRAO_MS).toBe(400);
  }, 20_000);
});

describe('bytes atrasados contam como divergência', () => {
  /** Fake target: answers every frame with `(ok)`; `atrasado` = late bytes reported on the 2nd exchange. */
  const conexao = (atrasado?: string): ConexaoTroca => {
    let n = 0;
    return {
      caiu: false,
      async trocar() {
        n++;
        return { bytes: Buffer.from('(ok)', 'latin1'), latenciaMs: 1, caiu: false, ...(atrasado && n === 2 ? { atrasados: Buffer.from(atrasado, 'latin1') } : {}) };
      },
      fechar() {},
      fecharRst() {},
    };
  };
  const rodar = (atrasadoA?: string, atrasadoB?: string) => {
    const caso: CasoDiff = { id: 'L', titulo: 'l', resolve: 'l', passos: [{ enviar: '(&S)' }, { enviar: '(&V)' }] };
    const alvoFalso = (nome: string, c: ConexaoTroca): AlvoDiff => ({ nome, alvo: { host: 'x', porta: 1 }, driver: 'x', conectar: async () => c });
    return executarDiff([caso], alvoFalso('A', conexao(atrasadoA)), alvoFalso('B', conexao(atrasadoB)), { chamarDriver: async () => ({ ok: true }) });
  };

  it('resto de resposta só num alvo faz o passo divergir (a resposta cortada no quadro não passa calada)', async () => {
    const rel = await rodar('(extra)', undefined);
    expect(rel.casos[0]!.divergencias).toBe(1);
    expect(rel.casos[0]!.passos[1]!.igual).toBe(false);
    expect(rel.casos[0]!.passos[1]!.byte).toBe(-1);
  });

  it('o mesmo resto nos dois alvos não diverge', async () => {
    const rel = await rodar('(extra)', '(extra)');
    expect(rel.casos[0]!.divergencias).toBe(0);
  });
});

describe('drenar rápido', () => {
  /** Fake target: `n` records; the first `(&A)` after each `(&I)` is dropped once when `perde` (Q1 merge). */
  class Registros implements ConexaoTroca {
    caiu = false;
    enviados: string[] = [];
    opcoes: (OpcoesTroca | undefined)[] = [];
    private perdeuDepoisDoI = false;
    constructor(
      private n: number,
      private readonly perde: boolean,
    ) {}
    async trocar(pedacos: (string | Buffer)[], op?: OpcoesTroca): Promise<ResultadoTroca> {
      const q = pedacos.join('');
      this.enviados.push(q);
      this.opcoes.push(op);
      if (q === '(&I)') {
        this.n--;
        this.perdeuDepoisDoI = false;
        return { bytes: Buffer.alloc(0), latenciaMs: null, caiu: false };
      }
      if (this.perde && !this.perdeuDepoisDoI && this.enviados.length > 1) {
        this.perdeuDepoisDoI = true;
        return { bytes: Buffer.alloc(0), latenciaMs: null, caiu: false };
      }
      return { bytes: Buffer.from(this.n > 0 ? '(registro)' : '(0)', 'latin1'), latenciaMs: 1, caiu: false };
    }
    fechar(): void {}
    fecharRst(): void {}
  }

  const drenarCom = async (conn: Registros) => {
    const caso: CasoDiff = { id: 'D', titulo: 'd', resolve: 'd', passos: [{ drenar: true }] };
    const alvoFalso = (nome: string): AlvoDiff => ({ nome, alvo: { host: 'x', porta: 1 }, driver: 'x', conectar: async () => conn });
    const rel = await executarDiff([caso], alvoFalso('A'), alvoFalso('B'), { chamarDriver: async () => ({ ok: true }) });
    return rel.casos[0]!.acoes.filter((x) => x.passo === 'drenar');
  };

  it('um (&A) e um (&I) por registro; o (&I) só espera o intervalo curto e o (&A) fecha no `)`', async () => {
    const conn = new Registros(5, false);
    const [ra] = await drenarCom(conn);
    expect(ra).toMatchObject({ ok: true, detalhe: '5 registro(s) lido(s)' });
    expect(conn.enviados.slice(0, 11)).toEqual([...Array.from({ length: 5 }, () => ['(&A)', '(&I)']).flat(), '(&A)']);
    const i = conn.opcoes[1]!;
    expect(i.timeoutMs).toBe(INTERVALO_DRENAR_MS);
    expect(conn.opcoes[0]!.completo?.(Buffer.from('(registro)'))).toBe(true);
  });

  it('um (&A) perdido junto com o (&I) anterior é pedido de novo uma vez, sem contar registro a mais', async () => {
    const conn = new Registros(3, true);
    const [ra] = await drenarCom(conn);
    expect(ra).toMatchObject({ ok: true, detalhe: '3 registro(s) lido(s)' });
    expect(conn.enviados.filter((q) => q === '(&I)').length).toBe(3); // both targets share the fake: A drains 3, B finds none
  });
});
