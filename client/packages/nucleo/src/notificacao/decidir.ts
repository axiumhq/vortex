import {
  chaveDaMatriz,
  type CanalDeEntrega,
  type EventoDeNotificacao,
  type Preferencias,
} from "../store/notificacoes";
import type { NivelDeNotificacao } from "../store/silencio";

/**
 * Uma mensagem que chegou, na forma que o notificador precisa — montada pelo
 * adapter, sem nada do SDK.
 */
export type MensagemRecebida = {
  readonly mensagemId: string;
  readonly channelId: string;
  readonly serverId: string | undefined;
  readonly tipoDoCanal: "dm" | "grupo" | "servidor";
  readonly autorNome: string;
  readonly canalNome: string | undefined;
  readonly servidorNome: string | undefined;
  readonly texto: string;
  readonly minha: boolean;
  /** `@você` ou resposta mencionando — a menção DIRETA. */
  readonly mencionaVoce: boolean;
  /**
   * `@everyone` ou `@online`, sem menção direta junto.
   *
   * ⚠ Separado de `mencionaVoce` porque o modal do servidor pode SUPRIMIR a
   * menção em massa; colapsados, suprimir `@everyone` suprimiria também o
   * `@você` que veio na mesma mensagem.
   */
  readonly mencionaTodos: boolean;
  /** Um cargo que você TEM foi mencionado. */
  readonly mencionaCargo: boolean;
  /**
   * A mensagem é de um TÓPICO. Só menção avisa: a mensagem comum de um tópico
   * seguido marca não lida e nada mais — nem som, nem toast, nem push, mesmo
   * que o nível do canal ou do servidor seja "todas as mensagens".
   */
  readonly ehTopico?: boolean;
  /** O canal pai do tópico — o silêncio e o nível dele valem para o tópico. */
  readonly paiId?: string;
};

export type Contexto = {
  readonly prefs: Preferencias;
  /** O nível que vale: a exceção do canal, senão o padrão do servidor. */
  readonly nivel: NivelDeNotificacao | undefined;
  /** O CANAL silenciado. */
  readonly silenciado: boolean;
  /** O SERVIDOR silenciado — elo anterior ao do canal na cadeia. */
  readonly servidorSilenciado: boolean;
  readonly suprimirTodos: boolean;
  readonly suprimirCargos: boolean;
  readonly naoPerturbe: boolean;
  readonly agora: Date;
  readonly janelaEmFoco: boolean;
  readonly vendoCanal: boolean;
};

export type Entrega = {
  readonly evento: EventoDeNotificacao;
  readonly canais: ReadonlySet<CanalDeEntrega>;
};

function minutos(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * O horário de silêncio está valendo agora?
 *
 * ⚠ **A janela atravessa a meia-noite** (22:00 → 08:00 é o padrão), e o DIA
 * que conta é o em que ela COMEÇOU: segunda às 02:00 pertence ao silêncio que
 * começou domingo à noite. Contar pelo dia de agora silenciaria a madrugada de
 * sábado para domingo com a semana marcada de segunda a sexta — e liberaria a
 * de sexta para sábado.
 */
export function emSilencioNoturno(prefs: Preferencias, agora: Date): boolean {
  if (!prefs.silencioNoturno) return false;
  const t = agora.getHours() * 60 + agora.getMinutes();
  const das = minutos(prefs.silencioDas);
  const ate = minutos(prefs.silencioAte);
  if (das === ate) return false;

  const dia = agora.getDay();
  if (das < ate) {
    return t >= das && t < ate && prefs.silencioDias.includes(dia);
  }
  if (t >= das) return prefs.silencioDias.includes(dia);
  if (t < ate) return prefs.silencioDias.includes((dia + 6) % 7);
  return false;
}

/**
 * Por onde entregar um evento que já passou pelos filtros — ou `undefined`.
 *
 * Toast é DENTRO do app e só serve com ele à frente; push é do sistema, e é o
 * caminho de quando a janela está atrás. Os dois juntos avisariam duas vezes a
 * mesma coisa.
 */
function canaisDe(
  evento: EventoDeNotificacao,
  ctx: Pick<Contexto, "prefs" | "janelaEmFoco">,
): Entrega | undefined {
  const canais = new Set<CanalDeEntrega>();
  for (const canal of ["toast", "som", "push"] as const) {
    if (!ctx.prefs.matriz.has(chaveDaMatriz(evento, canal))) continue;
    if (canal === "toast" && !ctx.janelaEmFoco) continue;
    if (canal === "push" && (ctx.janelaEmFoco || !ctx.prefs.desktop)) continue;
    canais.add(canal);
  }
  return canais.size > 0 ? { evento, canais } : undefined;
}

/**
 * Notificar, e por onde — ou `undefined` para nada.
 *
 * A ordem é a cadeia que o design escreve e a tela de notificações repete:
 * não perturbe → horário de silêncio → servidor silenciado → canal silenciado
 * → padrão do servidor → exceção do canal → matriz de eventos. Os dois últimos
 * elos chegam já resolvidos em `ctx.nivel` (ver `nivelEfetivo`).
 */
export function decidirEntrega(
  m: MensagemRecebida,
  ctx: Contexto,
): Entrega | undefined {
  if (m.minha) return undefined;
  /* Quem está olhando para o canal já está vendo a mensagem. */
  if (ctx.vendoCanal && ctx.janelaEmFoco) return undefined;
  if (ctx.naoPerturbe) return undefined;
  if (emSilencioNoturno(ctx.prefs, ctx.agora)) return undefined;
  if (ctx.servidorSilenciado && m.tipoDoCanal === "servidor") return undefined;
  if (ctx.silenciado || ctx.nivel === "nada") return undefined;

  /*
    ⚠ **Suprimir rebaixa a menção a MENSAGEM, e não a descarta.** Quem marcou
    o canal como "todas as mensagens" continua sendo avisado de um `@everyone`
    — como mensagem comum, sem o som e o push de menção. Descartar faria
    "suprimir menções em massa" calar mensagens que a pessoa pediu para ver.
  */
  const todos = m.mencionaTodos && !ctx.suprimirTodos;
  const cargo = m.mencionaCargo && !ctx.suprimirCargos;

  let evento: EventoDeNotificacao;
  if (m.tipoDoCanal !== "servidor") evento = "dm";
  else if (m.mencionaVoce || todos) evento = "mencaoDireta";
  else if (cargo) evento = "mencaoDeCargo";
  else evento = "mensagem";

  /*
    ⚠ **Mensagem comum só em canal marcado "todas as mensagens".** É o que o
    próprio evento diz na tela ("Canais com 'todas as mensagens'"). O padrão
    de canal de servidor é só menções — bipe por mensagem em servidor
    movimentado é o motivo pelo qual as pessoas desligam notificação inteira.
  */
  if (evento === "mensagem" && (m.ehTopico || ctx.nivel !== "todas")) return undefined;

  return canaisDe(evento, ctx);
}

/**
 * Um evento que não é mensagem — pedido de amizade, aceite.
 *
 * Passa pelos dois primeiros elos da cadeia (não perturbe e horário de
 * silêncio) e pela matriz. Servidor e canal não se aplicam: amizade é entre
 * pessoas, não mora em lugar nenhum.
 */
export function decidirEntregaDeEvento(
  evento: EventoDeNotificacao,
  ctx: Pick<Contexto, "prefs" | "naoPerturbe" | "agora" | "janelaEmFoco">,
): Entrega | undefined {
  if (ctx.naoPerturbe) return undefined;
  if (emSilencioNoturno(ctx.prefs, ctx.agora)) return undefined;
  return canaisDe(evento, ctx);
}

/** O que mudou numa relação, do ponto de vista de quem é avisado. */
export type MudancaDeAmizade = "pedido" | "aceite";

/**
 * A mudança de relação que merece aviso — ou `undefined`.
 *
 * ⚠ **O aceite só conta vindo de "enviado"**, e é isso que exige o estado
 * ANTERIOR. O protocolo manda `Friend` tanto quando a outra pessoa aceita o
 * seu pedido quanto quando VOCÊ aceita o dela; sem saber de onde a relação
 * veio, o app avisaria "fulano aceitou" logo depois de você clicar em aceitar.
 *
 * `Incoming` não tem essa ambiguidade: ninguém recebe um pedido por ação
 * própria.
 */
export function mudancaDeAmizade(
  anterior: string | undefined,
  atual: string,
): MudancaDeAmizade | undefined {
  if (anterior === atual) return undefined;
  if (atual === "Incoming") return "pedido";
  if (atual === "Friend" && anterior === "Outgoing") return "aceite";
  return undefined;
}

/** O texto do aviso de amizade — o do design. */
export function textoDeAmizade(
  mudanca: MudancaDeAmizade,
  nome: string,
): { titulo: string; corpo: string } {
  return {
    titulo: nome,
    corpo:
      mudanca === "pedido"
        ? "enviou um pedido de amizade"
        : "aceitou seu pedido de amizade",
  };
}

/** O que a decisão de uma chamada precisa saber. */
export type ContextoDeChamada = {
  readonly prefs: Preferencias;
  readonly naoPerturbe: boolean;
  readonly agora: Date;
  readonly janelaEmFoco: boolean;
  /** A DM ou o grupo está silenciado. */
  readonly silenciado: boolean;
  /** Quem ligou é amigo — o horário de silêncio o deixa passar. */
  readonly amigo: boolean;
};

/**
 * Anunciar uma chamada recebida, e por onde — ou `undefined` para nada.
 *
 * ⚠ **Não é a regra da mensagem, e as diferenças estão escritas na própria
 * tela de notificações.** *"Só o toast de chamada ignora tudo menos não
 * perturbe"* e, no horário de silêncio, *"suprime tudo menos chamadas de
 * amigos"*. Por isso:
 *
 * - **não perturbe** cala tudo, inclusive o aviso na tela;
 * - **o toast** ignora silêncio de canal e horário de silêncio, e ignora o
 *   FOCO — ao contrário do da mensagem. O aviso de chamada não expira em cinco
 *   segundos: ele fica até alguém decidir, e é a única forma de atender. Quem
 *   volta para a janela no meio do toque precisa encontrá-lo lá;
 * - **som e push** respeitam o canal silenciado e o horário de silêncio, com a
 *   exceção de amigo no horário.
 *
 * Vista na tela como "a pessoa escolheu não ser chamada" é o que DND é; o
 * resto é "não quero ser incomodado por barulho", que não é o mesmo que "não
 * quero saber que me ligaram".
 */
export function decidirEntregaDeChamada(
  ctx: ContextoDeChamada,
): Entrega | undefined {
  if (ctx.naoPerturbe) return undefined;

  const quieto =
    ctx.silenciado || (!ctx.amigo && emSilencioNoturno(ctx.prefs, ctx.agora));

  const canais = new Set<CanalDeEntrega>();
  for (const canal of ["toast", "som", "push"] as const) {
    if (!ctx.prefs.matriz.has(chaveDaMatriz("chamada", canal))) continue;
    if (canal !== "toast" && quieto) continue;
    if (canal === "push" && (ctx.janelaEmFoco || !ctx.prefs.desktop)) continue;
    canais.add(canal);
  }
  return canais.size > 0 ? { evento: "chamada", canais } : undefined;
}

/**
 * O lembrete de "10 minutos antes" de um evento — por onde, ou nada.
 *
 * Mesma ordem da mensagem nas partes que valem para ele: não perturbe e
 * horário de silêncio calam; a linha "Evento do servidor" da matriz decide os
 * canais. Silêncio de canal e nível NÃO entram — o lembrete é de algo em que a
 * pessoa marcou interesse, não de uma conversa que ela escolheu calar.
 */
export function decidirLembreteDeEvento(ctx: {
  readonly prefs: Preferencias;
  readonly naoPerturbe: boolean;
  readonly agora: Date;
  readonly janelaEmFoco: boolean;
}): ReadonlySet<CanalDeEntrega> {
  const canais = new Set<CanalDeEntrega>();
  if (ctx.naoPerturbe || emSilencioNoturno(ctx.prefs, ctx.agora)) return canais;
  for (const canal of ["toast", "som", "push"] as const) {
    if (!ctx.prefs.matriz.has(chaveDaMatriz("evento", canal))) continue;
    if (canal === "toast" && !ctx.janelaEmFoco) continue;
    if (canal === "push" && (ctx.janelaEmFoco || !ctx.prefs.desktop)) continue;
    canais.add(canal);
  }
  /*
    ⚠ **O padrão da matriz para evento é só "push"**, e push só sai com a
    janela ATRÁS. Com o app à frente o lembrete sumiria inteiro — então, sem
    nenhum canal de dentro do app marcado, o push vira toast. Quem desmarcou
    tudo continua sem nada: a troca só acontece se push estava pedido.
  */
  if (
    canais.size === 0 &&
    ctx.janelaEmFoco &&
    ctx.prefs.matriz.has(chaveDaMatriz("evento", "push")) &&
    !ctx.naoPerturbe
  ) {
    canais.add("toast");
  }
  return canais;
}

/** O título e o corpo, respeitando a prévia. */
export function textoDaNotificacao(
  m: MensagemRecebida,
  previa: boolean,
): { titulo: string; corpo: string } {
  const onde =
    m.tipoDoCanal === "servidor"
      ? ` em #${m.canalNome ?? "canal"}${m.servidorNome ? ` · ${m.servidorNome}` : ""}`
      : m.tipoDoCanal === "grupo" && m.canalNome
        ? ` em ${m.canalNome}`
        : "";
  const corpo = previa
    ? m.texto
        /* Menção crua é `<@01H…>`: ilegível numa notificação do sistema. */
        .replace(/<@[0-9A-Z]{26}>/g, "@menção")
        .replace(/<#[0-9A-Z]{26}>/g, "#canal")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180) || "Enviou um anexo"
    : "Nova mensagem";
  return { titulo: `${m.autorNome}${onde}`, corpo };
}
