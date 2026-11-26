/**
 * Tópicos, posts de fórum e itens de galeria — os três são a MESMA coisa.
 *
 * No protocolo deste fork, um tópico é um canal de texto com `thread` (ver
 * `vortexCanal.ts`). Um post de fórum é um tópico cujo pai tem `forum`; um
 * item de galeria é um post cujo pai tem `forum.media`. Por isso há um store
 * só, e as três telas o leem com recortes diferentes.
 *
 * O que ser canal dá de graça — e é a razão do desenho do protocolo —:
 * mensagens, digitação, não-lidas, permissões e o composer. A tela de um tópico
 * aberto é a conversa de sempre com um cabeçalho diferente; nada aqui duplica
 * o store de mensagens.
 *
 * O que NÃO vem de graça, e mora aqui:
 *
 * - **as listas**, recortadas por canal pai, por servidor e por "sigo";
 * - **a contagem de mensagens** e a **abertura** de cada post, que só a
 *   listagem REST traz de uma vez;
 * - **as escritas**: criar, arquivar, seguir.
 *
 * ⚠ **Ordenar é `n log n`, e só acontece quando alguém OLHA.** As listas são
 * recalculadas quando um tópico muda E há assinante — é a regra que a coluna
 * de conversas estabeleceu. Sob o firehose as mensagens caem em canais que não
 * são tópico, e o registro devolve antes de chegar aqui.
 */
import { decodeTime } from "ulid";

import { client } from "./client";
import { urlDeAnexo } from "./anexos";
import { usuarioLocalId } from "./adapter";
import { motivoDoErro } from "./erros";
import { toast } from "../ui-logica/toastStore";
import { createEntityStore } from "../store/entities";
import {
  anotarCanais,
  assinarMetaDeCanal,
  escreverTopico,
  lerAbertura,
  lerContagem,
  lerForum,
  lerTopico,
  semearListagem,
  topicosConhecidos,
  type MetaDeForum,
  type MetaDeTopico,
} from "./vortexCanal";
import type { AberturaDePost, TopicoSnapshot } from "./domain";

/* ------------------------------------------------------------- derivação */

/**
 * O snapshot de um tópico, a partir do registro.
 *
 * `meuId` entra por parâmetro para a derivação ser pura e testável sem sessão.
 */
export function derivarTopico(
  id: string,
  meta: MetaDeTopico,
  contagem: number | undefined,
  abertura: AberturaDePost | undefined,
  meuId: string | undefined,
): TopicoSnapshot {
  return {
    id,
    nome: meta.nome,
    paiId: meta.paiId,
    serverId: meta.serverId,
    donoId: meta.donoId,
    aberturaId: meta.aberturaId,
    arquivado: meta.arquivado,
    fixado: meta.fixado,
    emAnalise: meta.emAnalise,
    tags: meta.tags,
    seguidores: meta.seguidores,
    seguindo: meuId !== undefined && meta.seguidores.includes(meuId),
    /*
      A contagem do protocolo inclui a PRIMEIRA mensagem num post — que é o
      corpo dele, não uma resposta. Num tópico de mensagem a abertura mora no
      pai, então tudo lá dentro é resposta.
    */
    respostas:
      contagem === undefined
        ? undefined
        : Math.max(0, contagem - (abertura !== undefined && abertura.noTopico ? 1 : 0)),
    ultimaEm: decodeTime(meta.ultimaMensagemId ?? id),
    ultimoAutorId: meta.ultimoAutorId,
    abertura,
  };
}

export type Recorte = "ativos" | "seguindo" | "arquivados";

/**
 * Os IDs de cada lista, já ordenados por última atividade.
 *
 * Um recorte por chave em vez de filtrar no componente: filtrar lá exigiria
 * ler o snapshot de cada tópico para decidir se ele entra, ou seja, um hook
 * por item antes de saber quantos itens há.
 */
export function derivarListas(
  todos: readonly TopicoSnapshot[],
): Map<string, readonly string[]> {
  const ordenados = [...todos].sort((a, b) => b.ultimaEm - a.ultimaEm || (a.id < b.id ? 1 : -1));
  const listas = new Map<string, string[]>();
  const por = (chave: string, id: string) => {
    let l = listas.get(chave);
    if (!l) listas.set(chave, (l = []));
    l.push(id);
  };
  for (const t of ordenados) {
    // O canal pai mostra TUDO: o post fechado continua legível no fórum.
    por(chaveDoCanal(t.paiId), t.id);
    const servidor = t.serverId ?? "";
    if (t.arquivado) {
      por(chaveDoServidor(servidor, "arquivados"), t.id);
    } else {
      por(chaveDoServidor(servidor, "ativos"), t.id);
      if (t.seguindo) {
        por(chaveDoServidor(servidor, "seguindo"), t.id);
        por(CHAVE_SIGO, t.id);
      }
    }
  }
  return listas;
}

export const chaveDoCanal = (paiId: string) => `canal:${paiId}`;
export const chaveDoServidor = (serverId: string, recorte: Recorte) =>
  `servidor:${serverId}:${recorte}`;
/** Os tópicos que eu sigo, de todos os servidores — a aba da caixa de entrada. */
export const CHAVE_SIGO = "sigo";

/* ---------------------------------------------------------------- stores */

const NADA: readonly string[] = [];

export const topicos = createEntityStore<TopicoSnapshot>((id) => {
  if (topicos.peek(id) === undefined) republicar([id]);
});

/**
 * As listas. `onFirstSubscribe` recalcula tudo: é o momento em que a ordem
 * passa a ser observável, e também o que corrige o "sigo" de uma listagem que
 * chegou antes de a sessão saber quem eu sou.
 */
export const listasDeTopicos = createEntityStore<readonly string[]>(() => {
  republicar(undefined);
});

export const foruns = createEntityStore<MetaDeForum | null>((id) => {
  if (foruns.peek(id) === undefined) foruns.set(id, lerForum(id) ?? null);
});

/**
 * Índice mensagem -> tópico, uma entidade por `messageId` (lei nº 1).
 *
 * `string` = ID do tópico aberto sobre a mensagem; `null` = já teve e deixou
 * de ter (apagado, ou a mensagem trocou de tópico) — o snapshot FICA, como em
 * toda entity store, e `null` é o que acorda quem assinava. Ausente = nunca
 * soube. Só entram tópicos de MENSAGEM: a abertura de um post de fórum mora
 * dentro dele, e não é "uma mensagem com tópico".
 *
 * Alimentado por `republicar`, que roda em toda mudança de meta (criar,
 * atualizar, apagar) — com ou sem assinante, porque o índice precisa estar
 * pronto antes de a primeira linha perguntar.
 */
export const topicoPorMensagem = createEntityStore<string | null>();
/** Reverso: qual mensagem cada tópico indexa — para desindexar sem varrer. */
const mensagemDoTopico = new Map<string, string>();

function indexar(topicoId: string, meta: MetaDeTopico | undefined): void {
  const alvo =
    meta !== undefined && meta.aberturaId !== undefined && lerForum(meta.paiId) === undefined
      ? meta.aberturaId
      : undefined;
  const atual = mensagemDoTopico.get(topicoId);
  if (atual === alvo) return;
  if (atual !== undefined) {
    mensagemDoTopico.delete(topicoId);
    // Só solta se a mensagem ainda aponta para ESTE tópico.
    if (topicoPorMensagem.peek(atual) === topicoId) topicoPorMensagem.set(atual, null);
  }
  if (alvo !== undefined) {
    mensagemDoTopico.set(topicoId, alvo);
    topicoPorMensagem.set(alvo, topicoId);
  }
}

/** Só para testes. */
export function limparIndiceDeTopicos(): void {
  for (const msg of mensagemDoTopico.values()) topicoPorMensagem.set(msg, null);
  mensagemDoTopico.clear();
}

function paiEhForum(id: string): boolean {
  const meta = lerTopico(id);
  return meta !== undefined && lerForum(meta.paiId) !== undefined;
}

function aberturaDe(id: string): AberturaDePost | undefined {
  const crua = lerAbertura(id);
  if (!crua) return undefined;
  const anterior = topicos.peek(id)?.abertura;
  if (
    anterior &&
    anterior.id === crua.id &&
    anterior.texto === crua.texto &&
    anterior.reacao?.emoji === crua.reacao?.emoji &&
    anterior.reacao?.total === crua.reacao?.total
  ) {
    return anterior;
  }
  const m = crua.midia;
  return {
    id: crua.id,
    autorId: crua.autorId,
    texto: crua.texto,
    /*
      Se a abertura mora DENTRO do tópico. O protocolo não guarda a
      distinção, e ela sai do pai: pai com `forum` só tem posts, que abrem com
      mensagem de dentro; pai sem `forum` só tem tópicos de mensagem, que
      abrem no pai.
    */
    noTopico: paiEhForum(id),
    midia: m
      ? {
          url: urlDeAnexo(m.tag, m.id),
          nome: m.nome,
          tipo: m.tipo,
          largura: m.largura,
          altura: m.altura,
          spoiler: m.spoiler,
          tamanho: m.tamanho,
        }
      : undefined,
    reacao: crua.reacao,
  };
}

/**
 * Republica os tópicos que mudaram e as listas.
 *
 * `undefined` = tudo (primeira assinatura de lista).
 */
function republicar(ids: readonly string[] | undefined): void {
  const meuId = usuarioLocalId();
  const alvos = ids ?? [...topicosConhecidos()].map(([id]) => id);
  const paisTocados = new Set<string>();
  for (const id of alvos) {
    const meta = lerTopico(id);
    indexar(id, meta);
    if (!meta) continue;
    topicos.set(id, derivarTopico(id, meta, lerContagem(id), aberturaDe(id), meuId));
    paisTocados.add(chaveDoCanal(meta.paiId));
  }

  // Sem ninguém olhando lista nenhuma, ordenar é trabalho para o lixo.
  if (listasDeTopicos.assinados().length === 0) return;
  const todos: TopicoSnapshot[] = [];
  for (const [id] of topicosConhecidos()) {
    const s = topicos.peek(id);
    if (s) todos.push(s);
  }
  const novas = derivarListas(todos);
  for (const chave of listasDeTopicos.assinados()) {
    const nova = novas.get(chave) ?? NADA;
    const atual = listasDeTopicos.peek(chave);
    /*
      A lista de um CANAL troca de referência mesmo com os mesmos IDs quando
      um post dela mudou: a tela do fórum recorta por título, tag e fixado
      lendo os snapshots, e com a referência igual ela não re-renderiza —
      retagar um post com o filtro daquela tag ligado o deixaria na tela.
      As listas de servidor não recortam nada, e seguem só por ordem.
    */
    if (atual !== undefined && mesmos(atual, nova) && !(ids && paisTocados.has(chave))) continue;
    listasDeTopicos.set(chave, nova);
  }
}

function mesmos(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

assinarMetaDeCanal((ids) => {
  // Fórum mudou (tags, ou deixou de ser fórum) — só quem já é assinado.
  for (const id of ids) {
    if (foruns.subscriberCount(id) > 0 || foruns.peek(id) !== undefined) {
      const f = lerForum(id) ?? null;
      if (foruns.peek(id) !== f) foruns.set(id, f);
    }
  }
  republicar(ids.filter((id) => lerTopico(id) !== undefined || topicos.peek(id) !== undefined));
});

/* --------------------------------------------------------------- escritas */

type CanalCru = { _id: string };

/**
 * Hidrata o canal no SDK e anota o que só o Vortex conhece.
 *
 * As duas coisas, sempre juntas: sem hidratar, mensagens e composer não
 * encontram o canal; sem anotar, a tela não sabe que ele é tópico.
 */
function receberCanal(cru: CanalCru): void {
  client.channels.getOrCreate(cru._id, cru as never);
  anotarCanais([cru]);
}

/**
 * Abre um tópico — a partir de uma mensagem, do canal, ou como post.
 *
 * Abrir de novo sobre a mesma mensagem devolve o tópico que já existe: é o
 * servidor que garante, e o cliente não precisa procurar antes.
 */
export async function criarTopico(
  paiId: string,
  nome: string,
  opcoes: { mensagemId?: string; tags?: readonly string[] } = {},
): Promise<string | undefined> {
  try {
    const cru = (await client.api.post(
      `/channels/${paiId}/threads` as never,
      {
        name: nome,
        ...(opcoes.mensagemId ? { message: opcoes.mensagemId } : {}),
        tags: opcoes.tags ?? [],
      } as never,
    )) as CanalCru;
    receberCanal(cru);
    return cru._id;
  } catch (e) {
    toast({ tipo: "erro", titulo: "Não deu para abrir o tópico.", descricao: motivoDoErro(e) });
    return undefined;
  }
}

/**
 * Um nome de tópico a partir do texto de uma mensagem.
 *
 * O protocolo exige de 1 a 100 caracteres. Mensagem só com anexo não tem texto
 * — o nome vira "Tópico", que é verdade e não inventa assunto.
 */
export function nomeDeTopicoDe(texto: string): string {
  /*
    O texto CRU da mensagem, e não o que a linha mostra: menção é
    `<@01JQ…>` e título é `## …`. Um nome de tópico com o ID de alguém dentro
    não diz assunto nenhum — a menção sai, e a pontuação de markdown também,
    que no nome seria só ruído (o nome não é renderizado como markdown).
  */
  const limpo = texto
    .replace(/<[@#%:][^>\s]+>/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~`|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (limpo === "") return "Tópico";
  return limpo.length <= 60 ? limpo : `${limpo.slice(0, 59).trimEnd()}…`;
}

export async function arquivarTopico(id: string, arquivado: boolean): Promise<boolean> {
  const antes = lerTopico(id);
  if (antes) escreverTopico(id, { ...antes, arquivado });
  try {
    const cru = (await client.api.patch(
      `/channels/${id}/thread` as never,
      { archived: arquivado } as never,
    )) as unknown as CanalCru;
    anotarCanais([cru]);
    return true;
  } catch (e) {
    if (antes) escreverTopico(id, antes);
    toast({
      tipo: "erro",
      titulo: arquivado ? "Não deu para arquivar o tópico." : "Não deu para reabrir o tópico.",
      descricao: motivoDoErro(e),
    });
    return false;
  }
}

/**
 * Fixa (ou solta) um post no topo do fórum.
 *
 * Otimista como arquivar: o card sobe na hora, e volta se o servidor recusar
 * — o que acontece sem `ManageMessages`, porque fixar ordena o fórum de todo
 * mundo e ter aberto o post não basta.
 */
export async function fixarPost(id: string, fixado: boolean): Promise<boolean> {
  const antes = lerTopico(id);
  if (antes) escreverTopico(id, { ...antes, fixado });
  try {
    const cru = (await client.api.patch(
      `/channels/${id}/thread` as never,
      { pinned: fixado } as never,
    )) as unknown as CanalCru;
    anotarCanais([cru]);
    return true;
  } catch (e) {
    if (antes) escreverTopico(id, antes);
    toast({
      tipo: "erro",
      titulo: fixado ? "Não deu para fixar o post." : "Não deu para soltar o post.",
      descricao: motivoDoErro(e),
    });
    return false;
  }
}

/**
 * Marca (ou desmarca) um post como "em análise" — D-CANAIS-09.
 *
 * Mesma régua de fixar, e pela mesma razão: o selo diz algo a TODO mundo que
 * abre o fórum, então é moderação (`ManageMessages` no pai), não do autor.
 */
export async function marcarEmAnalise(id: string, emAnalise: boolean): Promise<boolean> {
  const antes = lerTopico(id);
  if (antes) escreverTopico(id, { ...antes, emAnalise });
  try {
    const cru = (await client.api.patch(
      `/channels/${id}/thread` as never,
      { in_review: emAnalise } as never,
    )) as unknown as CanalCru;
    anotarCanais([cru]);
    return true;
  } catch (e) {
    if (antes) escreverTopico(id, antes);
    toast({
      tipo: "erro",
      titulo: emAnalise ? "Não deu para marcar o post em análise." : "Não deu para tirar o post de análise.",
      descricao: motivoDoErro(e),
    });
    return false;
  }
}

export async function seguirTopico(id: string, seguir: boolean): Promise<boolean> {
  const antes = lerTopico(id);
  const eu = usuarioLocalId();
  if (antes && eu) {
    const seguidores = seguir
      ? antes.seguidores.includes(eu)
        ? antes.seguidores
        : [...antes.seguidores, eu]
      : antes.seguidores.filter((x) => x !== eu);
    escreverTopico(id, { ...antes, seguidores });
  }
  try {
    if (seguir) await client.api.put(`/channels/${id}/follow` as never);
    else await client.api.delete(`/channels/${id}/follow` as never);
    return true;
  } catch (e) {
    if (antes) escreverTopico(id, antes);
    toast({
      tipo: "erro",
      titulo: seguir ? "Não deu para seguir o tópico." : "Não deu para deixar de seguir.",
      descricao: motivoDoErro(e),
    });
    return false;
  }
}

/**
 * Busca os tópicos de um servidor — ativos por padrão, ou os arquivados.
 *
 * Os ativos já chegam no `Ready`; esta chamada existe pelo que o `Ready` não
 * traz: contagem de mensagens, a abertura de cada post e os ARQUIVADOS, que
 * nunca viajam com a sessão.
 */
export async function carregarTopicos(
  serverId: string,
  opcoes: { canal?: string; arquivados?: boolean } = {},
): Promise<boolean> {
  const q = new URLSearchParams();
  if (opcoes.canal) q.set("channel", opcoes.canal);
  if (opcoes.arquivados) q.set("archived", "true");
  try {
    const r = (await client.api.get(
      `/servers/${serverId}/threads${q.size > 0 ? `?${q.toString()}` : ""}` as never,
    )) as unknown as {
      threads?: CanalCru[];
      messages?: unknown[];
      users?: { _id: string }[];
      message_counts?: Record<string, number>;
    };
    for (const u of r.users ?? []) client.users.getOrCreate(u._id, u as never);
    for (const t of r.threads ?? []) client.channels.getOrCreate(t._id, t as never);
    anotarCanais(r.threads ?? []);
    semearListagem(r.message_counts ?? {}, r.messages ?? []);
    return true;
  } catch {
    // Sem rede a tela continua com o que o `Ready` trouxe — silêncio aqui é
    // degradação, não mentira: nada é afirmado que não se saiba.
    return false;
  }
}

/* ----------------------------------------------------------- consultas */

/**
 * Se dá para abrir um tópico neste canal.
 *
 * Espelha o que `POST /channels/:id/threads` aceita: canal de texto de
 * servidor, que não é sala de voz, não é tópico (tópico não tem tópico) e não
 * é fórum — no fórum, cada assunto já É um post. Sem isto o botão existiria
 * numa DM e o servidor responderia `InvalidOperation`.
 *
 * Leitura síncrona, sem assinar: quem chama é a linha de mensagem, e ela
 * republica quando o snapshot do canal muda — como `pode()`.
 */
export function podeAbrirTopico(channelId: string): boolean {
  const canal = client.channels.get(channelId);
  if (!canal || canal.type !== "TextChannel" || canal.isVoice) return false;
  return lerTopico(channelId) === undefined && lerForum(channelId) === undefined;
}

/** O tópico já aberto sobre esta mensagem, se houver. O(1) pelo índice. */
export function topicoDaMensagem(channelId: string, messageId: string): string | undefined {
  const id = topicoPorMensagem.peek(messageId);
  if (id === undefined || id === null) return undefined;
  return lerTopico(id)?.paiId === channelId ? id : undefined;
}

/**
 * Carrega os tópicos ATIVOS e ARQUIVADOS de um canal, uma vez por canal.
 *
 * O `Ready` só traz ativos: sem os arquivados, a mensagem que abriu um tópico
 * há meses perde a referência a ele. Cache por canal (a promessa, então
 * chamadas concorrentes dividem a mesma ida à rede); falha limpa a entrada
 * para a próxima abertura tentar de novo.
 */
const carregadosDoCanal = new Map<string, Promise<boolean>>();

export function carregarTopicosDoCanal(canalId: string): Promise<boolean> {
  const feito = carregadosDoCanal.get(canalId);
  if (feito) return feito;
  const serverId = client.channels.get(canalId)?.serverId;
  if (serverId === undefined) return Promise.resolve(false);
  const p = Promise.all([
    carregarTopicos(serverId, { canal: canalId }),
    carregarTopicos(serverId, { canal: canalId, arquivados: true }),
  ]).then(([a, b]) => {
    const ok = a && b;
    if (!ok) carregadosDoCanal.delete(canalId);
    return ok;
  });
  carregadosDoCanal.set(canalId, p);
  return p;
}

/** Só para testes e para o fim da sessão. */
export function limparTopicosCarregados(): void {
  carregadosDoCanal.clear();
}
