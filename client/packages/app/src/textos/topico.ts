/** Textos de um tópico aberto na área principal: criar, cabeçalho, mensagem de origem e aviso de arquivado. */
export const topico = {
  /** Na barra de ações e no menu da mensagem. */
  criar: "Criar tópico",
  abrir: "Abrir tópico",

  dialogo: {
    titulo: "Criar tópico",
    descricao: "As respostas ficam no tópico, sem encher o canal.",
    rotuloDoNome: "Nome do tópico",
    nomeObrigatorio: "Dê um nome ao tópico.",
    confirmar: "Criar tópico",
  },

  cabecalho: {
    rotulo: "Cabeçalho do tópico",
    voltar: (pai: string) => `Voltar para #${pai}`,
    voltarSemNome: "Voltar ao canal",
    em: (pai: string) => `em #${pai}`,
    /** Nome estável; o estado vai no `aria-pressed`. */
    seguir: "Seguir tópico",
    seguirVisivel: "Seguir",
    seguindoVisivel: "Seguindo",
    arquivar: "Arquivar tópico",
    reabrir: "Reabrir tópico",
    arquivado: "Arquivado",
  },

  origem: {
    rotulo: "Mensagem que iniciou o tópico",
    iniciou: "iniciou o tópico",
    apagada: "A mensagem que iniciou este tópico foi apagada.",
  },

  arquivado: "Este tópico está arquivado. Responder aqui o reabre.",
} as const;
