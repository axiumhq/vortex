/**
 * As enquetes, por mensagem.
 *
 * ⚠ **A fonte deixou de ser o cliente.** Este store nasceu como store de
 * CLIENTE, escrito só pelo arnês, porque enquete não existia no protocolo
 * Stoat — e guardar voto localmente daria uma contagem que só quem votou vê.
 * O serviço `api` do fork ganhou `Message.poll`, a rota de voto, a de
 * encerrar e os eventos `MessagePollVote`/`MessagePollEnd`; quem escreve aqui
 * agora é `sdk/enquetes.ts`, traduzindo o protocolo, e o arnês continua
 * podendo semear pelo mesmo caminho.
 *
 * ⚠ **Guarda o BRUTO e publica o DERIVADO.** O protocolo manda os IDs de quem
 * votou em cada resposta, como faz com reações; a linha precisa de contagens e
 * de "em quais EU votei". Derivar no render seria o erro nº 4 do briefing com
 * enquete no lugar de markdown, então a derivação é cacheada por versão do
 * bruto e por quem sou eu — e `lerEnquete` devolve a MESMA referência até uma
 * das duas mudar.
 */

import { plural } from "../lib/plural";

/** As marcas das respostas, pela posição. São do design, não do autor. */
export const MARCAS = ["🅰", "🅱", "🅲", "🅳", "🅴", "🅵", "🅶", "🅷", "🅸", "🅹"] as const;

export type OpcaoDeEnquete = {
  readonly id: string;
  /** O glifo à esquerda — 🅰, 🅱. Pela POSIÇÃO: a ordem é a do autor. */
  readonly marca: string;
  readonly texto: string;
  readonly votos: number;
};

export type Enquete = {
  readonly pergunta: string;
  readonly opcoes: readonly OpcaoDeEnquete[];
  /** Quantas opções cabem por pessoa. 1 = "uma resposta". */
  readonly maximo: number;
  /** Em quais opções EU votei. Vazio = ainda não votei. */
  readonly meusVotos: readonly string[];
  /**
   * Quando fecha, em ms. `undefined` = já encerrada pelo autor.
   *
   * O prazo que passou sem ninguém encerrar continua aqui: quem responde "já
   * fechou?" é `estaEncerrada`, que olha o relógio na hora da pergunta — um
   * snapshot cacheado não sabe que o tempo andou.
   */
  readonly fechaEm: number | undefined;
  /**
   * Quando o autor (ou um moderador) encerrou, em ms — o `ended_at` do
   * protocolo. `undefined` enquanto aberta ou quando fechou pelo PRAZO; aí o
   * instante do fim é `fechaEm`. Um número no snapshot e não a data formatada:
   * formatar é do componente, e só para a enquete que já fechou.
   */
  readonly encerradaEm: number | undefined;
  /** Esconde a contagem até fechar — "Resultado só no fim". */
  readonly resultadoNoFim: boolean;
};

/** O que o protocolo diz, sem interpretação de quem sou eu. */
export type EnqueteBruta = {
  readonly pergunta: string;
  readonly respostas: readonly { readonly id: string; readonly texto: string }[];
  readonly maximo: number;
  readonly expiraEm: number | undefined;
  readonly encerradaEm: number | undefined;
  readonly esconder: boolean;
  /** resposta → quem votou nela. */
  readonly votos: ReadonlyMap<string, ReadonlySet<string>>;
};

type Ouvinte = () => void;

const brutas = new Map<string, EnqueteBruta>();
const derivadas = new Map<string, { base: EnqueteBruta; eu: string | undefined; valor: Enquete }>();
const ouvintes = new Set<Ouvinte>();
let eu: string | undefined;

function avisar(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

export function assinarEnquetes(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** Quem sou eu — decide `meusVotos`. O adapter avisa quando descobre. */
export function definirEuDasEnquetes(id: string | undefined): void {
  eu = id;
}

export function lerEuDasEnquetes(): string | undefined {
  return eu;
}

/** Deriva o que a linha desenha. Pura: mesmo bruto e mesmo eu, mesmo valor. */
export function derivarEnquete(b: EnqueteBruta, euId: string | undefined): Enquete {
  const meus: string[] = [];
  const opcoes = b.respostas.map((r, i) => {
    const quem = b.votos.get(r.id);
    if (euId !== undefined && quem?.has(euId)) meus.push(r.id);
    return {
      id: r.id,
      marca: MARCAS[i] ?? "•",
      texto: r.texto,
      votos: quem?.size ?? 0,
    };
  });
  return {
    pergunta: b.pergunta,
    opcoes,
    maximo: b.maximo,
    meusVotos: meus,
    fechaEm: b.encerradaEm === undefined ? b.expiraEm : undefined,
    encerradaEm: b.encerradaEm,
    resultadoNoFim: b.esconder,
  };
}

/**
 * A enquete de uma mensagem, ou `undefined`.
 *
 * Devolve a REFERÊNCIA guardada — a armadilha nº 1. Este valor entra no
 * snapshot da mensagem, e um objeto novo a cada leitura faria toda linha com
 * enquete republicar em todo ciclo.
 */
export function lerEnquete(messageId: string): Enquete | undefined {
  const base = brutas.get(messageId);
  if (!base) return undefined;
  const cache = derivadas.get(messageId);
  if (cache && cache.base === base && cache.eu === eu) return cache.valor;
  const valor = derivarEnquete(base, eu);
  derivadas.set(messageId, { base, eu, valor });
  return valor;
}

export function lerEnqueteBruta(messageId: string): EnqueteBruta | undefined {
  return brutas.get(messageId);
}

/** Escreve (ou substitui) a enquete de uma mensagem. */
export function definirEnqueteBruta(messageId: string, enquete: EnqueteBruta): void {
  brutas.set(messageId, enquete);
  avisar();
}

export function removerEnquete(messageId: string): boolean {
  derivadas.delete(messageId);
  const havia = brutas.delete(messageId);
  if (havia) avisar();
  return havia;
}

/**
 * Troca o voto de UMA pessoa. Devolve se mudou.
 *
 * É a forma do evento `MessagePollVote`: a lista SUBSTITUI o voto anterior da
 * pessoa, onde quer que ele estivesse. Aplicar o mesmo evento duas vezes — o
 * eco do próprio voto otimista, por exemplo — não muda nada.
 */
export function aplicarVoto(
  messageId: string,
  userId: string,
  respostas: readonly string[],
): boolean {
  const atual = brutas.get(messageId);
  if (!atual) return false;
  const quero = new Set(respostas);
  let mudou = false;
  const votos = new Map<string, ReadonlySet<string>>();
  for (const r of atual.respostas) {
    const antes = atual.votos.get(r.id) ?? new Set<string>();
    const tem = antes.has(userId);
    const deve = quero.has(r.id);
    if (tem === deve) {
      votos.set(r.id, antes);
      continue;
    }
    mudou = true;
    const depois = new Set(antes);
    if (deve) depois.add(userId);
    else depois.delete(userId);
    votos.set(r.id, depois);
  }
  if (!mudou) return false;
  brutas.set(messageId, { ...atual, votos });
  avisar();
  return true;
}

/** Marca como encerrada. Sem efeito se já estava. */
export function marcarEncerrada(messageId: string, quando: number): boolean {
  const atual = brutas.get(messageId);
  if (!atual || atual.encerradaEm !== undefined) return false;
  brutas.set(messageId, { ...atual, encerradaEm: quando });
  avisar();
  return true;
}

/**
 * O voto que um clique produz.
 *
 * Uma resposta só: clicar na minha retira, clicar em outra MOVE. Múltiplas:
 * clicar alterna — e, no teto, clicar numa nova não faz nada, em vez de
 * derrubar em silêncio uma escolha antiga que a pessoa não pediu para tirar.
 */
export function proximoVoto(
  meus: readonly string[],
  opcaoId: string,
  maximo: number,
): readonly string[] {
  if (meus.includes(opcaoId)) return meus.filter((m) => m !== opcaoId);
  if (maximo <= 1) return [opcaoId];
  if (meus.length >= maximo) return meus;
  return [...meus, opcaoId];
}

/** Já fechou — pelo autor ou pelo relógio. */
export function estaEncerrada(e: Enquete, agora: number): boolean {
  return e.fechaEm === undefined || e.fechaEm <= agora;
}

/**
 * A contagem por resposta está à vista? A MESMA regra decide a porcentagem na
 * linha e o "Ver votos": "resultado no fim" esconde enquanto a enquete corre e
 * eu ainda não votei. Quem votou em quê diz o mesmo que a porcentagem, com mais
 * detalhe — uma regra só impede as duas portas de discordarem.
 */
export function resultadoVisivel(e: Enquete, agora: number): boolean {
  return !e.resultadoNoFim || estaEncerrada(e, agora) || e.meusVotos.length > 0;
}

/** Quando fechou — pelo autor (`ended_at`) ou pelo prazo. `undefined` se ainda corre. */
export function instanteDoFim(e: Enquete, agora: number): number | undefined {
  if (!estaEncerrada(e, agora)) return undefined;
  return e.encerradaEm ?? e.fechaEm;
}

/** Estado limpo entre testes. O módulo é global e sobrevive. */
export function limparEnquetes(): void {
  brutas.clear();
  derivadas.clear();
  eu = undefined;
}

/** O total de votos, para o rodapé "N votos". */
export function totalDeVotos(e: Enquete): number {
  let n = 0;
  for (const o of e.opcoes) n += o.votos;
  return n;
}

/**
 * A linha da esquerda no rodapé — os três desfechos que o design escreve.
 *
 * `18 votos · você votou` · `18 votos · resultado no fim` · `18 votos`.
 *
 * ⚠ **O total aparece nos TRÊS**, e a versão anterior o trocava por "Resultado
 * só no fim". Quantas pessoas responderam não enviesa ninguém, porque não diz
 * em QUÊ — o que "resultado no fim" esconde é a porcentagem por resposta, e
 * essa continua escondida. Esconder o total junto tirava da tela a única pista
 * de que a enquete está viva.
 *
 * Função de módulo e não expressão no JSX porque é uma decisão com três ramos
 * e uma precedência (escondido ganha de votou), e jsdom não precisa de layout
 * para conferir isso.
 */
export function rodapeDaEnquete(
  total: number,
  escondido: boolean,
  votou: boolean,
): string {
  const base = plural(total, "voto", "votos");
  if (escondido) return `${base} · resultado no fim`;
  return votou ? `${base} · você votou` : base;
}

/**
 * A porcentagem de uma opção, arredondada.
 *
 * Zero votos devolve 0 e não `NaN` — divisão por zero numa enquete recém-criada
 * é o caso mais comum que existe, não a exceção.
 */
export function porcentagem(e: Enquete, opcao: OpcaoDeEnquete): number {
  const total = totalDeVotos(e);
  return total === 0 ? 0 : Math.round((opcao.votos / total) * 100);
}
