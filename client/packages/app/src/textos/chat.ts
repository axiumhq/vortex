import { plural } from "nucleo/lib/plural";
import { causaDaFalha } from "nucleo/notificacao/falhaDeEnvio";

export const chat = {
  mensagem: "Mensagem",
  campoDeMensagem: "Escrever mensagem",
  placeholderDoCampo: (canal: string) => `Conversar em ${canal}`,
  placeholderDasNotas: "Escreva uma nota",
  /** DM e grupo: o campo fala com pessoas, não com um canal. */
  placeholderDaConversa: (nome: string) => `Conversar com ${nome}`,
  enviar: "Enviar",
  responder: "Responder",
  anexar: "Anexar arquivo",
  semMensagens: "Ainda não há mensagens aqui.",
  falhaNoEnvio: "Não foi possível enviar a mensagem.",
  novasMensagens: (n: number) => plural(n, "nova mensagem", "novas mensagens"),
  digitando: (nome: string) => `${nome} está digitando…`,
  editada: "editada",
  listaDeMensagens: "Mensagens",
  autorDesconhecido: "Alguém",
  /** Só para tipo de evento que o cliente não conhece. */
  eventoDoCanal: "Aconteceu algo no canal.",

  /** Prévias de link sob a mensagem. */
  embeds: {
    maisN: (n: number) => `e mais ${n}`,
    reproduzir: (servico: string) => `Reproduzir ${servico}`,
    abrirImagem: "Abrir a imagem do link",
    video: "Vídeo do link",
  },

  /** Cabeçalho do canal. */
  cabecalho: {
    rotulo: "Cabeçalho do canal",
    restrito: "Canal restrito",
  },

  /**
   * Linhas de sistema. Cada função recebe UM valor (o catálogo é varrido por
   * amostras de um argumento só): a frase é montada em `FraseDeSistema`,
   * juntando sujeito + verbo daqui. `n` é quantas pessoas a linha cobre, para
   * a concordância (entrou / entraram).
   */
  sistema: {
    conjuncao: "e",
    maisN: (n: number) => `e mais ${n}`,
    entrou: (n: number) => (n === 1 ? "entrou" : "entraram"),
    saiu: (n: number) => (n === 1 ? "saiu" : "saíram"),
    expulso: (n: number) => (n === 1 ? "foi expulso" : "foram expulsos"),
    banido: (n: number) => (n === 1 ? "foi banido" : "foram banidos"),
    entrouNoTopico: (n: number) => (n === 1 ? "entrou no tópico" : "entraram no tópico"),
    adicionou: "adicionou",
    removeu: "removeu",
    renomeou: "renomeou o canal para",
    transferiu: "passou o canal para",
    moveu: "mudou para",
    mudouDescricao: (por: string) => `${por} mudou a descrição do canal`,
    mudouIcone: (por: string) => `${por} mudou o ícone do canal`,
    fixou: (por: string) => `${por} fixou uma mensagem`,
    desafixou: (por: string) => `${por} desafixou uma mensagem`,
    chamadaEmAndamento: (por: string) => `${por} iniciou uma chamada`,
    chamadaTerminou: (por: string) => `Chamada de ${por} terminou`,
    durou: (duracao: string) => `durou ${duracao}`,
    transmitiu: (a: string) => `${a} começou a transmitir a tela`,
    canalDesconhecido: "outra sala",
  },

  comecoDoCanal: "Este é o começo do canal.",

  /* Histórico */
  carregandoMensagens: "Carregando mensagens…",
  carregandoAnteriores: "Carregando mensagens anteriores…",
  falhaAoCarregar: "Não foi possível carregar as mensagens.",
  tentarDeNovo: "Tentar de novo",
  comecoDoCanalDe: (nome: string) => `Este é o começo de #${nome}`,
  comecoDaSala: (nome: string) => `Este é o começo do chat de ${nome}`,
  comecoDaConversa: (nome: string) => `Este é o começo da sua conversa com ${nome}`,
  comecoDasNotas: "Este é o começo das suas notas",
  dicaDoComeco: "Escreva a primeira mensagem logo abaixo.",
  dicaDoComecoSemPermissao: "Quem pode escrever aqui ainda não escreveu nada.",

  /* Leitura como posição */
  novas: "Novas mensagens",
  irParaNaoLida: "Ir para a primeira não lida",
  proximaMencao: "Próxima menção",
  irParaOFim: "Ir para as mensagens recentes",

  /* Composer */
  semPermissaoParaEscrever: "Você não pode escrever neste canal.",
  semPermissaoNaSala: "Você não pode escrever no chat desta sala.",
  respondendoA: (nome: string) => `Respondendo a ${nome}`,
  cancelarResposta: "Cancelar resposta",
  mencionarResposta: "Mencionar",
  mencionarRespostaDica: (mencionar: boolean) =>
    mencionar
      ? "Quem escreveu será avisado · toque para responder sem avisar"
      : "Quem escreveu não será avisado · toque para avisar",
  respostaAvisa: "Avisa",
  respostaSemAviso: "Sem aviso",
  responderSemMencionar: "Responder sem mencionar",
  respostaIndisponivel: "Mensagem indisponível",
  removerAnexo: (nome: string) => `Remover ${nome}`,
  anexosSelecionados: "Arquivos para enviar",
  arquivoGrande: (nome: string) => `${nome} é grande demais para enviar.`,
  limiteDeEnvio: (teto: string) => `O limite aqui é ${teto}.`,
  negrito: "Negrito",
  italico: "Itálico",

  /* Estados de envio */
  enviando: "Enviando…",
  naFilaSemConexao: "Na fila · sem conexão",
  naoEnviada: "Não enviada",
  /** A causa vem do núcleo: linha, aviso e rodapé do campo usam a mesma frase. */
  causaDaFalha,
  falhadasNoCanal: (n: number, conectado: boolean) =>
    `${plural(n, "mensagem não enviada", "mensagens não enviadas")} · ${causaDaFalha(conectado)}`,
  reenviar: "Reenviar",
  descartar: "Descartar",
  enviandoArquivo: (porcento: number) => `Enviando arquivo… ${porcento}%`,
  cancelarEnvio: "Cancelar envio",

  /* Player de áudio */
  player: {
    reproduzir: "Reproduzir",
    pausar: "Pausar",
    posicao: (nome: string) => `Posição de ${nome}`,
    valorDaPosicao: (atual: string, total = "0:00") => `${atual} de ${total}`,
    falhou: "Não foi possível tocar o áudio.",
  },

  /* Ações da mensagem */
  reagirComEmoji: (emoji: string) => `Reagir com ${emoji}`,
  reagirRotulo: "Reagir",
  copiarTexto: "Copiar texto",
  textoCopiado: "Texto copiado.",
  editar: "Editar",
  apagar: "Apagar",
  fixar: "Fixar",
  desafixar: "Desafixar",
  fixada: "Fixada",
  marcarNaoLida: "Marcar como não lida",
  editandoMensagem: "Editando mensagem",
  salvarEdicao: "Salvar",
  cancelarEdicao: "Cancelar",
  dicaDeEdicao: "Esc cancela · Enter salva",
  falhaAoEditar: "Não foi possível salvar a edição.",
  confirmarApagarTitulo: "Apagar mensagem?",
  confirmarApagarTexto: "A mensagem some para todo mundo e não dá para desfazer.",
  falhaAoApagar: "Não foi possível apagar a mensagem.",
  menuDaMensagem: "Ações da mensagem",

  /* Anexos */
  baixar: "Baixar",
  abrirAnexo: (nome: string) => `Abrir ${nome}`,
  visualizador: {
    titulo: (autor: string) => `Imagem de ${autor}`,
    anterior: "Imagem anterior",
    proxima: "Próxima imagem",
    de: "de",
    emCanal: (canal: string) => `em #${canal}`,
  },

  /* Enquete na linha */
  enquete: {
    tipo: (maximo: number) =>
      maximo > 1 ? "Enquete · múltiplas respostas" : "Enquete · uma resposta",
    encerrada: "Enquete encerrada",
    /** Selo em caixa alta, como o resto dos selos do app. */
    sinalResultado: "Resultado",
    rodapeEncerrada: (total: number) => `${plural(total, "voto", "votos")} · encerrada`,
    fechaEmDias: (n: number) => `fecha em ${n} d`,
    fechaEmHoras: (n: number) => `fecha em ${n} h`,
    fechaEmMinutos: (n: number) => `fecha em ${n} min`,
    fechando: "fechando",
    vencedora: "Mais votada",
  },

  /* Criar enquete (botão no campo e diálogo) */
  criarEnquete: {
    botao: "Criar enquete",
    titulo: "Criar enquete",
    descricao: "Quem estiver no canal vota direto na mensagem.",
    pergunta: "Pergunta",
    perguntaDica: "O que você quer perguntar?",
    respostas: "Respostas",
    resposta: (n: number) => `Resposta ${n}`,
    moverResposta: (n: number) => `Mover resposta ${n}`,
    moverDica: "Arraste ou use Alt e as setas para mudar a ordem",
    removerResposta: (n: number) => `Remover resposta ${n}`,
    adicionarResposta: (max: number) => `Adicionar resposta · até ${max}`,
    restam: (n: number) => (n === 1 ? "1 caractere restante" : `${n} caracteres restantes`),
    tipo: "Tipo",
    umaResposta: "Uma resposta",
    multiplasRespostas: "Múltiplas respostas",
    duracao: "Duração",
    duracoes: {
      oitoHoras: "8 horas",
      umDia: "1 dia",
      tresDias: "3 dias",
      umaSemana: "1 semana",
    },
    resultadoNoFim: "Resultado só no fim",
    resultadoNoFimDica: "A contagem fica escondida até a enquete fechar.",
    criar: "Criar",
    erros: {
      perguntaVazia: "Escreva a pergunta.",
      perguntaLonga: (max: number) => `A pergunta passa de ${max} caracteres.`,
      poucasRespostas: "Preencha pelo menos duas respostas.",
      respostaLonga: (max: number) => `Cada resposta tem até ${max} caracteres.`,
    },
  },

  /* Seletor de emoji */
  emoji: {
    maisReacoes: "Mais reações",
    seletor: "Escolher emoji",
    buscar: "Buscar emoji",
    categorias: "Categorias",
    recentes: "Usados recentemente",
    resultados: "Resultados",
    semResultado: (busca: string) => `Nenhum emoji para ${busca}.`,
    carregando: "Carregando emojis…",
  },
} as const;
