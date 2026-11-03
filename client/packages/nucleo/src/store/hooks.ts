/**
 * A fronteira React do store. Nada além daqui conhece `useSyncExternalStore`.
 */
import { useMemo, useSyncExternalStore } from "react";

import type { EntityStore } from "./entities";
import { chaveDeMembro } from "../sdk/domain";

import {
  canaisDeTexto,
  categorias,
  canaisDeVoz,
  channelMessageIds,
  channels,
  conversas,
  fixadas,
  members,
  membrosOffline,
  membrosOnline,
  secoesOnline,
  messages,
  pessoas,
  presence,
  RAIZ,
  SOLICITACOES,
  relacoes,
  serverIds,
  servers,
  typing,
  vozPorCanal,
} from "../sdk/adapter";
import type {
  CategoriaDeCanais,
  ChannelSnapshot,
  ChaveDeMembro,
  MemberSnapshot,
  SecaoDeMembros,
  MessageSnapshot,
  EstadoDeVoz,
  ParticipanteDeVoz,
  PresenceStatus,
  Relacao,
  RelacaoSnapshot,
  ServerSnapshot,
  ForumSnapshot,
  TopicoSnapshot,
} from "../sdk/domain";
import {
  assinarNavegacao,
  lerCanalAtivo,
  lerLocal,
  lerServidorAtivo,
  type Local,
} from "./navegacao";
import {
  CONVERSAS,
  naoLidasDeConversas,
  TOTAIS,
  totaisNaoLidos,
  type Contagem,
} from "../sdk/adapter";
import {
  CHAVE_SIGO,
  chaveDoCanal,
  chaveDoServidor,
  foruns,
  listasDeTopicos,
  topicos,
  type Recorte,
} from "../sdk/topicos";
import { assinarColapso, estaColapsada } from "./colapso";
import { assinarFaixaDoPalco, lerFaixaRecolhida } from "./faixaDoPalco";
import {
  assinarConexao,
  lerConexao,
  lerDetalheDaConexao,
  type DetalheDaConexao,
  type EstadoDaConexao,
} from "./conexao";
import { assinarChamada, falando, lerChamada, type Chamada } from "./chamada";
import { assinarJanelaDestacada, lerJanelaDestacada } from "./janelaDestacada";
import { assinarPalco, lerPalco, type Palco } from "./palcoDeVoz";
import { assinarFalhaDeVoz, lerFalhaDeVoz, type FalhaDeVoz } from "./falhaDeVoz";
import { assinarSeletorDeTela, lerSeletorDeTela, type EstadoDoSeletor } from "./seletorDeTela";
import { chaveDeVideo, faixasDeVideo, type FonteDeVideo } from "./video";
import { assinarProntidao, lerProntidao } from "./prontidao";
import { assinarFuncoesDoServidor, servidorTemEnquetes } from "../sdk/config";
import { assinarMinutoAtual, lerMinutoAtual } from "./relogioDeEnquetes";
import {
  assinarPreferenciasDaSala,
  lerCantoDaSala,
  lerColunaDeSalas,
  lerModoDaGaveta,
  type CantoDaSala,
  type ModoDaColuna,
  type ModoDaGaveta,
} from "./preferenciasDaSala";
import {
  assinarUltimoLugar,
  lerUltimoLugar,
  type UltimoLugar,
} from "./ultimoLugar";
import { assinarIdade, idadeConfirmada } from "./idade";
import { rascunhos, RASCUNHO_VAZIO } from "./rascunhos";
import { assinarPermissoes } from "./permissoes";
import { pode, podeNoServidor, type Acao } from "../sdk/permissoes";
import {
  assinarPolitica,
  assinarRevelado,
  estaRevelado,
  lerPolitica,
  type PoliticaDeMidia,
} from "./filtroDeMidia";

const NO_IDS: readonly string[] = [];
const NO_SECOES: readonly SecaoDeMembros[] = [];
const NO_VOZ: readonly ParticipanteDeVoz[] = [];
const NO_CATEGORIAS: readonly CategoriaDeCanais[] = [];

/**
 * Assertion de dev para a armadilha nº 1 do projeto.
 *
 * `useSyncExternalStore` chama `getSnapshot` a cada render e compara por
 * `Object.is`. Se o getter alocar, cada chamada devolve referência nova, o
 * React acha que mudou, re-renderiza e chama de novo — loop infinito que se
 * manifesta como aba travando, não como erro.
 *
 * Cinco linhas que se pagam na primeira ocorrência. Some em produção.
 */
export function assertStable<T>(getSnapshot: () => T, label: string) {
  const first = getSnapshot();
  const second = getSnapshot();
  if (!Object.is(first, second)) {
    throw new Error(
      `[vortex] getSnapshot instável em ${label}: duas chamadas seguidas ` +
        `devolveram referências diferentes sem a entidade ter mudado. ` +
        `Derivação vai no adapter, nunca no getter.`,
    );
  }
}

export function useMessage(id: string): MessageSnapshot | undefined {
  const getSnapshot = () => messages.getSnapshot(id);
  if (import.meta.env.DEV) assertStable(getSnapshot, `useMessage(${id})`);
  return useSyncExternalStore(messages.subscriber(id), getSnapshot);
}

export function useChannelMessageIds(channelId: string): readonly string[] {
  const getSnapshot = () => channelMessageIds.getSnapshot(channelId) ?? NO_IDS;
  if (import.meta.env.DEV) {
    assertStable(getSnapshot, `useChannelMessageIds(${channelId})`);
  }
  return useSyncExternalStore(
    channelMessageIds.subscriber(channelId),
    getSnapshot,
  );
}

export function usePresence(userId: string): PresenceStatus {
  return useSyncExternalStore(
    presence.subscriber(userId),
    () => presence.getSnapshot(userId) ?? "offline",
  );
}

export function useTyping(channelId: string): readonly string[] {
  return useSyncExternalStore(
    typing.subscriber(channelId),
    () => typing.getSnapshot(channelId) ?? NO_IDS,
  );
}

/**
 * Rascunho do canal.
 *
 * Muda uma vez por tecla — é o valor mais quente do app. Assinado por canal, é
 * o composer que acorda e mais ninguém: a lista de mensagens não re-renderiza
 * porque alguém está escrevendo.
 */
export function useRascunho(channelId: string): string {
  const getSnapshot = () => rascunhos.getSnapshot(channelId) ?? RASCUNHO_VAZIO;
  if (import.meta.env.DEV) assertStable(getSnapshot, `useRascunho(${channelId})`);
  return useSyncExternalStore(rascunhos.subscriber(channelId), getSnapshot);
}

/* ------------------------------------------------------- colunas laterais */

export function useServerIds(): readonly string[] {
  const getSnapshot = () => serverIds.getSnapshot(RAIZ) ?? NO_IDS;
  if (import.meta.env.DEV) assertStable(getSnapshot, "useServerIds");
  return useSyncExternalStore(serverIds.subscriber(RAIZ), getSnapshot);
}

/**
 * A soma de não-lidas e menções de TODOS os servidores.
 *
 * Uma subscrição só para um número que a caixa de entrada mostra em duas abas
 * — ver `totaisNaoLidos` no adapter para por que a soma não pode morar no
 * componente.
 */
export function useTotaisNaoLidos(): Contagem {
  const getSnapshot = () => totaisNaoLidos.getSnapshot(TOTAIS) ?? SEM_TOTAIS;
  if (import.meta.env.DEV) assertStable(getSnapshot, "useTotaisNaoLidos");
  return useSyncExternalStore(totaisNaoLidos.subscriber(TOTAIS), getSnapshot);
}

/**
 * O número da entrada Conversas no rail: não-lidas de DM e grupo — ver
 * `naoLidasDeConversas` no adapter. Número e não objeto, então o snapshot já
 * é estável por valor.
 */
export function useNaoLidasDeConversas(): number {
  return useSyncExternalStore(
    naoLidasDeConversas.subscriber(CONVERSAS),
    () => naoLidasDeConversas.getSnapshot(CONVERSAS) ?? 0,
  );
}

/** Referência compartilhada — a armadilha nº 1. */
const SEM_TOTAIS: Contagem = { naoLidas: 0, mencoes: 0 };

/**
 * A soma de não-lidas e menções de UM conjunto de servidores — a pasta do rail.
 *
 * ⚠ **`useTotaisNaoLidos` não serve, e a diferença é o escopo:** ele é o rollup
 * GLOBAL que o adapter mantém para a caixa de entrada, e uma pasta precisa da
 * soma dos servidores dentro dela. Um rollup por pasta no adapter seria o
 * adapter conhecendo um conceito que só existe no cliente.
 *
 * Assina os N servidores de uma vez, e o `getSnapshot` devolve REFERÊNCIA
 * CACHEADA — é a armadilha nº 1 do briefing, e num getter que SOMA ela é mais
 * fácil de cair do que num que lê: montar `{naoLidas, mencoes}` a cada chamada
 * daria objeto novo em toda comparação e o loop de render que trava a aba.
 *
 * A chave é a string de IDs e não o array: `agrupar` monta arrays novos a cada
 * render do rail, e uma dependência por identidade recriaria a subscrição
 * inteira em toda passagem.
 */
export function useSomaDeServidores(ids: readonly string[]): Contagem {
  return useSoma(servers, ids, "useSomaDeServidores");
}

/**
 * A mesma soma, para os canais de uma categoria recolhida — D-CANAIS-35.
 *
 * ⚠ **Ela ignora canal SILENCIADO**, e essa é a única diferença em relação à
 * soma de servidores: o realce de um canal mudo já é apagado na linha dele
 * (ver `silencio.ts`), e somá-lo no cabeçalho reacenderia pela porta dos
 * fundos exatamente o que alguém pediu para calar.
 */
export function useSomaDeCanais(ids: readonly string[]): Contagem {
  return useSoma(channels, ids, "useSomaDeCanais", NAO_SILENCIADO);
}

/*
  Os dois filtros são constantes de MÓDULO, e não literais no call site.

  Uma seta escrita na chamada tem identidade nova a cada render, e ela é
  dependência do `useMemo` que monta a subscrição — o efeito seria desassinar
  e reassinar os N servidores em toda passagem do rail, sem nada quebrar e sem
  nada acusar.
*/
const TUDO = () => true;
const NAO_SILENCIADO = (c: ChannelSnapshot) => !c.silenciado;

/** Um snapshot que tem o que contar. */
type ComContagem = { readonly naoLidas: number; readonly mencoes: number };

function useSoma<T extends ComContagem>(
  fonte: EntityStore<T>,
  ids: readonly string[],
  nome: string,
  conta: (snapshot: T) => boolean = TUDO,
): Contagem {
  const chave = `${nome}:${ids.join(",")}`;

  const { subscribe, getSnapshot } = useMemo(() => {
    const lista = chave.slice(nome.length + 1).split(",").filter(Boolean);

    /* Propriedades com seta, não métodos: as duas são DESTRUTURADAS logo
       abaixo, e o lint reprova arrancar um método do objeto dono dele. */
    return {
      subscribe: (aoMudar: () => void) => {
        const soltar = lista.map((id) => fonte.subscriber(id)(aoMudar));
        return () => {
          for (const f of soltar) f();
        };
      },
      getSnapshot: (): Contagem => {
        let naoLidas = 0;
        let mencoes = 0;
        for (const id of lista) {
          const s = fonte.getSnapshot(id);
          if (!s || !conta(s)) continue;
          naoLidas += s.naoLidas;
          mencoes += s.mencoes;
        }
        const anterior = SOMAS.get(chave) ?? SEM_TOTAIS;
        if (naoLidas === anterior.naoLidas && mencoes === anterior.mencoes) {
          return anterior;
        }
        const novo = { naoLidas, mencoes };
        guardarSoma(chave, novo);
        return novo;
      },
    };
  }, [chave, nome, fonte, conta]);

  if (import.meta.env.DEV) assertStable(getSnapshot, chave);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * A referência cacheada de cada soma — a armadilha nº 1, num getter que DERIVA.
 *
 * ⚠ **Ela mora no MÓDULO, e as duas alternativas óbvias são proibidas aqui.**
 * Um `let` fechado pelo `getSnapshot` é reprovado pelo lint do compiler
 * (*"Cannot reassign variable after render completes"*), e um `useRef` também
 * (*"Cannot access refs during render"*) — e os dois estão certos: o getter é
 * chamado DURANTE o render por `useSyncExternalStore`. O que sobra é uma caixa
 * que não pertence a render nenhum.
 *
 * Chaveada por `nome:ids`, então duas pastas com os mesmos servidores
 * compartilham a entrada — o valor é o mesmo, e quem pergunta é a soma, não a
 * identidade de quem pergunta.
 *
 * ⚠ **Teto, senão é o erro nº 5 com outra roupa.** A chave muda toda vez que
 * alguém entra ou sai de um servidor, ou que um canal é criado — numa sessão
 * de 8h isso é entrada nova sem fim. O corte é grosseiro de propósito: um Map
 * de 64 números não merece um LRU.
 */
const SOMAS = new Map<string, Contagem>();
const TETO_DE_SOMAS = 64;

function guardarSoma(chave: string, valor: Contagem): void {
  if (SOMAS.size >= TETO_DE_SOMAS) SOMAS.clear();
  SOMAS.set(chave, valor);
}

export function useServer(id: string): ServerSnapshot | undefined {
  const getSnapshot = () => servers.getSnapshot(id);
  if (import.meta.env.DEV) assertStable(getSnapshot, `useServer(${id})`);
  return useSyncExternalStore(servers.subscriber(id), getSnapshot);
}

/**
 * Texto e voz assinam separado, pelo mesmo motivo dos baldes de membro: canal
 * de voz criado não republica a seção de texto, e vice-versa.
 */
/**
 * Uma categoria está colapsada?
 *
 * Assina o store inteiro e devolve um booleano — e isso é seguro justamente
 * porque é booleano: `Object.is` compara por valor, então uma categoria só
 * re-renderiza quando o PRÓPRIO estado dela muda, mesmo o store notificando
 * todas. Guardar preferência de leitura por categoria num store por chave
 * seria maquinário para dezenas de itens que mudam por clique humano.
 */
export function useColapso(categoriaId: string): boolean {
  return useSyncExternalStore(assinarColapso, () => estaColapsada(categoriaId));
}

export function useCategorias(serverId: string): readonly CategoriaDeCanais[] {
  const getSnapshot = () => categorias.getSnapshot(serverId) ?? NO_CATEGORIAS;
  if (import.meta.env.DEV) assertStable(getSnapshot, `useCategorias(${serverId})`);
  return useSyncExternalStore(categorias.subscriber(serverId), getSnapshot);
}

export function useCanaisDeTexto(serverId: string): readonly string[] {
  const getSnapshot = () => canaisDeTexto.getSnapshot(serverId) ?? NO_IDS;
  if (import.meta.env.DEV) {
    assertStable(getSnapshot, `useCanaisDeTexto(${serverId})`);
  }
  return useSyncExternalStore(canaisDeTexto.subscriber(serverId), getSnapshot);
}

/**
 * TODOS os membros do servidor — os dois baldes concatenados.
 *
 * ⚠ **Assina os DOIS stores e junta aqui**, em vez de um terceiro store com a
 * lista inteira: quem precisa dela é uma página de configuração que abre uma
 * vez, e manter um terceiro balde em dia a cada mudança de presença seria
 * pagar o custo no caminho quente para servir o frio.
 *
 * O `useMemo` é o que mantém a referência estável — sem ele, `getSnapshot`
 * devolveria array novo a cada render e o `assertStable` acusaria a armadilha
 * nº 1 com razão.
 */
export function useMembrosDoServidor(serverId: string): readonly string[] {
  const online = useMembrosOnline(serverId);
  const offline = useMembrosOffline(serverId);
  return useMemo(() => [...online, ...offline], [online, offline]);
}

export function useCanaisDeVoz(serverId: string): readonly string[] {
  const getSnapshot = () => canaisDeVoz.getSnapshot(serverId) ?? NO_IDS;
  if (import.meta.env.DEV) {
    assertStable(getSnapshot, `useCanaisDeVoz(${serverId})`);
  }
  return useSyncExternalStore(canaisDeVoz.subscriber(serverId), getSnapshot);
}

export function useChannel(id: string): ChannelSnapshot | undefined {
  const getSnapshot = () => channels.getSnapshot(id);
  if (import.meta.env.DEV) assertStable(getSnapshot, `useChannel(${id})`);
  return useSyncExternalStore(channels.subscriber(id), getSnapshot);
}

const SEPARADOR_DE_NOMES = " ";

/**
 * Os nomes de vários canais de uma vez, na ordem dos IDs. Serve a quem precisa
 * comparar irmãos (as siglas da faixa de salas). O snapshot é uma string única,
 * comparada por valor, então não aloca nem acorda sem mudança de nome.
 */
export function useNomesDosCanais(ids: readonly string[]): readonly string[] {
  const getSnapshot = () =>
    ids.map((id) => channels.getSnapshot(id)?.name ?? "").join(SEPARADOR_DE_NOMES);
  const subscribe = (aviso: () => void) => {
    const saidas = ids.map((id) => channels.subscriber(id)(aviso));
    return () => {
      for (const sair of saidas) sair();
    };
  };
  const juntos = useSyncExternalStore(subscribe, getSnapshot);
  return useMemo(() => (ids.length === 0 ? [] : juntos.split(SEPARADOR_DE_NOMES)), [juntos, ids.length]);
}

/**
 * Um membro, pela chave composta.
 *
 * O parâmetro é `ChaveDeMembro` e não `string` de propósito: apelido, cor de
 * cargo e castigo são POR SERVIDOR, e um ID de usuário sozinho não sabe de
 * qual servidor se fala. Com o tipo marcado, `useMembro(userId)` não compila —
 * sem ele, compilaria e devolveria `undefined` para sempre.
 */
export function useMembro(chave: ChaveDeMembro): MemberSnapshot | undefined {
  const getSnapshot = () => members.getSnapshot(chave);
  if (import.meta.env.DEV) assertStable(getSnapshot, `useMembro(${chave})`);
  return useSyncExternalStore(members.subscriber(chave), getSnapshot);
}

/**
 * SÓ o nome de exibição do membro: um string, comparado por valor.
 *
 * Quem precisa do nome mas não da foto assina isto e não `useMembro`: trocar o
 * avatar republica o snapshot do membro, e a linha de mensagem não pode
 * re-renderizar por causa disso (o avatar tem componente próprio).
 */
export function useNomeDoMembro(chave: ChaveDeMembro): string | undefined {
  const getSnapshot = () => members.getSnapshot(chave)?.displayName;
  return useSyncExternalStore(members.subscriber(chave), getSnapshot);
}

/** SÓ a foto do membro (URL ou ausência), pelo mesmo motivo de `useNomeDoMembro`. */
export function useAvatarDoMembro(chave: ChaveDeMembro): string | undefined {
  const getSnapshot = () => members.getSnapshot(chave)?.avatarUrl;
  return useSyncExternalStore(members.subscriber(chave), getSnapshot);
}

/**
 * A pessoa pode fazer isto neste canal, e o componente acorda se isso mudar.
 *
 * É o `pode()` com assinatura: cargo editado ou membro com cargo novo com a chamada
 * aberta ajusta a cápsula, o widget, o overlay e o diálogo de transmissão sem
 * recarregar. O snapshot é um booleano, então só re-renderiza quem teve a RESPOSTA
 * trocada. Nas linhas da lista de mensagens continua valendo o `pode()` direto: lá o
 * adapter republica os snapshots (ver `repensarPermissoes`).
 */
export function usePode(canalId: string, acao: Acao): boolean {
  return useSyncExternalStore(assinarPermissoes, () => pode(canalId, acao));
}

/** Como `usePode`, para onde não há canal. */
export function usePodeNoServidor(servidorId: string, acao: Acao): boolean {
  return useSyncExternalStore(assinarPermissoes, () => podeNoServidor(servidorId, acao));
}

/**
 * Os dois baldes assinam separado.
 *
 * Alguém ficar offline republica UM dos dois arrays na maior parte das vezes —
 * e mesmo quando republica os dois, quem re-renderiza é a member list, não as
 * linhas: elas assinam a si mesmas por ID.
 */
export function useMembrosOnline(serverId: string): readonly string[] {
  const getSnapshot = () => membrosOnline.getSnapshot(serverId) ?? NO_IDS;
  if (import.meta.env.DEV) {
    assertStable(getSnapshot, `useMembrosOnline(${serverId})`);
  }
  return useSyncExternalStore(membrosOnline.subscriber(serverId), getSnapshot);
}

/**
 * As seções de cargo do lado online.
 *
 * Assina separado dos baldes: um painel estreito que só mostra avatares não
 * renderiza seção nenhuma e não precisa acordar quando um cargo é renomeado.
 */
export function useSecoesOnline(serverId: string): readonly SecaoDeMembros[] {
  const getSnapshot = () => secoesOnline.getSnapshot(serverId) ?? NO_SECOES;
  if (import.meta.env.DEV) {
    assertStable(getSnapshot, `useSecoesOnline(${serverId})`);
  }
  return useSyncExternalStore(secoesOnline.subscriber(serverId), getSnapshot);
}

export function useMembrosOffline(serverId: string): readonly string[] {
  const getSnapshot = () => membrosOffline.getSnapshot(serverId) ?? NO_IDS;
  if (import.meta.env.DEV) {
    assertStable(getSnapshot, `useMembrosOffline(${serverId})`);
  }
  return useSyncExternalStore(membrosOffline.subscriber(serverId), getSnapshot);
}

/**
 * Quem está dentro de um canal de voz.
 *
 * Assina por CANAL: alguém entrando na sala A não acorda a linha da sala B.
 */
export function useFixadas(channelId: string): readonly string[] {
  const getSnapshot = () => fixadas.getSnapshot(channelId) ?? NO_IDS;
  if (import.meta.env.DEV) assertStable(getSnapshot, `useFixadas(${channelId})`);
  return useSyncExternalStore(fixadas.subscriber(channelId), getSnapshot);
}

export function useVozDoCanal(channelId: string): readonly ParticipanteDeVoz[] {
  const getSnapshot = () => vozPorCanal.getSnapshot(channelId) ?? NO_VOZ;
  if (import.meta.env.DEV) {
    assertStable(getSnapshot, `useVozDoCanal(${channelId})`);
  }
  return useSyncExternalStore(vozPorCanal.subscriber(channelId), getSnapshot);
}

/* ------------------------------------------------------------------ casa */

/**
 * As conversas — DMs, grupos e notas — na ordem da coluna da casa.
 *
 * Uma lista só e já ordenada por recência: a ordenação acontece na ESCRITA,
 * como os baldes de presença, e a coluna nunca chama `sort` no render.
 */
export function useConversas(): readonly string[] {
  const getSnapshot = () => conversas.getSnapshot(RAIZ) ?? NO_IDS;
  if (import.meta.env.DEV) assertStable(getSnapshot, "useConversas()");
  return useSyncExternalStore(conversas.subscriber(RAIZ), getSnapshot);
}

/**
 * A fila de solicitações de mensagem — DMs de quem não é amigo, ainda não
 * aceitas. Mesma varredura e mesmo store da coluna; ver `SOLICITACOES`.
 */
export function useSolicitacoesDeMensagem(): readonly string[] {
  const getSnapshot = () => conversas.getSnapshot(SOLICITACOES) ?? NO_IDS;
  if (import.meta.env.DEV) {
    assertStable(getSnapshot, "useSolicitacoesDeMensagem()");
  }
  return useSyncExternalStore(conversas.subscriber(SOLICITACOES), getSnapshot);
}

/**
 * Uma pessoa. Assinada por ID, como toda entidade.
 *
 * Diferente de `useMembro`: aquele é a pessoa DENTRO de um servidor (apelido,
 * cor de cargo, castigo) e este é a pessoa em si. A tela de amigos e a coluna
 * de conversas falam de gente, não de membro.
 */
export function usePessoa(userId: string): RelacaoSnapshot | undefined {
  const getSnapshot = () => pessoas.getSnapshot(userId);
  if (import.meta.env.DEV) assertStable(getSnapshot, `usePessoa(${userId})`);
  return useSyncExternalStore(pessoas.subscriber(userId), getSnapshot);
}

/**
 * Esta pessoa é minha amiga? Booleano, e a razão é escopo.
 *
 * `usePessoa` devolveria o snapshot inteiro, que carrega PRESENÇA — e presença
 * é mais da metade da carga do firehose. Quem só quer saber de amizade (o véu
 * de mídia) não pode acordar a cada piscada; comparado por valor, este só
 * re-renderiza quando a relação muda.
 */
export function useEhAmigo(userId: string): boolean {
  return useSyncExternalStore(
    pessoas.subscriber(userId),
    () => pessoas.getSnapshot(userId)?.relacao === "amigo",
  );
}

/**
 * Uma aba da tela de amigos.
 *
 * Keyed pela relação, e não uma lista só com filtro no componente: trocar de
 * aba não pode acordar as outras três, e filtrar no render refaria a varredura
 * a cada re-render.
 */
export function useRelacao(relacao: Relacao): readonly string[] {
  const getSnapshot = () => relacoes.getSnapshot(relacao) ?? NO_IDS;
  if (import.meta.env.DEV) assertStable(getSnapshot, `useRelacao(${relacao})`);
  return useSyncExternalStore(relacoes.subscriber(relacao), getSnapshot);
}

/* ------------------------------------------------------------- navegação */

/** O lugar inteiro. Quem só precisa do ID usa os dois hooks abaixo. */
export function useLocal(): Local {
  return useSyncExternalStore(assinarNavegacao, lerLocal);
}

export function useServidorAtivo(): string {
  return useSyncExternalStore(assinarNavegacao, lerServidorAtivo);
}

export function useCanalAtivo(): string {
  return useSyncExternalStore(assinarNavegacao, lerCanalAtivo);
}

/**
 * A política de mídia explícita de um servidor. Muda por ação de quem
 * administra — quase nunca —, e acorda só as mídias daquele servidor.
 */
export function usePoliticaDeMidia(serverId: string): PoliticaDeMidia {
  return useSyncExternalStore(assinarPolitica(serverId), () => lerPolitica(serverId));
}

/** Se esta aba já decidiu mostrar o anexo velado. */
export function useRevelado(anexoId: string): boolean {
  return useSyncExternalStore(assinarRevelado(anexoId), () => estaRevelado(anexoId));
}

/**
 * Se o canal é +18 e esta pessoa ainda não confirmou a idade (D-CCANAL-06).
 *
 * ⚠ **Assina um BOOLEANO do canal, e não o snapshot.** Quem chama é a coluna
 * de conteúdo, e o snapshot do canal republica a cada mensagem nova (não
 * lidas, última mensagem). Com o snapshot inteiro, a coluna acordaria sob o
 * firehose por um campo que muda uma vez na vida do canal; com o booleano, o
 * React compara `false === false` e não re-renderiza.
 */
export function useExigeConfirmacaoDeIdade(channelId: string): boolean {
  const restrito = useSyncExternalStore(
    channels.subscriber(channelId),
    () => channels.getSnapshot(channelId)?.restritoPorIdade === true,
  );
  const confirmado = useSyncExternalStore(assinarIdade, () =>
    idadeConfirmada(channelId),
  );
  return restrito && !confirmado;
}

/* ---------------------------------------------- tópicos, fórum e galeria */

/** Um tópico (ou post, ou item de galeria). `undefined` para canal que não é tópico. */
export function useTopico(id: string): TopicoSnapshot | undefined {
  const getSnapshot = () => topicos.getSnapshot(id);
  if (import.meta.env.DEV) assertStable(getSnapshot, `useTopico(${id})`);
  return useSyncExternalStore(topicos.subscriber(id), getSnapshot);
}

function useListaDeTopicos(chave: string): readonly string[] {
  const getSnapshot = () => listasDeTopicos.getSnapshot(chave) ?? NO_IDS;
  if (import.meta.env.DEV) assertStable(getSnapshot, `useListaDeTopicos(${chave})`);
  return useSyncExternalStore(listasDeTopicos.subscriber(chave), getSnapshot);
}

/** Os tópicos de um canal — os posts, num fórum; os itens, numa galeria. */
export function useTopicosDoCanal(paiId: string): readonly string[] {
  return useListaDeTopicos(chaveDoCanal(paiId));
}

export function useTopicosDoServidor(serverId: string, recorte: Recorte): readonly string[] {
  return useListaDeTopicos(chaveDoServidor(serverId, recorte));
}

/** Os tópicos que eu sigo e não estão arquivados, de todos os servidores. */
export function useTopicosQueSigo(): readonly string[] {
  return useListaDeTopicos(CHAVE_SIGO);
}

/**
 * Os tópicos seguidos, agrupados pelo canal pai — o que a coluna aninha.
 *
 * Mora aqui e não na coluna porque o agrupamento precisa LER `topicos`, e o
 * store só é conhecido desta fronteira. E o resultado é cacheado pela
 * identidade da lista: sem isso a `Categoria` e o `Canal`, que são `memo`,
 * receberiam um `Map` novo a cada render da coluna e nenhum dos dois
 * seguraria.
 *
 * Assina só a LISTA. `paiId` não muda depois que o tópico existe — o que muda
 * é quem está nela, e é ela que republica.
 */
export function useTopicosSeguidosPorPai(): ReadonlyMap<
  string,
  readonly string[]
> {
  const ids = useTopicosQueSigo();
  return useMemo(() => {
    const por = new Map<string, string[]>();
    for (const id of ids) {
      const t = topicos.getSnapshot(id);
      if (!t) continue;
      const lista = por.get(t.paiId);
      if (lista) lista.push(id);
      else por.set(t.paiId, [id]);
    }
    return por;
  }, [ids]);
}

/** `null` para canal que não é fórum nem galeria. */
export function useForum(channelId: string): ForumSnapshot | null {
  const getSnapshot = () => foruns.getSnapshot(channelId) ?? null;
  if (import.meta.env.DEV) assertStable(getSnapshot, `useForum(${channelId})`);
  return useSyncExternalStore(foruns.subscriber(channelId), getSnapshot);
}

/* ------------------------------------------------- jornada de salas (4.2) */

/** O estado da conexão com o servidor. String: estável por valor. */
export function useConexao(): EstadoDaConexao {
  return useSyncExternalStore(assinarConexao, lerConexao);
}

/** O detalhe da conexão (última sincronia). Referência cacheada no store. */
export function useDetalheDaConexao(): DetalheDaConexao {
  return useSyncExternalStore(assinarConexao, lerDetalheDaConexao);
}

/** O servidor anuncia enquetes (`features.vortex`)? Reage à configuração chegando. */
export function useTemEnquetes(): boolean {
  return useSyncExternalStore(assinarFuncoesDoServidor, servidorTemEnquetes);
}

/** O minuto atual (ms, arredondado para baixo). Um timer só para todas as linhas. */
export function useMinutoAtual(): number {
  return useSyncExternalStore(assinarMinutoAtual, lerMinutoAtual);
}

/** O `Ready` desta sessão já chegou? Antes dele a interface mostra esqueleto. */
export function useProntidao(): boolean {
  return useSyncExternalStore(assinarProntidao, lerProntidao);
}

/**
 * Em que canal de voz a pessoa está conectada (ou conectando). Vazio fora de
 * chamada. String, então só acorda quem muda de sala, nunca quem muda o mudo.
 */
export function useCanalDaChamada(): string {
  return useSyncExternalStore(assinarChamada, () => {
    const c = lerChamada();
    return c.estado === "fora" ? "" : c.channelId;
  });
}

/** O estado da chamada ("fora", "conectando", "dentro", "reconectando"). */
export function useEstadoDaChamada() {
  return useSyncExternalStore(assinarChamada, () => lerChamada().estado);
}

export function useUltimoLugar(serverId: string): UltimoLugar {
  return useSyncExternalStore(assinarUltimoLugar, () => lerUltimoLugar(serverId));
}

export function useCantoDaSala(): CantoDaSala {
  return useSyncExternalStore(assinarPreferenciasDaSala, lerCantoDaSala);
}

export function useModoDaGaveta(): ModoDaGaveta {
  return useSyncExternalStore(assinarPreferenciasDaSala, lerModoDaGaveta);
}

export function useColunaDeSalas(): ModoDaColuna {
  return useSyncExternalStore(assinarPreferenciasDaSala, lerColunaDeSalas);
}

/** Alguém dentro de uma sala, com o nome que o servidor mostra. */
export type PessoaNaSala = {
  readonly id: string;
  /** Vazio quando o membro ainda não chegou; quem desenha troca por um rótulo neutro. */
  readonly nome: string;
  /** A foto do membro, quando há (nunca a URL do avatar padrão do servidor). */
  readonly avatarUrl: string | undefined;
  readonly estado: EstadoDeVoz;
  readonly mudo: boolean;
  readonly surdo: boolean;
};

const PESSOAS_DA_SALA = new WeakMap<
  readonly ParticipanteDeVoz[],
  { readonly nomes: readonly string[]; readonly lista: readonly PessoaNaSala[] }
>();

/**
 * Quem está na sala, com nome — a lista que o item da coluna e o widget
 * desenham. Muda quando alguém entra, sai, muda de mudo/surdo/tela ou renomeia;
 * **não** muda com presença nem com fala (esses têm store próprio).
 *
 * O resultado é cacheado por referência do snapshot de voz: o getter só aloca
 * quando os nomes realmente mudaram, senão devolve o mesmo array.
 */
export function usePessoasDaSala(serverId: string, canalId: string): readonly PessoaNaSala[] {
  const voz = useVozDoCanal(canalId);
  const { subscribe, getSnapshot } = useMemo(() => {
    const chaves = voz.map((p) => chaveDeMembro(serverId, p.userId));
    return {
      subscribe: (aoMudar: () => void) => {
        const soltar = chaves.map((c) => members.subscriber(c)(aoMudar));
        return () => {
          for (const f of soltar) f();
        };
      },
      getSnapshot: (): readonly PessoaNaSala[] => {
        const membrosDaSala = chaves.map((c) => members.getSnapshot(c));
        /* Nome e foto juntos: trocar qualquer um dos dois refaz a lista. */
        const nomes = membrosDaSala.map((m) => `${m?.displayName ?? ""}${m?.avatarUrl ?? ""}`);
        const guardado = PESSOAS_DA_SALA.get(voz);
        if (guardado && guardado.nomes.every((n, i) => n === nomes[i])) return guardado.lista;
        const lista = voz.map((p, i) => ({
          id: p.userId,
          nome: membrosDaSala[i]?.displayName ?? "",
          avatarUrl: membrosDaSala[i]?.avatarUrl,
          estado: p.estado,
          mudo: p.mudo || p.mudoPeloServidor,
          surdo: p.surdo || p.surdoPeloServidor,
        }));
        PESSOAS_DA_SALA.set(voz, { nomes, lista });
        return lista;
      },
    };
  }, [voz, serverId]);

  if (import.meta.env.DEV) assertStable(getSnapshot, `usePessoasDaSala(${canalId})`);
  return useSyncExternalStore(subscribe, getSnapshot);
}

const FALANTES = new Map<string, readonly string[]>();

/**
 * Quem, entre `ids`, está falando agora. Lê o store efêmero (throttle de 120 ms
 * na fronteira), e só devolve referência nova quando o CONJUNTO muda.
 */
export function useFalantes(ids: readonly string[]): readonly string[] {
  const chave = ids.join(",");
  const { subscribe, getSnapshot } = useMemo(() => {
    const lista = chave === "" ? [] : chave.split(",");
    return {
      subscribe: (aoMudar: () => void) => {
        const soltar = lista.map((id) => falando.subscriber(id)(aoMudar));
        return () => {
          for (const f of soltar) f();
        };
      },
      getSnapshot: (): readonly string[] => {
        const agora = lista.filter((id) => falando.getSnapshot(id) === true);
        const anterior = FALANTES.get(chave) ?? NO_IDS;
        if (agora.length === anterior.length && agora.every((id, i) => id === anterior[i])) {
          return anterior;
        }
        if (FALANTES.size >= TETO_DE_SOMAS) FALANTES.clear();
        FALANTES.set(chave, agora);
        return agora;
      },
    };
  }, [chave]);

  if (import.meta.env.DEV) assertStable(getSnapshot, `useFalantes(${chave})`);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/* ------------------------------------------------------------- palco */

/** A faixa de miniaturas do palco está recolhida (preferência local)? */
export function useFaixaDoPalcoRecolhida(): boolean {
  return useSyncExternalStore(assinarFaixaDoPalco, lerFaixaRecolhida);
}

/** O que o palco de voz mostra (`fechado` = a pessoa está lendo o chat). */
export function usePalco(): Palco {
  return useSyncExternalStore(assinarPalco, lerPalco);
}

/**
 * A chamada inteira, SEM quem está falando (esse tem store próprio). Muda por
 * ação humana — alguém entra, liga a câmera —, nunca por sílaba.
 */
export function useChamada(): Chamada {
  return useSyncExternalStore(assinarChamada, lerChamada);
}

/** A falha da última tentativa de entrar numa sala, se ainda não foi dispensada. */
export function useFalhaDeVoz(): FalhaDeVoz | undefined {
  return useSyncExternalStore(assinarFalhaDeVoz, lerFalhaDeVoz);
}

/** O pedido de escolha de tela em voo (`fase: "fechado"` quando não há). */
export function useSeletorDeTela(): EstadoDoSeletor {
  return useSyncExternalStore(assinarSeletorDeTela, lerSeletorDeTela);
}

/**
 * A faixa de vídeo de uma pessoa, ou `undefined` enquanto ninguém a pediu (ou
 * ela não chegou). Quem desenha cai no avatar — comportamento certo, não bug.
 */
export function useFaixaDeVideo(userId: string, fonte: FonteDeVideo): MediaStreamTrack | undefined {
  const chave = chaveDeVideo(userId, fonte);
  return useSyncExternalStore(faixasDeVideo.subscriber(chave), () => faixasDeVideo.getSnapshot(chave));
}

/** A janela destacada da chamada, ou `undefined` quando a chamada está só no app. */
export function useJanelaDestacada(): Window | undefined {
  return useSyncExternalStore(assinarJanelaDestacada, lerJanelaDestacada);
}
