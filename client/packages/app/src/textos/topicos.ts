import { plural } from "nucleo/lib/plural";

/** Textos da lista de tópicos do canal: botão do cabeçalho, painel, recortes, estados e seguidos na coluna. */
export const topicos = {
  /** O botão do cabeçalho (liga e desliga o painel). */
  botao: "Tópicos",
  painel: "Tópicos do canal",
  titulo: "Tópicos",
  fechar: "Fechar os tópicos",
  fecharComAtalho: "Fechar os tópicos com Esc",

  recortes: {
    rotulo: "Recorte dos tópicos",
    ativos: "Ativos",
    arquivados: "Arquivados",
  },

  lista: {
    rotulo: (recorte: string) => `Tópicos ${recorte}`,
    abrir: (nome: string) => `Abrir o tópico ${nome}`,
    respostas: (n: number | undefined) =>
      n === undefined ? "—" : n === 0 ? "Sem respostas" : plural(n, "resposta", "respostas"),
    arquivado: "Arquivado",
  },

  estados: {
    carregando: "Carregando os tópicos…",
    vazioAtivos: "Nenhum tópico ativo neste canal",
    vazioAtivosDica: "Crie um tópico a partir de uma mensagem para a conversa ter o próprio fio.",
    vazioArquivados: "Nenhum tópico arquivado neste canal",
    erro: "Não foi possível carregar os tópicos.",
    tentarDeNovo: "Tentar de novo",
  },

  /** Os seguidos aninhados sob o canal pai, na coluna de canais. */
  seguidos: {
    rotulo: (canal: string) => `Tópicos que você segue em ${canal}`,
  },
} as const;
