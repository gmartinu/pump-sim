// Site copy in pt-BR and English. Mirrors the approved design strings
// (docs: design/homepage/homepage-i18n.js); keep both files in step.
(function () {
  'use strict';
  const PERFIS = ['simulador-2.7.2', 'cbc-32', 'cbc05-dip3', 'cbc01', 'horustech-cbc-36', 'horustech-48', 'concept-48'];
  const MCP = '{\n  "mcpServers": {\n    "pump-sim": {\n      "command": "pump-sim",\n      "args": ["mcp", "--control", "http://127.0.0.1:7070"]\n    }\n  }\n}';
  const MCP_M = '{ "mcpServers": { "pump-sim": {\n    "command": "pump-sim",\n    "args": ["mcp", "--control",\n             "http://127.0.0.1:7070"]\n} } }';
  const CMDS = [
    'git clone https://github.com/gmartinu/pump-sim && cd pump-sim',
    'npm install && npm run build && npm link',
    'pump-sim --profile simulador-2.7.2 --ui',
  ];
  const TOOLS = ['gerar_abastecimentos', 'apresentar_cartao', 'injetar_falha', 'avancar_tempo', 'set_perfil', 'start_recording'];
  const NC = "printf '(&S)' | nc 127.0.0.1 2001";

  const HP = {
    pt: {
      lang: 'pt-BR',
      title: 'pump-sim · simulador de concentrador Companytec',
      nav: { links: [{ t: 'Recursos' }, { t: 'Início rápido' }, { t: 'Agentes' }, { t: 'Docs' }], gh: 'GitHub', menu: 'Menu' },
      ui: { themeDark: 'Tema escuro', themeLight: 'Tema claro', copy: 'Copiar', copied: 'Copiado' },
      hero: {
        eyebrow: 'v1.0 · open source · MIT',
        h1: 'Simule o concentrador. Teste a pista sem ir ao posto.',
        lead: 'pump-sim é um simulador open source dos concentradores Companytec (CBC, Horustech, Concept e Identfid), fiel ao SimuladorCBC 2.7.2, com API de controle, servidor MCP e console de tráfego para devs e agentes de IA.',
        cta1: 'Baixar para Windows', cta2: 'Instalar pela CLI', cta3: 'GitHub',
        meta: 'pump-sim-win-x64.exe · ainda sem assinatura · SHA-256 no release',
        meta2: 'macOS e Linux: Node 22+',
        tryk: 'Teste em uma linha', nc: NC,
        cap: 'Canal 1 · perfil simulador-2.7.2 · 127.0.0.1:2001',
      },
      shot: {
        k: 'A interface', h: 'A pista do 2.7.2, com o que faltava.',
        p: 'Os painéis do SimuladorCBC, mais tráfego ao vivo, gravação e diff. Roda no navegador com --ui ou numa janela própria no Windows.',
        swipe: 'Arraste para ver a pista inteira',
      },
      feat: {
        k: 'Recursos', h: 'Feito para quem integra bomba.',
        protoT: 'Protocolos e perfis',
        protoD: 'Companytec (&…), Identfid (?…) com os 14 modos de identificação e Horustech >? nativo. Os perfis são dados, não código.',
        perfis: PERFIS,
        valMed: 'medido contra o SimuladorCBC 2.7.2 real.',
        valManK: 'Os outros seis',
        valMan: 'segundo o manual, não validado em hardware (DT435, DT432, DT277).',
        parT: 'Paridade com o 2.7.2, medida',
        parD: 'Cada caso manda o quadro exato a um SimuladorCBC 2.7.2 numa bancada Windows real e compara a resposta byte a byte. Os bugs dele viram quirks, ligados só no perfil simulador-2.7.2.',
        parF: 'pump-sim diff --a <bancada>:2001',
        agT: 'Pronto para agentes',
        agD: 'API HTTP de controle só em loopback e servidor MCP stdio com o mesmo catálogo de comandos. O relógio manual deixa o CI do seu cliente determinístico.',
        agF: 'POST /api/comandos/<comando>',
        conT: 'Console de tráfego e injeção de falhas',
        conD: 'Cada leitura e escrita do socket, por porta e conexão. Injete uma falha e veja o seu software reagir.',
        falhas: ['sem_resposta', 'atraso 800 ms', 'frame_corrompido', 'truncado'],
        recT: 'Gravar, reproduzir, comparar',
        recD: 'Grave o tráfego em JSONL, reproduza como concentrador ou como cliente, e rode o teste diferencial contra um alvo real.',
        recF: ['--record trafego.jsonl', 'pump-sim replay servidor trafego.jsonl', 'pump-sim diff --a <alvo>:2001'],
      },
      qs: {
        k: 'Início rápido', h: 'Três comandos.',
        p: 'macOS, Linux ou Windows com Node 22+. No Windows, o .exe dispensa tudo isso: dois cliques e a interface abre.',
        tabs: [{ t: 'CLI' }, { t: 'Windows .exe' }],
        steps: [
          { n: '1', t: 'Clonar', c: CMDS[0] },
          { n: '2', t: 'Instalar e compilar', c: CMDS[1] },
          { n: '3', t: 'Subir com a interface', c: CMDS[2] },
        ],
        after: 'Depois, aponte o PDV ou a automação para 127.0.0.1:2001.',
        nc: NC,
      },
      ag: {
        k: 'Para agentes', h: 'Seu agente dirige a pista.',
        p: 'pump-sim mcp expõe o catálogo de comandos como ferramentas MCP. Cada chamada vira um POST na API de controle: o agente abastece, apresenta cartão, injeta falha, avança o relógio e lê o estado.',
        toolsK: 'Algumas ferramentas', copy: 'Copiar', tools: TOOLS,
        file: 'mcp.json', mcp: MCP, mcpM: MCP_M,
        before: 'Antes, suba o simulador com a API:', beforeC: 'pump-sim --profile cbc-32 --control 7070',
        warn: 'A API não tem autenticação e só escuta em 127.0.0.1.',
      },
      foot: {
        tag: 'Simulador open source de concentrador de combustível.',
        lic: 'Licença MIT · © 2026 Gabriel Martinusso',
        links: [{ t: 'GitHub' }, { t: 'Releases' }, { t: 'Portfólio' }, { t: 'thermal-print' }],
        signA: 'Assinatura de código gratuita por ', signB: ', certificado da ', signL: 'Política de assinatura',
        disc: 'Projeto independente. Não é afiliado à Companytec nem endossado por ela. Companytec, CBC, Horustech e Concept são marcas de seus respectivos titulares.',
      },
    },
    en: {
      lang: 'en',
      title: 'pump-sim · Companytec concentrator simulator',
      nav: { links: [{ t: 'Features' }, { t: 'Quickstart' }, { t: 'Agents' }, { t: 'Docs' }], gh: 'GitHub', menu: 'Menu' },
      ui: { themeDark: 'Dark theme', themeLight: 'Light theme', copy: 'Copy', copied: 'Copied' },
      hero: {
        eyebrow: 'v1.0 · open source · MIT',
        h1: 'Simulate the concentrator. Skip the trip to the station.',
        lead: 'pump-sim is an open-source simulator of Companytec fuel concentrators (CBC, Horustech, Concept and Identfid), faithful to SimuladorCBC 2.7.2, with a control API, an MCP server and a live traffic console for developers and AI agents.',
        cta1: 'Download for Windows', cta2: 'Install with the CLI', cta3: 'GitHub',
        meta: 'pump-sim-win-x64.exe · not code-signed yet · SHA-256 on the release',
        meta2: 'macOS and Linux: Node 22+',
        tryk: 'One-line check', nc: NC,
        cap: 'Channel 1 · simulador-2.7.2 profile · 127.0.0.1:2001',
      },
      shot: {
        k: 'The interface', h: 'The 2.7.2 forecourt, plus what was missing.',
        p: 'The SimuladorCBC panels, plus live traffic, recording and diff. Runs in the browser with --ui or in its own window on Windows.',
        swipe: 'Drag to see the whole forecourt',
      },
      feat: {
        k: 'Features', h: 'Built for people who integrate pumps.',
        protoT: 'Protocols and profiles',
        protoD: 'Companytec (&…), Identfid (?…) with the 14 identification modes, and native Horustech >?. Profiles are data, not code.',
        perfis: PERFIS,
        valMed: 'measured against the real SimuladorCBC 2.7.2.',
        valManK: 'The other six',
        valMan: 'per the manual, not validated on hardware (DT435, DT432, DT277).',
        parT: 'Parity with 2.7.2, measured',
        parD: 'Each case sends the exact frame to a SimuladorCBC 2.7.2 on a real Windows bench and compares the reply byte by byte. Its bugs become quirks, on only in the simulador-2.7.2 profile.',
        parF: 'pump-sim diff --a <bench>:2001',
        agT: 'Agent-ready',
        agD: 'An HTTP control API on loopback only, and a stdio MCP server with the same command catalog. The manual clock makes your client’s CI deterministic.',
        agF: 'POST /api/comandos/<command>',
        conT: 'Traffic console and fault injection',
        conD: 'Every socket read and write, per port and connection. Inject a fault and watch your software react.',
        falhas: ['sem_resposta', 'atraso 800 ms', 'frame_corrompido', 'truncado'],
        recT: 'Record, replay, compare',
        recD: 'Record traffic to JSONL, replay it as the concentrator or as the client, and run the differential test against a real target.',
        recF: ['--record trafego.jsonl', 'pump-sim replay servidor trafego.jsonl', 'pump-sim diff --a <target>:2001'],
      },
      qs: {
        k: 'Quickstart', h: 'Three commands.',
        p: 'macOS, Linux or Windows with Node 22+. On Windows the .exe skips all of this: double-click it and the interface opens.',
        tabs: [{ t: 'CLI' }, { t: 'Windows .exe' }],
        steps: [
          { n: '1', t: 'Clone', c: CMDS[0] },
          { n: '2', t: 'Install and build', c: CMDS[1] },
          { n: '3', t: 'Start with the interface', c: CMDS[2] },
        ],
        after: 'Then point your POS or forecourt software at 127.0.0.1:2001.',
        nc: NC,
      },
      ag: {
        k: 'For agents', h: 'Your agent drives the forecourt.',
        p: 'pump-sim mcp exposes the command catalog as MCP tools. Each call becomes a POST to the control API: the agent dispenses fuel, presents a card, injects a fault, moves the clock and reads the state.',
        toolsK: 'Some tools', copy: 'Copy', tools: TOOLS,
        file: 'mcp.json', mcp: MCP, mcpM: MCP_M,
        before: 'First, start the simulator with the API:', beforeC: 'pump-sim --profile cbc-32 --control 7070',
        warn: 'The API has no authentication and listens on 127.0.0.1 only.',
      },
      foot: {
        tag: 'Open-source fuel concentrator simulator.',
        lic: 'MIT license · © 2026 Gabriel Martinusso',
        links: [{ t: 'GitHub' }, { t: 'Releases' }, { t: 'Portfolio' }, { t: 'thermal-print' }],
        signA: 'Free code signing provided by ', signB: ', certificate by ', signL: 'Code signing policy',
        disc: 'Independent project. Not affiliated with or endorsed by Companytec. Companytec, CBC, Horustech and Concept are trademarks of their respective owners.',
      },
    },
  };

  window.PumpSite = window.PumpSite || {};
  window.PumpSite.HP = HP;
})();
