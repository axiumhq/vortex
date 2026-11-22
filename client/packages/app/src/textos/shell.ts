/** Textos do shell fixo: regiões, estados vazios e controles da gaveta e da barra de título. */
export const shell = {
  barraDeTitulo: {
    rotulo: "Barra de título",
    minimizar: "Minimizar a janela",
    maximizar: "Maximizar a janela",
    restaurar: "Restaurar a janela",
    fechar: "Fechar a janela",
  },
  conexao: {
    rotulo: "Estado da conexão",
    reconectando: (desde: string) => `Reconectando… há ${desde}`,
    semConexao: (desde: string) => `Sem conexão · há ${desde}`,
    reconectandoSemTempo: "Reconectando…",
    semConexaoSemTempo: "Sem conexão",
  },
  dock: {
    rotulo: "Servidores",
    vazio: "Nenhum servidor ainda.",
  },
  salas: {
    rotulo: "Salas e canais",
    vazio: "Escolha um servidor para ver as salas.",
  },
  faixa: {
    rotulo: "Salas",
    canais: "Canais de texto",
    vazia: "vazia",
    recolher: "Recolher as salas",
    expandir: "Mostrar as salas",
  },
  principal: {
    rotulo: "Conversa",
    vazio: "Escolha uma sala para começar a conversar.",
  },
  erro: {
    rotulo: "Erro",
    frase: "Algo deu errado aqui. O resto do app segue funcionando.",
  },
  gaveta: {
    rotulo: "Membros online",
    titulo: "Online",
    vazio: "Ninguém online agora.",
    offline: "Offline",
    carregando: "Carregando os membros",
    desatualizada: "Presença desatualizada",
    mostrarIcones: "Mostrar só os ícones",
    mostrarLista: "Mostrar a lista",
  },
} as const;
