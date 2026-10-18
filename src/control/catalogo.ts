/**
 * Command catalog of the control API (spec §5 + K18–K26). It is only data: name,
 * group, description and JSON Schema of the arguments. The HTTP/WS API runs them; the MCP lists
 * this catalog as tools and forwards each call to the API, with no logic of its own.
 *
 * Every command also accepts `sim_id` (multi-instance; default "default").
 * `bico` accepts the `BB` code in hex ("04", "C4"), `{canal, endereco, posicao}`
 * (posicao 1..4, the 2.7.2 radio's) or `{numero}` (lane nozzle, Horustech).
 */

export type Schema = Record<string, unknown>;

export interface DefComando {
  nome: string;
  grupo: 'leitura' | 'protocolo' | 'controle' | 'infra';
  descricao: string;
  params: Schema;
}

const str = (description: string, extra: Schema = {}): Schema => ({ type: 'string', description, ...extra });
const int = (description: string, extra: Schema = {}): Schema => ({ type: 'integer', description, ...extra });
const num = (description: string, extra: Schema = {}): Schema => ({ type: 'number', description, ...extra });
const bool = (description: string): Schema => ({ type: 'boolean', description });
const enm = (description: string, valores: readonly (string | number)[]): Schema => ({ enum: [...valores], description });

export const SCHEMA_BICO: Schema = {
  description: 'Bico: código BB em hex ("04"), {canal, endereco, posicao 1..4} ou {numero} (bico de pista)',
  anyOf: [
    { type: 'string', pattern: '^[0-9A-Fa-f]{2}$' },
    {
      type: 'object',
      properties: { canal: { type: 'integer' }, endereco: { type: 'integer' }, posicao: { type: 'integer' } },
      required: ['canal', 'endereco', 'posicao'],
      additionalProperties: false,
    },
    { type: 'object', properties: { numero: { type: 'integer' } }, required: ['numero'], additionalProperties: false },
  ],
};
const bico = SCHEMA_BICO;
const porta = int('Porta lógica do console (2001, 1771, 857, 7002). Padrão: a 1ª do perfil');
const canal = int('Canal 1..N', { minimum: 1 });
const endereco = int('Endereço (lado) 1..4', { minimum: 1, maximum: 4 });
const datahora = str('Data/hora local do concentrador, ISO "2026-10-16T14:30:00" (sem fuso)');

function obj(props: Record<string, Schema> = {}, required: string[] = []): Schema {
  return { type: 'object', properties: props, required, additionalProperties: false };
}

const d = (nome: string, grupo: DefComando['grupo'], descricao: string, params: Schema = obj()): DefComando => ({
  nome,
  grupo,
  descricao,
  params,
});

export const FORMATOS_ABASTECIMENTO = ['a52', 'a34', 'a36', 'a67', 'dupla', 'paf1', 'paf2', 'a4', 'lr', 'lc', 'h02', 'h02a1', 'h02a2'] as const;
export const MODOS_SET_MODO = ['libera', 'bloqueia', 'autoriza', 'stop', 'pausa', 'idf_on', 'idf_off', 'clear'] as const;

export const CATALOGO: readonly DefComando[] = [
  // ───────────── 5.1 reads (no socket and no pointer changes) ─────────────
  d('get_status', 'leitura', 'Status de todos os lados, como o &S (cbc) ou o ?S92 (companytec48). horustech = função 01, v1.1', obj({ formato: enm('Formato', ['cbc', 'companytec48', 'horustech']) })),
  d('get_visualizacao', 'leitura', 'Abastecimentos em andamento, como o &V (ou ?V com identificada)', obj({ identificada: bool('?V em vez de &V') })),
  d(
    'get_abastecimento',
    'leitura',
    'Um registro do buffer no layout pedido. Sem posicao: o do ponteiro de leitura da porta (sem avançar)',
    obj({ posicao: int('Posição no buffer (R)'), porta, formato: enm('Layout do registro', FORMATOS_ABASTECIMENTO) }),
  ),
  d(
    'list_abastecimentos',
    'leitura',
    'Registros do buffer (estruturados). com_quadro: cada registro traz o quadro &A no layout que o &A devolveria',
    obj({ de: int('Posição inicial'), ate: int('Posição final'), bico, limite: int('Máximo', { minimum: 1 }), com_quadro: bool('Inclui o quadro &A de cada registro'), porta }),
  ),
  d('get_ponteiros', 'leitura', 'Ponteiro de escrita e de leitura (por porta nos perfis reais; único no 2.7.2), como &T99P', obj({ porta })),
  d('get_encerrante', 'leitura', 'Encerrante do bico, como &T L/l/$', obj({ bico, tipo: enm('litros (&T L), litros10 (&T l), valor (&T $), completo (estruturado)', ['litros', 'litros10', 'valor', 'completo']) }, ['bico'])),
  d('get_precos', 'leitura', 'Preços do bico por nível (vigentes e pendentes), como &T U/u', obj({ bico }, ['bico'])),
  d('get_config_bico', 'leitura', 'Configuração do bico (canal, vírgula, endereço, nº de bicos, pista, combustível, tanque), como &T C', obj({ bico }, ['bico'])),
  d('get_serie', 'leitura', 'Número de série, como &T N / &T99N', obj({ bico })),
  d('get_ids_abastecimento', 'leitura', 'Identificadores do abastecimento corrente ou do último, como &T I', obj({ bico }, ['bico'])),
  d('get_relogio', 'leitura', 'Relógio do concentrador (RTC) e do PC, como &R / &KR1', obj()),
  d('list_cartoes', 'leitura', 'Cadastro de identificadores (?LF). Com posicao, só aquela', obj({ posicao: int('Posição 0-based') })),
  d('get_cartao', 'leitura', 'Um identificador cadastrado pelo código', obj({ codigo: str('16 hex') }, ['codigo'])),
  d('list_cartoes_desconhecidos', 'leitura', 'Fila de identificadores não cadastrados (?A)', obj({ limite: int('Máximo', { minimum: 1 }), porta })),
  d('get_lista_negra', 'leitura', 'Lista negra (&M99): 20 posições nos reais; no 2.7.2, a coluna do cadastro de cartões'),
  d('list_eventos', 'leitura', 'Memória de eventos (ON, MEM, MSG, BEEP…)', obj({ limite: int('Máximo', { minimum: 1 }) })),
  d('get_sensores', 'leitura', 'Sensores IDF e modo de identificação por endereço (?D)'),
  d('get_bombas', 'leitura', 'Tipo de bomba por endereço (&F)'),
  d('get_equipamento', 'leitura', 'Modelo, firmware, monitor, série, DIPs, bateria (trailer do &S)'),
  d('get_estado_simulador', 'leitura', 'Árvore inteira: perfil, quirks, portas, conexões, timers, lados, bicos, buffer, ponteiros, falhas'),
  d('get_log_comunicacao', 'leitura', 'Log RX/TX/ERRO/INFO (aba Comunicação)', obj({ porta, desde: num('ms (época Unix)'), limite: int('Máximo', { minimum: 1 }) })),
  d('list_conexoes', 'leitura', 'Clientes conectados por porta (Memo2 do 2.7.2, K19)'),
  d('get_displays', 'leitura', 'Displays Total/Volume/Preço e status textual por endereço ("Abastecendo..", 888888 piscando; K25)', obj({ canal })),
  d('list_falhas', 'leitura', 'Falhas injetadas ativas'),
  d('list_snapshots', 'leitura', 'Snapshots salvos'),
  d('list_perfis', 'leitura', 'Perfis disponíveis'),
  d('list_sims', 'leitura', 'Instâncias do simulador neste processo'),
  d('list_gravacoes', 'leitura', 'Gravações JSONL da pasta de gravações (nome, perfil, início, duração, quadros, tamanho)', obj({ dir: str('Pasta (padrão: a de --gravacoes)') })),
  d('list_roteiros_diff', 'leitura', 'Casos do teste diferencial (DIFF-01..20, DIFF-30, BANCADA-1710, EQUIV-*)'),

  // ───────────── 5.2 command via protocol (same effect as the request) ─────────────
  d('incrementar_ponteiro', 'protocolo', 'Avança o ponteiro de leitura da porta (&I) ou da fila de identificadores (?I)', obj({ porta, alvo: enm('abast (&I) ou id (?I)', ['abast', 'id']) })),
  d('set_ponteiro', 'protocolo', 'K18: fixa o ponteiro de leitura da porta; sem valor, sincroniza (leitura = escrita)', obj({ porta, valor: int('Nova posição de leitura'), alvo: enm('abast ou id', ['abast', 'id']) })),
  d('set_modo', 'protocolo', 'Modo do lado do bico (&M): libera L, bloqueia B, autoriza A, stop S, pausa P, idf_on H, idf_off I; clear limpa a lista negra', obj({ bico, modo: enm('Modo', MODOS_SET_MODO) }, ['bico', 'modo'])),
  d('set_preco', 'protocolo', 'Preço por nível (&U), inteiro na escala das casas do preço (ex.: 5899 = 5,899). Vale no próximo abastecimento', obj({ bico, preco: int('Preço inteiro', { minimum: 0 }), nivel: enm('Nível', [0, 1, 2]) }, ['bico', 'preco'])),
  d(
    'preset',
    'protocolo',
    'Preset (&P) por valor em centavos, ou por volume (casas do volume do lado). alvo bico = só aquele bico libera',
    obj({ bico, valor: int('Centavos'), volume: int('Volume inteiro nas casas do lado'), alvo: enm('endereco ou bico', ['endereco', 'bico']), nivel: enm('Nível de preço do abastecimento', [0, 1, 2]) }, ['bico']),
  ),
  d(
    'preset_identificado',
    'protocolo',
    'Preset identificado (?F..P): cartão + teto em valor ou volume + prazo para retirar o bico',
    obj(
      {
        bico,
        cartao: str('16 hex'),
        tipo: enm('Tipo de identificador', ['frentista', 'cliente', 'hodometro']),
        valor: int('Teto em centavos'),
        volume: int('Teto em volume'),
        segundos_retirada: int('Prazo para retirar o bico (0 = sem prazo)', { minimum: 0 }),
        autoriza: bool('Autoriza o lado (padrão true)'),
      },
      ['bico', 'cartao'],
    ),
  ),
  d(
    'gravar_cartao',
    'protocolo',
    'Grava um identificador (?F G). tipo 1..F e permissão 2/4/6/8/A formam o byte CC',
    obj(
      {
        codigo: str('16 hex'),
        tipo: int('Tipo 1..15', { minimum: 0, maximum: 15 }),
        permissao: int('Permissão (nibble alto): 2, 4, 6, 8, 10', { minimum: 0, maximum: 15 }),
        turnoA: obj({ inicio: str('hhmm'), fim: str('hhmm') }, ['inicio', 'fim']),
        turnoB: obj({ inicio: str('hhmm'), fim: str('hhmm') }, ['inicio', 'fim']),
      },
      ['codigo'],
    ),
  ),
  d('excluir_cartao', 'protocolo', 'Exclui um identificador (?F A)', obj({ codigo: str('16 hex') }, ['codigo'])),
  d('limpar_cartoes', 'protocolo', 'Limpa o cadastro de identificadores (?F00L)'),
  d('lista_negra', 'protocolo', 'Lista negra (&M99): poe, tira ou limpa', obj({ acao: enm('Ação', ['poe', 'tira', 'limpa']), codigo: str('16 hex') }, ['acao'])),
  d('set_relogio', 'protocolo', 'Acerta o RTC do concentrador (&KW1 / &H)', obj({ datahora }, ['datahora'])),
  d(
    'configurar_endereco',
    'protocolo',
    'Configura um endereço (&C): nº de bicos (0 desconfigura), tipo de bomba, vírgula; e, por bico, nº de pista, combustível, tanque (K22)',
    obj(
      {
        canal,
        endereco,
        n_bicos: int('0..4', { minimum: 0, maximum: 4 }),
        tipo_bomba: str('Letra do tipo de bomba (W = Wayne)'),
        virgula: str('Código de vírgula em hex ("3A")', { pattern: '^[0-9A-Fa-f]{2}$' }),
        bicos: {
          type: 'array',
          description: 'Campos por bico (posicao 1..4)',
          items: obj(
            {
              posicao: int('1..4'),
              numero_pista: int('1..99'),
              combustivel: int('Código do combustível'),
              tanque: int('Tanque'),
              volume_tanque: int('Volume do tanque'),
            },
            ['posicao'],
          ),
        },
      },
      ['canal', 'endereco', 'n_bicos'],
    ),
  ),
  d(
    'configurar_bico',
    'protocolo',
    'K22: nº de pista, combustível, tanque e volume do tanque de um bico (alimentam PAF1/PAF2, Horustech)',
    obj({ bico, numero_pista: int('1..99'), combustivel: int('Código'), tanque: int('Tanque'), volume_tanque: int('Volume') }, ['bico']),
  ),
  d(
    'configurar_sensor',
    'protocolo',
    'Sensor IDF e modo de identificação 01..14 do endereço (?C). No 2.7.2 o modo é só rótulo',
    obj({ canal, endereco, ligado: bool('Sensor IDF'), modo_identificacao: int('1..14', { minimum: 1, maximum: 14 }) }, ['canal', 'endereco']),
  ),
  d(
    'gravar_encerrante',
    'protocolo',
    'Gravação de totais (&E): encerrante em litros (mL) ou em valor (milésimos de real). painel: como o botão "Gravar totais" do 2.7.2 (com E_272 cria o registro de volume zero)',
    obj({ bico, valor: int('litros: mL; valor: milésimos de real', { minimum: 0 }), unidade: enm('Unidade', ['litros', 'valor']), painel: bool('Botão do painel do 2.7.2') }, ['bico', 'valor']),
  ),
  d('carregar_config_padrao', 'protocolo', 'Botão "Carregar configuração padrão" do 2.7.2 (8 canais × 2 endereços × 2 bicos)'),
  d('enviar_comando_cru', 'protocolo', 'Quadro cru pelo parser ("Simular comando"), como se tivesse chegado na porta. Devolve a resposta exata', obj({ quadro: str('Ex.: (&S)'), porta }, ['quadro'])),
  d(
    'enviar_pela_porta',
    'protocolo',
    'Quadro cru por uma conexão TCP de verdade na porta (127.0.0.1): passa pelo transporte, pelas falhas e pela gravação, e mexe no ponteiro daquela porta',
    obj({ quadro: str('Ex.: (&S)'), porta, timeout_ms: int('Silêncio após (ms), padrão 1000', { minimum: 1 }) }, ['quadro']),
  ),

  // ───────────── 5.3 physical control ─────────────
  d('retirar_bico', 'controle', 'Retira o bico do descanso', obj({ bico }, ['bico'])),
  d('recolocar_bico', 'controle', 'Devolve o bico (encerra o abastecimento, se houver)', obj({ bico }, ['bico'])),
  d('alternar_bico', 'controle', 'Botão "Retira Bico" do 2.7.2: retira, devolve ou encerra', obj({ bico }, ['bico'])),
  d(
    'abastecer',
    'controle',
    'Atalho: retira, autoriza se preciso, vaza até volume/valor/duração e recoloca. Assíncrono: use aguardar_estado',
    obj(
      {
        bico,
        volume: int('mL'),
        valor: int('Centavos'),
        duracao_s: num('Segundos de vazão'),
        vazao_l_s: num('Vazão em L/s (muda o tick de vazão do concentrador inteiro)'),
        cartao1: str('Identificador 1 (frentista), 16 hex'),
        cartao2: str('Identificador 2 (cliente), 16 hex'),
        nivel_preco: enm('Nível de preço', [0, 1, 2]),
        recolocar_ao_fim: bool('Recoloca ao fim (padrão true; o corte por preset sempre encerra)'),
      },
      ['bico'],
    ),
  ),
  d(
    'gerar_abastecimentos',
    'controle',
    'Grava N abastecimentos completos na hora, sem esperar a vazão (encher o buffer, DIFF-17)',
    obj({ bico, quantidade: int('1..10000', { minimum: 1, maximum: 10000 }), volume: int('mL por abastecimento', { minimum: 1 }) }, ['bico', 'quantidade']),
  ),
  d('limpar_buffer', 'controle', 'Esvazia o buffer de abastecimentos: escrita e leitura de todas as portas voltam à 1ª posição'),
  d('apresentar_cartao', 'controle', 'Painel IDF: apresenta um cartão no endereço (desconhecido vai para a fila)', obj({ canal, endereco, codigo: str('16 hex') }, ['canal', 'endereco', 'codigo'])),
  d('set_falha_endereco', 'controle', 'Falha do endereço (Cb_End0x → F)', obj({ canal, endereco, ativo: bool('Falha') }, ['canal', 'endereco', 'ativo'])),
  d('set_automacao', 'controle', 'Automação ligada/desligada (Q7)', obj({ on: bool('Ligada') }, ['on'])),
  d('set_rede_ac', 'controle', 'Rede AC ligada/desligada (bateria)', obj({ ligada: bool('Ligada') }, ['ligada'])),
  d('set_bateria', 'controle', 'Tensão da bateria', obj({ volts: num('Volts (ex.: 12.0)') }, ['volts'])),
  d('set_dip', 'controle', 'DIP switch 1..4', obj({ n: int('1..4', { minimum: 1, maximum: 4 }), on: bool('Ligada') }, ['n', 'on'])),
  // The tick in ms may be fractional: simulador-2.7.2 runs at 109.375 (§29), and `--lembrar` restores
  // the value get_estado_simulador reports (DECISIONS §35).
  d('set_velocidade', 'controle', 'Velocidade da vazão: lento/normal/rapido ou o tick em ms', obj({ velocidade: { anyOf: [{ enum: ['lento', 'normal', 'rapido'] }, { type: 'number', minimum: 1 }], description: 'Velocidade' } }, ['velocidade'])),
  d(
    'set_relogio_simulado',
    'controle',
    'RTC simulado: data/hora, congelado, e a fonte da data dos registros (pc = Q5 do 2.7.2)',
    obj({ datahora, congelado: bool('RTC parado'), fonte_data_registro: enm('pc ou simulado', ['pc', 'simulado']) }),
  ),
  d('avancar_tempo', 'controle', 'Só com relógio manual (--relogio-manual): avança o tempo e roda os ticks', obj({ ms: int('Milissegundos', { minimum: 0 }) }, ['ms'])),
  d('injetar_evento', 'controle', 'K21: grava um evento na memória (ON, MEM, OFF, WDT…)', obj({ tipo: str('Tipo'), texto: str('Texto') }, ['tipo'])),
  d('ciclo_energia', 'controle', 'K21: desliga e liga o concentrador (encerra abastecimentos, OFF + ON "CBC Ligou PWRON")'),
  d('set_quirk', 'controle', 'Liga/desliga um quirk do 2.7.2 (Q1..Q8 e os demais)', obj({ nome: str('Ex.: Q1, Q3, TG'), on: bool('Ligado') }, ['nome', 'on'])),
  d('set_modelo', 'controle', 'K26: combo Modelo do 2.7.2 (CBC-02/05/06, Horustech), sem trocar de perfil', obj({ modelo: enm('Modelo', ['CBC-01', 'CBC-02', 'CBC-04', 'CBC-05', 'CBC-06', 'Horustech', 'Concept']) }, ['modelo'])),
  d('set_firmware', 'controle', 'K26: firmware do trailer do &S e dos gates (deriva o perfil atual)', obj({ firmware: str('Ex.: V8.4') }, ['firmware'])),

  // ───────────── 5.3 faults and infrastructure ─────────────
  d(
    'injetar_falha',
    'infra',
    'Falha de transporte: sem_resposta, atraso, frame_corrompido, truncado, checksum_errado, fragmentar, resposta_dupla, erro, desconectar, travamento',
    obj(
      {
        tipo: enm('Tipo', ['sem_resposta', 'atraso', 'frame_corrompido', 'truncado', 'checksum_errado', 'fragmentar', 'resposta_dupla', 'erro', 'desconectar', 'travamento']),
        porta,
        verbo: str('Prefixo do quadro sem "(": "&S", "&T", "?A", ">?"; "*" = todos'),
        param: obj({
          ms: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }], description: 'atraso/fragmentar/travamento (null = até liberar)' },
          bytes: int('frame_corrompido/truncado: quantos chars'),
          partes: int('fragmentar: em quantos writes'),
          codigo: str('erro: ?t, ?b, ?r, ?m, ?f'),
          modo: enm('desconectar', ['rst', 'fin']),
          aplicar: bool('false = o quadro não chega ao simulador'),
        }),
        vezes: { anyOf: [{ type: 'integer', minimum: 1 }, { const: 'sempre' }], description: 'Padrão 1' },
        probabilidade: num('0..1 (PRNG com semente)', { minimum: 0, maximum: 1 }),
      },
      ['tipo'],
    ),
  ),
  d('limpar_falhas', 'infra', 'Remove uma falha (id) ou todas', obj({ id: int('Id da falha') })),
  d('desconectar', 'infra', 'Derruba conexões (RST ou FIN) e/ou passa a recusar novas', obj({ porta, cliente: int('Id da conexão'), modo: enm('rst ou fin', ['rst', 'fin']), recusar_conexoes: bool('Recusar novas conexões') })),
  d('travar', 'infra', 'MessageBox modal por ms (sem ms = até liberar). No 2.7.2 (Q2) o socket segue atendendo; nos perfis reais congela o concentrador (falha sintética)', obj({ ms: int('Milissegundos', { minimum: 1 }), motivo: str('Texto') })),
  d('liberar_travamento', 'infra', 'Fecha o "MessageBox"'),
  d('configurar_travamento', 'infra', 'Q2: quanto tempo um MessageBox do protocolo fica aberto (0 = OK imediato; null = até liberar). As respostas que o 2.7.2 dá depois do OK (E3) saem quando ele fecha', obj({ ms: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }], description: 'ms' } }, ['ms'])),
  d('set_perfil', 'infra', 'Troca o perfil (mantém o estado físico; reabre as portas se mudarem)', obj({ perfil: str('Id do perfil') }, ['perfil'])),
  d('abrir_porta', 'infra', 'Abre uma porta TCP (no 2.7.2 troca a porta única)', obj({ tipo: enm('tcp', ['tcp']), porta }, ['porta'])),
  d('fechar_porta', 'infra', 'Fecha uma porta TCP e as conexões dela', obj({ tipo: enm('tcp', ['tcp']), porta }, ['porta'])),
  d(
    'gravar_inicio',
    'infra',
    'Começa a gravar o tráfego bruto em JSONL (sem arquivo: em memória; na_pasta: um arquivo novo na pasta de gravações)',
    obj({ arquivo: str('Caminho do .jsonl'), na_pasta: bool('Cria trafego-<data-hora>.jsonl na pasta de gravações') }),
  ),
  d('gravar_fim', 'infra', 'Para a gravação. Em memória, devolve as linhas', obj()),
  d(
    'replay',
    'infra',
    'Replay de uma gravação: servidor (faz o papel do concentrador gravado) ou cliente (manda os rx contra um alvo e compara)',
    obj(
      {
        arquivo: str('JSONL gravado'),
        modo: enm('servidor ou cliente', ['servidor', 'cliente']),
        velocidade: num('1 = tempos gravados; 0 = sem espera'),
        alvo: str('cliente: host:porta (padrão: 127.0.0.1 e a porta gravada)'),
        portas: { type: 'object', description: 'servidor: porta gravada → porta de escuta', additionalProperties: { type: 'integer' } },
      },
      ['arquivo', 'modo'],
    ),
  ),
  d('replay_parar', 'infra', 'Fecha os servidores de replay abertos'),
  d('snapshot_salvar', 'infra', 'Salva o estado inteiro em memória com um nome', obj({ nome: str('Nome') }, ['nome'])),
  d('snapshot_carregar', 'infra', 'Restaura um snapshot', obj({ nome: str('Nome') }, ['nome'])),
  d('reset', 'infra', 'Reinicia o concentrador. manter_config guarda endereços, preços, cartões e lista negra', obj({ manter_config: bool('Manter a configuração') })),
  d(
    'diff_executar',
    'infra',
    'Teste diferencial: roda um roteiro (DIFF-01..20, DIFF-30 ou BANCADA-1710) contra dois alvos host:porta e compara byte a byte',
    obj(
      {
        roteiro: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'Id(s) do caso, ou "todos"' },
        alvo_a: str('host:porta'),
        alvo_b: str('host:porta'),
        timeout_ms: int('Silêncio após (ms), padrão 1000'),
        controle_a: str('URL de controle do alvo A (driver da UI do 2.7.2 ou API do pump-sim)'),
        controle_b: str('URL de controle do alvo B'),
        tipo_controle_a: enm('driver (padrão no A) ou pump-sim', ['driver', 'pump-sim']),
        tipo_controle_b: enm('pump-sim (padrão no B) ou driver', ['driver', 'pump-sim']),
        drenar_antes: bool('Drena os abastecimentos pendentes do alvo A antes do 1º caso'),
        plataforma_a: enm('windows (padrão, tudo byte a byte) ou wine: o 2.7.2 do A roda no Wine e a vazão livre compara com tolerância de ±10%', ['windows', 'wine']),
      },
      ['roteiro', 'alvo_a', 'alvo_b'],
    ),
  ),
  d('aguardar_estado', 'infra', 'Espera o bico chegar à letra de status (L, B, C, A, E, F, P)', obj({ bico, status: enm('Letra', ['L', 'B', 'C', 'A', 'E', 'F', 'P']), timeout_ms: int('Padrão 10000', { minimum: 1 }) }, ['bico', 'status'])),
  d('importar_simcnf', 'infra', 'K20: importa um c:\\simcnf.ini do 2.7.2 (linhas &C, encerrantes/preços por bico e cartões)', obj({ conteudo: str('Texto do arquivo'), arquivo: str('Caminho') })),
  d('importar_log', 'infra', 'K20: importa um companytec.log ([CONF](&C…) reaplicado; [..] vira evento)', obj({ conteudo: str('Texto do arquivo'), arquivo: str('Caminho') })),
  d('criar_sim', 'infra', 'Cria outra instância no mesmo processo', obj({ sim_id: str('Id'), perfil: str('Perfil'), portas: { type: 'array', items: { type: 'integer' } } }, ['sim_id', 'perfil'])),
  d('remover_sim', 'infra', 'Fecha e remove uma instância', obj({ sim_id: str('Id') }, ['sim_id'])),
];

export const NOMES_COMANDOS = new Set(CATALOGO.map((c) => c.nome));

export function defComando(nome: string): DefComando | undefined {
  return CATALOGO.find((c) => c.nome === nome);
}

/** Exposed schema (MCP/HTTP): the params + `sim_id`. */
export function schemaComSimId(c: DefComando): Schema {
  const p = c.params as { properties?: Record<string, Schema>; required?: string[] };
  return {
    type: 'object',
    properties: { sim_id: { type: 'string', description: 'Instância (padrão "default")' }, ...(p.properties ?? {}) },
    required: p.required ?? [],
    additionalProperties: false,
  };
}
