#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { type Clock, ManualClock, SystemClock } from './core/clock.js';
import { Hub } from './control/hub.js';
import { executarComando } from './control/comandos.js';
import { abrirServidorControle } from './control/servidor.js';
import { type AlvoDiff, type RelatorioDiff, type ResultadoCaso, executarDiff, formatarRelatorio, lerParcial } from './diff/executor.js';
import { DIR_ORACULO_PADRAO, construirOraculo, executarOraculo, formatarRelatorioOraculo, gravarOraculo, lerOraculo, mesclarOraculo } from './diff/oraculo.js';
import { ROTEIROS, selecionarRoteiros } from './diff/roteiros.js';
import type { PlataformaA } from './diff/tolerancia.js';
import { rodarMcpStdio } from './mcp/servidor.js';
import { lerAlvo } from './net/cliente-tcp.js';
import { IDS_PERFIS, type PerfilId, obterPerfil } from './profiles/index.js';
import { lerGravacao } from './recorder/formato.js';
import { ServidorReplay, replayCliente } from './recorder/replay.js';
import { PORTA_CONTROLE_PADRAO, abrirControleComFallback, mensagemErroFatal, mensagemFalhaControle, pilhaSemCaminhos, textoDialogoErro } from './ui/inicio.js';
import { type Instalacao, argsErroHost, argsHost, caiParaNavegador, dirHost, encerraComJanela, instalarHost, lerAssetsHost, usarHost } from './ui/janela.js';
import { type UltimaConfig, arquivoUltimaConfig, lerUltimaConfig, passosUltimaConfig } from './ui/lembrar.js';
import { LogArquivo, NOME_LOG, dirLogs, espelhar } from './ui/log.js';
import { VERSAO } from './versao.js';
import { comoAbrir } from './ui/navegador.js';

const AJUDA = `pump-sim — simulador de concentrador Companytec

Uso:
  pump-sim [--profile <id>] [--ports 2001,1771] [--control 7070] [--record <arquivo.jsonl>]
           [--host <ip>] [--sem-config-padrao] [--relogio-manual] [--listar-perfis]
           [--ui] [--sem-abrir] [--lembrar] [--gravacoes <pasta>] [--sem-mcp-http]
  pump-sim mcp --control http://127.0.0.1:7070
  pump-sim replay servidor <arquivo.jsonl> [--velocidade 1] [--mapa 2001=3001,...] [--enquadramento fluxo|leituraUnica]
  pump-sim replay cliente <arquivo.jsonl> [--alvo host:porta] [--velocidade 1]
  pump-sim diff --a host:porta --b host:porta [--casos DIFF-01,DIFF-03|todos]
           [--controle-a url] [--controle-b url] [--controle-a-tipo driver|pump-sim]
           [--controle-b-tipo pump-sim|driver] [--diff17-n 1001] [--interativo] [--timeout ms] [--timeout-silencio 400] [--json saida.json]
           [--retomar saida.json.partial.jsonl] [--drenar-antes] [--alvo-a windows|wine]
  pump-sim diff --listar
  pump-sim oracle [--dir test/fixtures/oracle-2.7.2] [--json saida.json]
  pump-sim oracle --atualizar-de <diff.json> [--dir ...] [--inicio 2026-10-17T14:35:32] [--sessao id]
           [--alterados DIFF-14,DIFF-20 [--motivo texto]] [--substituir]

  diff: --controle-a é o driver da UI do 2.7.2 (tools/driver-simuladorcbc, ex. http://127.0.0.1:7071)
        e --controle-b a API de controle do pump-sim, salvo --controle-x-tipo.
        --timeout-silencio: espera dos passos em que a bancada gravou silêncio (padrão 400 ms; nunca
        mais que --timeout; passos com timeout próprio ou seguidos de fechar_modais mantêm o --timeout).
        --alvo-a wine: o A é o 2.7.2 no Wine (timer de vazão de 100 ms, 109,375 ms no Windows); nos passos
        de vazão livre, volume/valor/encerrante/duração comparam com tolerância de ±10% ("igual
        (tolerância wine)"); o resto continua byte a byte. Padrão windows (tudo byte a byte).
  oracle: repete as respostas gravadas do 2.7.2 real (lado A) contra o pump-sim em processo (lado B);
        caso com roteiro alterado sai "stale" (precisa de bancada). --atualizar-de importa um relatório
        de bancada (--json do diff); --alterados marca casos cujo roteiro mudou depois da corrida
        (relatórios sem roteiroHash).

  --profile, --perfil  ${IDS_PERFIS.join(' | ')} (padrão: simulador-2.7.2)
  --ports, --porta     portas TCP lógicas (vírgulas ou repetido). Padrão: as do perfil
                       (reais: 2001 1771 857 ao mesmo tempo; simulador-2.7.2: uma só, 2001 | 1771 | 7002)
  --control            porta da API de controle HTTP/WS (em 127.0.0.1; --control-host muda)
  --record             grava todo o tráfego bruto em JSONL desde o início
  --relogio-manual     relógio parado; o tempo só anda pelo comando avancar_tempo (CI determinístico)
  --sem-config-padrao  não carrega 8 canais × 2 endereços × 2 bicos
  --ui                 sobe a API de controle (sem --control: a 1ª porta livre de 7070 a 7089), imprime a
                       URL da interface e abre numa janela do Edge/Chrome; porta TCP ocupada não aborta
                       (a UI tenta de novo); porta de controle ocupada não aborta (segue sem UI)
  --sem-abrir          com --ui, só imprime a URL
  --lembrar            parte do último perfil/porta/equipamento salvo e salva as mudanças
  --gravacoes          pasta das gravações da UI (padrão: ./gravacoes)
  --sem-mcp-http       sobe a API de controle com o MCP por HTTP (<controle>/mcp) desligado; liga pela UI

  Executável do Windows (SEA): é o app de duplo clique (sem argumentos = --ui --lembrar), sem console.
  A saída vai para %LOCALAPPDATA%\\pump-sim\\logs\\pump-sim.log (UI: Gravação & agentes > Ver logs); um
  erro fatal abre uma caixa de diálogo; fechar a janela encerra o simulador. No terminal, use npx pump-sim.
`;

interface Opcoes {
  pos: string[];
  flags: Map<string, string[]>;
}

function argumentos(argv: string[]): Opcoes {
  const pos: string[] = [];
  const flags = new Map<string, string[]>();
  const booleanas = new Set(['--sem-config-padrao', '--listar-perfis', '--relogio-manual', '--interativo', '--listar', '--help', '-h', '--ui', '--sem-abrir', '--sem-mcp-http', '--lembrar', '--drenar-antes', '--substituir']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('-')) {
      const [k, v] = a.includes('=') && a.startsWith('--') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
      const valor = booleanas.has(k) ? 'true' : (v ?? argv[++i] ?? '');
      flags.set(k, [...(flags.get(k) ?? []), valor]);
    } else pos.push(a);
  }
  return { pos, flags };
}

const um = (o: Opcoes, ...nomes: string[]): string | undefined => {
  for (const n of nomes) {
    const v = o.flags.get(n);
    if (v && v.length) return v[v.length - 1];
  }
  return undefined;
};
const lista = (o: Opcoes, ...nomes: string[]): string[] => nomes.flatMap((n) => o.flags.get(n) ?? []).flatMap((v) => v.split(',')).filter(Boolean);
const tem = (o: Opcoes, ...nomes: string[]) => nomes.some((n) => o.flags.has(n));
const log = (s: string) => process.stderr.write(s + '\n');

// ───────────────────────── last configuration (--lembrar) ─────────────────────────

function arquivoConfig(): string {
  return arquivoUltimaConfig(process.platform, process.env, os.homedir());
}

/** The saved configuration, validated key by key (DECISIONS §35); one log line for what was dropped. */
function lerConfigSalva(): UltimaConfig {
  const r = lerUltimaConfig(arquivoConfig(), IDS_PERFIS);
  if (r.aviso) log(r.aviso);
  return r.config;
}

async function capturarConfig(hub: Hub): Promise<UltimaConfig> {
  const e = (await executarComando(hub, 'get_estado_simulador')) as {
    perfil: { id: string };
    portas: { logica: number }[];
    equipamento: { dips: boolean[]; modelo: string; automacao: boolean; redeAC: boolean; bateriaVolts: number };
    timers: { tickVazaoMs: number };
  };
  const q = e.equipamento;
  return { perfil: e.perfil.id, portas: e.portas.map((p) => p.logica), dips: q.dips, modelo: q.modelo, automacao: q.automacao, redeAC: q.redeAC, bateriaVolts: q.bateriaVolts, tickVazaoMs: e.timers.tickVazaoMs };
}

/** Re-applies the saved equipment panel through the control commands (the same ones the UI uses). */
async function aplicarConfig(hub: Hub, c: UltimaConfig): Promise<void> {
  for (const [nome, args] of passosUltimaConfig(c)) {
    try {
      await executarComando(hub, nome, args);
    } catch (e) {
      log(`[pump-sim] última configuração: ${nome} falhou (${e instanceof Error ? e.message : String(e)})`);
    }
  }
}

/** Saves the configuration whenever it changes (checked every 2 s, and on exit). */
function vigiarConfig(hub: Hub): () => Promise<void> {
  let ultimo = '';
  const salvar = async () => {
    try {
      const txt = JSON.stringify(await capturarConfig(hub), null, 2);
      if (txt === ultimo) return;
      fs.mkdirSync(path.dirname(arquivoConfig()), { recursive: true });
      fs.writeFileSync(arquivoConfig(), txt);
      ultimo = txt;
    } catch {
      // A failed save is retried on the next round.
    }
  };
  const t = setInterval(() => void salvar(), 2000);
  t.unref();
  return async () => {
    clearInterval(t);
    await salvar();
  };
}

/** Opens the UI in an app window of a browser (Edge, then Chrome, then the default browser). */
function abrirNavegador(url: string): void {
  const { cmd, args, verbatim } = comoAbrir(url, process.platform, process.env, (p) => fs.existsSync(p));
  const p = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: Boolean(verbatim) });
  p.on('error', () => log(`[pump-sim] não consegui abrir o navegador; abra ${url}`));
  p.unref();
}

/** Writes the embedded window host to disk (sha-checked); null outside the Windows executable or without the host. */
function prepararHost(): Instalacao | null {
  const assets = process.platform === 'win32' && executavel ? lerAssetsHost() : null;
  if (!usarHost({ plataforma: process.platform, executavel, temHost: assets !== null }) || !assets) return null;
  return instalarHost({ bytes: assets.bytes, shaEsperado: assets.sha, dir: dirHost(process.env, os.homedir()) });
}

/**
 * Opens the UI window. The Windows executable runs its embedded frameless window host (DECISIONS
 * §32); without it, or when it reports no WebView2 runtime, the browser app window takes over.
 * The executable has no console (§34), so `aoFechar` (stop the simulator) runs when the host window
 * ends; with the browser fallback the process keeps running until "Encerrar pump-sim" in the UI.
 * Returns what closes the host window when the process ends first.
 */
function abrirJanela(url: string, aoFechar: () => void): () => void {
  const inst = prepararHost();
  if (!inst) {
    abrirNavegador(url);
    return () => undefined;
  }
  if (!inst.ok) {
    log(`[pump-sim] ${inst.motivo}; abrindo no navegador`);
    abrirNavegador(url);
    return () => undefined;
  }
  let caiu = false;
  const cair = (r: { erroSpawn: boolean; codigo: number | null }) => {
    if (!caiu && encerraComJanela(r)) {
      caiu = true;
      log(`[pump-sim] janela fechada (código ${r.codigo ?? '—'}); encerrando o simulador`);
      aoFechar();
      return;
    }
    if (caiu || !caiParaNavegador(r)) return;
    caiu = true;
    log(r.erroSpawn ? '[pump-sim] não consegui abrir a janela; abrindo no navegador' : '[pump-sim] WebView2 Runtime não encontrado; abrindo no navegador');
    abrirNavegador(url);
  };
  const p = spawn(inst.caminho, argsHost(url), { detached: true, stdio: 'ignore', windowsHide: false });
  p.on('error', () => cair({ erroSpawn: true, codigo: null }));
  p.on('exit', (codigo) => cair({ erroSpawn: false, codigo }));
  p.unref();
  // "Encerrar pump-sim" in the UI (DECISIONS §35): the process ends first, so the window goes with it.
  return () => {
    caiu = true;
    if (p.exitCode === null && p.signalCode === null) p.kill();
  };
}

async function rodarSimulador(o: Opcoes): Promise<void> {
  if (tem(o, '--listar-perfis')) {
    for (const id of IDS_PERFIS) process.stdout.write(`${id}\t${obterPerfil(id).descricao}\n`);
    return;
  }
  const lembrar = tem(o, '--lembrar');
  const ultima = lembrar ? lerConfigSalva() : {};
  const salvo = ultima.perfil && (IDS_PERFIS as readonly string[]).includes(ultima.perfil) ? (ultima.perfil as PerfilId) : undefined;
  const perfilId = (um(o, '--profile', '--perfil') ?? salvo ?? 'simulador-2.7.2') as PerfilId;
  if (!IDS_PERFIS.includes(perfilId)) throw new Error(`perfil desconhecido: ${perfilId}`);
  let portas = lista(o, '--ports', '--porta').map(Number);
  if (!portas.length && lembrar && perfilId === salvo && ultima.portas?.length) portas = ultima.portas;
  const host = um(o, '--host') ?? '0.0.0.0';
  const manual = tem(o, '--relogio-manual');
  const ui = tem(o, '--ui');
  const clock: Clock = manual ? new ManualClock(Date.now()) : new SystemClock();
  const hub = new Hub({ clock, host, fusoMinutos: -new Date().getTimezoneOffset(), dirGravacoes: um(o, '--gravacoes') });
  const rt = await hub.criar('default', perfilId, portas.length ? portas : undefined, {
    configPadrao: !tem(o, '--sem-config-padrao'),
    gravar: um(o, '--record', '--gravar'),
    tolerarPortaOcupada: ui,
  });
  for (const p of rt.servidor?.portas() ?? []) log(`[pump-sim] ${perfilId} ouvindo em ${host}:${p.fisica}`);
  if (rt.erroPorta) log(`[pump-sim] porta ${rt.erroPorta.porta} ocupada (${rt.erroPorta.codigo}): simulando sem porta aberta; tente de novo pela UI`);
  if (rt.gravador?.arquivo) log(`[pump-sim] gravando tráfego em ${rt.gravador.arquivo}`);
  if (lembrar && perfilId === salvo) await aplicarConfig(hub, ultima);
  const ctlExplicito = um(o, '--control', '--controle');
  const ctl = ctlExplicito ?? (ui ? String(PORTA_CONTROLE_PADRAO) : undefined);
  let fecharCtl: (() => Promise<void>) | null = null;
  let urlJanela: string | null = null;
  if (ctl) {
    const porta = Number(ctl);
    if (!Number.isInteger(porta) || porta < 0 || porta > 65535) throw new Error(`--control: porta inválida (${ctl})`);
    const hostCtl = um(o, '--control-host') ?? '127.0.0.1';
    // Explicit --control: one attempt. --ui default: first free port in 7070..7089 (DECISIONS §31).
    const mcpHttp = !tem(o, '--sem-mcp-http');
    const r = await abrirControleComFallback((p) => abrirServidorControle(hub, p, hostCtl, { mcpHttp, arquivoLog: logArquivo?.arquivo ?? null, aoEncerrar: () => void sair('encerrado pela interface') }), { porta, explicita: ctlExplicito !== undefined });
    if (r.ok) {
      const s = r.servidor;
      fecharCtl = s.fechar;
      if (r.porta !== porta) log(`[pump-sim] porta ${porta} ocupada; usando ${r.porta}`);
      log(`[pump-sim] API de controle em ${s.url} (WS ${s.url.replace('http', 'ws')}/ws)`);
      log(`[pump-sim] UI em ${s.url}/`);
      const m = s.mcp.ativo ? `MCP (HTTP) em ${s.url}/mcp` : 'MCP (HTTP) desligado (--sem-mcp-http); liga pela UI';
      log(`[pump-sim] ${m}`);
      if (ui && !tem(o, '--sem-abrir')) urlJanela = `${s.url}/`;
    } else {
      // The simulator itself keeps serving its TCP ports; only the API/UI is missing.
      log(mensagemFalhaControle(r, ctlExplicito !== undefined));
    }
  }
  const pararVigia = lembrar ? vigiarConfig(hub) : null;
  const t = manual ? null : setInterval(() => hub.tick(), 50);
  let fecharJanela: () => void = () => undefined;
  let saindo = false;
  // Saves the configuration, closes the control API and the TCP ports, then exits (once).
  async function sair(motivo?: string): Promise<void> {
    if (saindo) return;
    saindo = true;
    if (motivo) log(`[pump-sim] ${motivo}; fechando as portas`);
    if (t) clearInterval(t);
    await pararVigia?.();
    await fecharCtl?.();
    await hub.fechar();
    fecharJanela();
    process.exit(0);
  }
  process.on('SIGINT', () => void sair());
  process.on('SIGTERM', () => void sair());
  if (urlJanela) fecharJanela = abrirJanela(urlJanela, () => void sair());
}

async function rodarReplay(o: Opcoes): Promise<void> {
  const [, modo, arquivo] = o.pos;
  if (!arquivo || (modo !== 'servidor' && modo !== 'cliente')) throw new Error('uso: pump-sim replay servidor|cliente <arquivo.jsonl>');
  const linhas = lerGravacao(fs.readFileSync(arquivo, 'utf8'));
  const velocidade = Number(um(o, '--velocidade') ?? (modo === 'servidor' ? 1 : 0));
  if (modo === 'servidor') {
    const mapa = Object.fromEntries(lista(o, '--mapa').map((p) => p.split('=') as [string, string]).map(([a, b]) => [a, Number(b)]));
    const enq = um(o, '--enquadramento');
    if (enq !== undefined && enq !== 'fluxo' && enq !== 'leituraUnica') throw new Error(`--enquadramento: fluxo | leituraUnica (veio ${enq})`);
    const s = await ServidorReplay.abrir(linhas, { host: um(o, '--host') ?? '0.0.0.0', mapa, velocidade, enquadramento: enq });
    log(`[pump-sim replay] enquadramento ${s.enquadramento}`);
    for (const p of s.portas()) log(`[pump-sim replay] porta gravada ${p.porta} em ${p.fisica}`);
    process.on('SIGINT', () => {
      log(`[pump-sim replay] ${s.atendidos} atendidos, ${s.naoEncontrados.length} quadros sem gravação`);
      void s.fechar().then(() => process.exit(0));
    });
    return;
  }
  const alvo = um(o, '--alvo');
  const portasGravadas = [...new Set(linhas.filter((l) => l.dir === 'rx').map((l) => String(l.porta)))];
  const alvos = alvo ? Object.fromEntries(portasGravadas.map((p) => [p, lerAlvo(alvo)])) : undefined;
  const r = await replayCliente(linhas, { alvos, velocidade });
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  process.exitCode = r.divergencias.length ? 1 : 0;
}

function lerPlataformaA(v: string | undefined): PlataformaA | undefined {
  if (v === undefined || v === 'windows') return undefined;
  if (v === 'wine') return 'wine';
  throw new Error(`--alvo-a desconhecido: ${v} (windows | wine)`);
}

async function rodarDiff(o: Opcoes): Promise<void> {
  if (tem(o, '--listar')) {
    for (const c of ROTEIROS) process.stdout.write(`${c.id}\t${c.titulo}\t(${c.resolve})\n`);
    return;
  }
  const a = um(o, '--a');
  const b = um(o, '--b');
  if (!a || !b) throw new Error('uso: pump-sim diff --a host:porta --b host:porta [--casos ...]');
  const n17 = um(o, '--diff17-n');
  const casos = selecionarRoteiros(um(o, '--casos') ?? 'todos', n17 !== undefined ? { diff17N: Number(n17) } : {});
  const comControle = (alvo: AlvoDiff, url: string | undefined, tipo: string): AlvoDiff => {
    if (!url) return alvo;
    if (tipo === 'driver') return { ...alvo, driver: url };
    if (tipo === 'pump-sim') return { ...alvo, controle: url };
    throw new Error(`tipo de controle desconhecido: ${tipo} (driver | pump-sim)`);
  };
  const alvoA = comControle({ nome: 'A', alvo: lerAlvo(a) }, um(o, '--controle-a'), um(o, '--controle-a-tipo') ?? 'driver');
  const alvoB = comControle({ nome: 'B', alvo: lerAlvo(b) }, um(o, '--controle-b'), um(o, '--controle-b-tipo') ?? 'pump-sim');
  let rl: readline.Interface | null = null;
  const manual = tem(o, '--interativo')
    ? async (texto: string, alvo: AlvoDiff) => {
        rl ??= readline.createInterface({ input: process.stdin, output: process.stderr });
        await rl.question(`[${alvo.nome} ${alvo.alvo.host}:${alvo.alvo.porta}] ${texto} — Enter quando pronto `);
      }
    : undefined;
  const timeout = um(o, '--timeout');
  const json = um(o, '--json');
  const retomar = um(o, '--retomar');
  const anteriores = retomar ? lerParcial(fs.readFileSync(retomar, 'utf8')) : undefined;
  if (anteriores) process.stderr.write(`[diff] retomando ${retomar}: ${new Set(anteriores.filter((r) => !r.pulado).map((r) => r.id)).size} caso(s) já feitos\n`);
  // Each case is appended (and fsynced) as soon as it ends, so a run that dies midway keeps what it did.
  const parcial = retomar ?? (json ? `${json}.partial.jsonl` : undefined);
  const fd = parcial ? fs.openSync(parcial, 'a') : null;
  const aoTerminarCaso = fd === null ? undefined : (r: ResultadoCaso) => {
    fs.writeSync(fd, JSON.stringify(r) + '\n');
    fs.fsyncSync(fd);
  };
  const rel = await executarDiff(casos, alvoA, alvoB, {
    manual,
    timeoutMs: timeout ? Number(timeout) : undefined,
    timeoutSilencioMs: um(o, '--timeout-silencio') !== undefined ? Number(um(o, '--timeout-silencio')) : undefined,
    anteriores,
    aoTerminarCaso,
    drenarAntes: tem(o, '--drenar-antes'),
    plataformaA: lerPlataformaA(um(o, '--alvo-a')),
  }).finally(() => {
    if (fd !== null) fs.closeSync(fd);
  });
  (rl as readline.Interface | null)?.close();
  if (json) fs.writeFileSync(json, JSON.stringify(rel, null, 2));
  process.stdout.write(formatarRelatorio(rel) + '\n');
  process.exitCode = rel.total.divergencias ? 1 : 0;
}

async function rodarOraculo(o: Opcoes): Promise<void> {
  const dir = um(o, '--dir') ?? DIR_ORACULO_PADRAO;
  const de = um(o, '--atualizar-de');
  if (de) {
    const rel = JSON.parse(fs.readFileSync(de, 'utf8')) as RelatorioDiff;
    const atual = fs.existsSync(path.join(dir, 'manifest.json')) ? lerOraculo(dir) : null;
    const sessao = um(o, '--sessao') ?? path.basename(de).replace(/\.json$/, '');
    const inicio = um(o, '--inicio') ?? atual?.manifesto.sessoes.find((s) => s.id === sessao)?.inicioRelogio;
    if (!inicio) throw new Error('--inicio 2026-10-17T14:35:32 (hora de parede do início da corrida) é obrigatório numa sessão nova');
    const motivo = um(o, '--motivo') ?? 'listado em --alterados';
    const alterados = Object.fromEntries(lista(o, '--alterados').map((id) => [id.trim().toUpperCase(), motivo]));
    const novo = construirOraculo(rel, { sessao, fonte: path.basename(de), inicioRelogio: inicio, alterados });
    const oraculo = mesclarOraculo(atual, novo, tem(o, '--substituir'));
    gravarOraculo(dir, oraculo);
    for (const a of novo.avisos) log(`[oracle] aviso: ${a}`);
    const semHash = novo.casos.filter((c) => c.roteiroHash === null).map((c) => c.caso);
    log(`[oracle] ${novo.casos.length} caso(s) da sessão ${sessao} gravados em ${dir}${semHash.length ? `; sem hash (stale): ${semHash.join(', ')}` : ''}`);
    return;
  }
  const r = await executarOraculo(lerOraculo(dir));
  const json = um(o, '--json');
  if (json) fs.writeFileSync(json, JSON.stringify(r, null, 2));
  process.stdout.write(formatarRelatorioOraculo(r) + '\n');
  process.exitCode = r.falhas.length ? 1 : 0;
}

/** True inside a Node single executable (the Windows distribution). */
function ehExecutavel(): boolean {
  try {
    const sea = (process as unknown as { getBuiltinModule?: (id: string) => { isSea(): boolean } | undefined }).getBuiltinModule?.('node:sea');
    return Boolean(sea?.isSea());
  } catch {
    return false;
  }
}

async function main(argv: string[]): Promise<void> {
  // Double click on the Windows executable: simulator on 2001 + UI window + last configuration.
  const o = argumentos(argv.length === 0 && executavel ? ['--ui', '--lembrar'] : argv);
  if (tem(o, '--help', '-h')) {
    process.stdout.write(AJUDA);
    if (executavel) mostrarAjuda();
    return;
  }
  switch (o.pos[0]) {
    case 'mcp':
      await rodarMcpStdio(um(o, '--control', '--controle') ?? 'http://127.0.0.1:7070');
      return;
    case 'replay':
      await rodarReplay(o);
      return;
    case 'diff':
      await rodarDiff(o);
      return;
    case 'oracle':
    case 'oraculo':
      await rodarOraculo(o);
      return;
    case undefined:
      await rodarSimulador(o);
      return;
    default:
      throw new Error(`subcomando desconhecido: ${o.pos[0]}\n\n${AJUDA}`);
  }
}

/**
 * `--help` in the GUI executable (no console, DECISIONS §34): the text also goes to `ajuda.txt` next
 * to the log, opened in Notepad.
 */
function mostrarAjuda(): void {
  if (process.platform !== 'win32') return;
  try {
    const arq = path.join(dirLogs(process.env, os.homedir()), 'ajuda.txt');
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    fs.writeFileSync(arq, AJUDA.replace(/\n/g, '\r\n'));
    const p = spawn('notepad.exe', [arq], { detached: true, stdio: 'ignore' });
    p.on('error', () => undefined);
    p.unref();
  } catch {
    // the help is in the log anyway
  }
}

/**
 * A fatal error in the GUI executable: a native dialog through the window host (`-erro`,
 * MessageBoxW), waited for before exiting. Without the host the message stays in the log only.
 */
function dialogoErro(mensagem: string): void {
  const inst = prepararHost();
  if (!inst?.ok) return;
  try {
    spawnSync(inst.caminho, argsErroHost(textoDialogoErro(mensagem, logArquivo?.arquivo ?? null)), { stdio: 'ignore', windowsHide: false });
  } catch {
    // no dialog: the log has it
  }
}

let fatalVisto = false;
function fatal(e: unknown): void {
  if (fatalVisto) return;
  fatalVisto = true;
  const m = mensagemErroFatal(e);
  process.stderr.write(`${m}\n`);
  if (executavel && process.platform === 'win32') {
    if (e instanceof Error && e.stack) logArquivo?.escrever(`${pilhaSemCaminhos(e.stack)}\n`);
    dialogoErro(m);
  }
  logArquivo?.fechar();
  process.exit(1);
}

const argvCli = process.argv.slice(2);
const executavel = ehExecutavel();
/**
 * The Windows executable is a GUI-subsystem program (no console window, DECISIONS §34): stdout and
 * stderr are mirrored into %LOCALAPPDATA%\pump-sim\logs\pump-sim.log. Under `mcp` stdout is the
 * JSON-RPC stream and stays out of the log.
 */
const logArquivo = executavel && process.platform === 'win32' ? new LogArquivo({ arquivo: path.join(dirLogs(process.env, os.homedir()), NOME_LOG), agora: () => new Date() }) : null;
if (logArquivo) {
  espelhar(process.stderr, logArquivo);
  if (argvCli[0] !== 'mcp') espelhar(process.stdout, logArquivo);
  logArquivo.escrever(`[pump-sim] ${VERSAO} iniciado: pid ${process.pid}, argumentos ${JSON.stringify(argvCli)}\n`);
  process.on('uncaughtException', fatal);
  process.on('exit', () => logArquivo.fechar());
}
main(argvCli).catch(fatal);
