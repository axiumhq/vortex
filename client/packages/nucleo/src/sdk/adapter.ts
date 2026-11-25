/**
 * A ponte stoat.js → React. A peça mais crítica do projeto.
 *
 * Não é overhead de migração: é a camada onde a granularidade de update é
 * decidida, e portanto onde a performance do app é definida.
 *
 * Duas granularidades, e a separação entre elas é o ponto:
 *
 *   coleção  → assina lista de IDs, alimentada por evento do Client em O(1)
 *   entidade → assina a si mesma, via efeito Solid sobre os getters do SDK
 *
 * Editar uma mensagem toca uma linha. Mensagem nova toca a lista, mas a lista
 * só renderiza IDs — as linhas existentes têm as mesmas keys e não remontam.
 *
 * Este é o ÚNICO módulo, junto de `map.ts` e `client.ts`, que importa
 * `stoat.js`. O lint de boundary garante isso.
 */
import { createEffect, createRoot, createSignal } from "solid-js";
import { ligarAtividades } from "./atividades";
import { ligarFiltroDeMidia } from "./filtroDeMidia";
import { decodeTime, monotonicFactory } from "ulid";
import type { Message } from "stoat.js";
/**
 * `ReactiveSet` do SDK, construído aqui.
 *
 * Dependência DIRETA acrescentada de propósito, e a justificativa é a mesma
 * que já vale para `VoiceParticipant`: esta camada constrói coleções reativas
 * com a forma que o `stoat.js` espera, e é o único lugar do app autorizado a
 * conhecer essa forma.
 *
 * A alternativa era um `Set` comum. Ele passaria no typecheck e funcionaria
 * para a MINHA reação otimista — e falharia calado depois: uma reação de
 * outra pessoa naquele mesmo emoji não dispararia o efeito, porque `Set` não
 * é reativo. Um chip que para de contar sem erro é exatamente o tipo de bug
 * que este projeto persegue.
 *
 * Já estava no lockfile como transitiva do SDK: não há superfície nova.
 */
import { ReactiveSet } from "@solid-primitives/set";

import { count } from "../arnes/stats";
import { createEntityStore } from "../store/entities";
import { createEphemeralStore } from "../store/ephemeral";
import { client, conectado } from "./client";
import { subirAnexo } from "./anexos";
import {
  figurinhaDaMensagem,
  instalarFigurinhasDeMensagem,
  registrarFigurinhaLocal,
} from "./figurinhasDeMensagem";
import { instalarExpressoes } from "./eventosDeExpressoes";
import { formatarBytes } from "../lib/bytes";
import { toast } from "../ui-logica/toastStore";
import { motivoDoErro } from "./erros";
import {
  criarMedidorDeTaxa,
  esquecerUpload,
  progressoDeUpload,
  registrarCancelamento,
} from "../store/uploads";
import { definirEuDasEnquetes, lerEnquete } from "../store/enquetes";
import { anotarEventoDeEnquete, buscarMensagensComEnquetes } from "./enquetes";
import { anotarEventoDeVoz, consumirModosAlterados } from "./vozDoCanal";
import {
  aplicarEventoDeVoz,
  canalDeVozDaPessoa,
  colocarNaSala,
  colocarOtimista,
  desfazerOtimista,
  participantesDaSala,
  tirarDaSala,
} from "./salasDeVoz";
import {
  avisarMudoDoServidor,
  avisarSurdoDoServidor,
  lerAutorImposto,
  lerMovimentoImposto,
  registrarAutorImposto,
  registrarMovimentoImposto,
} from "./vozImposta";
import {
  ehLinhaDeSala,
  linhasDoEvento,
  registrarLinhaDeSala,
  soltarLinhasDe,
} from "./eventosDaSala";
import { assinarChamada, lerChamada } from "../store/chamada";
import { definirProntidao } from "../store/prontidao";
import { aplicarFixacao, removerFixada } from "../store/fixados";
import { anotarEventoDeServidor } from "./eventos";
import { semearStatusDoServidor } from "./perfil";
import { aguardar, desistir, reconciliar } from "./nonce";
import {
  assinarConexao,
  definirConexao,
  lerConexao,
} from "../store/conexao";
import {
  confirmarNaFila,
  desmarcarFalhada,
  desmarcarPendente,
  esquecerDaFila,
  marcarFalhada,
  marcarPendente,
} from "../store/fila";
import { assinarSilencio, estaMudo, segueTopicosAutomaticamente } from "../store/silencio";
import { registrarUsoDeReacao } from "../store/reacoesFrequentes";
import { assinarFavoritos, lerFavoritos, ordenarComFavoritas } from "../store/favoritos";
import { assinarPrivacidade, lerPrivacidade } from "../store/privacidade";
import {
  aceitaDm,
  algumaRestricaoDeDm,
  assinarPrivacidadeDoServidor,
  lerPrivacidadeDoServidor,
  privacidadeRestringe,
} from "../store/privacidadeDoServidor";
import {
  assinarSolicitacoes,
  decisaoSobre,
  destinoDaConversa,
  inicioDasSolicitacoes,
  type Destino,
} from "../store/solicitacoes";
import {
  atualizarContador,
  definirCanalVisto,
  notificarAmizade,
  notificarMensagem,
} from "../notificacao/notificador";
import { avisarFalhaDeEnvio } from "../notificacao/falhaDeEnvio";
import { pode } from "./permissoes";
import { notificarMudancaDePermissoes } from "../store/permissoes";
import { mudancaDeAmizade } from "../notificacao/decidir";
import { emFila } from "../lib/fila";
import {
  naoLidasQueSobem,
  somarConversas,
  somarPorServidor,
  type InfoDeTopico,
} from "./somaDeNaoLidas";
import { aceitarAmizade, buscarEmComum, desfazerAmizade } from "./social";
import { sincronizarPush } from "../notificacao/push";
import { dentro } from "../store/sessao";
import {
  sinalizarChamada,
  sinalizarFimDeChamada,
} from "../notificacao/chamadas";
import {
  baldeDe,
  SEM_CARGO,
  usuarioDaChave,
  type Balde,
  type ChannelSnapshot,
  CATEGORIA_PADRAO,
  type CategoriaDeCanais,
  chaveDeMembro,
  type ChaveDeMembro,
  type EstadoDeVoz,
  type MemberSnapshot,
  type ParticipanteDeVoz,
  type SecaoDeMembros,
  type MessageSnapshot,
  type PresenceStatus,
  type RelacaoSnapshot,
  type SendState,
  type ServerSnapshot,
} from "./domain";
import { calcularLayout, type Layout } from "./agrupamento";
import {
  aplicarEventoCru as aplicarEventoCruDeCanal,
  assinarMetaDeCanal,
  lerTopico,
} from "./vortexCanal";
import {
  ehEntradaNoTopico,
  juntarOuAbrir,
  quemEntrou,
  registrarEntrada,
} from "./entradasNoTopico";
import { desfazerSeguirAoResponder } from "./seguirAoResponder";
import { criarNotificadorDeDigitacao } from "./digitando";
import { instalarSync, puxarConfiguracoes } from "./sincronizar";
import { aplicarEventoCru, avisarCanaisVortex, superficie } from "./superficieVortex";
import { ulidAnterior } from "../lib/ulid";
import {
  ehCanalDeVoz,
  toChannelSnapshot,
  toRelacaoSnapshot,
  toMemberSnapshot,
  toMessageSnapshot,
  presencaDe,
  toServerSnapshot,
  relacaoDoProtocolo,
} from "./map";

/* ----------------------------------------------------------- layout */

/**
 * Agrupamento e divisor de data por mensagem.
 *
 * Depende do VIZINHO, e a lei nº 1 diz que a linha assina só a si mesma —
 * então a dependência é resolvida aqui, na escrita, e chega ao componente já
 * como campo do snapshot.
 *
 * O que torna isso barato: `authorId` e `createdAt` são imutáveis depois da
 * criação. Editar uma mensagem, reagir a ela ou resolver um upload NÃO mexem
 * no layout de ninguém. Só inserção e remoção mexem — e aí só nos vizinhos
 * imediatos, não na lista.
 */
const layouts = new Map<string, Layout>();

const PADRAO: Layout = {
  iniciaGrupo: true,
  dia: undefined,
  primeiraNaoLida: false,
};

export function layoutDe(id: string): Layout {
  return layouts.get(id) ?? PADRAO;
}

/* -------------------------------------------------------- cursor de leitura */

/**
 * Onde a pessoa PAROU de ler, por canal.
 *
 * Guarda o ID da última mensagem lida — posição, não contagem. É a diferença
 * entre "tem 47 coisas novas" e "você parou AQUI", e é a segunda que faz
 * alguém conseguir voltar a um canal movimentado sem desistir.
 *
 * ⚠ Fase 6: isto EXISTE no protocolo — `ChannelUnread.lastMessageId`, e
 * `Message.ack()` escreve de volta. Hoje é local; a semeadura a partir de
 * `channelUnreads` no `Ready` já está listada como pendência, e quando ela
 * chegar o cursor passa a sobreviver entre dispositivos de graça.
 */
const cursorDeLeitura = new Map<string, string>();

/** Canais marcados como não lidos nesta sessão — ver `avancarCursor`. */
const naoLidaManual = new Set<string>();


/**
 * A primeira não lida de um canal — a que recebe o divisor.
 *
 * `undefined` quando não há cursor (nunca visitado) ou quando o cursor já é a
 * última: nos dois casos não existe "primeira não lida", e desenhar o divisor
 * no topo do histórico seria dizer que TUDO é novo.
 */
function primeiraNaoLidaDe(channelId: string): string | undefined {
  const cursor = cursorDeLeitura.get(channelId);
  if (!cursor) return undefined;

  const ids = idsOf(channelId);
  const indice = ids.indexOf(cursor);
  if (indice === -1) return undefined;

  /*
    ⚠ **A própria mensagem nunca é "nova".** Com o cursor na última lida, a
    primeira coisa que EU escrevo seria a primeira depois dele, e o divisor
    "novas mensagens" apareceria em cima da minha fala. Pula as minhas: o que
    importa é a primeira que OUTRA pessoa escreveu depois de onde parei.
  */
  for (let i = indice + 1; i < ids.length; i += 1) {
    const id = ids[i];
    if (id === undefined) continue;
    const autor = client.messages.get(idDoSdk(id))?.authorId;
    if (usuarioLocal !== undefined && autor === usuarioLocal) continue;
    return id;
  }
  return undefined;
}

/**
 * Avança o cursor até o fim do canal.
 *
 * Chamado ao SAIR do canal, não ao entrar — e essa é a decisão que faz o
 * divisor servir para alguma coisa. Avançando na entrada, ele sumiria no
 * mesmo frame em que apareceu: a pessoa abriria o canal e veria a lista sem
 * marca nenhuma de onde tinha parado.
 *
 * Discord faz assim, e a razão é essa: "lido" é o que você JÁ viu, e você só
 * viu quando saiu.
 */
function avancarCursor(channelId: string): void {
  /*
    Quem marcou como não lida AQUI pediu exatamente o contrário de "saí, então
    li". Sem este desvio, o item de menu valeria até o próximo clique no rail.
    Consumido uma vez: voltar ao canal e sair de novo é leitura normal.
  */
  if (naoLidaManual.delete(channelId)) return;

  const ids = idsOf(channelId);
  const ultima = ids[ids.length - 1];
  if (!ultima) return;

  const anterior = cursorDeLeitura.get(channelId);
  if (anterior === ultima) return;

  cursorDeLeitura.set(channelId, ultima);

  // A linha que era a primeira não lida deixa de ser: recalcula o trecho e
  // re-emite só quem mudou.
  const antiga = anterior ? ids.indexOf(anterior) : -1;
  recalcularLayout(channelId, antiga, ids.length - 1);
}

/** Dados que o agrupamento precisa, lidos do SDK. */
function vizinho(id: string | undefined) {
  if (!id) return null;
  const m = client.messages.get(id);
  if (!m) return null;
  return {
    authorId: m.authorId,
    createdAt: m.createdAt.getTime(),
    // `!!` e não o objeto: o `Vizinho` é comparado por campo, e carregar a
    // instância do SDK aqui vazaria o protocolo para dentro do módulo de
    // agrupamento, que é puro de propósito.
    ehSistema: Boolean(m.systemMessage),
    // Responder quebra o grupo — ver `calcularLayout`. Booleano e não a lista:
    // o agrupamento só precisa saber SE responde, não a quem.
    responde: (m.replyIds?.length ?? 0) > 0,
  };
}

/**
 * Recalcula o layout de um trecho e re-emite os snapshots que mudaram.
 *
 * Re-emitir só quem mudou é o que preserva o `memo` da linha: publicar um
 * snapshot novo para toda a lista faria as 25 linhas visíveis re-renderizarem
 * a cada mensagem que chega.
 */
function recalcularLayout(channelId: string, de: number, ate: number) {
  const ids = idsOf(channelId);
  const inicio = Math.max(0, de);
  const fim = Math.min(ids.length - 1, ate);

  for (let i = inicio; i <= fim; i++) {
    const id = ids[i];
    if (!id) continue;

    const atual = vizinho(id);
    if (!atual) continue;

    const base = calcularLayout(atual, vizinho(ids[i - 1]));
    // O cursor entra POR COMPOSIÇÃO: `calcularLayout` é puro sobre dois
    // vizinhos e não conhece estado de leitura, que é do cliente.
    const novo: Layout = {
      ...base,
      primeiraNaoLida: id === primeiraNaoLidaDe(channelId),
    };

    const velho = layouts.get(id);
    if (
      velho &&
      velho.iniciaGrupo === novo.iniciaGrupo &&
      velho.dia === novo.dia &&
      velho.primeiraNaoLida === novo.primeiraNaoLida
    ) {
      continue;
    }

    layouts.set(id, novo);

    // Só re-emite o que alguém está olhando. Snapshot de mensagem fora da
    // janela é recalculado quando a linha montar.
    const message = client.messages.get(id);
    if (message && messages.subscriberCount(id) > 0) {
      messages.set(
        id,
        toMessageSnapshot(message, novo, estadoDeEnvioDe(id), usuarioLocal, lerEnquete(id)),
      );
    }
  }
}

/* ------------------------------------------------------- estado de envio */

/**
 * Estado de envio por mensagem.
 *
 * O protocolo não tem esse conceito: para o servidor, ou a mensagem existe ou
 * não existe. "Pendente" e "falhou" são estados do CLIENTE, e é exatamente o
 * tipo de coisa que a camada anticorrupção existe para comportar — o modelo do
 * Vortex é mais rico que o do Stoat, e essa diferença fica aqui, num Map, em
 * vez de virar um campo opcional espalhado pelo app.
 *
 * Vive fora do snapshot pelo mesmo motivo do layout: é derivação de escrita.
 * A linha continua assinando só a si mesma.
 */
const estadosDeEnvio = new Map<string, SendState>();

/**
 * ID do servidor → ID local, para as mensagens que ESTE cliente enviou.
 *
 * A mensagem otimista nasce com ID local e é isso que o virtualizador usa como
 * chave. Quando a confirmação volta, o servidor manda o ID dele — e a partir
 * daí toda edição, reação e exclusão daquela mensagem chega com esse ID.
 *
 * Traduzir na ENTRADA é o que mantém a chave estável pelo resto da sessão. O
 * mapa só cresce com o que a própria pessoa enviou, então é pequeno por
 * construção: um dia inteiro de conversa cabe em algumas centenas de entradas.
 */
const apelidos = new Map<string, string>();

/** O caminho de volta: a chave que o app usa → o ID que o SDK guarda. */
const apelidosInversos = new Map<string, string>();

/**
 * Um sinal, e ele é o que faz a reconciliação chegar na tela.
 *
 * O efeito que constrói o snapshot lê o objeto do SDK pela chave local. Depois
 * da confirmação, o objeto que o SERVIDOR vai continuar atualizando é outro —
 * edição, reação e fixar chegam no ID dele, e o SDK os aplica lá.
 *
 * Um `Map` comum não acordaria o efeito: ele releria a chave local para sempre
 * e a linha congelaria no conteúdo do instante do envio, sem nada falhar. O
 * sinal faz o efeito voltar a rodar no momento em que o apelido nasce, e a
 * partir dali ele lê o objeto certo.
 *
 * Um sinal só para todos os apelidos, e não um por mensagem: apelido aparece
 * quando VOCÊ envia, algumas dezenas de vezes por hora. Reprocessar os
 * snapshots visíveis nesse momento é mais barato que manter um sinal por
 * mensagem enviada na sessão inteira.
 */
const [versaoDeApelidos, bumpApelidos] = createSignal(0);

/**
 * O ID pelo qual o app conhece esta mensagem.
 *
 * Identidade para tudo que não passou por aqui, que é a esmagadora maioria.
 */
function chaveLocal(id: string): string {
  return apelidos.get(id) ?? id;
}

/** O ID que o SDK guarda para esta chave. Reativo: ver `versaoDeApelidos`. */
function idDoSdk(chave: string): string {
  versaoDeApelidos();
  return apelidosInversos.get(chave) ?? chave;
}

/** Liga os dois lados de uma mensagem confirmada. */
function registrarApelido(idDoServidor: string, idLocal: string): void {
  apelidos.set(idDoServidor, idLocal);
  apelidosInversos.set(idLocal, idDoServidor);
  bumpApelidos((n) => n + 1);
}

/**
 * O nonce que o servidor devolveu, se devolveu.
 *
 * O tipo do SDK não expõe `nonce` — ele é campo do protocolo que o modelo não
 * promove. Ler assim, aqui dentro, é exatamente o trabalho da camada
 * anticorrupção: o formato do protocolo para de existir na saída desta função.
 */
function nonceDe(message: unknown): string | undefined {
  const n = (message as { nonce?: unknown }).nonce;
  return typeof n === "string" ? n : undefined;
}

/** Mensagem que veio do servidor não está no Map — e "sent" é a verdade. */
function estadoDeEnvioDe(id: string): SendState {
  return estadosDeEnvio.get(id) ?? "sent";
}

function marcarEnvio(id: string, estado: SendState) {
  if (estadoDeEnvioDe(id) === estado) return;

  if (estado === "sent") estadosDeEnvio.delete(id);
  else estadosDeEnvio.set(id, estado);

  const message = client.messages.get(idDoSdk(id));

  /*
    O contador de fila do canal acompanha, e este é o funil.

    Só `pending` conta: `subindo` é upload EM CURSO (a rede está de pé) e
    `failed` é o que já desistiu — nenhum dos dois "envia ao reconectar", que é
    o que o rodapé do composer promete. Ver `store/fila.ts`.
  */
  if (estado === "pending" && message) marcarPendente(id, message.channelId);
  else desmarcarPendente(id);
  /* O rodapé do campo conta as falhadas do canal: mesma história da linha. */
  if (estado === "failed" && message) marcarFalhada(id, message.channelId);
  else desmarcarFalhada(id);
  if (message && messages.subscriberCount(id) > 0) {
    messages.set(
      id,
      toMessageSnapshot(message, layoutDe(id), estado, usuarioLocal, lerEnquete(id)),
    );
  }
}

/**
 * "Enviar quando voltar" — mantém na fila e dispensa a pergunta.
 *
 * ⚠ A decisão mora em `store/fila.ts` e não aqui, e a razão está lá: a
 * primeira versão era um `Set` no adapter, republicando o snapshot da
 * mensagem para acordar a linha — e não acordava, porque o snapshot é cacheado
 * por conteúdo e estado, e nenhum dos dois muda com a escolha. Os dois botões
 * ficavam na tela depois do clique, sem erro nenhum.
 */
export function manterNaFila(id: string): void {
  if (estadoDeEnvioDe(id) !== "pending") return;
  confirmarNaFila(id);
}

/**
 * "Descartar" — a mensagem some, e some de verdade.
 *
 * ⚠ **Ela sai do cache do SDK, não só da lista.** Deixar o objeto vivo e
 * apenas tirar o ID faria a mensagem voltar na próxima republicação do canal,
 * e o vazamento seria invisível: nada quebra, a linha só reaparece.
 *
 * `desistir(id)` porque o nonce não serve mais para nada — sem isto o mapa
 * cresce para sempre numa sessão de 8h com rede instável, que é o erro nº 5 do
 * briefing.
 */
export function descartarPendente(id: string): void {
  /* A falhada também: "Descartar" é a segunda saída da linha que não foi enviada. */
  const estado = estadoDeEnvioDe(id);
  if (estado !== "pending" && estado !== "failed") return;
  estadosDeEnvio.delete(id);
  esquecerDaFila(id);
  desistir(id);
  const sdkId = idDoSdk(id);
  const message = client.messages.get(sdkId);
  const channelId = message?.channelId;
  client.messages.delete(sdkId);
  if (channelId === undefined) return;

  /*
    ⚠ **Tirar do índice da lista, e não só do SDK.** `messages.delete` não emite
    `messageDelete` (esse evento vem do servidor), então o ID ficava na lista e a
    linha continuava lá, "descartada" e visível. É o mesmo ajuste de vizinhança
    que o evento de exclusão faz: a que vinha depois passa a olhar outro vizinho.
  */
  const ids = idsOf(channelId);
  const at = ids.indexOf(id);
  if (at !== -1) {
    ids.splice(at, 1);
    recalcularLayout(channelId, at, at);
  }
  publishNow(channelId);
}

/**
 * Ao voltar a conexão, as pendentes vão.
 *
 * ⚠ **É isto que faz "Enviar quando voltar" ser verdade e não um rótulo.** Sem
 * este laço, a mensagem digitada offline ficaria pendente para sempre e o
 * botão prometeria algo que ninguém cumpre — o defeito que o registro de
 * pendências existe justamente para não deixar acontecer em silêncio.
 *
 * Module-level e sem cleanup de propósito: o adapter vive enquanto o app vive,
 * e este é o único assinante da conexão fora de componente. Um `remove` aqui
 * só rodaria no descarregamento da página.
 */
let conexaoAnterior = lerConexao();
assinarConexao(() => {
  const agora = lerConexao();
  const voltou = conexaoAnterior !== "conectado" && agora === "conectado";
  conexaoAnterior = agora;
  if (!voltou) return;

  /*
    Cópia da lista antes de percorrer: `reenviarPendente` escreve em
    `estadosDeEnvio`, e iterar um Map que muda durante o laço é a família de
    bug que não dá erro — pula entradas.
  */
  for (const [id, estado] of [...estadosDeEnvio]) {
    if (estado === "pending") reenviarPendente(id);
  }
});

/**
 * O caminho de envio de uma pendente que já existe.
 *
 * Separado de `reenviar` porque aquele exige `failed`: são duas transições
 * diferentes — "falhou, tenta de novo" e "estava esperando a rede voltar" —, e
 * juntá-las faria a segunda passar pelo guarda da primeira e não fazer nada.
 */
function reenviarPendente(id: string): void {
  esquecerDaFila(id);

  if (simulacao.ativa) {
    setTimeout(() => {
      if (simulacao.falhar) {
        desistir(id);
        falharEnvio(id);
      } else {
        marcarEnvio(id, "sent");
      }
    }, simulacao.latenciaMs ?? 600);
    return;
  }

  /*
    ⚠ **Isto também não reenviava nada, e é a terceira ocorrência da mesma
    família no caminho de envio** — depois de `enviarMensagem`, que nunca
    chamava o servidor, e de `reenviar`, logo abaixo. O corpo inteiro era o
    ramo de simulação acima, sem guarda: ao voltar a conexão, toda pendente
    virava `sent` depois de 600ms sem sair daqui.

    O comentário de `enviarMensagem` afirmava o contrário com todas as letras
    — *"ao voltar a conexão, toda pendente é reenviada. É o que faz 'Enviar
    quando voltar' ser verdade"*. Era a promessa mais visvel do modo offline,
    e o único jeito de descobrir era ficar sem rede e conferir no servidor.
  */
  despacharEnvio(id);
}

/**
 * Tenta enviar de novo uma mensagem que falhou.
 *
 * O design system diz que erro **explica o que aconteceu E como resolver**. A
 * linha falhada dizia "não enviada" — a primeira metade — e a segunda não
 * existia em lugar nenhum do app: a mensagem ficava lá, vermelha, para sempre.
 *
 * O conteúdo não é reenviado nem recriado: a mensagem já existe localmente com
 * o texto certo. Reenviar é voltar ao estado pendente e tentar de novo, o que
 * mantém a posição dela no histórico — recriar produziria um ID novo e a linha
 * saltaria para o fim, perdendo o lugar onde a pessoa a escreveu.
 *
 * ⚠ Fase 6: com rede, isto vira um POST novo com o MESMO nonce, e a
 * reconciliação por nonce (já documentada aqui) é o que impede a mensagem de
 * aparecer duas vezes se a primeira tentativa tiver chegado ao servidor.
 */
export function reenviar(id: string): void {
  if (estadoDeEnvioDe(id) !== "failed") return;

  /*
    O arnês SUBSTITUI a rede, como no envio. Ver `SimulacaoDeEnvio`.
  */
  if (simulacao.ativa) {
    marcarEnvio(id, "pending");
    setTimeout(() => {
      if (simulacao.falhar) {
        // Desiste do nonce: sem isto o mapa cresce para sempre numa sessão de
        // 8h com rede instável, que é o erro nº 5 do briefing.
        desistir(id);
        falharEnvio(id);
      } else {
        marcarEnvio(id, "sent");
      }
    }, simulacao.latenciaMs ?? 600);
    return;
  }

  /*
    ⚠ **Isto NÃO reenviava nada, e o defeito é irmão do `enviarMensagem` que
    nunca chamava o servidor.** O corpo inteiro era o ramo de simulação acima,
    sem guarda: apertar "tentar de novo" esperava 600ms e marcava `sent`. A
    linha ficava verde, a mensagem nunca saía, e nada em lugar nenhum
    acusava — a interface mentindo sobre a única coisa que ela existe para
    dizer.

    Só apareceu porque o upload precisa deste caminho: sem ele, uma falha de
    anexo seria irrecuperável ou, pior, "reenviaria" o texto sozinho.
  */
  /*
    O nonce é registrado de novo: `desistir` o soltou quando a falha veio.
    Em `reenviarPendente` não é preciso — lá a mensagem nunca saiu, e o nonce
    original continua válido.
  */
  const mensagem = client.messages.get(idDoSdk(id));
  if (mensagem === undefined) return;
  aguardar(id, id, mensagem.channelId);

  despacharEnvio(id);
}

/**
 * Manda uma mensagem que JÁ EXISTE na lista.
 *
 * Um só lugar para os dois caminhos que chegam aqui — "falhou, tenta de novo"
 * e "estava esperando a rede voltar". Eles diferem no guarda de entrada e no
 * nonce, e não no despacho; separá-los faria o próximo caso (anexo) ser
 * lembrado num e esquecido no outro.
 *
 * ⚠ **Com arquivo, o caminho é o do upload.** Postar o texto sozinho faria a
 * linha voltar verde sem o anexo — exatamente o que `arquivosPendentes`
 * existe para impedir.
 */
function despacharEnvio(id: string): void {
  const mensagem = client.messages.get(idDoSdk(id));
  if (mensagem === undefined) return;

  const channelId = mensagem.channelId;
  const texto = mensagem.content ?? "";
  /*
    ⚠ **A escolha de notificar vem do MAPA, não do objeto.** `replyIds` é lista
    de IDs — o protocolo não guarda `mention` na mensagem —, então reconstruir
    daqui perderia a decisão. Sem o mapa, "tentar de novo" numa resposta sem
    menção mandaria a menção que a pessoa recusou.

    O `?? true` é o caso de uma pendente que atravessou um recarregamento: o
    mapa é de memória. Notificar a mais é o erro menos ruim dos dois — é o que
    "Responder" faz por padrão.
  */
  const alvo = mensagem.replyIds?.[0];
  const respondendoA =
    alvo === undefined
      ? undefined
      : (respostasPendentes.get(id) ?? { id: alvo, mencionar: true });
  const arquivos = arquivosPendentes.get(id);

  if (arquivos !== undefined && arquivos.length > 0) {
    marcarEnvio(id, "subindo");
    void subirEEnviar(id, channelId, texto, respondendoA);
    return;
  }

  marcarEnvio(id, "pending");
  void postar(id, channelId, texto, respondendoA, undefined, figurinhaDaMensagem(id));
}

/**
 * Adiciona ou remove a MINHA reação. Otimista, e por enquanto só otimista.
 *
 * Mexe direto no `ReactiveMap` do SDK, que é o mesmo caminho que os eventos de
 * reação usariam — então quando a rede existir, a reação de outra pessoa cai
 * no mesmo lugar e a linha republica pelo mesmo efeito. Não há um segundo
 * caminho a reconciliar.
 *
 * ⚠ Fase 6: aqui entra o `POST /messages/:id/reactions/:emoji` (e o DELETE), e
 * com ele a possibilidade de o servidor recusar. O rollback é escrever de
 * volta o estado anterior — que é barato justamente porque a operação é um
 * toggle sobre um Set, e não um patch.
 */
export function alternarReacao(messageId: string, emoji: string): void {
  if (!usuarioLocal) return;

  /* O objeto do SERVIDOR: depois da reconciliação a chave da lista é o ID local
     e os eventos chegam no objeto do servidor. Mutar o outro não acorda a linha. */
  const message = client.messages.get(idDoSdk(messageId));
  if (!message) return;

  const quem = message.reactions.get(emoji);

  const tinha = quem?.has(usuarioLocal) === true;

  if (quem && tinha) {
    quem.delete(usuarioLocal);
    // Set vazio é removido: o `map.ts` já pula emoji sem ninguém, mas deixar a
    // chave viva faria a ORDEM dos chips guardar um fantasma — reagir de novo
    // com o mesmo emoji o traria de volta à posição antiga em vez do fim.
    if (quem.size === 0) message.reactions.delete(emoji);
  } else if (quem) {
    quem.add(usuarioLocal);
  } else {
    message.reactions.set(emoji, new ReactiveSet([usuarioLocal]));
  }

  /*
    ⚠ **A rede, que até a etapa 7 não existia.**

    A mutação acima continua sendo otimista e imediata — é o que faz o chip
    acender no clique, sem esperar ida e volta. O que faltava era CONTAR ao
    servidor: até aqui a reação vivia só nesta aba, e sumia no F5.

    Fire-and-forget atrás de `conectado()` pela mesma razão de `ack` e
    `startTyping`: `EventClient.send` LANÇA sem socket, e uma reação não pode
    derrubar o clique.

    Reverter em caso de erro seria o correto, e não é o que está aqui: o
    servidor reenvia o estado no próximo evento da mensagem, e um rollback
    otimista que corre contra esse evento produz o chip piscando duas vezes.
    Fica dito.
  */
  /*
    A frequência de uso, para o conjunto rápido do menu ser SEU.

    ⚠ **Só ao PÔR, nunca ao tirar.** Contar o desfazer premiaria o emoji que a
    pessoa clicou por engano — duas vezes, porque errar e corrigir somaria dois
    usos ao que ela não queria.

    Aqui e não no componente: reagir acontece por três caminhos (menu, barra de
    hover, seletor), e contar em cada um seria a mesma regra escrita três vezes.
  */
  if (!tinha) registrarUsoDeReacao(emoji);

  if (!conectado()) return;
  const alvo = client.messages.get(idDoSdk(messageId));
  if (tinha) void alvo?.unreact(emoji).catch(() => undefined);
  else void alvo?.react(emoji).catch(() => undefined);
}

/**
 * Edita o conteúdo de uma mensagem.
 *
 * ⚠ **`Editar` foi item INERTE no menu por três fases**, e saiu de lá por isso
 * — item que aparece, recebe foco e não faz nada ensina a pessoa a não
 * confiar no menu inteiro. Volta com `Message.edit()` por trás.
 *
 * Otimista: o texto novo entra na hora e `editedAt` também, senão a linha
 * ficaria idêntica até a resposta voltar e a pessoa apertaria salvar de novo.
 */
export async function editarMensagem(
  messageId: string,
  conteudo: string,
): Promise<boolean> {
  const alvo = client.messages.get(idDoSdk(messageId));
  if (!alvo) return false;

  /*
    ⚠ `editedAt` e um `Date`, e e o campo HIDRATADO: o objeto subjacente do SDK
    guarda o que a `hydrate` produz, nao o formato do fio (`edited`, string).
    Escrever `edited` aqui nao chegava a lugar nenhum — a linha mostrava o texto
    novo e nunca o "(editada)", ate o evento do servidor reescrever o campo certo.
    Tambem pelo ID do SDK: depois da reconciliacao a chave da lista e o ID local.
  */
  client.messages.updateUnderlyingObject(idDoSdk(messageId), {
    content: conteudo,
    editedAt: new Date(),
  } as never);

  if (!conectado()) return true;
  try {
    await alvo.edit({ content: conteudo });
    return true;
  } catch {
    return false;
  }
}

/**
 * Apagadas otimisticamente e ainda sem resposta do servidor, por chave local.
 *
 * `anterior` é o vizinho de cima NO MOMENTO da remoção: a lista muda enquanto
 * o `DELETE` voa (mensagem nova no fim, página de histórico no começo), então
 * o índice guardado envelheceria; o vizinho não. `confirmada` marca que o eco
 * `MessageDelete` já chegou — se o `DELETE` falhar depois dele, a mensagem
 * realmente não existe mais e devolvê-la seria mentir.
 */
const apagadasOtimistas = new Map<
  string,
  { channelId: string; anterior: string | undefined; confirmada: boolean }
>();

/**
 * Apaga.
 *
 * **Otimista**: a linha sai da lista na hora, pelo MESMO caminho do eco do
 * servidor (`splice` + layout dos vizinhos + `publish` coalescido por frame) —
 * sem varredura extra. Se o `DELETE` falhar ela volta onde estava e a função
 * devolve `false` (quem chama avisa). O eco `MessageDelete` que chegar depois
 * não encontra a chave na lista e é no-op, então não remove duas vezes.
 */
export async function apagarMensagem(messageId: string): Promise<boolean> {
  const alvo = client.messages.get(idDoSdk(messageId));
  if (!alvo) return false;
  const channelId = alvo.channelId;
  const ids = channelId ? idsOf(channelId) : undefined;
  const at = ids ? ids.indexOf(messageId) : -1;
  if (channelId && ids && at !== -1 && !apagadasOtimistas.has(messageId)) {
    apagadasOtimistas.set(messageId, {
      channelId,
      anterior: ids[at - 1],
      confirmada: false,
    });
    ids.splice(at, 1);
    recalcularLayout(channelId, at, at);
    publish(channelId);
  }
  try {
    await alvo.delete();
    apagadasOtimistas.delete(messageId);
    return true;
  } catch {
    devolverApagada(messageId);
    return false;
  }
}

/** Desfaz a remoção otimista, no mesmo lugar, se o servidor não a confirmou. */
function devolverApagada(chave: string): void {
  const pendente = apagadasOtimistas.get(chave);
  apagadasOtimistas.delete(chave);
  if (!pendente || pendente.confirmada) return;
  const ids = idsOf(pendente.channelId);
  if (ids.includes(chave)) return;
  let at: number;
  const acima = pendente.anterior ? ids.indexOf(pendente.anterior) : -1;
  if (pendente.anterior === undefined) {
    at = 0;
  } else if (acima !== -1) {
    at = acima + 1;
  } else {
    // O vizinho saiu da lista nesse meio-tempo: cai pela ordem dos IDs.
    at = ids.findIndex((id) => id > chave);
    if (at === -1) at = ids.length;
  }
  ids.splice(at, 0, chave);
  recalcularLayout(pendente.channelId, at - 1, at + 1);
  publish(pendente.channelId);
}

/* -------------------------------------------------------------- entidade */

/**
 * Prévia de link que chega tarde NÃO é edição.
 *
 * O SDK carimba `editedAt = new Date()` em TODO `MessageUpdate`, e o servidor
 * manda um quando o `january` termina de resolver o link (ou quando fixam, etc.).
 * Sem isto a linha ganharia "(editada)" segundos depois de enviada, por causa
 * de um cartão. Se o texto é o mesmo, a edição que vale é a que já estava.
 */
export function preservarEdicao(
  anterior: MessageSnapshot | undefined,
  novo: MessageSnapshot,
): MessageSnapshot {
  if (!anterior || anterior.content !== novo.content || anterior.editedAt === novo.editedAt) return novo;
  return { ...novo, editedAt: anterior.editedAt };
}


/**
 * Efeito Solid por mensagem assinada. Os getters do SDK são backed por store
 * Solid, então ler `content` aqui dentro rastreia AQUELE campo: o efeito só
 * re-roda quando aquela mensagem muda.
 *
 * O teardown volta para o store, que o chama quando o último assinante sai.
 * Sem isso, uma sessão de 8h acumula um efeito por mensagem já vista.
 */
export const messages = createEntityStore<MessageSnapshot>((id) => {
  // Resolve JÁ, não no próximo tick. O efeito Solid é agendado, e uma linha
  // que monta antes dele roda um render com `undefined` — que numa lista
  // virtualizada vira altura zero e realimenta a medição.
  const initial = client.messages.get(idDoSdk(id));
  if (initial) {
    messages.set(id, toMessageSnapshot(
        initial,
        layoutDe(id),
        estadoDeEnvioDe(id),
        usuarioLocal,
        lerEnquete(id),
      ));
  }

  return createRoot((dispose) => {
    createEffect(() => {
      // `idDoSdk` e não `id`: depois da confirmação, quem o servidor atualiza
      // é o objeto DELE. Ler pela chave local congelaria a linha no conteúdo
      // do instante do envio, sem nada falhar.
      const message = client.messages.get(idDoSdk(id));
      if (message) {
        const novo = toMessageSnapshot(
          message,
          layoutDe(id),
          estadoDeEnvioDe(id),
          usuarioLocal,
          lerEnquete(id),
        );
        messages.set(id, preservarEdicao(messages.peek(id), novo));
        count("snapshots");
      }
    });
    return dispose;
  });
});

/* ---------------------------------------------------------------- coleção */

/**
 * O SDK não tem índice por canal — `client.messages` é um Map plano e o canal
 * só conhece `lastMessageId`. Então o índice é do app, e é mantido por evento,
 * nunca por varredura da coleção.
 */
export const channelMessageIds = createEntityStore<readonly string[]>();

const index = new Map<string, string[]>();

function idsOf(channelId: string): string[] {
  let ids = index.get(channelId);
  if (!ids) {
    ids = [];
    index.set(channelId, ids);
  }
  return ids;
}

/**
 * Publicação coalescida por frame.
 *
 * A versão ingênua publicava por evento. O firehose mostrou o custo real disso,
 * e ele não aparece no regime permanente — aparece na CARGA: semear um canal
 * emite um `messageCreate` por mensagem, e publicar em cada um significa N
 * cópias do array de IDs e N renders do React. Em 10k mensagens isso é
 * quadrático, e é exatamente o caminho que a app percorre ao abrir um canal ou
 * paginar histórico.
 *
 * Coalescer no frame resolve os dois casos com o mesmo mecanismo: uma
 * publicação por frame, independente de quantos eventos chegaram. O
 * `followOnAppend` do virtualizador continua correto — ele reancora por frame,
 * não por evento.
 */
const dirty = new Set<string>();
/**
 * Servidores cuja member list precisa reordenar.
 *
 * Mesmo frame, mesmo flush. Duas filas de rAF concorrentes publicariam a lista
 * de mensagens e a de membros em frames diferentes — dois relayouts onde um
 * basta, e num painel que divide o mesmo grid do shell.
 */
const membrosSujos = new Set<string>();
let flushHandle: number | undefined;

function flushPublications() {
  flushHandle = undefined;
  const started = performance.now();
  for (const channelId of dirty) {
    channelMessageIds.set(channelId, [...idsOf(channelId)]);
    count("publishes");
  }
  dirty.clear();
  count("publishMs", performance.now() - started);

  // Cronometrado em separado, e não somado ao de canal: são dois caminhos com
  // custos de natureza diferente — cópia de array de um lado, ordenação de
  // toda a member list do outro. Somados, o relatório do gate não atribui.
  const membrosDe = performance.now();
  for (const serverId of membrosSujos) {
    publicarMembros(serverId);
    count("membrosPublishes");
  }
  membrosSujos.clear();
  count("membrosPublishMs", performance.now() - membrosDe);
}

function agendarFlush() {
  flushHandle ??= requestAnimationFrame(flushPublications);
}

/**
 * SONDA: o que está esperando o próximo frame?
 *
 * Fica porque respondeu a uma pergunta que o DOM não responde e que custou
 * caro: "a lista está vazia porque o dado não chegou, ou porque a publicação
 * ainda não foi liberada?" — os dois casos renderizam nada.
 *
 * O caso real: numa aba sem composição estável, o `requestAnimationFrame`
 * dispara com intervalos de segundos. A publicação coalescida ficava
 * pendurada, e o sintoma — lista vazia, contador de não-lida correto — parecia
 * exatamente um bug de escopo no adapter. Era o ambiente. Esta sonda é a
 * diferença entre ver `canaisSujos: []` (nada aconteceu) e
 * `canaisSujos: [id], frameAgendado: 4` (aconteceu, o frame é que não veio).
 */
export function estadoDaFila() {
  return {
    canaisSujos: [...dirty],
    membrosSujos: [...membrosSujos],
    frameAgendado: flushHandle ?? "nenhum",
    adapterLigado: started,
  };
}

function publish(channelId: string) {
  dirty.add(channelId);
  agendarFlush();
}

/**
 * Recalcula a lista de fixadas de um canal.
 *
 * Varre os IDs do canal em vez de manter um índice incremental. É O(n) por
 * chamada, e roda só quando alguém fixa ou desafixa — ação humana, raríssima
 * comparada a mensagem nova. Um índice incremental seria mais rápido e teria
 * que ser mantido correto em cinco caminhos (criar, apagar, fixar, desafixar,
 * carregar histórico); a varredura não pode divergir da verdade porque ELA é
 * a verdade lida de novo.
 */
function publicarFixadas(channelId: string): void {
  const out: string[] = [];
  for (const id of idsOf(channelId)) {
    if (client.messages.get(idDoSdk(id))?.pinned) out.push(id);
  }
  fixadas.set(channelId, out);
}

/**
 * Fixa ou desafixa. Otimista, como a reação.
 *
 * ⚠ Fase 6: `PUT /channels/:c/messages/:m/pin` e o DELETE. O servidor pode
 * recusar por permissão — fixar costuma ser privilégio —, e aí o rollback é
 * escrever `pinned` de volta e republicar. Barato porque é booleano.
 */
export function alternarFixada(messageId: string): void {
  const message = client.messages.get(idDoSdk(messageId));
  if (!message) return;

  // `updateUnderlyingObject` e não um campo nosso: `pinned` é do PROTOCOLO, e
  // manter a verdade lá é o que faz o evento de outra pessoa e a nossa ação
  // otimista chegarem no mesmo lugar.
  const fixando = !message.pinned;
  client.messages.updateUnderlyingObject(idDoSdk(messageId), {
    pinned: fixando,
  } as never);

  publicarFixadas(message.channelId);
  // O painel de fixados acompanha na hora, sem refazer a busca. A chave é a do SDK:
  // é a que `Channel.search` devolve, e `chaveLocal` a resolve ao saltar.
  aplicarFixacao(message.channelId, message.id, fixando);

  // A rede, como na reação: otimista na tela, contado ao servidor depois.
  if (!conectado()) return;
  const alvo = client.messages.get(idDoSdk(messageId));
  if (fixando) void alvo?.pin().catch(() => undefined);
  else void alvo?.unpin().catch(() => undefined);
}

/**
 * Desafixa — e só isso. O painel de fixados oferece "Desafixar" sobre uma lista
 * que pode estar um instante atrás da mensagem (outra pessoa já desafixou): o
 * alternar a FIXARIA de novo. Mensagem que já não está fixada só sai da lista.
 */
export function desafixarMensagem(messageId: string): void {
  const message = client.messages.get(idDoSdk(messageId));
  if (!message) return;
  if (message.pinned) alternarFixada(messageId);
  else aplicarFixacao(message.channelId, message.id, false);
}

/**
 * Aplica um evento CRU da superfície do Vortex e republica quem mudou.
 *
 * Exportado para a escrita otimista: quem acabou de gravar `spoiler` ou
 * `invites_paused` aplica o mesmo evento que o servidor vai mandar, sem
 * esperar o socket — a tela relê o snapshot logo depois do `await`, e o evento
 * pode chegar um quadro atrasado. Idempotente quando ele chegar.
 */
/**
 * Anota a voz crua de um canal e republica quem mudou de TIPO de sala.
 *
 * O snapshot já foi republicado pelo ouvinte do SDK com o modo velho (ele
 * roda antes deste — ver `superficieVortex.ts`), e o tipo é o único campo da
 * voz que a coluna desenha. Exportado para a escrita otimista, como
 * `aplicarSuperficieVortex`: criar ou salvar um canal de vídeo não espera o
 * socket para trocar o ícone.
 */
export function aplicarVozDoCanal(evento: unknown): void {
  anotarEventoDeVoz(evento);
  for (const id of consumirModosAlterados()) reemitirCanal(id);
}

export function aplicarSuperficieVortex(evento: unknown): void {
  const mudou = aplicarEventoCru(superficie, evento);
  for (const id of mudou.canais) reemitirCanal(id);
  avisarCanaisVortex(mudou.canais);
}

/**
 * Tira as prévias de link de uma mensagem — o "Remover embed" do menu.
 *
 * Otimista como fixar: o cartão some na hora, e só o que o SERVIDOR gerou sai
 * (`Text` é embed que o autor mandou de propósito e fica). A rota é do servidor
 * do Vortex (`DELETE …/embeds`), e ela liga `SuppressEmbeds` na mensagem para o
 * worker de prévia não devolver o cartão numa edição.
 *
 * ⚠ **Sem rollback se o servidor recusar**, pela razão da reação: o
 * `MessageUpdate` seguinte traz o estado certo, e um rollback correndo contra
 * ele faria o cartão piscar duas vezes. A recusa vira toast.
 */
export function removerEmbeds(messageId: string): void {
  const message = client.messages.get(messageId);
  if (!message) return;

  client.messages.updateUnderlyingObject(messageId, {
    embeds: (message.embeds ?? []).filter((e) => e.type === "Text"),
  } as never);

  if (!conectado()) return;
  const idServidor = idDoSdk(messageId);
  void client.api
    .delete(`/channels/${message.channelId}/messages/${idServidor}/embeds` as never)
    .catch((e: unknown) => {
      toast({ tipo: "erro", titulo: "Não deu para remover a prévia.", descricao: motivoDoErro(e) });
    });
}

/** Publicação imediata, para setup — não há frame para esperar. */
function publishNow(channelId: string) {
  dirty.delete(channelId);
  channelMessageIds.set(channelId, [...idsOf(channelId)]);
}

/* --------------------------------------------------------------- efêmero */

export const presence = createEphemeralStore<PresenceStatus>();
export const typing = createEphemeralStore<readonly string[]>();

const typingByChannel = new Map<string, Set<string>>();

/* ----------------------------------------------------------- subscrições */

let started = false;

/**
 * Idempotente de propósito. `StrictMode` invoca effects duas vezes em dev e
 * numa app 100% websocket isso geraria listener duplicado e mensagem dobrada.
 * A defesa é estrutural: a subscrição vive aqui, module-level, não num
 * `useEffect` por componente.
 */
/**
 * Permissão mudou. As linhas na tela precisam reperguntar.
 *
 * **A nota que eu mesmo escrevi em `permissoes.ts` dizia "republicar o canal",
 * e estava errada.** Republicar o canal troca o array de IDs, o que acorda a
 * LISTA — mas `MessageRow` é `memo` com a mesma prop `id`, então nenhuma linha
 * re-renderiza. A pessoa continuaria vendo o botão de fixar depois de perder o
 * cargo, e nada falharia.
 *
 * O que funciona é reescrever os SNAPSHOTS: eles são comparados por
 * `Object.is`, e um objeto novo com o mesmo conteúdo é o suficiente para o
 * `useSyncExternalStore` acordar quem assina.
 *
 * Só os ASSINADOS, que são as linhas na tela — algumas dezenas num histórico
 * de dez mil. Varrer o canal inteiro seria pagar pelo que ninguém está vendo,
 * e o gatilho é raro: alguém editar um cargo.
 *
 * A alternativa era `pode()` virar hook com store, e ela é pior: três
 * subscrições por linha, para sempre, por um evento que acontece uma vez por
 * semana.
 */
/**
 * A enquete de uma mensagem mudou — republica só ela.
 *
 * Mesma mecânica de `marcarEnvio` e de `repensarPermissoes`: o que acorda a
 * linha é um SNAPSHOT novo, não o array de IDs — `MessageRow` é `memo` com a
 * mesma prop `id`, então republicar a coleção não re-renderizaria linha
 * nenhuma. Foi o erro que a nota de `permissoes.ts` já registrou uma vez.
 *
 * Só se houver quem assine: votar numa enquete fora da janela não existe.
 */
export function republicarEnquete(messageId: string): void {
  const message = client.messages.get(idDoSdk(messageId));
  if (!message || messages.subscriberCount(messageId) === 0) return;
  messages.set(
    messageId,
    toMessageSnapshot(
      message,
      layoutDe(messageId),
      estadoDeEnvioDe(messageId),
      usuarioLocal,
      lerEnquete(messageId),
    ),
  );
}

function repensarPermissoes(): void {
  notificarMudancaDePermissoes();
  for (const id of messages.assinados()) {
    const message = client.messages.get(idDoSdk(id));
    if (!message) continue;
    messages.set(
      id,
      toMessageSnapshot(
            message,
            layoutDe(id),
            estadoDeEnvioDe(id),
            usuarioLocal,
            lerEnquete(id),
          ),
    );
  }
}

export function startAdapter() {
  if (started) return;
  started = true;
  // Vortex: a política de mídia explícita vem do evento cru — ver o módulo.
  ligarFiltroDeMidia();
  ligarAtividades();

  /*
    Figurinhas e efeitos sonoros — conceitos do Vortex que o SDK não conhece.
    A figurinha de uma mensagem chega DEPOIS de o snapshot dela existir (ver
    `instalarFigurinhasDeMensagem`), e é por isso que a republicação é injetada:
    a mensagem acorda pela própria chave, como numa enquete.
  */
  instalarFigurinhasDeMensagem((id) => republicarEnquete(chaveLocal(id)));
  instalarExpressoes();

  /**
   * O estado de leitura que o SERVIDOR conhece, na entrada.
   *
   * Sem isto o app abre zerado sobre um histórico cheio, e o briefing já
   * chamava a ausência de "regressão garantida": a contagem só sabia do que
   * chegou AO VIVO, pelo caminho de evento. O que chegou enquanto o app estava
   * fechado — que é a maior parte do que interessa ao abrir — nunca passou por
   * ali.
   *
   * O protocolo entrega as duas coisas prontas: `lastMessageId` é o cursor, e
   * `messageMentionIds` é um CONJUNTO DE IDS. Contar aqui é derivar do que já
   * veio, não inventar.
   *
   * ⚠ Isto não conta as não lidas com precisão, e a imprecisão é honesta: o
   * cliente não tem o histórico entre o cursor e o fim antes de carregá-lo.
   * O que ele sabe é que EXISTEM — o cursor não é a última — e quantas
   * menções, porque essas vêm por ID. Uma bolinha "tem coisa nova" com a
   * contagem exata de menções é mais verdadeiro que um número inventado.
   */
  /*
    A conexão vira estado da interface.

    Traduzido aqui e não lido direto: `ConnectionState` é enum do SDK, e o app
    fala de "reconectando" e "sem conexão" — que são respostas de interface,
    não estados de socket. É a camada anticorrupção no caso mais simples que
    existe, e é o que permite o componente da faixa não importar nada do SDK.

    `Connecting` e `Disconnected` são coisas diferentes para quem olha: a
    primeira diz "espere", a segunda diz "não deu". O SDK religa sozinho, então
    a segunda é rara e quase sempre significa rede da máquina, não do servidor.
  */
  /*
    ⚠ **O SDK DESCARTA `can_publish`, e este é o único jeito de tê-lo sem
    forkar o submodule.**

    `can_publish` é campo de `ServerMember` no protocolo — é o "mudo pelo
    servidor", a diferença entre alguém que escolheu não falar e alguém que
    não PODE falar. Ele chega pelo fio em `Ready` e em `ServerMemberUpdate`, e
    a hidratação de `serverMember` não o lista: o objeto hidratado não tem o
    campo, então nenhum getter do SDK o alcança.

    As saídas eram três, e duas são piores:

    1. **Patchar `stoat.js`.** Ele é submodule PINADO — mexer aqui cria um fork
       do SDK para manter. Custo permanente por um booleano.
    2. **Buscar por REST.** `GET /servers/{id}/members` traz o campo, mas ele
       muda por EVENTO — o valor ficaria velho no instante seguinte, e a tela
       mostraria "mudo pelo servidor" para quem já foi destravado.
    3. **Ler o evento CRU**, que é isto. O `EventClient` emite `"event"` com o
       payload antes da hidratação, e o adapter é exatamente a camada que
       existe para traduzir protocolo em domínio. Nada vaza para componente.

    Mapa próprio e não um campo em `MemberSnapshot`: quem precisa disto é a
    linha da sala de voz, e pendurá-lo no snapshot de membro republicaria a
    member list inteira toda vez que alguém fosse silenciado.
  */
  client.events.on("event", (evento: unknown) => {
    /* Tópico e fórum também só existem no payload cru — ver `vortexCanal.ts`.
       Antes da hidratação, e é por isso que o registro guarda o nome. */
    const seguiamAntes = seguidoresAntesDoEvento(evento);
    aplicarEventoCruDeCanal(evento);
    if (seguiamAntes) inserirEntradasNoTopico(seguiamAntes.canal, seguiamAntes.seguidores);
    /* A voz por canal do fork mora no evento cru pela mesma razão do
       `can_publish` abaixo — ver `sdk/vozDoCanal.ts`. */
    aplicarVozDoCanal(evento);
    /* Quem está em cada sala vem do evento cru (ADR-003): o `ReactiveMap` do
       SDK ignora `VoiceChannelMove` e deixava o fantasma na sala de origem. */
    for (const id of aplicarEventoDeVoz(evento, usuarioLocal)) releituraDeVoz.get(id)?.();
    /* Enquete é campo do fork que a hidratação descarta — ver `sdk/enquetes.ts`. */
    for (const id of anotarEventoDeEnquete(evento)) republicarEnquete(id);
    /* Evento agendado é superfície do fork que o SDK não conhece — ver
       `sdk/eventos.ts`. */
    anotarEventoDeServidor(evento);
    const e = evento as {
      type?: string;
      members?: readonly {
        _id?: { server?: string; user?: string };
        can_publish?: boolean;
        can_receive?: boolean;
      }[];
      id?: { server?: string; user?: string };
      data?: { can_publish?: boolean; can_receive?: boolean };
      clear?: readonly string[];
    };

    /*
      ⚠ **`can_receive` entrou junto, e pelo mesmo caminho.** É o "ensurdecer
      no servidor" do menu do participante: sem ele o item não teria como
      saber se está marcado, e alternar às cegas desfaria o que outro
      moderador acabou de fazer.
    */
    const anotar = (
      conjunto: Set<ChaveDeMembro>,
      serverId: string | undefined,
      userId: string | undefined,
      pode: boolean | undefined,
    ) => {
      if (serverId === undefined || userId === undefined) return;
      /* `undefined` é "o servidor não falou disto", que NÃO é o mesmo que
         `true` — mas para a tela dá no mesmo, e guardar a ausência faria o
         mapa crescer com todo mundo que nunca foi silenciado. */
      if (pode === false) conjunto.add(chaveDeMembro(serverId, userId));
      else conjunto.delete(chaveDeMembro(serverId, userId));
    };

    if (e.type === "Ready" && e.members) {
      for (const m of e.members) {
        anotar(mudosPeloServidor, m._id?.server, m._id?.user, m.can_publish);
        anotar(surdosPeloServidor, m._id?.server, m._id?.user, m.can_receive);
      }
      republicarVoz();
    } else if (e.type === "ServerMemberUpdate" && e.id) {
      /*
        ⚠ **Só mexe no campo que o evento TRAZ, e antes mexia sempre.** O
        update é PARCIAL: trocar o apelido de alguém chega com `data:
        {nickname}` e nada de `can_publish` — e a versão anterior lia essa
        ausência como "pode falar", destravando em silêncio quem estava mudo
        pelo servidor. Voltar ao padrão vem em `clear`, não na ausência.
      */
      const { server, user } = e.id;
      /*
        ⚠ **A transição precisa ser lida ANTES e DEPOIS, e só para VOCÊ.**

        `anotar` é idempotente — ele não distingue "passou a ser" de "já era".
        Sem a leitura de antes, um `ServerMemberUpdate` qualquer que reafirmasse
        `can_publish: false` dispararia o aviso de novo, e o servidor reafirma
        campos com frequência. E o aviso é sobre o PRÓPRIO microfone: quem é
        silenciado aparece com `SRV` na coluna para todo mundo, mas só quem
        perdeu a voz precisa da frase.
      */
      const chave =
        server !== undefined && user !== undefined && user === usuarioLocal
          ? chaveDeMembro(server, user)
          : undefined;
      const mudoAntes = chave !== undefined && mudosPeloServidor.has(chave);
      const surdoAntes = chave !== undefined && surdosPeloServidor.has(chave);

      if (e.data && "can_publish" in e.data) {
        anotar(mudosPeloServidor, server, user, e.data.can_publish);
      } else if (e.clear?.includes("CanPublish")) {
        anotar(mudosPeloServidor, server, user, true);
      }
      if (e.data && "can_receive" in e.data) {
        anotar(surdosPeloServidor, server, user, e.data.can_receive);
      } else if (e.clear?.includes("CanReceive")) {
        anotar(surdosPeloServidor, server, user, true);
      }

      if (chave !== undefined) {
        const mudoDepois = mudosPeloServidor.has(chave);
        const surdoDepois = surdosPeloServidor.has(chave);
        if (mudoDepois !== mudoAntes) avisarMudoDoServidor(!mudoDepois);
        if (surdoDepois !== surdoAntes) avisarSurdoDoServidor(!surdoDepois);
      }
      republicarVoz();
    } else {
      /*
        ⚠ **O servidor te MOVEU de canal — e isto não existia.** O SDK descarta
        `UserMoveVoiceChannel` (o `case` dele é um `// todo` vazio), então o
        único sinal que chegava era o LiveKit fechando a conexão: a chamada
        sumia e nada dizia por quê. Ver `sdk/vozImposta.ts` para a corrida entre
        os dois sinais.
      */
      /* "por Fulano" da desconexão (D-LAC-25): evento PRIVADO do fork, só
         para quem foi tirado — ver `sdk/vozImposta.ts`. */
      const autorDaRemocao = lerAutorImposto(evento, usuarioLocal);
      if (autorDaRemocao) {
        registrarAutorImposto(
          autorDaRemocao.canal,
          nomeDe(autorDaRemocao.server, autorDaRemocao.por),
        );
      }
      const movimento = lerMovimentoImposto(evento);
      if (movimento) {
        const servidorDoMovimento = client.channels.get(movimento.para)?.serverId;
        registrarMovimentoImposto({
          de: movimento.de,
          para: movimento.para,
          nomeDe: client.channels.get(movimento.de)?.name ?? "a sala anterior",
          nomePara: client.channels.get(movimento.para)?.name ?? "outra sala",
          ...(movimento.por !== undefined && servidorDoMovimento
            ? { porNome: nomeDe(servidorDoMovimento, movimento.por) }
            : {}),
        });
      }
      traduzirSinalDeChamada(evento);
      inserirLinhasDeSala(evento);
    }

    if (e.type === "Ready" || e.type === "UserRelationship") {
      observarRelacoes(evento);
    }
  });

  /*
    A superfície a mais do servidor do Vortex — `spoiler`, `invites_paused` e
    `mentionable` —, que o SDK descarta na hidratação. Mesmo arranjo do
    `can_publish` acima; a decisão mora em `superficieVortex.ts`, que é puro.
  */
  client.events.on("event", aplicarSuperficieVortex);

  /*
    O cursor de leitura andou em OUTRO dispositivo — para a frente (leu lá) ou
    para trás (marcou como não lida lá). O SDK só emite; o estado é daqui.
  */
  client.on("channelAcknowledged", (canal, messageId) => {
    aplicarAckRemoto(canal.id, messageId);
  });

  client.on("connected", () => {
    definirConexao("conectado");
    /*
      ⚠ **O histórico adiado é retomado AQUI e também no `ready`, e a
      redundância é medida — não zelo.**

      Ele vivia só no `ready`, e o `ready` não é confiável: o `EventClient` do
      SDK reconecta sozinho depois de um `error` de socket, e a máquina de
      estado dele não volta para `Connecting`. O segundo `Authenticated` cai
      em `Connected` e ele LANÇA — `Uncaught Unreachable code. Received Ready
      in Connected state.` — antes de emitir. Nenhum `client.on("ready")` do
      adapter roda nesse caso.

      Medido com as duas sondas: `__conexoes` em 1 (não é connect duplicado
      nosso) e `__historico` em `adiado: true, conectado: true` — o canal
      esperando um evento que já tinha sido descartado, com o socket de pé.

      `connected` é emitido a cada (re)conexão e não depende da hidratação, o
      que o torna o gancho certo para "volte a tentar o que ficou parado".
      Como `carregarHistorico` sai na primeira linha quando já pediu, chamar
      nos dois lugares não duplica requisição.
    */
    for (const id of [...historicoAdiado]) void carregarHistorico(id);
    renovarPresencaDoServidor();
  });
  client.on("connecting", () => definirConexao("reconectando"));
  client.on("disconnected", () => definirConexao("sem-conexao"));

  /*
    Silêncio mudou: os canais na tela precisam reperguntar.

    Mesma forma da permissão, e pela mesma razão: o store é a fonte, mas quem
    responde é `channel.muted` — e o snapshot só é reconstruído quando alguém o
    reemite. Sem isto, silenciar não mudaria nada na tela até o canal ser
    tocado por outro motivo.

    Todos os assinados e não só o alterado: silêncio pode herdar do servidor um
    dia, e aí um clique muda vários. Assinados são as dezenas de canais
    visíveis, não os milhares de mensagens — a varredura é barata aqui de um
    jeito que não seria lá.
  */
  assinarSilencio(() => {
    for (const id of channels.assinados()) reemitirCanal(id);
    /*
      O rollup também: silenciar um canal ou um servidor tira as não-lidas
      dele do rail e da caixa de entrada. Recontar inteiro é barato aqui — a
      varredura é sobre canais COM contagem, e silenciar é clique humano, não
      evento do firehose.
    */
    recontarServidores();
  });

  /* Favoritar é ação humana e muda a ORDEM — republica a coluna da casa. */
  assinarFavoritos(publicarConversas);
  /*
    O filtro de desconhecidos e as decisões da fila mudam QUAL lista uma
    conversa ocupa. Os dois são gesto humano — um interruptor, um "Aceitar" —,
    então republicar a varredura inteira aqui é o preço certo.
  */
  assinarPrivacidade(publicarConversas);
  assinarPrivacidadeDoServidor(publicarConversas);
  assinarSolicitacoes(publicarConversas);

  // Permissão mudou: as linhas na tela precisam reperguntar. Ver
  // `repensarPermissoes`.
  client.on("serverRoleUpdate", repensarPermissoes);
  client.on("serverRoleDelete", repensarPermissoes);
  client.on("serverMemberUpdate", repensarPermissoes);

  instalarSync();

  client.on("ready", () => {
    /*
      O histórico que ficou esperando o socket.

      Primeira coisa do `Ready`, e de propósito: quem abriu o app num link de
      canal está olhando para a lista vazia desde o primeiro quadro.
    */
    for (const id of [...historicoAdiado]) void carregarHistorico(id);

    /*
      A casa nasce pronta no `Ready`.

      As conversas chegam no payload de abertura, não por evento: o protocolo
      entrega DMs e grupos junto com o resto. Sem isto a coluna abriria vazia e
      só se preencheria na primeira mensagem nova de cada conversa — que é o
      mesmo defeito que a semeadura de não-lidas veio consertar.
    */
    /*
      ⚠ **Os SERVIDORES, e a falta disto deixava o rail vazio para sempre.**

      `serverIds` só era preenchido pelo evento `serverCreate` — que existe
      para o servidor criado ou entrado COM O APP ABERTO. Quem já era membro de
      alguma coisa ao conectar não via nada: o `Ready` traz os servidores, os
      canais e os membros, e ninguém os lia.

      Medido contra a instância local: `Ready` chegava com
      `servers: [{Time Vortex, 1 canal}]` e o rail dizia "sem servidores", até
      depois de recarregar. A coluna de canais dizia "este servidor não tem
      canais" com o canal existindo no backend.

      ⚠ **Nunca apareceu porque o ARNÊS semeia `serverIds` direto.** É a mesma
      família de "o arnês é mais pobre que o protocolo", com o sinal trocado:
      aqui ele era mais RICO, e por isso escondia a ausência do caminho real.

      Os canais vão junto e não por `channelCreate` pela mesma razão — o
      payload de abertura já os tem.
    */
    const doProtocolo = client.servers.toList();
    if (doProtocolo.length > 0) {
      serverIds.set(RAIZ, doProtocolo.map((s) => s.id));
      for (const servidor of doProtocolo) {
        canaisPorServidor.set(servidor.id, [...servidor.channelIds]);
        publicarCanais(servidor.id);
        void semearMembros(servidor.id);
      }
    }

    publicarConversas();
    publicarRelacoes();

    /*
      O meu status vem do servidor, não do default do store.

      Sem isto o painel de usuário abre sempre dizendo "Online" — e quem tinha
      escolhido invisível na sessão anterior veria a interface afirmar o
      contrário do que o servidor sabe, o que é pior que não mostrar nada: a
      pessoa acha que está escondida e não está, ou o inverso.

      Mesma família da semeadura de não-lidas logo abaixo: o `Ready` já traz o
      dado, e o que faltava era alguém lê-lo.
    */
    semearStatusDoServidor();

    for (const unread of client.channelUnreads.toList()) {
      const channelId = unread.id;
      // `ReactiveSet`, não array: o SDK expõe o conjunto do protocolo como
      // estrutura reativa do Solid. Ler `size` aqui dentro é o contrato.
      const mencoes = unread.messageMentionIds?.size ?? 0;
      cursorDeLeitura.set(channelId, unread.lastMessageId ?? "");

      const canal = client.channels.get(channelId);
      const ultima = canal?.lastMessageId;
      // Sem cursor, ou cursor já na última: nada por ler.
      const temNaoLida =
        ultima !== undefined && ultima !== null && ultima !== unread.lastMessageId;
      if (!temNaoLida && mencoes === 0) continue;

      contagemPorCanal.set(channelId, {
        // 1 é "existe", não "uma". Ver a ressalva acima.
        naoLidas: temNaoLida ? 1 : 0,
        mencoes,
      });
      reemitirCanal(channelId);
    }
    /* Uma recontagem no fim, e não uma soma por canal: é a mesma regra do
       silêncio (canal mudo não acende o servidor) num lugar só. */
    recontarServidores();

    void puxarConfiguracoes();
    /* Sessão nova é inscrição nova: o push é por SESSÃO no servidor. */
    void sincronizarPush();

    /* Por último: servidores, canais e conversas já estão publicados. */
    definirProntidao(true);
  });

  client.on("messageCreate", (message) => {
    /*
      Esta mensagem é a confirmação de uma que já está na tela?

      Se for, ela NÃO entra na lista: a linha otimista continua onde está, com
      o ID local que já é a chave dela no virtualizador. Trocar a chave aqui
      desmontaria e remontaria a linha no instante seguinte ao Enter — a
      pessoa veria a própria mensagem piscar, e num histórico longo a âncora
      iria junto.

      É a razão de o nonce existir no protocolo, e o único lugar do app que
      precisa saber disso.
    */
    const confirmada = reconciliar(nonceDe(message), message.id);
    if (confirmada) {
      registrarApelido(message.id, confirmada.idLocal);
      marcarEnvio(confirmada.idLocal, "sent");
      return;
    }

    const ids = idsOf(message.channelId);
    ids.push(message.id);
    // Só a recém-chegada muda de layout: ela olha para trás, e ninguém
    // olha para ela. É o caminho quente, e é O(1).
    recalcularLayout(message.channelId, ids.length - 1, ids.length - 1);
    publish(message.channelId);
    // Depois do publish, não antes: contabilizar é trabalho da coluna
    // lateral, e o caminho quente da lista não deve esperar por ele.
    contabilizarNaoLida(message.channelId, message.content);
    avisarChegada(message);
  });

  /*
    Fixar/desafixar por OUTRA pessoa chega como `MessageUpdate` com `pinned`. O
    painel de fixados mantém a lista por este evento, sem refazer a busca. Só
    reage à MUDANÇA do campo: o eco da nossa própria ação já encontra o valor
    escrito (`alternarFixada` é otimista) e não repete nada.
  */
  client.on("messageUpdate", (message, anterior) => {
    const antes = (anterior as { pinned?: boolean | null }).pinned === true;
    if (message.pinned === antes) return;
    publicarFixadas(message.channelId);
    aplicarFixacao(message.channelId, message.id, message.pinned);
  });

  client.on("messageDelete", (message) => {
    const channelId = message.channelId;
    if (!channelId) return;
    removerFixada(channelId, message.id);
    const ids = idsOf(channelId);
    // `chaveLocal`: se esta mensagem foi enviada por aqui, a lista a conhece
    // pelo ID otimista, e o servidor está falando do ID dele.
    const chave = chaveLocal(message.id);
    // Eco de uma remoção otimista: o servidor confirmou, então um `DELETE`
    // que ainda falhe por outro caminho não pode devolver a linha.
    const pendente = apagadasOtimistas.get(chave);
    if (pendente) pendente.confirmada = true;
    const at = ids.indexOf(chave);
    if (at === -1) return;
    ids.splice(at, 1);
    // A que vinha depois passa a olhar para outro vizinho — pode deixar de
    // continuar um grupo, ou passar a abrir um dia.
    recalcularLayout(channelId, at, at);
    publish(channelId);
  });

  client.on("userUpdate", (user) => {
    // Presença vai para o store efêmero, com throttle na fronteira do adapter.
    // Nunca para o store de mensagens: um servidor grande emite centenas
    // destes por segundo e a lista inteira acordaria a cada piscada.
    const status = presencaDe(user.online, user.status?.presence);
    presence.set(user.id, status);
    // A member list só reordena se o BALDE mudou — online↔idle↔dnd não move
    // ninguém, e é a esmagadora maioria destes eventos.
    atualizarBalde(user.id, status);

    /*
      A RELAÇÃO muda por evento humano — pedido aceito, pessoa bloqueada —, e é
      raro. Republicar as abas aqui é seguro; republicar por presença não seria,
      e é por isso que a comparação existe: `userUpdate` chega centenas de vezes
      por segundo num servidor grande, e quase sempre só a presença mudou.
    */
    const antes = pessoas.peek(user.id)?.relacao;
    if (antes !== undefined && antes !== toRelacaoSnapshot(user).relacao) {
      publicarRelacoes();
      // Virar amigo tira a conversa da fila; bloquear a tira da coluna.
      publicarConversas();
    }
  });

  client.on("serverCreate", (server) => {
    const lista = serverIds.peek(RAIZ) ?? [];
    if (lista.includes(server.id)) return;
    serverIds.set(RAIZ, [...lista, server.id]);
    canaisPorServidor.set(server.id, [...server.channelIds]);
    publicarCanais(server.id);
  });

  client.on("channelCreate", (channel) => {
    const serverId = channel.serverId;
    // Conversa não tem servidor: ela entra na coluna da casa, não na de canais.
    if (!serverId) {
      publicarConversas();
      return;
    }
    const ids = canaisPorServidor.get(serverId) ?? [];
    if (ids.includes(channel.id)) return;
    ids.push(channel.id);
    canaisPorServidor.set(serverId, ids);
    publicarCanais(serverId);
  });

  client.on("channelDelete", (channel) => {
    const serverId = channel.serverId;
    if (!serverId) {
      publicarConversas();
      return;
    }
    const ids = canaisPorServidor.get(serverId);
    const at = ids?.indexOf(channel.id) ?? -1;
    if (!ids || at === -1) return;
    ids.splice(at, 1);
    publicarCanais(serverId);
  });

  // Entrada e saída de membro passam pelo flush coalescido: um servidor
  // sincronizando membros emite estes em rajada, e reordenar por evento seria
  // o mesmo custo quadrático que a carga de mensagens já ensinou.
  client.on("serverMemberJoin", (member) => {
    registrarMembro(member.id.server, member.id.user);
    agendarFlush();
  });

  client.on("serverMemberLeave", (member) => {
    removerMembro(member.id.server, member.id.user);
    agendarFlush();
  });

  client.on("channelStartTyping", (channel, user) => {
    if (!user) return;
    let set = typingByChannel.get(channel.id);
    if (!set) {
      set = new Set();
      typingByChannel.set(channel.id, set);
    }
    set.add(user.id);
    typing.set(channel.id, [...set]);
  });

  client.on("channelStopTyping", (channel, user) => {
    if (!user) return;
    const set = typingByChannel.get(channel.id);
    if (!set) return;
    set.delete(user.id);
    typing.set(channel.id, [...set]);
  });
}

/** SONDA: o id está assinado? o snapshot acompanhou o SDK? */
export function diagnostico(id: string) {
  return {
    assinado: messages.subscriberCount(id) > 0,
    assinantes: messages.subscriberCount(id),
    noStore: messages.getSnapshot(id)?.content,
    noSdk: client.messages.get(id)?.content,
  };
}

/**
 * Traz o histórico do canal do servidor.
 *
 * ⚠ **NÃO EXISTIA, e a ausência tornava o app inutilizável contra um servidor
 * real.** `channelMessageIds` só era populado por evento (`messageCreate`) e
 * por envio otimista, então todo canal abria vazio: o que você mandou some no
 * primeiro F5, e conversa de outra pessoa só aparece se chegar com a aba
 * aberta. Passou despercebido porque todo dado vinha do firehose, que semeia
 * o canal por `seedChannel`.
 *
 * ## Três decisões, e as três têm consequência medida
 *
 * **Vai pelo caminho de MASSA e nunca pelo de evento.** É invariante desta
 * base desde a fase 0 — carga em massa por `messageCreate` publica uma vez
 * por mensagem e destrói a âncora do virtualizador. `seedChannel` publica uma
 * vez só.
 *
 * **MESCLA, não substitui.** Entre o pedido e a resposta cabe um envio
 * otimista e um `messageCreate`. Trocar a lista pelo que o servidor devolveu
 * apagaria os dois — a mensagem que a pessoa acabou de escrever sumindo da
 * tela por causa de uma requisição que ela não pediu.
 *
 * ⚠ **Dedupe por `chaveLocal`, e sem isso a própria mensagem duplicaria.**
 * Depois da reconciliação, a lista guarda a otimista pelo ID LOCAL para
 * sempre e o ID do servidor vira apelido. O histórico chega com o ID do
 * servidor — comparar cru daria duas linhas para a mesma mensagem, uma delas
 * com o corpo repetido logo abaixo da outra.
 *
 * Uma vez por canal por sessão. A janela deslizante e o prepend continuam
 * pendentes; isto é o que faltava para o canal ter conteúdo.
 */
const historicoPedido = new Set<string>();

/** Canais cuja lista montou antes de haver socket. Retomados no `Ready`. */
const historicoAdiado = new Set<string>();

/**
 * Onde está o histórico de um canal, para a lista dizer a verdade.
 *
 * Observável e não só a sonda `estadoDoHistorico`: "o canal está vazio" e "o
 * histórico ainda não chegou" renderizam a mesma lista de zero IDs, e a tela
 * precisa distinguir esqueleto de começo-do-canal. `pagina` é o prepend em voo
 * (o aviso no topo). Muda poucas vezes por canal — frequência de ação humana —,
 * então mora no store normal.
 */
export type EstadoDoHistorico = {
  readonly inicial: "carregando" | "pronto" | "falhou";
  readonly pagina: boolean;
};
export const estadoDoHistoricoDoCanal = createEntityStore<EstadoDoHistorico>();

function atualizarHistorico(channelId: string, parte: Partial<EstadoDoHistorico>): void {
  const atual = estadoDoHistoricoDoCanal.peek(channelId) ?? { inicial: "carregando", pagina: false };
  const inicial = parte.inicial ?? atual.inicial;
  const pagina = parte.pagina ?? atual.pagina;
  /* Referência nova só quando algo mudou: o getter devolve o objeto guardado. */
  if (inicial === atual.inicial && pagina === atual.pagina) return;
  estadoDoHistoricoDoCanal.set(channelId, { inicial, pagina });
}

export async function carregarHistorico(channelId: string): Promise<void> {
  if (historicoPedido.has(channelId)) return;
  /*
    ⚠ **Adiar, e nunca desistir — a primeira versão desistia e o defeito só
    aparecia no caminho mais comum que existe.** Abrir o app direto na URL de
    um canal (F5, permalink, convite) monta a lista ANTES de o socket estar
    pronto: o canal ainda não existe em `client.channels` e `conectado()` é
    falso. Com um `return` seco, o efeito da lista — que roda uma vez por
    canal — nunca mais tentava, e o canal ficava vazio para sempre.

    Clicar no servidor pela casa funcionava, porque ali a conexão já subiu. É
    a diferença entre o caminho que se testa e o caminho que se usa.
  */
  const canal = client.channels.get(channelId);
  if (canal === undefined || !conectado()) {
    historicoAdiado.add(channelId);
    atualizarHistorico(channelId, { inicial: "carregando" });
    return;
  }

  /*
    Marcado ANTES do `await`: dois montes no mesmo tick — StrictMode em dev,
    ou trocar de canal e voltar depressa — pediriam o mesmo histórico duas
    vezes, e a segunda resposta reescreveria a lista por cima da primeira.
  */
  historicoAdiado.delete(channelId);
  historicoPedido.add(channelId);
  atualizarHistorico(channelId, { inicial: "carregando" });

  try {
    const doServidor = await buscarMensagensComEnquetes(canal.id, {
      limit: LIMITE_DE_HISTORICO,
    });

    /* O protocolo devolve do mais NOVO para o mais velho. */
    const doHistorico: string[] = [];
    const vistos = new Set<string>();
    for (let i = doServidor.length - 1; i >= 0; i -= 1) {
      const bruto = doServidor[i];
      if (bruto === undefined) continue;
      const chave = chaveLocal(bruto.id);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      doHistorico.push(chave);
    }

    /*
      O que chegou enquanto isto viajava vai para o FIM, na ordem em que está.
      São mensagens mais novas que o histórico por construção — evento novo ou
      otimista recém-criada.
    */
    for (const id of idsOf(channelId)) {
      if (vistos.has(id)) continue;
      vistos.add(id);
      doHistorico.push(id);
    }

    seedChannel(channelId, doHistorico);
    atualizarHistorico(channelId, { inicial: "pronto" });
  } catch {
    /*
      Solta a marca: sem isto, uma falha de rede na primeira abertura deixaria
      o canal vazio para o resto da sessão, sem nenhuma forma de tentar de
      novo a não ser recarregar a página.
    */
    historicoPedido.delete(channelId);
    atualizarHistorico(channelId, { inicial: "falhou" });
  }
}

/**
 * Quantas mensagens a primeira carga traz.
 *
 * 100 é o teto do protocolo por chamada. Não é escolha de performance — o
 * gate mediu que o custo por frame não depende do tamanho da lista, e sim da
 * janela visível — é o que evita uma segunda chamada logo na abertura.
 */
const LIMITE_DE_HISTORICO = 100;

/**
 * A página anterior do histórico, ao rolar para cima.
 *
 * ⚠ **Sem isto, `carregarHistorico` era um teto e não um começo.** Ela traz as
 * 100 últimas; num canal com mil mensagens as outras novecentas eram
 * inalcançáveis — rolar até o topo mostrava o começo da lista como se fosse o
 * começo do canal, que é a interface afirmando algo falso.
 *
 * O trabalho pesado já existia: `prependHistory` insere na frente e o TanStack
 * reancora pela chave do item sob o scroll. Faltavam o cursor e o gatilho.
 *
 * ⚠ **`before` é o ID da mensagem mais antiga que a lista TEM**, e não um
 * contador de páginas. Com deslocamento, uma mensagem apagada entre duas
 * chamadas faria a página seguinte pular uma linha; com cursor de ID, o
 * servidor responde a partir de um ponto que existe.
 *
 * ⚠ **Dedupe pelo mesmo `chaveLocal` da carga inicial.** Uma mensagem sua já
 * reconciliada vive na lista pelo ID LOCAL, e a página vem com o do servidor.
 */
const paginaEmVoo = new Set<string>();
let ultimaTentativaDePagina = "nunca chamada";
const historicoNoFim = new Set<string>();

/** Não há mais o que buscar para trás — a coluna para de pedir. */
export function historicoAcabou(channelId: string): boolean {
  return historicoNoFim.has(channelId);
}

export async function carregarPaginaAnterior(channelId: string): Promise<void> {
  ultimaTentativaDePagina = "entrou";
  if (paginaEmVoo.has(channelId) || historicoNoFim.has(channelId)) {
    ultimaTentativaDePagina = "em voo ou acabou";
    return;
  }
  /*
    Só depois da primeira carga: pedir uma página anterior sem ter a atual
    daria um cursor inventado, e o servidor responderia a partir do fim.
  */
  if (!historicoPedido.has(channelId)) {
    ultimaTentativaDePagina = "sem carga inicial";
    return;
  }

  const canal = client.channels.get(channelId);
  if (canal === undefined || !conectado()) {
    ultimaTentativaDePagina = "sem canal ou sem socket";
    return;
  }

  const atuais = idsOf(channelId);
  const maisAntiga = atuais[0];
  if (maisAntiga === undefined) {
    ultimaTentativaDePagina = "lista vazia";
    return;
  }

  /*
    O cursor precisa ser o ID que o SERVIDOR conhece. Para uma mensagem nossa
    a lista guarda o ID local, e mandá-lo faria o servidor não achar o ponto.
  */
  const cursor = idDoSdk(maisAntiga);

  paginaEmVoo.add(channelId);
  atualizarHistorico(channelId, { pagina: true });
  try {
    const doServidor = await buscarMensagensComEnquetes(canal.id, {
      limit: LIMITE_DE_HISTORICO,
      before: cursor,
    });

    /*
      Página menor que o pedido = chegamos ao começo do canal. Vazia também,
      e é o caso comum quando o total é múltiplo de 100.
    */
    if (doServidor.length < LIMITE_DE_HISTORICO) historicoNoFim.add(channelId);
    if (doServidor.length === 0) return;

    const jaTem = new Set(atuais);
    const antigas: string[] = [];
    for (let i = doServidor.length - 1; i >= 0; i -= 1) {
      const bruto = doServidor[i];
      if (bruto === undefined) continue;
      const chave = chaveLocal(bruto.id);
      if (jaTem.has(chave)) continue;
      jaTem.add(chave);
      antigas.push(chave);
    }

    ultimaTentativaDePagina = `trouxe ${String(antigas.length)}`;
    prependHistory(channelId, antigas);
  } catch (e) {
    ultimaTentativaDePagina = `falhou: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    paginaEmVoo.delete(channelId);
    atualizarHistorico(channelId, { pagina: false });
  }
}

export type ChegadaAMensagem =
  /** A mensagem está na lista; `chave` é como a lista a conhece (o ID local, se for sua). */
  | { readonly estado: "pronta"; readonly chave: string }
  /** O histórico chegou ao começo e ela não está nele (apagada, ou de outro canal). */
  | { readonly estado: "ausente" }
  /** Sem conexão, canal desconhecido ou a rede falhou no meio do caminho. */
  | { readonly estado: "falhou" };

/** Teto de páginas por salto: 40 × 100 = 4.000 mensagens para trás. */
const LIMITE_DE_PAGINAS_NO_SALTO = 40;

const dormir = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

/**
 * Faz a mensagem existir na lista, para a tela poder saltar até ela.
 *
 * ⚠ **Carrega para trás até a encontrar, e não "em volta" dela.** O protocolo
 * tem `nearby`, mas uma janela em volta de uma mensagem antiga seria uma
 * SEGUNDA janela, separada da que a lista já tem: o que ficasse entre as duas
 * seria um buraco que a timeline desenharia como se fosse contínuo — a
 * interface afirmando um histórico sem as mensagens do meio. Paginar com o
 * cursor que já existe (`carregarPaginaAnterior`) mantém uma lista só,
 * contígua até o presente, e o virtualizador reancora pela chave como em
 * qualquer prepend. O custo é uma chamada por 100 mensagens de distância,
 * limitado por `LIMITE_DE_PAGINAS_NO_SALTO`.
 *
 * A comparação para saber que passou do ponto é de ULID (ordem do ID = ordem
 * do tempo): se a mais antiga da lista já é anterior ao alvo e o alvo não está
 * nela, ele não existe mais — para de pedir.
 */
export async function carregarAteMensagem(
  channelId: string,
  messageId: string,
): Promise<ChegadaAMensagem> {
  const chave = chaveLocal(messageId);
  for (let volta = 0; volta <= LIMITE_DE_PAGINAS_NO_SALTO; volta += 1) {
    const ids = idsOf(channelId);
    if (ids.includes(chave)) return { estado: "pronta", chave };

    const maisAntiga = ids[0];
    if (maisAntiga !== undefined && idDoSdk(maisAntiga) < messageId && historicoPedido.has(channelId)) {
      return { estado: "ausente" };
    }
    if (historicoNoFim.has(channelId)) return { estado: "ausente" };
    if (volta === LIMITE_DE_PAGINAS_NO_SALTO) return { estado: "falhou" };

    if (!historicoPedido.has(channelId)) {
      await carregarHistorico(channelId);
      if (!historicoPedido.has(channelId)) return { estado: "falhou" };
      continue;
    }
    if (paginaEmVoo.has(channelId)) {
      await dormir(120);
      continue;
    }

    const antes = ids.length;
    await carregarPaginaAnterior(channelId);
    if (idsOf(channelId).length === antes && !historicoNoFim.has(channelId)) {
      /* Nada entrou e o histórico não acabou: a página falhou (rede). */
      return { estado: "falhou" };
    }
  }
  return { estado: "falhou" };
}

/**
 * SONDA: por que este canal está vazio?
 *
 * Mesma família de `estadoDaFila`, e pela mesma razão: "a lista está vazia
 * porque ninguém pediu, porque o pedido está em voo, ou porque ele falhou?"
 * — os três renderizam nada. Sem isto, descobrir custou uma rodada inteira de
 * navegador.
 *
 * Exposta em `globalThis` só em DEV, porque a pergunta se faz no console e o
 * arnês não está no caminho do produto.
 */
export function estadoDoHistorico(channelId: string) {
  return {
    pedido: historicoPedido.has(channelId),
    adiado: historicoAdiado.has(channelId),
    paginaEmVoo: paginaEmVoo.has(channelId),
    acabou: historicoNoFim.has(channelId),
    ultimaTentativaDePagina,
    idsNaLista: idsOf(channelId).length,
    canalNoSdk: client.channels.get(channelId) !== undefined,
    conectado: conectado(),
  };
}

if (import.meta.env.DEV) {
  (globalThis as unknown as Record<string, unknown>).__historico =
    estadoDoHistorico;
}

/* ------------------------------------------------------ linhas da sala */

/**
 * O último ID da lista que o SERVIDOR conhece.
 *
 * ⚠ Linha de sala (`sdk/eventosDaSala.ts`) é local: mandá-la como cursor de
 * `ack` gravaria no protocolo um ULID inventado — e, sendo mais novo que tudo,
 * marcaria como lida a próxima mensagem de verdade antes de ela chegar.
 */
function ultimaDoServidor(ids: readonly string[]): string | undefined {
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const id = ids[i];
    if (id !== undefined && !ehLinhaDeSala(id) && !ehEntradaNoTopico(id)) return id;
  }
  return undefined;
}

/** A sala cujas linhas estão na lista agora — no máximo uma. */
let salaComLinhas = "";
let chamadaAssinada = false;

function soltarLinhasDaSala(canal: string): void {
  if (canal === "") return;
  const soltas = new Set(soltarLinhasDe(canal));
  if (soltas.size > 0) {
    const ids = idsOf(canal);
    const restantes = ids.filter((id) => !soltas.has(id));
    ids.length = 0;
    ids.push(...restantes);
    for (const id of soltas) client.messages.delete(id);
    recalcularLayout(canal, 0, ids.length - 1);
    publish(canal);
  }
  if (salaComLinhas === canal) salaComLinhas = "";
}

/**
 * Entrou, saiu, foi movido — como linha de sistema no chat da sala.
 *
 * ⚠ **Mensagem LOCAL do SDK e não entrada à parte na lista**, e é o que a faz
 * custar zero componente novo: `vizinho`, `recalcularLayout` e a linha de
 * sistema da `MessageRow` já sabem tratá-la. `getOrCreate` com `isNew = false`
 * não emite `messageCreate` — ou seja, não conta como não lida, não toca som
 * e não passa pela reconciliação por nonce.
 */
function inserirLinhasDeSala(evento: unknown): void {
  const chamada = lerChamada();
  const canal = chamada.estado === "fora" ? "" : chamada.channelId;
  const linhas = linhasDoEvento(evento, canal);
  if (linhas.length === 0) return;

  if (!chamadaAssinada) {
    chamadaAssinada = true;
    /* Sair da sala (ou trocar de sala) apaga as linhas: elas são "visível só
       para conectados", e guardá-las seria acumular uma por entrada numa
       sessão de 8h. */
    assinarChamada(() => {
      const agora = lerChamada();
      const atual = agora.estado === "fora" ? "" : agora.channelId;
      if (salaComLinhas !== "" && salaComLinhas !== atual) soltarLinhasDaSala(salaComLinhas);
    });
  }

  for (const linha of linhas) {
    if (!client.channels.get(linha.canal)) continue;
    const id = proximoId();
    registrarLinhaDeSala(id, linha.canal, linha.sistema);
    client.messages.getOrCreate(
      id,
      {
        _id: id,
        channel: linha.canal,
        author: linha.userId,
        content: "",
        /* Só para o SDK hidratar como linha de sistema; o FATO é lido do
           registro em `toSistema`. */
        system: { type: "text", content: "" },
      },
      false,
    );
    const ids = idsOf(linha.canal);
    ids.push(id);
    recalcularLayout(linha.canal, ids.length - 1, ids.length - 1);
    publish(linha.canal);
    salaComLinhas = linha.canal;
  }
}

/* ---------------------------------------------------- entradas no tópico */

/**
 * Quem seguia o tópico ANTES do `ChannelUpdate` — tirado antes de o registro
 * de `vortexCanal.ts` o aplicar, porque depois só sobra a lista nova.
 *
 * Só `ChannelUpdate` com `thread`: é o que seguir e responder publicam. Um
 * `ChannelCreate` não é entrada — o dono nasce seguindo.
 */
function seguidoresAntesDoEvento(
  evento: unknown,
): { readonly canal: string; readonly seguidores: readonly string[] } | undefined {
  const e = evento as { type?: unknown; id?: unknown; data?: { thread?: unknown } };
  if (e.type !== "ChannelUpdate" || typeof e.id !== "string" || e.data?.thread === undefined) {
    return undefined;
  }
  const meta = lerTopico(e.id);
  return meta && { canal: e.id, seguidores: meta.seguidores };
}

/**
 * "Rafa e Nando entraram no tópico" (D-CANAIS-23) — ver `sdk/entradasNoTopico.ts`.
 *
 * Mesma mecânica das linhas da sala: mensagem LOCAL do SDK com `isNew =
 * false`, então não conta como não lida, não toca som e não passa pela
 * reconciliação por nonce.
 *
 * ⚠ **Só em tópico cuja conversa está na memória ou na tela.** Um evento de
 * seguir num tópico que ninguém abriu criaria a lista dele com uma linha só —
 * e a linha ficaria esperando um histórico que talvez nunca venha.
 */
function inserirEntradasNoTopico(canal: string, antes: readonly string[]): void {
  const meta = lerTopico(canal);
  const novos = quemEntrou(antes, meta?.seguidores, {
    eu: usuarioLocal,
    respondeu: meta?.ultimoAutorId,
  });
  if (novos.length === 0) return;
  const ids = index.get(canal);
  const naMemoria = (ids?.length ?? 0) > 0 || channelMessageIds.subscriberCount(canal) > 0;
  if (!naMemoria || !client.channels.get(canal)) return;
  const lista = idsOf(canal);

  const juntar = juntarOuAbrir(lista[lista.length - 1], canal, novos, Date.now());
  if (juntar) {
    registrarEntrada(juntar.juntarEm, canal, juntar.userIds);
    /* O objeto do SDK não mudou, então o efeito Solid da linha não re-roda:
       quem a acorda é um snapshot novo — a mecânica de `republicarEnquete`. */
    republicarEnquete(juntar.juntarEm);
    return;
  }

  const id = proximoId();
  registrarEntrada(id, canal, novos);
  client.messages.getOrCreate(
    id,
    {
      _id: id,
      channel: canal,
      author: novos[0]!,
      content: "",
      /* Só para o SDK hidratar como linha de sistema; o FATO é lido do
         registro em `toSistema`. */
      system: { type: "text", content: "" },
    },
    false,
  );
  lista.push(id);
  recalcularLayout(canal, lista.length - 1, lista.length - 1);
  publish(canal);
}

/** Semeia o canal sem passar por evento — é setup, não carga medida. */
export function seedChannel(channelId: string, ids: readonly string[]) {
  const target = idsOf(channelId);
  target.length = 0;
  target.push(...ids);
  recalcularLayout(channelId, 0, target.length - 1);
  publishNow(channelId);
  // A lista de fixadas é derivada dos IDs do canal — sem isto ela nasceria
  // vazia e só apareceria depois do primeiro fixar/desafixar.
  publicarFixadas(channelId);
}

/**
 * Histórico: mensagens ANTIGAS entram na frente da lista.
 *
 * É o contrato invertido da virtualização normal, e a razão de o virtualizador
 * rodar em modo chat. O usuário está lendo algo no meio do histórico; carregar
 * uma página anterior aumenta o total acima do viewport, e se nada compensar,
 * o conteúdo que ele está lendo desce e ele perde o lugar.
 *
 * Quem compensa é o TanStack: ao ver as chaves de borda mudarem, ele guarda a
 * chave do item sob o scroll e o offset relativo, e depois de remedir devolve
 * o scroll para o mesmo ponto daquele item. Por isso `getItemKey` precisa ser
 * ID de entidade — com índice, a chave sob o viewport muda de significado a
 * cada prepend e a âncora aponta para outra mensagem.
 *
 * Vai pelo mesmo `publish` coalescido do append: paginação dispara em rajada
 * quando o usuário rola rápido para cima, e uma publicação por página seria o
 * mesmo custo quadrático da carga.
 */
export function prependHistory(channelId: string, antigas: readonly string[]) {
  if (antigas.length === 0) return;
  const target = idsOf(channelId);
  target.unshift(...antigas);
  // A página nova, mais a primeira que já existia: ela deixou de ser a
  // primeira, então perde o divisor de dia que só tinha por ser o topo.
  // É o único caso em que uma linha muda de layout sem mudar de conteúdo.
  recalcularLayout(channelId, 0, antigas.length);
  publish(channelId);
}

/* ------------------------------------------------------------------ envio */

/**
 * Identidade local.
 *
 * Placeholder honesto: não existe sessão ainda, e a mensagem enviada precisa
 * de autor. Um `undefined` silencioso aqui produziria mensagem sem autor, que
 * é bug difícil de ver — a linha renderiza, só fica sem cabeçalho.
 */
let usuarioLocal: string | undefined;

/**
 * Quem sou eu, para a interface.
 *
 * Lido daqui e não de `client.user`: o arnês define o usuário local sem que
 * exista sessão, e o menu de mensagem precisa saber de quem é a mensagem para
 * decidir se "Editar" aparece. Perguntar ao SDK devolveria `undefined` em todo
 * o desenvolvimento.
 */
export function usuarioLocalId(): string | undefined {
  return usuarioLocal;
}

export function definirUsuarioLocal(id: string): void {
  usuarioLocal = id;
  definirEuDasEnquetes(id);
  /*
    O arnês entra sem senha, e é assim que ele deve entrar.

    Não há backend alcançável daqui, então exigir login travaria o
    desenvolvimento inteiro — e uma tela de entrada que não tem servidor para
    responder não é uma porta, é uma parede.

    Isto NÃO é um atalho de autenticação: `definirUsuarioLocal` só é chamada
    pelo firehose e pelo caminho de login de verdade. O que ela faz aqui é
    dizer ao portão que já se sabe quem é a pessoa, que é literalmente a
    pergunta que ele faz.
  */
  dentro(id);
}

const proximoId = monotonicFactory();

/**
 * Simulação de round-trip — do ARNÊS, e só dele.
 *
 * ⚠ **Ela era o caminho de envio do PRODUTO até agora, e isso era um buraco
 * grande.** O comentário aqui dizia que a rede não estava escrita "por
 * decisão", porque a mensagem otimista tem ID local e a confirmada tem ID do
 * servidor — a chave da linha mudando debaixo do virtualizador. Essa razão
 * EXPIROU: a reconciliação por nonce foi construída (`sdk/nonce.ts`, doze
 * testes), e o que sobrou foi um `setTimeout` marcando "enviada" uma mensagem
 * que nunca saiu da aba.
 *
 * Agora `enviarMensagem` faz o POST de verdade e a simulação só entra quando
 * alguém a liga — o que só o arnês faz, para exercitar falha e latência sem
 * derrubar a rede. Ligada, ela SUBSTITUI o POST: um envio simulado que também
 * fosse ao servidor duplicaria a mensagem.
 */
export type SimulacaoDeEnvio = {
  /** Liga a simulação no lugar do POST. Sem isto, o envio é real. */
  ativa?: boolean;
  falhar?: boolean;
  latenciaMs?: number;
};

let simulacao: SimulacaoDeEnvio = {};

export function configurarSimulacaoDeEnvio(nova: SimulacaoDeEnvio): void {
  simulacao = nova;
}

/**
 * Envia uma mensagem. Devolve o ID otimista, ou `undefined` se não deu.
 *
 * `undefined` em vez de exceção porque isto roda num handler de tecla: quebrar
 * a árvore do React por causa de um canal que ainda não carregou seria trocar
 * um problema por outro pior. Quem chama mantém o rascunho e a pessoa não
 * perde o que escreveu.
 */
export function enviarMensagem(
  channelId: string,
  conteudo: string,
  /**
   * A quem esta mensagem responde.
   *
   * Entra por parâmetro e não é lido do store aqui: o adapter não conhece
   * `store/resposta`, e não deve — a dependência correta aponta de dentro para
   * fora, como já acontece com o rascunho.
   *
   * ⚠ **Leva `mencionar` junto, e antes ia `false` fixo.** O comentário de
   * `postar` justificava: "enquanto `responderSemMencionar` não existe, o
   * inverso transformaria toda resposta numa menção que ninguém pediu". A
   * escolha existe agora, então quem responde decide.
   */
  respondendoA?: RespostaDeEnvio,
  /**
   * Os arquivos a subir junto.
   *
   * ⚠ **`File` e não ID de anexo, e o comentário anterior defendia o
   * contrário.** Ele dizia que subir "pertence a quem tem a tela", e por isso
   * o parâmetro seriam IDs já subidos. A régua caiu quando o design foi lido:
   * o progresso não mora no composer, mora na LINHA da mensagem otimista
   * (`enviando… · densidades.png · 62% · 178 KB/s · Cancelar`).
   *
   * Com IDs, a tela teria de subir ANTES de existir uma linha — ou seja,
   * inventar uma segunda superfície de progresso para depois criar a linha
   * que o design já usa para isso. Recebendo `File`, o envio inteiro é um
   * gesto só: a linha nasce, ela mostra o upload, e o POST sai no fim.
   */
  arquivos?: readonly File[],
): string | undefined {
  const texto = conteudo.trim();
  /* Mensagem só de anexo é legítima, e é o caso mais comum de mandar uma
     imagem: sem esta condição, arrastar um arquivo e apertar Enter não fazia
     nada. */
  if (!texto && (arquivos === undefined || arquivos.length === 0)) return undefined;

  if (!usuarioLocal || !client.channels.get(channelId)) {
    if (import.meta.env.DEV) {
      console.error(
        "[vortex] envio recusado: " +
          (usuarioLocal ? `canal ${channelId} não carregado` : "sem usuário local") +
          ". O rascunho foi preservado.",
      );
    }
    return undefined;
  }

  const id = proximoId();

  /*
    O nonce, e ele é o contrato com o servidor.

    Vai no corpo do POST e volta no evento de criação; é assim que as duas
    pontas concordam sobre qual mensagem é qual sem depender do ID, que só o
    servidor conhece. Reusar o ID local é a escolha certa: ele já é único, já
    é ordenável, e uma segunda fonte de unicidade seria mais uma coisa para
    manter em sincronia com a primeira.

    Registrado ANTES da criação: com rede rápida, a confirmação pode chegar no
    mesmo tick, e um nonce registrado depois chegaria tarde demais para a
    reconciliação encontrá-lo.
  */
  aguardar(id, id, channelId);

  const temArquivo = arquivos !== undefined && arquivos.length > 0;
  const temRede = lerConexao() === "conectado";

  /*
    Os arquivos entram no registro ANTES de qualquer saída, e isto não é
    ordem por gosto.

    ⚠ Sem rede, `enviarMensagem` devolve o ID mais abaixo e nunca chega ao
    despacho. Guardando só lá, uma mensagem com anexo composta offline
    perderia os arquivos: ao voltar a conexão, a fila reenviaria o TEXTO
    sozinho, e a linha ficaria verde sem o anexo.
  */
  if (temArquivo) arquivosPendentes.set(id, arquivos);
  if (respondendoA !== undefined) respostasPendentes.set(id, respondendoA);

  // Pendente ANTES de criar: o `messageCreate` já vai construir o snapshot, e
  // marcar depois faria a linha nascer "enviada" e piscar para pendente.
  //
  // Com arquivo E rede o estado inicial é `subindo`, pelo mesmo motivo: a
  // linha tem de nascer mostrando o upload, não nascer "pendente" e trocar no
  // quadro seguinte.
  //
  // ⚠ **Sem rede é `pending`, mesmo com arquivo.** `subindo` prenderia a
  // linha: quem reenvia ao reconectar varre as `pending`, então uma mensagem
  // parada em `subindo` nunca seria retomada — e a linha diria "enviando…"
  // para sempre, com upload nenhum acontecendo.
  estadosDeEnvio.set(id, temArquivo && temRede ? "subindo" : "pending");
  if (!(temArquivo && temRede)) marcarPendente(id, channelId);

  client.messages.getOrCreate(
    id,
    {
      _id: id,
      channel: channelId,
      author: usuarioLocal,
      content: texto,
      // O nonce viaja no objeto para o teste poder exercitar o caminho de
      // volta sem rede — é o mesmo campo que o protocolo devolve.
      nonce: id,
        // `replies` é do PROTOCOLO; o snapshot expõe como `respostas`. A
      // tradução acontece no `map.ts`, como tudo o mais.
      ...(respondendoA ? { replies: [respondendoA.id] } : {}),
    },
    true,
  );

  digitacao.aoParar(channelId);

  /*
    ⚠ **Sem conexão a mensagem FICA pendente, e isto não é simulação — é o
    comportamento certo.** `channel.sendMessage` é uma chamada de rede; sem
    socket ela não acontece. Marcar `sent` de qualquer jeito era o que o arnês
    fazia, e produzia uma linha que afirma ter chegado ao servidor com o app
    offline — a interface mentindo sobre a única coisa que ela existe para
    dizer.

    Quem tira daqui é o laço de reconexão logo acima: ao voltar a conexão,
    toda pendente é reenviada. É o que faz "Enviar quando voltar" ser verdade.

    ⚠ **`lerConexao()` e NÃO `conectado()`, e a diferença importa.** Aquele lê
    o socket cru; este lê o store que a interface desenha — e é o MESMO que a
    linha consulta para decidir se escreve "na fila · offline". Com duas
    fontes, o rótulo e o comportamento poderiam discordar: a linha dizendo
    "está indo" com a mensagem parada, ou o contrário. Com uma, não podem.
  */
  if (!temRede) return id;

  /*
    O arnês SUBSTITUI o POST, não o acompanha: simular e enviar ao mesmo tempo
    mandaria a mesma mensagem duas vezes. Ver `SimulacaoDeEnvio`.
  */
  if (simulacao.ativa) {
    setTimeout(() => {
      if (simulacao.falhar) {
        // Desiste do nonce: sem isto o mapa cresce para sempre numa sessão de
        // 8h com rede instável, que é o erro nº 5 do briefing.
        desistir(id);
        falharEnvio(id);
      } else {
        marcarEnvio(id, "sent");
      }
    }, simulacao.latenciaMs ?? 600);
    return id;
  }

  if (temArquivo) {
    void subirEEnviar(id, channelId, texto, respondendoA);
    return id;
  }

  void postar(id, channelId, texto, respondendoA, undefined);

  return id;
}

/* ---------------------------------------------------------- figurinha */

/**
 * Envia uma figurinha como mensagem inteira.
 *
 * O mesmo caminho otimista de `enviarMensagem` — nonce registrado antes, linha
 * nascendo `pending`, confirmação pelo socket —, com o conteúdo vazio e a
 * figurinha anotada na chave LOCAL antes de a linha existir. Separada e não um
 * parâmetro a mais lá: aquela recusa texto vazio de propósito, e uma figurinha
 * não vem com texto nem com anexo.
 *
 * ⚠ **O reenvio ao reconectar leva a figurinha junto** — `despacharEnvio` a lê
 * do mesmo mapa. Sem isso a pendente sairia como mensagem vazia e o servidor
 * responderia `EmptyMessage`, com a linha virando "falhou" sem motivo visível.
 */
export function enviarFigurinha(channelId: string, figurinhaId: string): string | undefined {
  if (!usuarioLocal || !client.channels.get(channelId) || figurinhaId === "") {
    return undefined;
  }

  const id = proximoId();
  aguardar(id, id, channelId);
  registrarFigurinhaLocal(id, figurinhaId);
  estadosDeEnvio.set(id, "pending");
  marcarPendente(id, channelId);

  client.messages.getOrCreate(
    id,
    { _id: id, channel: channelId, author: usuarioLocal, content: "", nonce: id },
    true,
  );

  if (lerConexao() !== "conectado") return id;

  if (simulacao.ativa) {
    setTimeout(() => {
      if (simulacao.falhar) {
        desistir(id);
        falharEnvio(id);
      } else {
        marcarEnvio(id, "sent");
      }
    }, simulacao.latenciaMs ?? 600);
    return id;
  }

  void postar(id, channelId, "", undefined, undefined, figurinhaId);
  return id;
}

/* ------------------------------------------------------------- upload */

/**
 * Os arquivos de cada envio em andamento ou falho.
 *
 * ⚠ **Guardados porque "tentar de novo" precisa deles.** Sem isto, reenviar
 * uma mensagem cujo upload falhou mandaria o TEXTO sozinho — a linha voltaria
 * verde e o arquivo teria sumido, sem erro nenhum. É a família de defeito que
 * este projeto chama de degradação silenciosa.
 *
 * Some nos três desfechos, junto com o resto (`largarEnvio`).
 */
const arquivosPendentes = new Map<string, readonly File[]>();

/**
 * A quem uma mensagem responde, e se notifica.
 *
 * Estrutural e não importado de `store/resposta`: a dependência aponta de
 * dentro para fora, como o comentário do parâmetro diz.
 */
export type RespostaDeEnvio = {
  readonly id: string;
  readonly mencionar: boolean;
};

/**
 * O `mencionar` de cada envio em andamento ou falho.
 *
 * ⚠ **Guardado pelo mesmo motivo dos arquivos: o REENVIO precisa dele.** O
 * objeto local da mensagem carrega `replies` como lista de IDs — o protocolo
 * não guarda a escolha de notificar —, então sem este mapa "tentar de novo"
 * numa resposta sem menção mandaria uma menção que a pessoa recusou.
 */
const respostasPendentes = new Map<string, RespostaDeEnvio>();

/**
 * Sobe os anexos e só então posta.
 *
 * A ordem é imposta pelo protocolo: `sendMessage` leva IDs de anexo, então o
 * arquivo tem de estar no servidor de mídia antes de a mensagem existir lá.
 *
 * ⚠ **Sequencial e não em paralelo, de propósito.** Três uploads simultâneos
 * dividem a banda e as três barras andam devagar juntas; em série, a primeira
 * termina cedo e o progresso é legível. O design mostra UM nome de arquivo por
 * vez no cartão, o que é a mesma decisão dita de outro jeito.
 */
async function subirEEnviar(
  id: string,
  channelId: string,
  texto: string,
  respondendoA: RespostaDeEnvio | undefined,
): Promise<void> {
  const arquivos = arquivosPendentes.get(id);
  if (arquivos === undefined) return;

  const controle = new AbortController();
  registrarCancelamento(id, controle);

  const total = arquivos.reduce((soma, a) => soma + a.size, 0);
  const medir = criarMedidorDeTaxa();
  const ids: string[] = [];
  let concluidos = 0;

  try {
    for (const arquivo of arquivos) {
      const base = concluidos;
      const remoto = await subirAnexo(arquivo, "attachments", {
        sinal: controle.signal,
        aoProgredir: (fracao) => {
          const bytes = base + fracao * arquivo.size;
          const taxa = medir(bytes);
          progressoDeUpload.set(id, {
            nome: arquivo.name,
            fracao: total > 0 ? bytes / total : 0,
            taxaTexto:
              taxa === undefined
                ? undefined
                : `${formatarBytes(Math.round(taxa)) ?? "?"}/s`,
          });
        },
      });
      ids.push(remoto);
      concluidos += arquivo.size;
    }
  } catch (e) {
    /*
      Cancelar REMOVE a linha; falhar a mantém.

      Quem cancelou já sabe o que aconteceu e não quer um destroço na
      conversa. Quem falhou precisa da linha: é onde mora "tentar de novo", e
      é o único lugar onde o texto digitado ainda existe.
    */
    if (controle.signal.aborted) {
      largarEnvio(id);
      descartarSubindo(id);
      return;
    }

    largarEnvio(id);
    desistir(id);
    marcarEnvio(id, "failed");

    /*
      ⚠ **Toast AQUI, ao contrário de `postar`, e a diferença tem razão.** Lá
      a regra é não avisar: a falha já está na linha, e uma queda de rede
      viraria uma pilha de avisos sobre o mesmo fato.

      Aqui a causa é quase sempre única e acionável — arquivo grande demais,
      tipo não aceito —, e o teto vem do SERVIDOR. Sem a frase, a pessoa vê
      "falha no envio" e tenta o mesmo arquivo de novo, para sempre.
    */
    toast({
      tipo: "erro",
      titulo: "Não deu para enviar o arquivo",
      descricao: e instanceof Error ? e.message : "Tente de novo.",
    });
    return;
  }

  largarEnvio(id);
  marcarEnvio(id, "pending");
  await postar(id, channelId, texto, respondendoA, ids);
}

/** Larga o que o upload segurava. Nos três desfechos, senão vaza. */
function largarEnvio(id: string): void {
  esquecerUpload(id);
  arquivosPendentes.delete(id);
}

/**
 * Remove a linha de um upload cancelado.
 *
 * Irmã de `descartarPendente`, e separada dela porque aquela exige o estado
 * `pending` — de propósito, para não apagar mensagem já enviada. Aqui o
 * estado é `subindo`.
 */
function descartarSubindo(id: string): void {
  estadosDeEnvio.delete(id);
  esquecerDaFila(id);
  desistir(id);
  const sdkId = idDoSdk(id);
  const channelId = client.messages.get(sdkId)?.channelId;
  client.messages.delete(sdkId);
  if (channelId !== undefined) publishNow(channelId);
}

/**
 * O POST, e o que fazer com as duas respostas dele.
 *
 * ⚠ **Separado em função própria porque `enviarMensagem` é SÍNCRONA de
 * propósito** — ela roda num handler de tecla e devolve o ID otimista na hora,
 * que é o que faz a linha aparecer antes da rede. Torná-la `async` obrigaria
 * o composer a esperar o servidor para limpar o campo.
 *
 * ⚠ **Não marca `sent` na resposta, e isso é deliberado.** Quem materializa a
 * mensagem confirmada é o evento `messageCreate`, que chega pelo socket com o
 * nonce e passa pela reconciliação — marcar aqui correria com ele e a linha
 * piscaria entre dois estados. O sucesso é a AUSÊNCIA de falha; ver
 * `marcarEnvio` no caminho de reconciliação.
 *
 * ⚠ **`replies` com `mention: false`.** O protocolo pede `ReplyIntent`
 * (`{id, mention}`), e o default de mencionar é uma decisão de produto que a
 * pendência `responderSemMencionar` registra: enquanto não houver o controle,
 * responder NÃO notifica — o inverso transformaria toda resposta numa menção
 * sem ninguém ter pedido.
 */
async function postar(
  id: string,
  channelId: string,
  content: string,
  respondendoA: RespostaDeEnvio | undefined,
  anexos: readonly string[] | undefined,
  /** A figurinha da mensagem — campo do Vortex que o tipo do SDK não conhece. */
  figurinha?: string,
): Promise<void> {
  /* Lido ANTES do envio: depois dele o servidor já pôs a pessoa na lista. */
  const desfazerSeguir = desfazerSeguirAoResponder(
    lerTopico(channelId),
    usuarioLocalId(),
    segueTopicosAutomaticamente,
  );
  try {
    await client.channels.get(channelId)?.sendMessage({
      ...(figurinha ? ({ stickers: [figurinha] } as object) : {}),
      content,
      /*
        O nonce está DEPRECADO no schema em favor de `Idempotency-Key`, e vai
        assim mesmo: é o campo que volta no evento de criação, e é por ele que
        a reconciliação encontra a otimista. Trocar por idempotência resolve
        duplicata de reenvio, não identidade da linha — são problemas
        diferentes com nomes parecidos.
      */
      nonce: id,
      ...(respondendoA
        ? { replies: [{ id: respondendoA.id, mention: respondendoA.mencionar }] }
        : {}),
      ...(anexos && anexos.length > 0 ? { attachments: [...anexos] } : {}),
    });
    /*
      D-NOTIF-16. Fire-and-forget e SEM toast na falha: a mensagem foi, e o
      que sobra de um erro aqui é seguir um tópico — o estado que o servidor
      aplica a todo mundo, desfazível no cabeçalho do tópico.
    */
    if (desfazerSeguir) {
      void client.api.delete(`/channels/${channelId}/follow` as never).catch(() => undefined);
    }
  } catch {
    /*
      Desiste do nonce: sem isto o mapa cresce para sempre numa sessão de 8h
      com rede instável, que é o erro nº 5 do briefing.

      O toast vem junto, e o que o impede de virar pilha está em
      `notificacao/falhaDeEnvio.ts` (D-NOTIF-24).
    */
    desistir(id);
    falharEnvio(id);
  }
}

/**
 * Marca a falha E avisa por toast — o funil de toda falha de envio de TEXTO.
 *
 * O upload (`enviarComArquivos`) não passa por aqui: ele já tem toast próprio,
 * com a causa que o servidor devolveu (arquivo grande demais, tipo recusado),
 * e dois toasts para a mesma falha diriam a mesma coisa de dois jeitos.
 */
function falharEnvio(id: string): void {
  marcarEnvio(id, "failed");
  const channelId = client.messages.get(idDoSdk(id))?.channelId;
  if (channelId === undefined) return;
  avisarFalhaDeEnvio(rotuloDoCanal(channelId), lerConexao() === "conectado", () =>
    reenviarFalhadasDe(channelId),
  );
}

/** Todas as falhadas do canal, na ordem em que foram escritas. */
function reenviarFalhadasDe(channelId: string): void {
  const falhadas: string[] = [];
  for (const [id, estado] of estadosDeEnvio) {
    if (estado === "failed" && client.messages.get(idDoSdk(id))?.channelId === channelId) {
      falhadas.push(id);
    }
  }
  // Copiado antes: `reenviar` muda o mapa que estava sendo percorrido.
  for (const id of falhadas) reenviar(id);
}

/**
 * Onde a mensagem estava indo, como a pessoa o chama: `#canal`, o nome de
 * quem está do outro lado da DM, o nome do grupo.
 *
 * ⚠ Na DM, `recipientIds` menos eu e NÃO `canal.recipient` — o getter do SDK
 * faz `client.user!.id` e estoura antes do `Ready` (ver `destinoDe`).
 */
function rotuloDoCanal(channelId: string): string {
  const canal = client.channels.get(channelId);
  if (!canal) return "conversa";
  if (canal.type === "TextChannel") return `#${canal.name}`;
  if (canal.type === "SavedMessages") return "Notas";
  if (canal.type === "DirectMessage") {
    for (const outro of canal.recipientIds) {
      if (outro !== usuarioLocal) return client.users.get(outro)?.displayName ?? "conversa";
    }
    return "conversa";
  }
  return canal.name || "conversa";
}

/* -------------------------------------------------------------- digitação */

/**
 * O lado de saída do estado efêmero, com o transporte injetado.
 *
 * O guard de conexão não é defensivo por hábito: `EventClient.send` LANÇA
 * quando não há socket, e digitar num app desconectado é o caso mais comum
 * que existe — é o que a pessoa faz enquanto espera a reconexão. Um throw
 * dentro do `onChange` do campo derrubaria a digitação inteira.
 */
export const digitacao = criarNotificadorDeDigitacao({
  iniciar: (channelId) => {
    if (conectado()) client.channels.get(channelId)?.startTyping();
  },
  parar: (channelId) => {
    if (conectado()) client.channels.get(channelId)?.stopTyping();
  },
});

/* ==========================================================================
   Colunas laterais — servidores, canais e membros
   ==========================================================================

   Mesmas duas granularidades da lista de mensagens, pelas mesmas razões:

     coleção  → lista de IDs, publicada coalescida por frame
     entidade → assina a si mesma, via efeito Solid sobre os getters do SDK

   O que muda é o volume. Um servidor grande tem dezenas de milhares de
   membros, e a presença — o evento mais volumoso que existe — encosta
   justamente na member list. Por isso a ordenação usa dois baldes e não
   quatro: `online → idle → dnd` não move ninguém de lugar, então a lista não
   republica e só o pontinho de presença acorda.
   ========================================================================== */

/**
 * A lista de servidores é uma coleção só, não uma por chave.
 *
 * Reusar o `EntityStore` com uma chave constante evita um segundo tipo de
 * store só para guardar um array — e mantém a mesma disciplina de referência
 * cacheada que o `useSyncExternalStore` exige.
 */
export const RAIZ = "@raiz";

export const serverIds = createEntityStore<readonly string[]>();
export const membrosOnline = createEntityStore<readonly string[]>();
export const membrosOffline = createEntityStore<readonly string[]>();

/**
 * As seções de cargo do lado online.
 *
 * Store SEPARADO de `membrosOnline`, e não um substituto, por duas razões: um
 * painel estreito que só mostra avatares não precisa de seção nenhuma e não
 * deve acordar quando um cargo mudar de nome; e a lista achatada continua
 * sendo a forma que a member list virtualizada consome hoje.
 *
 * Quem publica os dois é a mesma função, no mesmo frame — não há como
 * divergirem.
 */
export const secoesOnline = createEntityStore<readonly SecaoDeMembros[]>();

/** As categorias de canal do servidor, na ordem que ele define. */
export const categorias = createEntityStore<readonly CategoriaDeCanais[]>();

/**
 * IDs das mensagens fixadas de um canal.
 *
 * Coleção de IDs, não de snapshots — a mesma disciplina da lista de mensagens,
 * e pela mesma razão: o painel assina a LISTA, cada item assina a própria
 * mensagem. Editar uma fixada toca uma linha do painel, não o painel.
 *
 * Derivada, não guardada em paralelo: a verdade é `message.pinned`, e manter
 * uma segunda lista sincronizada à mão daria duas fontes divergindo no
 * primeiro evento que uma delas perdesse.
 */
export const fixadas = createEntityStore<readonly string[]>();

/**
 * Quem está DENTRO de cada canal de voz.
 *
 * Assina o `ReactiveMap` do SDK por `createEffect`, e não um evento do cliente
 * — porque **não existe evento**: os handlers de `VoiceChannelJoin`,
 * `VoiceChannelLeave` e `UserVoiceStateUpdate` em `events/v1.ts` mutam
 * `channel.voiceParticipants` e trazem um `// todo: event` no lugar do
 * `client.emit`. A reatividade Solid do SDK é a única superfície de observação
 * que existe, e encapsulá-la aqui é literalmente o trabalho para o qual esta
 * camada foi instalada.
 *
 * **Um store por canal, com os participantes inteiros — não dois.** A lei nº 1
 * mandaria separar "lista de IDs" de "estado de cada um", e ela existe contra
 * *update não-escopado atingindo milhares de componentes*. Uma sala tem
 * dezenas de pessoas e a câmera é ligada por ação humana; separar aqui seria
 * otimizar preventivamente, que o briefing proíbe com todas as letras.
 *
 * ⚠ **O que NÃO pode entrar neste store:** quem está FALANDO. Esse sinal vem
 * do LiveKit dezenas de vezes por segundo e é o estado efêmero que o briefing
 * nomeia. Ele vai em store separado, com throttle na fronteira
 * (`createEphemeralStore`, o mesmo do typing). Enfiá-lo aqui repintaria a
 * coluna de canais inteira a cada sílaba.
 */
/**
 * Quem está mudo POR ORDEM DO SERVIDOR, por `ChaveDeMembro`.
 *
 * Alimentado pelo evento CRU — ver a nota em `client.events.on("event")`. Só
 * guarda quem está silenciado: a ausência é o caso comum, e registrá-la faria
 * o mapa ter uma entrada por membro de todo servidor.
 */
const mudosPeloServidor = new Set<ChaveDeMembro>();

/** Quem está surdo POR ORDEM DO SERVIDOR — `can_receive: false`. Mesma forma. */
const surdosPeloServidor = new Set<ChaveDeMembro>();

/**
 * Republica as salas que já têm assinante.
 *
 * `can_publish` não passa pelo Solid — ele vem de um evento cru, fora de
 * qualquer sinal —, então o efeito de `vozPorCanal` não acorda sozinho quando
 * alguém é silenciado. Sem isto o selo só apareceria na próxima vez que a
 * sala mudasse por outro motivo.
 */
const releituraDeVoz = new Map<string, () => void>();

function republicarVoz(): void {
  for (const reler of releituraDeVoz.values()) reler();
}

/**
 * Em qual canal de voz esta pessoa está, se estiver.
 *
 * ⚠ **Leitura direta e não store**, e é o que evita um índice invertido: o
 * store de voz é keyed por CANAL, porque é assim que a sala é desenhada.
 * "Onde está fulano" é pergunta de menu de contexto — acontece uma vez por
 * abertura, sobre dezenas de canais —, e manter um segundo mapa em dia a cada
 * `VoiceChannelJoin` custaria mais que a varredura.
 */
/**
 * Tira você da sala LOCALMENTE, depois de uma entrada que falhou.
 *
 * ⚠ **O defeito que isto conserta era visível e contraditório.** `joinCall`
 * registra você no servidor ANTES de o LiveKit conectar; quando o `connect`
 * lança, o `catch` limpa o store da chamada e mais nada. Medido em navegador:
 * o toast "Não deu para entrar na chamada" na tela AO MESMO TEMPO que
 * `sonda_anexo` listado dentro da sala, na coluna de canais. Só recarregar
 * limpava.
 *
 * Mexe direto no store de salas (`salasDeVoz.ts`), que é o mesmo caminho por
 * onde um `VoiceChannelLeave` entraria — a mesma decisão já tomada para reação
 * otimista. Não há um segundo caminho a reconciliar: se o servidor ainda
 * achar que você está lá, o próximo `Ready` traz a verdade de volta.
 *
 * ⚠ **NÃO conserta o que os OUTROS veem, e isso precisa ser dito.** O
 * protocolo não tem rota de saída — sair é o socket cair, e o servidor
 * descobrir. Se o `joinCall` chegou a persistir do outro lado, você segue
 * fantasma na sala para todo mundo até sua conexão cair. O que dá para fazer
 * aqui é parar de mentir para VOCÊ.
 */
export function sairDaSalaLocalmente(channelId: string): void {
  if (usuarioLocal === undefined) return;
  if (!tirarDaSala(channelId, usuarioLocal)) return;
  /*
    A releitura guardada é o caminho que
    `republicarVoz` já usa para o caso em que o sinal não acorda sozinho.
    Chamar as duas custa uma varredura de uma sala.
  */
  releituraDeVoz.get(channelId)?.();
}

/**
 * Põe você na lista da sala NA HORA em que o LiveKit conecta, sem esperar o
 * `VoiceChannelJoin` voltar pelo webhook (centenas de ms a segundos).
 *
 * Reconcilia sozinho: o eco real escreve a mesma pessoa na mesma sala (mapa por
 * usuário, sem duplicar) e tira a marca de palpite. Desfaz por
 * `sairDaSalaLocalmente` (falha / saída) ou `desfazerEntradaOtimista`
 * (queda antes do eco). `publicando` espelha o mudo atual, para o ícone não
 * piscar de microfone aberto.
 */
export function entrarNaSalaLocalmente(
  channelId: string,
  opcoes: { publicando: boolean } = { publicando: true },
): void {
  if (usuarioLocal === undefined) return;
  if (!colocarOtimista(channelId, usuarioLocal, { is_publishing: opcoes.publicando })) {
    return;
  }
  releituraDeVoz.get(channelId)?.();
}

/** Tira a entrada otimista só se o servidor ainda não a confirmou. */
export function desfazerEntradaOtimista(channelId: string): void {
  if (usuarioLocal === undefined) return;
  if (!desfazerOtimista(channelId, usuarioLocal)) return;
  releituraDeVoz.get(channelId)?.();
}

export function canalDeVozDe(userId: string): string | undefined {
  return canalDeVozDaPessoa(userId);
}

export const vozPorCanal = createEntityStore<readonly ParticipanteDeVoz[]>(
  (channelId) => {
    const ler = () => {
      const canal = client.channels.get(channelId);
      if (!canal) return;

      const out: ParticipanteDeVoz[] = [];
      for (const [userId, p] of participantesDaSala(channelId)) {
        const estado: EstadoDeVoz = p.tela
          ? "tela"
          : p.camera
            ? "video"
            : "voz";
        out.push({
          userId,
          estado,
          desde: p.desde,
          /*
            ⚠ Lidos DENTRO do efeito, como os três acessores acima: fora
            dele o snapshot congelaria no estado de quando a pessoa entrou, e
            silenciar o microfone não republicaria a sala.
          */
          mudo: !p.publicando,
          surdo: !p.recebendo,
          /*
            ⚠ Do SERVIDOR, e por isso vem de um mapa e não do participante: o
            protocolo põe `can_publish` em `ServerMember`, não em
            `UserVoiceState`. Uma pessoa pode estar mudo por escolha, mudo pelo
            servidor, ou os dois — e são coisas diferentes de dizer.
          */
          mudoPeloServidor:
            canal.serverId !== undefined &&
            mudosPeloServidor.has(chaveDeMembro(canal.serverId, userId)),
          surdoPeloServidor:
            canal.serverId !== undefined &&
            surdosPeloServidor.has(chaveDeMembro(canal.serverId, userId)),
        });
      }

      // Por ordem de chegada, não alfabética. Duas razões, e as duas são de
      // estabilidade: renomear alguém não reordena a sala, e ligar a câmera
      // também não — a lista só muda quando alguém entra ou sai, que é a
      // única mudança que a pessoa olhando espera ver.
      out.sort((a, b) => a.desde - b.desde);
      vozPorCanal.set(channelId, out);
    };

    ler();

    /*
      Guardado para o `republicarVoz`: `can_publish` vem de um evento CRU, fora
      de qualquer sinal do Solid, então o efeito abaixo não acorda quando
      alguém é silenciado pelo servidor. Sem esta releitura o selo só
      apareceria na próxima vez que a sala mudasse por outro motivo.
    */
    releituraDeVoz.set(channelId, ler);

    count("vozEfeitos");
    return () => {
      releituraDeVoz.delete(channelId);
    };
  },
);

/**
 * Canais publicados JÁ SEPARADOS por tipo, e não numa lista só.
 *
 * A tentação é publicar um array e deixar a coluna dividir no render. Não dá,
 * e o motivo é a lei nº 1: a lista de canais assina IDs, não entidades — quem
 * conhece o tipo de um canal é a linha, que assina a si mesma. Para partir no
 * render, a lista teria que ler o snapshot de cada canal sem assinar nenhum,
 * que é ler dado por fora do mecanismo que garante que ele está atualizado.
 *
 * A saída é a mesma dos baldes de presença: quem sabe, publica. A separação
 * acontece na ESCRITA, uma vez, e cada seção é uma referência cacheada que o
 * `useSyncExternalStore` pode comparar.
 */
export const canaisDeTexto = createEntityStore<readonly string[]>();
export const canaisDeVoz = createEntityStore<readonly string[]>();

/**
 * As conversas — DMs, grupos e as notas.
 *
 * Uma lista só, keyed por `RAIZ`, e não uma por tipo: a coluna da casa mostra
 * as três misturadas e ordenadas por recência, que é como uma caixa de entrada
 * funciona. Separá-las em três seções faria a conversa de ontem ficar abaixo de
 * um grupo morto só porque grupo é outro tipo.
 *
 * Ordenada na ESCRITA, como os baldes de presença: a coluna recebe a ordem
 * pronta e não chama `sort` no render. `ultimaEm` vem do ULID da última
 * mensagem — o protocolo não tem campo de última atividade.
 */
export const conversas = createEntityStore<readonly string[]>();

/**
 * As pessoas, agrupadas pela relação.
 *
 * Keyed pela própria relação (`amigo`, `recebido`, …) e não por `RAIZ` com um
 * objeto dentro: a tela de amigos tem abas, cada aba assina a sua, e trocar de
 * aba não pode acordar as outras três. É a lei nº 1 aplicada a uma tela que
 * ainda nem é lista longa — mas que vira, em conta antiga.
 */
export const relacoes = createEntityStore<readonly string[]>();

/** Uma pessoa, para as telas que falam de gente e não de membro de servidor. */
export const pessoas = createEntityStore<RelacaoSnapshot>((id) => {
  const inicial = client.users.get(id);
  if (inicial) pessoas.set(id, toRelacaoSnapshot(inicial));

  return createRoot((dispose) => {
    createEffect(() => {
      const u = client.users.get(id);
      if (u) pessoas.set(id, toRelacaoSnapshot(u));
    });
    return dispose;
  });
});

/**
 * A chave da fila de solicitações dentro do store de conversas.
 *
 * O mesmo store e não um segundo: as duas listas nascem da MESMA varredura e
 * uma conversa passa de uma para a outra num gesto só (aceitar). Com dois
 * stores haveria um quadro em que ela está nas duas, ou em nenhuma.
 */
export const SOLICITACOES = "@solicitacoes";

/** O destino de cada conversa na última publicação — ver `avisarChegada`. */
const destinoPublicado = new Map<string, Destino>();

/**
 * Republica a coluna da casa e as abas de amigos.
 *
 * Varredura sobre todas as conversas e todas as pessoas — cara, e por isso
 * chamada em EVENTO (conversa criada, relação mudou), nunca por mensagem. Uma
 * mensagem só reordena; e reordenar a cada uma das 500 por segundo do firehose
 * seria O(n log n) no caminho mais quente do app.
 *
 * A reordenação por recência acontece quando a pessoa ABRE a casa, que é o
 * único momento em que ela é observável — ver `publicarConversas`.
 */
export function publicarConversas(): void {
  const lista: { id: string; em: number }[] = [];
  const fila: { id: string; em: number }[] = [];
  destinoPublicado.clear();
  for (const canal of client.channels.toList()) {
    const t = canal.type;
    if (t !== "DirectMessage" && t !== "Group" && t !== "SavedMessages") continue;
    const ultimo = canal.lastMessageId;
    const item = { id: canal.id, em: ultimo ? decodeTime(ultimo) : 0 };
    const destino = t === "DirectMessage" ? destinoDe(canal) : "conversa";
    destinoPublicado.set(canal.id, destino);
    if (destino === "conversa") lista.push(item);
    else if (destino === "solicitacao") fila.push(item);
  }
  // Mais recente primeiro; empate pelo ID, que é estável e cronológico.
  const porRecencia = (
    a: { id: string; em: number },
    b: { id: string; em: number },
  ) => b.em - a.em || b.id.localeCompare(a.id);
  lista.sort(porRecencia);
  fila.sort(porRecencia);
  // Favoritas por cima, sem mexer na recência do resto — `store/favoritos.ts`.
  conversas.set(RAIZ, ordenarComFavoritas(lista.map((c) => c.id), lerFavoritos()));
  conversas.set(SOLICITACOES, fila.map((c) => c.id));
}


/**
 * A regra está em `store/solicitacoes.ts`, pura; aqui só se traduz o canal do
 * SDK para a entrada que ela lê. O ID do canal é ULID, e o tempo dele é o
 * momento em que a DM foi CRIADA — que é o que separa conversa antiga de
 * desconhecido chegando.
 */
function destinoDe(canal: {
  readonly id: string;
  readonly lastMessageId: string | undefined;
  readonly recipientIds: Iterable<string>;
}): Destino {
  let criadaEm = 0;
  try {
    criadaEm = decodeTime(canal.id);
  } catch {
    /* ID fora do formato ULID: trata como antiga, que é o lado seguro — não
       esconde conversa nenhuma. */
  }
  /*
    ⚠ `recipientIds` menos eu, e NÃO `canal.recipient` — o getter do SDK faz
    `client.user!.id` e estoura antes do `Ready`. Mesma armadilha registrada
    em `toChannelSnapshot`, e o teste desta varredura caiu nela primeiro.
  */
  let outro: string | undefined;
  for (const id of canal.recipientIds) {
    if (id !== usuarioLocal) {
      outro = id;
      break;
    }
  }
  const r = outro ? client.users.get(outro)?.relationship : undefined;
  return destinoDaConversa(
    {
      tipo: "dm",
      relacao: r === undefined ? undefined : relacaoDoProtocolo(r),
      criadaEm,
      ultimaMensagemId: canal.lastMessageId,
    },
    {
      filtrar: lerPrivacidade().filtrarDesconhecidos,
      inicio: inicioDasSolicitacoes(),
      decisao: decisaoSobre(canal.id),
      restritaPorPrivacidade: () =>
        outro !== undefined && restritaPorPrivacidade(outro),
    },
  );
}

/* ------------------------------------------- privacidade por servidor */

/*
  Servidores em comum por pessoa, para a regra de DM da privacidade por
  servidor. Cache da SESSÃO: servidores em comum mudam quando alguém entra ou
  sai de um servidor, que é raro, e a regra só DESVIA conversa — um valor
  velho erra para a fila ou para a coluna, nunca apaga nada.

  ⚠ **A busca só acontece se alguma escolha restringe DM** (`algumaRestricaoDeDm`).
  Quem nunca abriu o modal não paga uma requisição por conversa.
*/
const emComumPorPessoa = new Map<string, readonly string[]>();
const buscandoEmComum = new Set<string>();

function restritaPorPrivacidade(userId: string): boolean {
  if (!algumaRestricaoDeDm()) return false;
  const servidores = emComumPorPessoa.get(userId);
  if (servidores === undefined) {
    if (conectado() && !buscandoEmComum.has(userId)) {
      buscandoEmComum.add(userId);
      void buscarEmComum(userId).then((r) => {
        buscandoEmComum.delete(userId);
        if (!r) return;
        emComumPorPessoa.set(userId, r.servidores);
        publicarConversas();
      });
    }
    return false;
  }
  return privacidadeRestringe(servidores, (serverId) =>
    aceitaDm(lerPrivacidadeDoServidor(serverId), compartilhaCargo(serverId, userId)),
  );
}

/* Membro não carregado conta como sem cargo — o lado que só desvia para a
   fila, e é o mesmo critério que o `delta` aplica com o membro em mãos. */
function compartilhaCargo(serverId: string, userId: string): boolean {
  if (!usuarioLocal) return false;
  const meus = client.serverMembers.getByKey({ server: serverId, user: usuarioLocal })?.roles;
  const deles = client.serverMembers.getByKey({ server: serverId, user: userId })?.roles;
  if (!meus || !deles) return false;
  return meus.some((id) => deles.includes(id));
}

export function publicarRelacoes(): void {
  const baldes: Record<string, string[]> = {
    amigo: [],
    recebido: [],
    enviado: [],
    bloqueado: [],
  };
  for (const u of client.users.toList()) {
    const r = toRelacaoSnapshot(u);
    baldes[r.relacao]?.push(u.id);
  }
  for (const chave of Object.keys(baldes)) {
    const ids = baldes[chave]!;
    // Ordem alfabética: a tela de amigos é lida procurando um nome, não
    // acompanhando o que mudou.
    ids.sort((a, b) => {
      const na = pessoas.peek(a)?.displayName ?? a;
      const nb = pessoas.peek(b)?.displayName ?? b;
      return na.localeCompare(nb);
    });
    relacoes.set(chave, ids);
  }
}

/* ------------------------------------------------------------- não-lidas */

export type Contagem = { naoLidas: number; mencoes: number };

const ZERO: Contagem = { naoLidas: 0, mencoes: 0 };

/**
 * O tópico, como o rollup o enxerga — `undefined` para canal comum.
 *
 * Lê o registro de `vortexCanal` (já em memória), nunca o SDK: é chamado por
 * canal COM contagem, dezenas, e no caminho de `messageCreate`.
 */
function infoDeTopico(channelId: string): InfoDeTopico | undefined {
  const meta = lerTopico(channelId);
  if (!meta) return undefined;
  return {
    paiId: meta.paiId,
    seguindo: usuarioLocal !== undefined && meta.seguidores.includes(usuarioLocal),
  };
}

/** O servidor de um canal — o tópico cai no registro se o SDK ainda não o tem. */
function servidorDoCanal(channelId: string): string | undefined {
  return client.channels.get(channelId)?.serverId ?? lerTopico(channelId)?.serverId;
}

/**
 * Seguir ou deixar de seguir MUDA a conta do servidor sem nenhuma mensagem.
 *
 * Só recontar quando o "sigo" daquele tópico MUDOU e ele tem contagem: o meta
 * é republicado a cada mensagem do tópico, e uma varredura por mensagem seria
 * o custo que o caminho incremental existe para evitar.
 */
const seguidoConhecido = new Map<string, boolean>();
assinarMetaDeCanal((ids) => {
  let mudou = false;
  for (const id of ids) {
    const seguindo = infoDeTopico(id)?.seguindo ?? false;
    if (seguidoConhecido.get(id) === seguindo) continue;
    seguidoConhecido.set(id, seguindo);
    if (contagemPorCanal.has(id)) mudou = true;
  }
  if (mudou) recontarServidores();
});

const contagemPorCanal = new Map<string, Contagem>();
const contagemPorServidor = new Map<string, Contagem>();

/**
 * A soma de TODOS os servidores — o número que a caixa de entrada põe na aba.
 *
 * ⚠ **Existe porque somar do lado do componente não tem forma boa.** A
 * contagem vive no snapshot de cada servidor, e cada snapshot é assinado por
 * quem o desenha; um componente que quisesse o total precisaria de uma
 * subscrição por servidor, e o número de servidores é variável — ou seja,
 * hooks em laço, que as Rules of React proíbem.
 *
 * Aqui a soma é do ADAPTER, publicada como qualquer coleção, chaveada por uma
 * constante — a mesma forma de `serverIds` sobre `RAIZ`.
 *
 * A comparação antes de publicar não é otimização: sem ela, toda mensagem nova
 * em qualquer canal reescreveria um objeto de dois números iguais, e o
 * `useSyncExternalStore` acordaria a caixa a cada evento do firehose.
 */
export const TOTAIS = "@totais";

/*
  O `onFirstSubscribe` NÃO é cerimônia — sem ele a aba abria zerada.

  A soma só é republicada quando uma contagem muda, e a caixa de entrada é
  aberta DEPOIS da semeadura: quem chega tarde encontra o store vazio e mostra
  "Menções" sem número, com três linhas listadas embaixo. Publicar na primeira
  subscrição é a mesma correção que `messages` faz na hidratação, e pela mesma
  razão — o estado já existe, faltava alguém dizê-lo.
*/
export const totaisNaoLidos = createEntityStore<Contagem>(() => {
  somarTotais();
});

function reemitirTotais(): void {
  publicarContador();
  if (totaisNaoLidos.subscriberCount(TOTAIS) === 0) return;
  somarTotais();
}

/**
 * O contador de menções no ícone do app acompanha os totais — sem depender de
 * alguém na tela estar assinando `totaisNaoLidos` (é por isso que não passa
 * pelo store, que só soma com assinante).
 */
let ultimoContador = -1;
function publicarContador(): void {
  let mencoes = 0;
  for (const c of contagemPorServidor.values()) mencoes += c.mencoes;
  if (mencoes === ultimoContador) return;
  ultimoContador = mencoes;
  atualizarContador(mencoes);
}

function somarTotais(): void {
  let naoLidas = 0;
  let mencoes = 0;
  for (const c of contagemPorServidor.values()) {
    naoLidas += c.naoLidas;
    mencoes += c.mencoes;
  }
  const atual = totaisNaoLidos.peek(TOTAIS);
  if (atual && atual.naoLidas === naoLidas && atual.mencoes === mencoes) return;
  totaisNaoLidos.set(TOTAIS, { naoLidas, mencoes });
}


/**
 * O número da entrada Conversas no rail — DMs e grupos, D-NOTIF-17.
 *
 * Store próprio e não uma chave em `totaisNaoLidos`, porque os dois têm
 * gatilhos diferentes: o total acorda a cada mensagem de SERVIDOR, e este só
 * a cada mensagem de conversa. Uma chave no mesmo store faria a varredura de
 * conversas rodar no caminho de `messageCreate` de todo canal de servidor.
 *
 * A soma é sobre `contagemPorCanal` — canais COM contagem, dezenas —, só roda
 * com assinante, e compara antes de publicar, pela mesma razão de
 * `somarTotais`.
 */
export const CONVERSAS = "@conversas";
export const naoLidasDeConversas = createEntityStore<number>(() => {
  somarNaoLidasDeConversas();
});

const TIPOS_DE_CONVERSA = new Set(["DirectMessage", "Group"]);

function reemitirConversas(): void {
  if (naoLidasDeConversas.subscriberCount(CONVERSAS) === 0) return;
  somarNaoLidasDeConversas();
}

function somarNaoLidasDeConversas(): void {
  const soma = somarConversas(
    contagemPorCanal,
    (id) => TIPOS_DE_CONVERSA.has(client.channels.get(id)?.type ?? ""),
    (id) => estaMudo(id, undefined),
  );
  if (naoLidasDeConversas.peek(CONVERSAS) === soma) return;
  naoLidasDeConversas.set(CONVERSAS, soma);
}

function contagemDe(mapa: Map<string, Contagem>, id: string): Contagem {
  return mapa.get(id) ?? ZERO;
}

/**
 * O canal aberto nunca acumula não-lidas.
 *
 * Vive aqui, e não no store de navegação, porque quem decide é o caminho de
 * ESCRITA: perguntar ao React "qual canal está aberto?" de dentro do handler
 * de `messageCreate` inverteria a direção do dado. A navegação empurra para cá.
 */
let canalAberto: string | undefined;

/**
 * Bonfire only fans UserUpdate to `{serverId}u`. Friends ride the user topic
 * (Ready already subscribes). Server members do not, unless we Subscribe.
 *
 * ponytail: one slot (the viewed server). Protocol: max 5, expires 15min,
 * refresh ≤10min. Bots skip this — they get `u` topics on Ready.
 */
const SUBSCRIBE_MS = 10 * 60 * 1000;
let servidorDePresenca: string | undefined;
let intervaloDePresenca: ReturnType<typeof setInterval> | undefined;

function enviarSubscribe(serverId: string): void {
  if (!conectado()) return;
  try {
    client.events.send({ type: "Subscribe", server_id: serverId } as never);
  } catch {
    /* EventClient.send throws without a socket */
  }
}

function assinarPresencaDoServidor(serverId: string | undefined): void {
  if (serverId === servidorDePresenca) return;
  servidorDePresenca = serverId;
  if (intervaloDePresenca !== undefined) {
    clearInterval(intervaloDePresenca);
    intervaloDePresenca = undefined;
  }
  if (!serverId) return;
  enviarSubscribe(serverId);
  intervaloDePresenca = setInterval(() => enviarSubscribe(serverId), SUBSCRIBE_MS);
}

function renovarPresencaDoServidor(): void {
  if (servidorDePresenca) enviarSubscribe(servidorDePresenca);
}

export function definirCanalAberto(channelId: string | undefined): void {
  if (canalAberto === channelId) return;
  definirCanalVisto(channelId);

  // SAINDO: o canal anterior passa a estar lido até o fim. É aqui que o
  // divisor de "novas mensagens" do PRÓXIMO retorno é decidido.
  if (canalAberto) avancarCursor(canalAberto);

  canalAberto = channelId;

  assinarPresencaDoServidor(
    channelId ? client.channels.get(channelId)?.serverId : undefined,
  );

  if (channelId) {
    marcarCanalLido(channelId);
    // Canal nunca visitado começa lido a partir de onde está: sem isto, abrir
    // um canal pela primeira vez marcaria as dez mil como novas.
    if (!cursorDeLeitura.has(channelId)) {
      const ids = idsOf(channelId);
      const ultima = ids[ids.length - 1];
      if (ultima) cursorDeLeitura.set(channelId, ultima);
    }
  }
}

/**
 * Marca o canal como não lido A PARTIR desta mensagem.
 *
 * O cursor vai para a mensagem ANTERIOR — a lista tem o ID dela; na primeira
 * carregada, o ULID imediatamente abaixo, que o servidor aceita porque `ack`
 * não confere se a mensagem existe. O `ack` para trás não precisou de rota
 * nova: a rota GRAVA o cursor em vez de avançá-lo, e o `ChannelAck` chega aos
 * outros dispositivos.
 *
 * ⚠ **Menções já lidas não voltam**, e é o protocolo: o servidor apaga do
 * `ChannelUnread` as menções até o cursor quando o cursor avança, e voltar o
 * cursor não as restaura. A contagem de não lidas volta; o selo de menção não.
 */
export function marcarNaoLidaA(messageId: string): void {
  const message = client.messages.get(idDoSdk(messageId));
  if (!message) return;
  const channelId = message.channelId;
  const ids = idsOf(channelId);
  const indice = ids.indexOf(messageId);

  /* Linha efêmera da sala não é cursor: o servidor não conhece o ID dela. */
  const anteriorNaLista = indice > 0 ? ultimaDoServidor(ids.slice(0, indice)) : undefined;
  const novoCursor = anteriorNaLista ?? ulidAnterior(idDoSdk(messageId));
  if (novoCursor === undefined) return;

  const antigo = cursorDeLeitura.get(channelId);
  cursorDeLeitura.set(channelId, novoCursor);
  naoLidaManual.add(channelId);

  // Só duas linhas mudam de marca: a que era a primeira não lida e a nova.
  const antigaPrimeira = antigo === undefined ? -1 : ids.indexOf(antigo) + 1;
  if (antigaPrimeira > 0) recalcularLayout(channelId, antigaPrimeira, antigaPrimeira);
  if (indice >= 0) recalcularLayout(channelId, indice, indice);

  somarNaoLida(channelId);

  if (conectado()) {
    const idServidor = anteriorNaLista === undefined ? novoCursor : idDoSdk(anteriorNaLista);
    void client.channels.get(channelId)?.ack(idServidor, true);
  }
}

/** Liga a não lida de um canal que não tinha — sem somar em cima de existente. */
function somarNaoLida(channelId: string): void {
  const atual = contagemDe(contagemPorCanal, channelId);
  if (atual.naoLidas > 0) return;
  contagemPorCanal.set(channelId, { naoLidas: 1, mencoes: atual.mencoes });
  reemitirCanal(channelId);

  if (servidorDoCanal(channelId)) {
    /* Recontar e não somar +1: silêncio e "não sigo" mudam o que sobe. */
    recontarServidores();
  } else {
    reemitirConversas();
    reemitirTotais();
  }
}

/**
 * O cursor que chegou de fora. Exportado para teste — o caminho real é o
 * evento `ChannelAck`.
 *
 * ⚠ **O próprio `ack` deste dispositivo também volta pelo socket**, e aplicá-lo
 * de novo é inofensivo: mesmo cursor, nada a republicar.
 */
export function aplicarAckRemoto(channelId: string, messageIdDoServidor: string): void {
  const chave = apelidos.get(messageIdDoServidor) ?? messageIdDoServidor;
  const ids = idsOf(channelId);
  const antigo = cursorDeLeitura.get(channelId);
  if (antigo === chave) return;

  /*
    ⚠ **No canal ABERTO, cursor que avança não move o divisor.** Abrir o canal
    manda `ack` da última mensagem, e o eco dele volta por aqui: aplicá-lo
    faria o divisor sumir no mesmo quadro em que a pessoa entrou para vê-lo —
    a regra que `avancarCursor` existe para garantir. Só a CONTAGEM zera; o
    cursor anda ao sair, como sempre. Voltar para trás vale mesmo aberto.
  */
  /* A POSIÇÃO na lista decide quando os dois estão nela; fora dela, a ordem
     do ULID — que é a mesma, exceto para ID local de mensagem otimista. */
  const posAntigo = antigo === undefined ? -1 : ids.indexOf(antigo);
  const posNovo = ids.indexOf(chave);
  const avanca =
    antigo === undefined ||
    (posAntigo >= 0 && posNovo >= 0
      ? posNovo > posAntigo
      : idDoSdk(antigo) < messageIdDoServidor);
  if (channelId === canalAberto && avanca) {
    zerarContagem(channelId);
    return;
  }

  cursorDeLeitura.set(channelId, chave);
  const antigaPrimeira = antigo === undefined ? -1 : ids.indexOf(antigo) + 1;
  const novaPrimeira = ids.indexOf(chave) + 1;
  if (antigaPrimeira > 0) recalcularLayout(channelId, antigaPrimeira, antigaPrimeira);
  if (novaPrimeira > 0) recalcularLayout(channelId, novaPrimeira, novaPrimeira);

  const ultima = client.channels.get(channelId)?.lastMessageId;
  if (ultima && ultima > messageIdDoServidor) somarNaoLida(channelId);
  else zerarContagem(channelId);
}

/** O ponto onde a leitura parou. Para a lista saber até onde rolar. */
export function primeiraNaoLida(channelId: string): string | undefined {
  return primeiraNaoLidaDe(channelId);
}

export function marcarCanalLido(channelId: string): void {
  /*
    Avisa o SERVIDOR, e não só a si mesmo.

    Sem isto a leitura é local: a pessoa lê no desktop, abre no celular e
    encontra tudo não lido de novo. O cursor de leitura é do protocolo
    (`ChannelUnread.lastMessageId`), e `ack` é como se escreve nele.

    Fire-and-forget com guarda de conexão, como digitação e presença: marcar
    lido é confirmação de algo que a pessoa já fez, e falhar por falta de
    socket não pode derrubar nada. O servidor reconcilia no próximo `Ready`.
  */
  if (conectado()) {
    const ids = channelMessageIds.peek(channelId);
    const ultima = ultimaDoServidor(ids ?? []);
    if (ultima) void client.channels.get(channelId)?.ack(idDoSdk(ultima));
  }

  zerarContagem(channelId);
}

/** Tira as não lidas e menções de um canal, sem avisar o servidor. */
function zerarContagem(channelId: string): void {
  const atual = contagemPorCanal.get(channelId);
  if (!atual) return;

  contagemPorCanal.delete(channelId);

  if (client.channels.get(channelId)?.serverId) recontarServidores();
  else reemitirConversas();

  reemitirCanal(channelId);
}

/**
 * Recalcula o rollup de todos os servidores a partir das contagens por canal.
 *
 * ⚠ **Recontar e não subtrair**, desde que o silêncio entrou no rollup. A
 * subtração assumia que tudo que o canal contou tinha sido somado ao servidor
 * — e com canal mudo isso deixou de ser verdade: a não-lida fica no canal e
 * NÃO sobe. Subtrair o que nunca foi somado zeraria o servidor por causa de
 * outro canal. A regra mora em `somarPorServidor`, e só lá.
 *
 * Só republica o servidor cuja soma MUDOU, pela mesma razão da comparação em
 * `somarTotais`: sem ela, abrir um canal acordaria o rail inteiro.
 */
function recontarServidores(): void {
  const nova = somarPorServidor(
    contagemPorCanal,
    servidorDoCanal,
    estaMudo,
    infoDeTopico,
  );
  const tocados = new Set([...contagemPorServidor.keys(), ...nova.keys()]);
  for (const serverId of tocados) {
    const antes = contagemPorServidor.get(serverId);
    const depois = nova.get(serverId);
    if (antes?.naoLidas === depois?.naoLidas && antes?.mencoes === depois?.mencoes) {
      continue;
    }
    if (depois) contagemPorServidor.set(serverId, depois);
    else contagemPorServidor.delete(serverId);
    reemitirServidor(serverId);
  }
  reemitirTotais();
  /* Semeadura e silêncio passam por aqui, e os dois mudam a conta das
     conversas também — silenciar uma DM tira o número dela do rail. */
  reemitirConversas();
}

/**
 * Marca como lidos TODOS os canais com não-lida — "Marcar tudo como lido" da
 * caixa de entrada.
 *
 * ⚠ **Em fila de três, e cada canal só zera quando o servidor confirma.** O
 * protocolo não tem `ack` em lote; disparar quarenta `PUT` no mesmo tique bate
 * no limitador de taxa, e os que voltassem 429 ficariam zerados na tela e não
 * lidos no servidor — a leitura mentindo até o próximo `Ready`. Zerando por
 * confirmação, o que falhou continua aparecendo não lido, que é verdade.
 *
 * ⚠ **A rota crua, e não `Channel.ack()`.** Sem `skipRateLimiter` o `ack` do
 * SDK AGENDA a requisição com 1,5 s de atraso e devolve na hora; com ele,
 * dispara e também devolve na hora, porque não retorna a promessa do `PUT`.
 * Nos dois casos a fila esperaria nada e não limitaria nada.
 *
 * Sem socket, zera localmente e não escreve: é o mesmo contrato de
 * `marcarCanalLido` ("o servidor reconcilia no próximo `Ready`").
 */
export async function marcarTodosLidos(
  aoProgredir?: (feitos: number, total: number) => void,
): Promise<{ readonly total: number; readonly falhas: number }> {
  const alvos = [...contagemPorCanal.keys()];
  if (alvos.length === 0) return { total: 0, falhas: 0 };

  if (!conectado()) {
    for (const id of alvos) zerarLocalmente(id);
    return { total: alvos.length, falhas: 0 };
  }

  const { falhas } = await emFila(
    alvos,
    async (channelId) => {
      const ids = channelMessageIds.peek(channelId);
      const ultima = ids?.[ids.length - 1];
      const alvo = ultima ? idDoSdk(ultima) : client.channels.get(channelId)?.lastMessageId;
      if (alvo) {
        await client.api.put(`/channels/${channelId}/ack/${alvo}` as never);
      }
      zerarLocalmente(channelId);
    },
    3,
    (feitos) => aoProgredir?.(feitos, alvos.length),
  );
  return { total: alvos.length, falhas: falhas.length };
}

/** Zera a contagem de um canal sem escrever no servidor. */
function zerarLocalmente(channelId: string): void {
  if (!contagemPorCanal.delete(channelId)) return;
  if (client.channels.get(channelId)?.serverId) recontarServidores();
  else {
    reemitirTotais();
    reemitirConversas();
  }
  reemitirCanal(channelId);
}

/**
 * Menção é do app, não do protocolo.
 *
 * O Stoat carrega `mentions` na mensagem; o Vortex decide o que conta como
 * menção SUA. Hoje é o teu ID no texto — quando existirem menção de cargo e
 * `@everyone`, a regra muda AQUI e nenhum componente fica sabendo.
 */
function ehMencao(conteudo: string): boolean {
  return usuarioLocal !== undefined && conteudo.includes(`<@${usuarioLocal}>`);
}

/**
 * As menções de um canal, em cache pela IDENTIDADE da lista de IDs.
 *
 * Três versões, e as duas primeiras estavam erradas de formas opostas — vale
 * registrar porque o erro é fácil de repetir:
 *
 * 1. **Acumular pelo evento `message`** era cego para metade do app: `seed()`
 *    contorna o caminho de evento de propósito ("carga em massa e chegada
 *    incremental são caminhos diferentes"), então nenhuma menção do histórico
 *    entrava. Mesma família da pendência de semear não-lidas no `Ready`.
 *
 * 2. **Derivar na hora** consertava isso e criava outro: o botão precisa saber
 *    se EXISTE menção para decidir se aparece, e isso é uma pergunta de
 *    RENDER. A passada por dez mil IDs saiu do clique e foi para o caminho
 *    quente. O gate mediu: **18,6% de frames perdidos contra 1,5%**, p99 de
 *    75ms. O comentário da versão 2 dizia "por clique, não por frame" e o
 *    código fazia o contrário.
 *
 * 3. Cache pela identidade do array de IDs, incremental no append. A lista de
 *    IDs é republicada como array novo a cada mudança, então comparar a
 *    referência responde "mudou?" sem comparar conteúdo. Append — o caminho
 *    quente — só varre a cauda.
 */
type CacheDeMencoes = { ids: readonly string[]; mencoes: string[] };
const mencoesPorCanal = new Map<string, CacheDeMencoes>();
const VAZIO_DE_IDS: readonly string[] = [];

function mencoesDe(channelId: string): readonly string[] {
  /*
    A lista PUBLICADA, nunca `idsOf`.

    `idsOf` devolve o array interno, que é mutado NO LUGAR — a identidade dele
    nunca muda, então um cache que a compara jamais invalidaria: a lista de
    menções seria calculada uma vez e congelada. Foi o que os testes pegaram,
    e o sintoma era "a próxima menção é a de dois seeds atrás".

    A publicada é cópia nova a cada publish — é por isso que publicar é O(total),
    e é exatamente essa propriedade que faz a comparação por referência
    responder "mudou?" sem comparar conteúdo. Também é a lista que o componente
    enxerga, então os IDs devolvidos aqui existem lá.
  */
  const ids = channelMessageIds.peek(channelId) ?? VAZIO_DE_IDS;
  const cache = mencoesPorCanal.get(channelId);
  if (cache && cache.ids === ids) return cache.mencoes;

  const ehDaqui = (id: string) => {
    const m = client.messages.get(id) as { content?: string } | undefined;
    return m?.content !== undefined && ehMencao(m.content);
  };

  /*
    Append preserva o prefixo, e é o caminho quente.

    Uma mensagem nova produz um array que começa igual ao anterior. Conferir o
    ÚLTIMO id do prefixo é o suficiente para saber disso — prepend e
    substituição mudam esse elemento, e caem na varredura completa, que é rara
    e acontece fora da janela medida.
  */
  const antes = cache?.ids;
  const podeIncrementar =
    antes !== undefined &&
    ids.length > antes.length &&
    antes.length > 0 &&
    ids[antes.length - 1] === antes[antes.length - 1];

  const mencoes = podeIncrementar
    ? [...(cache?.mencoes ?? []), ...ids.slice(antes?.length ?? 0).filter(ehDaqui)]
    : ids.filter(ehDaqui);

  mencoesPorCanal.set(channelId, { ids, mencoes });
  return mencoes;
}

/** Existe alguma menção a você neste canal? Pergunta de RENDER, e é O(1). */
export function temMencao(channelId: string): boolean {
  return mencoesDe(channelId).length > 0;
}

/**
 * Os IDs das menções a você neste canal, na ordem da lista. Quem decide se há
 * alguma FORA da área visível (o atalho "próxima menção") precisa deles; é a
 * mesma lista cacheada de `temMencao`, sem varredura nova.
 */
export function idsDeMencao(channelId: string): readonly string[] {
  return mencoesDe(channelId);
}

/**
 * A próxima menção depois de uma posição, ou a primeira se não houver posição.
 *
 * `depoisDe` é um ID e não um índice: índice muda quando chega histórico pelo
 * topo, e quem chama não sabe nada sobre prepend. Mesma razão do `getItemKey`.
 *
 * Dá a volta ao chegar no fim. Um botão de "próxima" que para de funcionar na
 * última obriga a rolar de volta à mão — e quem aperta três vezes seguidas
 * quer varrer as três, não descobrir onde acaba a fila.
 */
export function proximaMencao(
  channelId: string,
  depoisDe: string | undefined,
): string | undefined {
  const vivas = mencoesDe(channelId);
  if (vivas.length === 0) return undefined;

  if (!depoisDe) return vivas[0];
  const atual = vivas.indexOf(depoisDe);
  if (atual === -1) return vivas[0];
  return vivas[(atual + 1) % vivas.length];
}

/**
 * Uma chamada numa DM ou grupo, traduzida do evento CRU.
 *
 * ⚠ **Cru porque o SDK não trata dois dos três.** `VoiceCallUpdate` não tem
 * `case` em `events/v1.ts` — o `stoat.js` o descarta —, e é justamente o sinal
 * que o protocolo desenhou para "está tocando": o `voice-ingress` o publica em
 * privado para cada destinatário quando a PRIMEIRA pessoa entra na sala, e com
 * `ended: true` no canal quando a sala esvazia. Ver `store/chamadaRecebida.ts`
 * para as duas fontes e a deduplicação.
 *
 * ⚠ **`VoiceChannelJoin`/`Leave` são lidos SEM depender da ordem** em que o SDK
 * aplica o mesmo evento no `ReactiveMap`: a pergunta é "há alguém ALÉM de
 * quem entrou/saiu?", e excluir essa pessoa da contagem dá a mesma resposta
 * antes e depois de o SDK mexer no mapa.
 *
 * Só DM e grupo tocam. Canal de voz de servidor é LUGAR, não chamada — entrar
 * numa sala de servidor não liga para ninguém.
 */
function traduzirSinalDeChamada(evento: unknown): void {
  const e = evento as {
    type?: string;
    initiator_id?: string;
    channel_id?: string;
    ended?: boolean;
    id?: string;
    user?: string;
    state?: { id?: string };
  };
  if (
    e.type !== "VoiceCallUpdate" &&
    e.type !== "VoiceChannelJoin" &&
    e.type !== "VoiceChannelLeave"
  ) {
    return;
  }

  const channelId = e.type === "VoiceCallUpdate" ? e.channel_id : e.id;
  if (channelId === undefined) return;
  const canal = client.channels.get(channelId);
  if (canal?.type !== "DirectMessage" && canal?.type !== "Group") return;

  const outrosAlem = (quem: string | undefined) =>
    [...participantesDaSala(channelId).keys()].some((id) => id !== quem);

  if (e.type === "VoiceChannelLeave") {
    if (!outrosAlem(e.user)) sinalizarFimDeChamada(channelId);
    return;
  }
  if (e.type === "VoiceCallUpdate" && e.ended) {
    sinalizarFimDeChamada(channelId);
    return;
  }

  const quemLigou = e.type === "VoiceCallUpdate" ? e.initiator_id : e.state?.id;
  if (quemLigou === undefined) return;
  /* Entrar numa sala que já tinha gente é juntar-se a uma chamada, não ligar. */
  if (e.type === "VoiceChannelJoin" && outrosAlem(quemLigou)) return;

  const pessoa = client.users.get(quemLigou);
  sinalizarChamada({
    channelId,
    quemLigou,
    eu: usuarioLocal,
    quemLigouNome: pessoa?.displayName ?? "Alguém",
    grupoNome: canal.type === "Group" ? canal.name : undefined,
    amigo: pessoa?.relationship === "Friend",
  });
}

/**
 * A mensagem que chegou, traduzida para o notificador.
 *
 * ⚠ **Só depois de sabermos que não é nossa**, e barata antes disso: este é o
 * caminho de `messageCreate`, o mais quente do app. A tradução (nomes, cargos
 * mencionados) só roda para mensagem de outra pessoa.
 */
function avisarChegada(message: Message): void {
  if (!usuarioLocal || message.authorId === usuarioLocal) return;
  const canal = message.channel;
  const tipo = canal?.type;
  if (canal && tipo === "DirectMessage") {
    const destino = destinoDe(canal);
    /*
      ⚠ **A fila muda por MENSAGEM num caso só**, e é aqui que ele é pego: a
      conversa recusada volta quando a pessoa escreve de novo. Republicar a
      coluna por mensagem seria o `n log n` que `publicarConversas` existe
      para evitar — então só quando o destino desta conversa MUDOU, que é
      raro, e só para DM, que nunca é a carga do firehose.
    */
    if (destino !== destinoPublicado.get(canal.id)) publicarConversas();
    /*
      Solicitação não interrompe. O toast e o som levariam o TEXTO de um
      desconhecido para a tela antes de a pessoa decidir abrir — exatamente o
      que a fila existe para impedir. Ela aparece na aba, contada.
    */
    if (destino !== "conversa") return;
  }
  const direta = message.mentionIds?.includes(usuarioLocal) ?? false;
  const cargo = message.roleMentions?.some((r) => r.assigned) ?? false;
  /*
    O "Responder…" do toast (D-NOTIF-20) é uma resposta COM menção, que é o
    padrão do composer (`store/resposta`): quem te mencionou é avisado de que
    você respondeu. Sem permissão de escrever ali, o campo nem aparece — a
    regra do projeto é não renderizar ação que a pessoa não pode executar.

    ⚠ PREGUIÇOSO: este é o caminho de `messageCreate`, o mais quente do app, e
    `pode()` consulta a tabela de permissões. Só a menção que vira toast chega
    a perguntar — a mensagem comum de um canal movimentado não paga nada.
  */
  const channelId = message.channelId;
  const mensagemId = message.id;
  /* Tópico é canal: a menção avisa como em qualquer canal; a mensagem comum
     de um tópico seguido só marca não lida (ver `decidirEntrega`). */
  const topico = lerTopico(channelId);
  const responder = () =>
    pode(channelId, "enviar")
      ? (texto: string) => {
          enviarMensagem(channelId, texto, { id: mensagemId, mencionar: true });
        }
      : undefined;
  notificarMensagem({
    mensagemId: message.id,
    channelId: message.channelId,
    serverId: canal?.serverId,
    tipoDoCanal: tipo === "DirectMessage" ? "dm" : tipo === "Group" ? "grupo" : "servidor",
    ...(topico ? { ehTopico: true, paiId: topico.paiId } : {}),
    autorNome: message.masquerade?.name ?? message.author?.displayName ?? "Alguém",
    canalNome: canal?.name,
    servidorNome: canal?.server?.name,
    texto: message.content,
    minha: false,
    mencionaVoce: direta,
    /* `mentioned` do SDK junta direta, cargo e massa; o que sobra dos dois
       primeiros é `@everyone`/`@online`. */
    mencionaTodos: !direta && !cargo && message.mentioned,
    mencionaCargo: cargo,
  }, responder);
}

function contabilizarNaoLida(channelId: string, conteudo: string): void {
  if (channelId === canalAberto) return;

  const canal = contagemDe(contagemPorCanal, channelId);
  const mencao = ehMencao(conteudo) ? 1 : 0;
  contagemPorCanal.set(channelId, {
    naoLidas: canal.naoLidas + 1,
    mencoes: canal.mencoes + mencao,
  });
  reemitirCanal(channelId);

  const serverId = servidorDoCanal(channelId);
  if (!serverId) {
    reemitirConversas();
    return;
  }
  /*
    Canal ou servidor mudo não acende o servidor — só a menção sobe. É a regra
    de `somarPorServidor` aplicada em O(1), porque este é o caminho de
    `messageCreate`: recontar tudo aqui seria pagar a varredura por mensagem.
    Os dois caminhos concordam porque perguntam a mesma coisa (`estaMudo`).
  */
  const soma = naoLidasQueSobem(1, channelId, serverId, estaMudo, infoDeTopico(channelId));
  if (soma === 0 && mencao === 0) return;
  const servidor = contagemDe(contagemPorServidor, serverId);
  contagemPorServidor.set(serverId, {
    naoLidas: servidor.naoLidas + soma,
    mencoes: servidor.mencoes + mencao,
  });
  reemitirServidor(serverId);
  /*
    ⚠ **O total não acompanhava a mensagem ao vivo.** Só leitura e semeadura o
    republicavam, então a aba da caixa de entrada e o contador de menções no
    ícone do app ficavam no número da abertura até a pessoa ler um canal. A
    soma é sobre SERVIDORES com contagem (poucos), e as duas saídas comparam
    antes de publicar — o firehose não acorda ninguém por isto.
  */
  reemitirTotais();
}

/**
 * A relação que cada pessoa tinha na última vez que o protocolo falou dela.
 *
 * ⚠ **Mapa próprio, alimentado pelo evento CRU, e não o `previousUser` do
 * `userUpdate`.** Pedido de amizade chega quase sempre de quem a sessão nunca
 * viu, e o SDK roda sem `partials`: para pessoa fora do cache, o
 * `UserRelationship` não vira `userUpdate` nenhum. O evento cru traz a pessoa
 * inteira e o status novo, e este mapa traz o anterior — que é o que separa
 * "ela aceitou o meu pedido" de "eu aceitei o dela" (ver `mudancaDeAmizade`).
 *
 * Semeado no `Ready`: sem isto, o primeiro aceite depois de abrir o app viria
 * de `undefined` e não seria reconhecido como aceite.
 */
const relacaoConhecida = new Map<string, string>();

function observarRelacoes(evento: unknown): void {
  const e = evento as {
    type?: string;
    users?: readonly { _id?: string; relationship?: string }[];
    user?: { _id?: string; username?: string; display_name?: string; relationship?: string };
    status?: string;
  };

  if (e.type === "Ready") {
    for (const u of e.users ?? []) {
      if (u._id && u.relationship) relacaoConhecida.set(u._id, u.relationship);
    }
    return;
  }

  const userId = e.user?._id;
  const status = e.status ?? e.user?.relationship;
  if (!userId || !status) return;
  const mudanca = mudancaDeAmizade(relacaoConhecida.get(userId), status);
  relacaoConhecida.set(userId, status);
  if (!mudanca) return;

  notificarAmizade(
    {
      userId,
      nome: e.user?.display_name ?? e.user?.username ?? "Alguém",
      mudanca,
    },
    {
      aceitar: () => void aceitarAmizade(userId),
      recusar: () => void desfazerAmizade(userId),
    },
  );
}

/* -------------------------------------------------------------- entidades */

/**
 * O teto de gente numa sala de voz — o `8` de "3/8" na coluna.
 *
 * ⚠ **Lê o objeto HIDRATADO, e é a única forma.** O `Channel` do SDK expõe
 * `isVoice` mas não o objeto `voice` de onde ele deriva; o campo mora aqui,
 * atrás de `getUnderlyingObject`, que é público na coleção e não na entidade.
 *
 * Vive no adapter e não em `map.ts` porque quem tem a coleção é este módulo —
 * `map.ts` traduz uma entidade recebida, não busca dados. A leitura crua fica
 * confinada nesta função, e o resto do app vê `ChannelSnapshot.limite`.
 *
 * Ausência e `max_users: 0` chegam como "cabe quem vier". Zero no fio era o
 * sentinela errado do slider, e a coluna não pode desenhar "3/0".
 */
function tetoDaSala(channelId: string): number | undefined {
  const bruto = client.channels.getUnderlyingObject(channelId) as unknown as {
    voice?: { maxUsers?: number };
  };
  const teto = bruto.voice?.maxUsers;
  return typeof teto === "number" && Number.isFinite(teto) && teto > 0
    ? teto
    : undefined;
}

/** Só re-emite o que alguém está olhando — a mesma regra do `recalcularLayout`. */
function reemitirCanal(channelId: string): void {
  if (channels.subscriberCount(channelId) === 0) return;
  const canal = client.channels.get(channelId);
  if (!canal) return;
  const c = contagemDe(contagemPorCanal, channelId);
  channels.set(channelId, toChannelSnapshot(canal, c.naoLidas, c.mencoes, usuarioLocal, tetoDaSala(channelId)));
}

function reemitirServidor(serverId: string): void {
  if (servers.subscriberCount(serverId) === 0) return;
  const servidor = client.servers.get(serverId);
  if (!servidor) return;
  const c = contagemDe(contagemPorServidor, serverId);
  servers.set(serverId, toServerSnapshot(servidor, c.naoLidas, c.mencoes));
}

export const servers = createEntityStore<ServerSnapshot>((id) => {
  const inicial = client.servers.get(id);
  if (inicial) {
    const c = contagemDe(contagemPorServidor, id);
    servers.set(id, toServerSnapshot(inicial, c.naoLidas, c.mencoes));
  }

  return createRoot((dispose) => {
    createEffect(() => {
      const servidor = client.servers.get(id);
      if (!servidor) return;
      const c = contagemDe(contagemPorServidor, id);
      servers.set(id, toServerSnapshot(servidor, c.naoLidas, c.mencoes));
    });
    return dispose;
  });
});

export const channels = createEntityStore<ChannelSnapshot>((id) => {
  const inicial = client.channels.get(id);
  if (inicial) {
    const c = contagemDe(contagemPorCanal, id);
    channels.set(id, toChannelSnapshot(inicial, c.naoLidas, c.mencoes, usuarioLocal, tetoDaSala(id)));
  }

  return createRoot((dispose) => {
    createEffect(() => {
      const canal = client.channels.get(id);
      if (!canal) return;
      const c = contagemDe(contagemPorCanal, id);
      channels.set(id, toChannelSnapshot(canal, c.naoLidas, c.mencoes, usuarioLocal, tetoDaSala(id)));
    });
    return dispose;
  });
});

/**
 * Membro, keyed por SERVIDOR + USUÁRIO.
 *
 * A pendência que este bloco fecha estava escrita assim: *"apelido é por
 * servidor (`ServerMember`), e uma chave de usuário não sabe de qual servidor
 * se fala"*. Era verdade e custava três campos de uma vez — apelido, cor de
 * cargo e castigo, todos moram no `ServerMember` e nenhum no `User`.
 *
 * A chave é marcada no domínio (`ChaveDeMembro`), então passar um ID de
 * usuário aqui não compila. Sem isso, o erro seria `getSnapshot(userId)`
 * devolvendo `undefined` para sempre, calado.
 *
 * **Duas fontes numa subscrição só, e é de propósito.** `User` muda quando a
 * pessoa troca de nome; `ServerMember`, quando trocam o apelido dela ou lhe
 * dão um cargo. Um `createEffect` lendo os dois reage aos dois — e a
 * granularidade continua sendo a linha, não a lista.
 */
export const members = createEntityStore<MemberSnapshot>((chave) => {
  const userId = usuarioDaChave(chave as ChaveDeMembro);
  const serverId = chave.slice(0, chave.length - userId.length - 1);

  const ler = () => {
    const user = client.users.get(userId);
    if (!user) return;
    // `getByKey` e não `get`: a coleção do SDK indexa por objeto composto, e
    // passar a nossa chave direto acharia nada — silenciosamente.
    const membro = serverId
      ? client.serverMembers.getByKey({ server: serverId, user: userId })
      : undefined;
    /*
      EU, neste servidor — é o que responde a hierarquia.

      Lido aqui e não em `map.ts` porque aquele é tradução pura e não conhece
      o cliente. `undefined` sem sessão ou fora do servidor, e aí `inferiorTo`
      não roda: o default de "não sei" é NÃO PODE.
    */
    const eu =
      serverId && client.user
        ? client.serverMembers.getByKey({
            server: serverId,
            user: client.user.id,
          })
        : undefined;
    members.set(chave, toMemberSnapshot(user, membro, eu));
  };

  ler();

  count("membroEfeitos");
  return createRoot((dispose) => {
    createEffect(ler);
    return dispose;
  });
});

/* -------------------------------------------------------------- canais */

const canaisPorServidor = new Map<string, string[]>();

/**
 * Publica imediatamente, sem passar pelo flush por frame.
 *
 * A coalescência existe para eventos que chegam aos milhares — mensagem e
 * presença. Canal criado e canal apagado são raros e vêm um de cada vez;
 * enfileirar num rAF só adiaria um frame o que já é barato, e esconderia o
 * efeito de quem estivesse depurando.
 */
/**
 * Republica as colunas de um servidor. Exportado para as escritas.
 *
 * Criar e apagar canal chegam por evento quando há servidor; sem ele — e no
 * arnês — o caminho de escrita precisa empurrar a mesma publicação, senão a
 * coluna só muda no F5.
 */
export function publicarCanaisDe(serverId: string): void {
  publicarCanais(serverId);
}

function publicarCanais(serverId: string): void {
  const ids = canaisPorServidor.get(serverId) ?? [];
  const texto: string[] = [];
  const voz: string[] = [];
  for (const id of ids) {
    // Mesma função que o snapshot usa. Partir aqui por um critério e rotular
    // a linha por outro daria uma seção "voz" cheia de ícones de `#`.
    const canal = client.channels.get(id);
    (canal && ehCanalDeVoz(canal) ? voz : texto).push(id);
  }
  canaisDeTexto.set(serverId, texto);
  canaisDeVoz.set(serverId, voz);

  publicarCategorias(serverId);
}

/**
 * As categorias, na ordem que o servidor define.
 *
 * `server.orderedChannels` faz o trabalho pesado — casa `categories` com os
 * canais, e força uma categoria "default" para o que sobrou fora de grupo. Era
 * a parte que parecia cara nesta pendência e já vinha pronta.
 *
 * A tradução aqui é pequena e é toda anticorrupção: IDs em vez de objetos do
 * SDK, e o título `"Default"` — string em inglês vinda do protocolo — vira
 * `undefined`, que é o que o domínio quer dizer com "sem grupo". Deixar
 * `"Default"` passar poria uma palavra do Stoat na interface do Vortex.
 */
function publicarCategorias(serverId: string): void {
  const servidor = client.servers.get(serverId);
  if (!servidor) {
    categorias.set(serverId, []);
    return;
  }

  const out: CategoriaDeCanais[] = [];
  for (const grupo of servidor.orderedChannels) {
    /*
      ⚠ **Categoria vazia FICA, e descartá-la aqui fechava "criar canal" num
      beco sem saída.**

      A regra anterior era `if (grupo.channels.length === 0) continue`, com a
      razão de não deixar cabeçalho órfão para quem não enxerga os canais de
      dentro. A razão é boa; o lugar estava errado.

      Este store é a VERDADE sobre o servidor, e é ele que o modal de criar
      canal consulta para escolher onde o canal vai. Medido: com a categoria
      `Textos` existindo no servidor e filtrada aqui, "Criar canal" respondia
      "este servidor não tem categorias, crie a primeira" — depois de a pessoa
      ter acabado de criar uma. Um laço fechado: nunca dava para criar canal.

      Esconder cabeçalho vazio é decisão de EXIBIÇÃO, e mora na coluna, que
      é quem sabe se quem está olhando pode criar canal ali.
    */
    out.push({
      id: grupo.id,
      titulo: grupo.id === CATEGORIA_PADRAO ? undefined : grupo.title,
      canais: grupo.channels.map((c) => c.id),
    });
  }

  categorias.set(serverId, out);
}

/* ----------------------------------------------------- baldes de presença */

const membrosPorServidor = new Map<string, Set<string>>();
const servidoresDoUsuario = new Map<string, Set<string>>();
/** Em qual balde cada usuário está HOJE — a comparação que evita o re-sort. */
const baldePorUsuario = new Map<string, Balde>();

function conjunto(mapa: Map<string, Set<string>>, chave: string): Set<string> {
  let set = mapa.get(chave);
  if (!set) {
    set = new Set();
    mapa.set(chave, set);
  }
  return set;
}

/**
 * Semeia a presença inicial de um usuário.
 *
 * Existe porque presença chega por EVENTO (`userUpdate`), e na carga inicial
 * não houve evento nenhum — sem isto, um servidor recém-carregado mostra os
 * 40 membros offline até a primeira piscada de cada um.
 *
 * Recebe o tipo de DOMÍNIO, não o do protocolo: quem chama é o arnês, que não
 * pode conhecer `stoat.js`. Quando existir login, quem chama isto é o
 * `ready` do SDK, e a assinatura não muda.
 */
export function semearPresenca(userId: string, status: PresenceStatus): void {
  presence.set(userId, status);
  baldePorUsuario.set(userId, baldeDe(status));
}

/**
 * Semeia ocupantes de uma sala de voz — setup em massa, como `registrarServidor`.
 *
 * Existe porque o arnês NÃO pode importar `stoat.js`: a fronteira de import
 * proíbe, e o lint pegou a primeira versão disto tentando construir
 * `VoiceParticipant` lá fora. A regra estava certa por um motivo além da
 * fronteira — o arnês não tem por que conhecer a forma do protocolo, e um dia
 * em que `UserVoiceState` mudar de campo, quem conserta é este arquivo.
 */
export function semearVoz(
  channelId: string,
  dentro: readonly {
    userId: string;
    desde: number;
    tela?: boolean;
    camera?: boolean;
    mudo?: boolean;
    surdo?: boolean;
  }[],
): void {
  const canal = client.channels.get(channelId);
  if (!canal) return;

  for (const p of dentro) {
    /*
      ⚠ Surdo IMPLICA mudo, e a implicação mora AQUI e não no arnês: é regra
      do protocolo (quem não recebe também não publica), e deixá-la na
      semeadura deixaria o rig capaz de produzir um estado que nenhum servidor
      produz.
    */
    colocarNaSala(channelId, p.userId, {
      joined_at: new Date(p.desde).toISOString(),
      is_receiving: !(p.surdo ?? false),
      is_publishing: !(p.mudo ?? false) && !(p.surdo ?? false),
      screensharing: p.tela ?? false,
      camera: p.camera ?? false,
    });
  }
  releituraDeVoz.get(channelId)?.();
}

/**
 * O arnês marcando alguém como silenciado pelo servidor.
 *
 * ⚠ Existe porque o rig não pode fabricar o evento CRU: `can_publish` chega
 * pelo socket, e o firehose não fala socket. Sem isto o selo `SRV` nasceria
 * inalcançável — a família do "construído e inalcançável" que este projeto já
 * registrou várias vezes.
 *
 * Escreve no MESMO mapa que o evento escreve, e não num paralelo: dois lugares
 * guardando o mesmo fato divergiriam no primeiro que alguém esquecesse.
 */
export function semearMudoDoServidor(
  serverId: string,
  userId: string,
  mudo: boolean,
): void {
  const chave = chaveDeMembro(serverId, userId);
  if (mudo) mudosPeloServidor.add(chave);
  else mudosPeloServidor.delete(chave);
  republicarVoz();
}

/**
 * O mesmo para `can_receive` — ensurdecido pelo servidor.
 *
 * ⚠ **Arnês mais pobre que o protocolo, de novo.** `surdoPeloServidor` entrou
 * no snapshot quando o menu do participante precisou saber se o item estava
 * marcado, e nada nunca o pôs em `true`: o campo existia, compilava, tinha
 * consumidor no menu e NUNCA tinha sido visto na coluna. O selo dele nasceria
 * inalcançável, exatamente como o `SRV` teria nascido sem a função acima.
 */
export function semearSurdoDoServidor(
  serverId: string,
  userId: string,
  surdo: boolean,
): void {
  const chave = chaveDeMembro(serverId, userId);
  if (surdo) surdosPeloServidor.add(chave);
  else surdosPeloServidor.delete(chave);
  republicarVoz();
}

export function registrarMembro(serverId: string, userId: string): void {
  const membros = conjunto(membrosPorServidor, serverId);
  if (membros.has(userId)) return;
  membros.add(userId);
  conjunto(servidoresDoUsuario, userId).add(serverId);
  baldePorUsuario.set(userId, baldeDe(presence.getSnapshot(userId) ?? "offline"));
  membrosSujos.add(serverId);
}

export function removerMembro(serverId: string, userId: string): void {
  const membros = membrosPorServidor.get(serverId);
  if (!membros?.delete(userId)) return;
  servidoresDoUsuario.get(userId)?.delete(serverId);
  baldePorUsuario.delete(userId);
  membrosSujos.add(serverId);
}

/**
 * Presença mudou — a lista só reordena se o BALDE mudou.
 *
 * É a decisão que faz a member list sobreviver ao firehose. Presença é 55% da
 * mistura, e a esmagadora maioria é `online ↔ idle ↔ dnd`, que não troca de
 * balde. Sem esta comparação a lista republicaria a cada frame, pagando
 * `n log n` num painel onde nada mudou de lugar — e as linhas visíveis
 * re-renderizariam junto.
 *
 * O pontinho continua correto: ele assina `usePresence` sozinho, um nível
 * abaixo da linha, exatamente como no `MessageRow`.
 */
function atualizarBalde(userId: string, status: PresenceStatus): void {
  const servidores = servidoresDoUsuario.get(userId);
  if (!servidores || servidores.size === 0) return;

  const novo = baldeDe(status);
  if (baldePorUsuario.get(userId) === novo) return;

  baldePorUsuario.set(userId, novo);
  for (const serverId of servidores) membrosSujos.add(serverId);
  agendarFlush();
}

// Um colator por sessão, não um por comparação — mesma razão do DateTimeFormat.
const COLATOR = new Intl.Collator("pt-BR", { sensitivity: "base" });

/**
 * O nome pelo qual a lista ORDENA — que precisa ser o mesmo que ela mostra.
 *
 * Era `username` cru, e passou a estar errado no instante em que o apelido
 * entrou: a coluna exibiria "Ana-vx" e ordenaria por "Ana", então uma pessoa
 * apelidada apareceria fora de ordem alfabética sem nada explicando por quê.
 * Bug introduzido pela feature anterior e morto aqui.
 */
function nomeDe(serverId: string, userId: string): string {
  const apelido = client.serverMembers.getByKey({
    server: serverId,
    user: userId,
  })?.nickname;
  return apelido || client.users.get(userId)?.username || userId;
}

/**
 * Os cargos HASTEADOS do servidor, achatados uma vez por publicação.
 *
 * A alternativa óbvia era `membro.hoistedRole` por membro — e ela é uma
 * armadilha: o getter chama `orderedRoles`, que faz `map` + `filter` + `sort`
 * a CADA chamada. Numa lista de 10 mil membros isso é dez mil ordenações por
 * publicação, e a member list publica sempre que alguém cruza de balde.
 *
 * Com o mapa, o custo vira O(cargos) uma vez mais O(cargos por membro) na
 * varredura, sem alocar nada por membro.
 */
type CargoHasteado = { rank: number; nome: string; cor: string | undefined };

function cargosHasteados(serverId: string): Map<string, CargoHasteado> {
  const out = new Map<string, CargoHasteado>();
  const servidor = client.servers.get(serverId);
  if (!servidor) return out;

  for (const [id, cargo] of servidor.roles) {
    if (!cargo.hoist) continue;
    out.set(id, {
      // `rank` menor = mais sênior, e o SDK documenta assim. Sem cargo, vai
      // para o fim junto com quem não tem nenhum.
      rank: cargo.rank ?? Number.MAX_SAFE_INTEGER,
      nome: cargo.name,
      cor: cargo.colour ?? undefined,
    });
  }
  return out;
}

function publicarMembros(serverId: string): void {
  const membros = membrosPorServidor.get(serverId);
  if (!membros) {
    membrosOnline.set(serverId, []);
    membrosOffline.set(serverId, []);
    secoesOnline.set(serverId, []);
    return;
  }

  const online: string[] = [];
  const offline: string[] = [];
  for (const id of membros) {
    (baldePorUsuario.get(id) === "offline" ? offline : online).push(id);
  }

  const comparar = (a: string, b: string) =>
    COLATOR.compare(nomeDe(serverId, a), nomeDe(serverId, b));
  online.sort(comparar);
  offline.sort(comparar);

  membrosOnline.set(serverId, online);
  membrosOffline.set(serverId, offline);

  /*
    As seções, só do lado online.

    Offline continua um balde único de propósito: seccionar os ausentes por
    cargo dobraria o número de cabeçalhos para mostrar quem não está lá.
  */
  const cargos = cargosHasteados(serverId);
  const porCargo = new Map<string, string[]>();

  for (const userId of online) {
    const membro = client.serverMembers.getByKey({
      server: serverId,
      user: userId,
    });

    // Entre os cargos hasteados da pessoa, o MAIS SÊNIOR — menor `rank`.
    let escolhido = SEM_CARGO;
    let melhor = Number.MAX_SAFE_INTEGER;
    for (const roleId of membro?.roles ?? []) {
      const cargo = cargos.get(roleId);
      if (cargo && cargo.rank < melhor) {
        melhor = cargo.rank;
        escolhido = roleId;
      }
    }

    const lista = porCargo.get(escolhido);
    if (lista) lista.push(userId);
    else porCargo.set(escolhido, [userId]);
  }

  // `online` já veio ordenado, então cada balde de cargo herda a ordem sem
  // ordenar de novo — a varredura acima preserva a sequência de entrada.
  const secoes: SecaoDeMembros[] = [];
  for (const [id, ids] of porCargo) {
    const cargo = cargos.get(id);
    secoes.push({
      id,
      rotulo: cargo?.nome ?? "online",
      cor: cargo?.cor,
      ids,
    });
  }

  secoes.sort((a, b) => {
    // Sem cargo sempre por último, qualquer que seja o rank dos outros.
    if (a.id === SEM_CARGO) return 1;
    if (b.id === SEM_CARGO) return -1;
    return (
      (cargos.get(a.id)?.rank ?? 0) - (cargos.get(b.id)?.rank ?? 0)
    );
  });

  secoesOnline.set(serverId, secoes);
}

/* ---------------------------------------------------------------- registro */

/**
 * Registra servidor, canais e membros SEM passar pelo caminho de evento.
 *
 * É a mesma separação do `seedChannel`, pela mesma razão: carga em massa e
 * chegada incremental são caminhos diferentes, e misturá-los dá duas fontes
 * competindo pela mesma lista. Publica na hora — não há frame para esperar
 * durante o setup.
 */
/**
 * Traz a lista de membros de um servidor, uma vez, na abertura.
 *
 * ⚠ **A member list ficava VAZIA contra um servidor de verdade, e o motivo é
 * exatamente o que o comentário do `Ready` descreve uma camada acima.**
 * `membrosPorServidor` só tinha dois preenchedores: o evento
 * `serverMemberJoin` — que existe para quem entra COM O APP ABERTO — e
 * `registrarServidor`, que é chamado só pelo arnês e pelos testes. Quem já era
 * membro antes de você abrir o app nunca era registrado, então a coluna
 * mostrava "Nenhum membro para mostrar" num servidor onde você mesmo está.
 *
 * Consertaram `serverIds` e os canais no `Ready` e os membros ficaram para
 * trás — a lista de canais é semeada duas linhas acima, no mesmo laço. É a
 * mesma família, e a mesma razão de nunca ter aparecido: o arnês semeia
 * `registrarServidor` direto e é mais RICO que o caminho real.
 *
 * ⚠ **`Ready` NÃO traz membros, e por isso é uma chamada de rede.** O payload
 * de abertura tem servidores, canais, cursores de leitura e presença; a lista
 * de membros é `GET /servers/{id}/members`, uma rota própria. Medido contra a
 * instância local: 200, com `members` e `users` preenchidos.
 *
 * ⚠ **Fire-and-forget, e uma por servidor.** Segurar o `Ready` esperando N
 * respostas atrasaria a primeira pintura por causa de uma coluna lateral que
 * talvez nem esteja aberta. A lista aparece quando chega, que é o mesmo
 * contrato do resto do adapter.
 *
 * Falha em silêncio de propósito: sem membros a coluna já tem estado vazio, e
 * um toast de erro para uma lista secundária seria ruído em cima de uma sessão
 * que acabou de abrir.
 */
async function semearMembros(serverId: string): Promise<void> {
  const servidor = client.servers.get(serverId);
  if (!servidor) return;

  try {
    const { members, users } = await servidor.fetchMembers();
    /*
      ⚠ A presença vem ANTES do registro, e a ordem é o que decide o balde:
      `registrarMembro` lê `presence.getSnapshot(userId)` para escolher entre
      online e offline, e o que não estiver semeado cai em offline.
    */
    for (const u of users) {
      presence.set(u.id, presencaDe(u.online, u.status?.presence));
    }
    for (const membro of members) registrarMembro(serverId, membro.id.user);
    membrosSujos.delete(serverId);
    publicarMembros(serverId);
  } catch {
    /* Sem permissão, sem rede, ou servidor grande demais para a rota. A coluna
       fica no estado vazio, que é o que ela já sabia fazer. */
  }
}

export function registrarServidor(
  serverId: string,
  membros: readonly string[],
): void {
  const servidor = client.servers.get(serverId);
  if (!servidor) return;

  const lista = serverIds.peek(RAIZ) ?? [];
  if (!lista.includes(serverId)) serverIds.set(RAIZ, [...lista, serverId]);

  canaisPorServidor.set(serverId, [...servidor.channelIds]);
  publicarCanais(serverId);

  for (const userId of membros) registrarMembro(serverId, userId);
  membrosSujos.delete(serverId);
  publicarMembros(serverId);
}

/** Canal de texto preferido ao entrar num servidor — voz não abre sozinha. */
export function primeiroCanalDe(serverId: string): string | undefined {
  return canaisDeTexto.peek(serverId)?.[0] ?? canaisDeVoz.peek(serverId)?.[0];
}
