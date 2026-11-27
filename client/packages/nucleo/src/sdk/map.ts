/**
 * SDK → domínio. A única tradução do projeto.
 *
 * Tudo o que o resto do app enxerga passa por aqui. Derivação acontece nesta
 * escrita — uma vez, quando a entidade muda — e nunca no `getSnapshot`.
 */
import { decodeTime } from "ulid";

import { duracaoCurta } from "../lib/duracao";
import { BIT_VER_CANAL } from "./bits";


import type {
  Channel,
  CallStartedSystemMessage,
  ChannelEditSystemMessage,
  ChannelOwnershipChangeSystemMessage,
  MessagePinnedSystemMessage,
  ChannelRenamedSystemMessage,
  Message,
  Server,
  ServerMember,
  TextSystemMessage,
  User,
  UserModeratedSystemMessage,
  UserSystemMessage,
} from "stoat.js";

import { analisar } from "../markdown/analisar";
import { traduzirEmbeds } from "./traduzirEmbeds";
import { conviteNoTexto } from "./conviteNoTexto";
import type { Layout } from "./agrupamento";
import type {
  CanalTipo,
  ChannelSnapshot,
  MemberSnapshot,
  AnexoSnapshot,
  MessageSnapshot,
  PresenceStatus,
  SendState,
  ReacaoSnapshot,
  Relacao,
  RelacaoSnapshot,
  ServerSnapshot,
  SistemaSnapshot,
} from "./domain";
import { NOMES_POR_REACAO } from "./domain";
import type { Enquete } from "../store/enquetes";
import { figurinhaDaMensagem } from "./figurinhasDeMensagem";
import { formatarBytes } from "../lib/bytes";
import { sigla } from "../lib/sigla";
import { camposDe, superficie } from "./superficieVortex";
import { linhaDeSala } from "./eventosDaSala";
import { lerEntrada } from "./entradasNoTopico";
import { lerConfigDeVoz } from "./vozDoCanal";

/**
 * `reactions` chega como ReactiveMap<emoji, ReactiveSet<userId>>. Achatar aqui
 * é deliberado: o componente recebe contagem pronta e não itera Set no render.
 */
function flattenReactions(
  message: Message,
  euId: string | undefined,
): readonly ReacaoSnapshot[] {
  const out: ReacaoSnapshot[] = [];
  for (const [emoji, users] of message.reactions) {
    // Reação sem ninguém não é reação: o SDK pode deixar a chave com Set
    // vazio depois da última remoção, e um chip com "0" seria pior que nada.
    if (users.size === 0) continue;
    out.push({
      emoji,
      total: users.size,
      minha: euId !== undefined && users.has(euId),
      /*
        Uma AMOSTRA, com teto — ver `ReacaoSnapshot.quem`.

        O laço para no teto em vez de `[...users].slice()`: espalhar o Set
        inteiro para descartar quase tudo é alocação proporcional à contagem,
        numa função que roda de novo a cada layout, envio, permissão e reação.
      */
      quem: primeiros(users, NOMES_POR_REACAO),
    });
  }
  return out.length === 0 ? SEM_REACOES : out;
}

/** Referência compartilhada: a maioria das mensagens não tem reação nenhuma. */
const SEM_REACOES: readonly ReacaoSnapshot[] = [];

/** Os `n` primeiros de um Set, sem materializar o resto. */
function primeiros(users: ReadonlySet<string>, n: number): readonly string[] {
  const out: string[] = [];
  for (const id of users) {
    out.push(id);
    if (out.length === n) break;
  }
  return out;
}

// Um formatter por sessão, não um por chamada — criar Intl.DateTimeFormat é
// caro; usar é barato.
/**
 * Um array vazio COMPARTILHADO.
 *
 * `?? []` alocaria um array novo a cada tradução, e o snapshot precisa ser
 * comparável por referência — é a armadilha nº 1 do briefing, na sua forma
 * mais fácil de escrever sem perceber.
 */
const VAZIO: readonly string[] = [];

const HORA = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * Sem segundos, para a coluna de hora do modo compacto.
 *
 * A coluna tem 40px de largura fixa — `14:02:35` em mono não cabe, e um
 * timestamp truncado com reticências é pior que um sem segundos. O modo
 * confortável continua com a hora cheia: lá ela mora numa linha de cabeçalho
 * onde há espaço, e o segundo às vezes decide qual de duas mensagens veio
 * antes.
 */
const HORA_CURTA = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * SDK → domínio, para linha de sistema.
 *
 * As cinco estruturadas cobrem o que um servidor produz o dia inteiro. O resto
 * cai em `texto`, com rótulo em português — e o `type` cru no fim é a última
 * defesa, para um tipo novo do upstream aparecer como algo em vez de nada.
 */
/*
  Exportada só para teste, e a companhia justifica: `toPresence`,
  `presencaDe` e `ehCanalDeVoz` já saem daqui pela mesma razão — são
  traduções PURAS, e o caminho alternativo seria montar um `Message`
  inteiro para exercer um `switch`.
*/
const TIPO_NAO_SUPORTADO = /^[a-z_]+ is not supported\.$/;

export function toSistema(message: Message): SistemaSnapshot | undefined {
  /* Entrou/saiu/moveu na sala de voz: linha LOCAL, o fato mora no registro. */
  const daSala = linhaDeSala(message.id);
  if (daSala !== undefined) return daSala;
  /* Entrou no tópico: linha LOCAL também — ver `sdk/entradasNoTopico.ts`. */
  const noTopico = lerEntrada(message.id);
  if (noTopico !== undefined) return noTopico;
  const sm = message.systemMessage;
  if (!sm) return undefined;

  switch (sm.type) {
    case "user_joined":
      return { tipo: "entrou", userId: (sm as UserSystemMessage).userId };
    case "user_left":
      return { tipo: "saiu", userId: (sm as UserSystemMessage).userId };
    case "user_added":
      return {
        tipo: "adicionou",
        userId: (sm as UserModeratedSystemMessage).userId,
        porId: (sm as UserModeratedSystemMessage).byId,
      };
    case "user_remove":
      return {
        tipo: "removeu",
        userId: (sm as UserModeratedSystemMessage).userId,
        porId: (sm as UserModeratedSystemMessage).byId,
      };
    case "channel_renamed":
      return {
        tipo: "renomeou",
        porId: (sm as ChannelRenamedSystemMessage).byId,
        nome: (sm as ChannelRenamedSystemMessage).name,
      };
    case "call_started": {
      const chamada = sm as CallStartedSystemMessage;
      return {
        tipo: "chamada",
        porId: chamada.byId,
        /*
          `finishedAt` nulo é a chamada AINDA DE PÉ, e é o dado mais útil da
          linha: é ele que decide se cabe um "entrar". Já formatado aqui
          porque a tradução é o lugar de derivar — ver `createdAtText`.
        */
        duracaoTexto:
          chamada.finishedAt === null
            ? undefined
            : duracaoCurta(
                chamada.finishedAt.getTime() - chamada.startedAt.getTime(),
              ),
      };
    }
    case "user_kicked":
      return { tipo: "expulso", userId: (sm as UserSystemMessage).userId };
    case "user_banned":
      return { tipo: "banido", userId: (sm as UserSystemMessage).userId };
    case "message_pinned":
      return { tipo: "fixou", porId: (sm as MessagePinnedSystemMessage).byId };
    case "message_unpinned":
      return { tipo: "desafixou", porId: (sm as MessagePinnedSystemMessage).byId };
    case "channel_description_changed":
      return { tipo: "mudouDescricao", porId: (sm as ChannelEditSystemMessage).byId };
    case "channel_icon_changed":
      return { tipo: "mudouIcone", porId: (sm as ChannelEditSystemMessage).byId };
    case "channel_ownership_changed":
      return {
        tipo: "transferiu",
        deId: (sm as ChannelOwnershipChangeSystemMessage).fromId,
        paraId: (sm as ChannelOwnershipChangeSystemMessage).toId,
      };
    case "text": {
      const texto = (sm as TextSystemMessage).content;
      /*
        O SDK converte tipo que não conhece em `text` com "<tipo> is not
        supported." — frase em inglês com o nome do protocolo. Não é texto de
        ninguém: é o nosso "desconhecido".
      */
      return TIPO_NAO_SUPORTADO.test(texto) ? { tipo: "desconhecido" } : { tipo: "texto", texto };
    }
    default:
      return { tipo: "desconhecido" };
  }
}

/**
 * O layout e o estado de envio entram por parâmetro, não são calculados aqui.
 *
 * Este módulo traduz UMA entidade e não conhece vizinho nem histórico de
 * envio — quem sabe a ordem da lista e o que já chegou no servidor é o
 * adapter. Passar os dois de fora mantém a tradução pura e deixa as únicas
 * partes que dependem de contexto num lugar só.
 */
const SEM_ANEXOS: readonly AnexoSnapshot[] = [];

/**
 * Os anexos, reduzidos ao que a linha precisa.
 *
 * A dimensão é o que importa aqui e é o que o protocolo dá: `Metadata` carrega
 * `width` e `height` para imagem e vídeo. Sem eles a linha só descobre a
 * altura quando o arquivo carrega — e aí ela já foi medida com a altura
 * errada, num container ancorado.
 *
 * `type` do protocolo tem cinco valores e o app tem três. "Text" e "Audio"
 * caem em `arquivo` porque a interface faz com eles a mesma coisa: uma caixa
 * de altura fixa com nome e tamanho. Colapsar aqui é o trabalho da camada
 * anticorrupção — o componente não deve conhecer cinco casos para desenhar
 * três.
 */

function toAnexos(message: Message): readonly AnexoSnapshot[] {
  const arquivos = message.attachments;
  if (!arquivos || arquivos.length === 0) return SEM_ANEXOS;

  return arquivos.map((f) => {
    const m = f.metadata;
    const dimensionado = m.type === "Image" || m.type === "Video";
    return {
      id: f.id,
      nome: f.filename ?? f.id,
      // `originalUrl` e não `previewUrl`: a miniatura é decisão de
      // apresentação, e ela entra quando houver servidor para servi-la.
      url: f.originalUrl,
      tipo:
        m.type === "Image"
          ? "imagem"
          : m.type === "Video"
            ? "video"
            : m.type === "Audio"
              ? "audio"
              : "arquivo",
      largura: dimensionado ? m.width : undefined,
      altura: dimensionado ? m.height : undefined,
      tamanhoTexto: formatarBytes(f.size),
    } as const;
  });
}

export function toMessageSnapshot(
  message: Message,
  layout: Layout,
  sendState: SendState,
  /** Quem sou eu — para saber quais reações são minhas. Vem de fora, como tudo. */
  euId: string | undefined,
  /** A enquete — o `stoat.js` a descarta na hidratação; vem de `store/enquetes.ts`. */
  enquete: Enquete | undefined,
): MessageSnapshot {
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.authorId,
    content: message.content,
    /*
      Analisado UMA VEZ por CONTEÚDO — nunca no render, e nunca de novo aqui.

      Esta função não roda uma vez por mensagem: ela roda de novo a cada
      mudança de layout, de estado de envio, de permissão e a cada reação, para
      toda linha assinada. Analisar markdown aqui dentro sem cache seria o erro
      nº 4 do briefing mudado de lugar, e ele degrada exatamente onde dói —
      quando a presença começa a piscar.

      O cache mora em `markdown/analisar.ts`, chaveado pelo texto: mensagem
      editada troca de chave sozinha, e "ok" digitado por trinta pessoas divide
      uma árvore só.
    */
    /*
      A pergunta da enquete chega TAMBÉM no `content` — é o que um cliente sem
      enquete mostra (ver `sdk/enquetes.ts`). Aqui a caixa da enquete já diz a
      pergunta, e repeti-la como parágrafo em cima seria a mesma frase duas
      vezes. Só quando é IGUAL: texto a mais escrito pelo autor continua.
    */
    blocos: analisar(
      enquete !== undefined && message.content.trim() === enquete.pergunta
        ? ""
        : message.content,
    ),
    anexos: toAnexos(message),
    /* O embed de convite (D-EVT-40). Ver `conviteNoTexto` para por que o
       reconhecimento é estreito: o cartão traz um botão que muda de servidor. */
    conviteCodigo: conviteNoTexto(message.content),
    /** Menciona VOCÊ — a linha inteira se destaca por isso. */
    mencionaVoce: euId !== undefined && message.content.includes(`<@${euId}>`),
    createdAt: message.createdAt.getTime(),
    createdAtText: HORA.format(message.createdAt),
    createdAtCurto: HORA_CURTA.format(message.createdAt),
    editedAt: message.editedAt?.getTime(),
    sistema: toSistema(message),
    respostas: message.replyIds ?? VAZIO,
    fixada: message.pinned,
    reactions: flattenReactions(message, euId),
    embeds: traduzirEmbeds(message.embeds),
    // O protocolo não carrega isto: quem mantém é o adapter, e mensagem que
    // veio do servidor nasce "sent". É a camada anticorrupção fazendo o
    // trabalho para o qual existe.
    sendState,
    enquete,
    figurinha: figurinhaDaMensagem(message.id, message.nonce),
    iniciaGrupo: layout.iniciaGrupo,
    dia: layout.dia,
    primeiraNaoLida: layout.primeiraNaoLida,
  };
}

const PRESENCE: Record<string, PresenceStatus> = {
  Online: "online",
  Idle: "idle",
  Busy: "dnd",
  Focus: "idle",
  Invisible: "offline",
  Offline: "offline",
};

export function toPresence(raw: string | null | undefined): PresenceStatus {
  return (raw && PRESENCE[raw]) || "offline";
}

/**
 * A presença de alguém, a partir dos DOIS campos do protocolo.
 *
 * ⚠ **`online` e `status.presence` são coisas diferentes, e usar só o segundo
 * punha a member list inteira em OFFLINE.** `online` é a CONEXÃO — um
 * booleano que o servidor mantém —, e `status.presence` é o que a pessoa
 * ESCOLHEU mostrar. Quem nunca escolheu não tem o campo, e
 * `toPresence(undefined)` devolve `"offline"` por desenho.
 *
 * O resultado, medido contra a instância local: o servidor respondia
 * `{"username":"auditor9018","online":true}` e a coluna me listava em OFFLINE,
 * na minha própria sessão. Vale para todo mundo — só escapa quem tiver
 * escolhido um status à mão.
 *
 * ⚠ **Desconectado vence a escolha.** Quem escolheu "Online" e fechou o app
 * está offline, e mostrá-lo aceso mandaria alguém falar com uma parede.
 * Invisível não precisa de tratamento aqui: o servidor já reporta `online:
 * false` para os outros, que é o ponto de ser invisível.
 */
export function presencaDe(
  online: boolean | undefined,
  raw: string | null | undefined,
): PresenceStatus {
  if (!online) return "offline";
  return (raw && PRESENCE[raw]) || "online";
}

/* ------------------------------------------------------- colunas laterais */


/**
 * As contagens entram por parâmetro pelo mesmo motivo de `sendState`: elas não
 * existem no protocolo, quem as mantém é o adapter, e este módulo traduz uma
 * entidade sem saber o que aconteceu antes dela.
 */
/** "3 de março de 2024" — a data de criação de um servidor. */
const DATA_LONGA = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function toServerSnapshot(
  server: Server,
  naoLidas: number,
  mencoes: number,
): ServerSnapshot {
  return {
    id: server.id,
    name: server.name,
    sigla: sigla(server.name),
    avatarUrl: server.iconURL,
    naoLidas,
    mencoes,
    /*
      `?? ""` e não `undefined`: quem consome é um `textarea` controlado, e um
      controlado que recebe `undefined` vira NÃO-controlado no meio da vida —
      o React avisa e o campo para de responder ao estado.
    */
    descricao: server.description ?? "",
    bannerUrl: server.banner?.createFileURL(),
    criadoEmTexto: DATA_LONGA.format(server.createdAt),
  };
}

/**
 * Canal de voz.
 *
 * O protocolo NÃO tem `channel_type: "VoiceChannel"` — a união é
 * `SavedMessages | DirectMessage | Group | TextChannel`. Canal de voz é um
 * TextChannel que carrega um objeto `voice` ("voice chats v2"), e é isso que
 * `isVoice` detecta.
 *
 * Descoberto verificando em navegador: o arnês criava `"VoiceChannel"`, a
 * hidratação aceitava calada (o campo entra como string qualquer) e o canal
 * aparecia entre os de texto. Nenhum erro, nenhum aviso — só a seção errada.
 *
 * A restrição a DM e Grupo é deliberada: para eles `isVoice` é `true` no
 * sentido de "pode ter chamada", não de "é um canal de voz". O snapshot é do
 * domínio e vale em toda parte, então a diferença fica explícita aqui em vez
 * de virar surpresa na primeira tela de DMs.
 */
export function ehCanalDeVoz(channel: Channel): boolean {
  return (
    channel.isVoice &&
    channel.type !== "DirectMessage" &&
    channel.type !== "Group"
  );
}

/**
 * O tipo do protocolo → o tipo do produto.
 *
 * `SavedMessages | DirectMessage | Group | TextChannel` mais a detecção de voz,
 * colapsados nos cinco que a coluna sabe desenhar. O caso torto é `TextChannel`
 * com objeto `voice` — ver `ehCanalDeVoz`.
 */
function tipoDoCanal(channel: Channel): ChannelSnapshot["tipo"] {
  if (channel.type === "SavedMessages") return "notas";
  if (channel.type === "DirectMessage") return "dm";
  if (channel.type === "Group") return "grupo";
  return ehCanalDeVoz(channel) ? "voz" : "texto";
}

/**
 * Canal restrito — o cadeado do design.
 *
 * ⚠ **NÃO usa `potentiallyRestrictedChannel`, e a primeira versão usava.**
 * Aquele getter responde "isto pode estar escondido de ALGUÉM", somando três
 * perguntas: o canal nega ver, o SERVIDOR não concede ver, ou algum cargo
 * nega. As duas últimas fazem o cadeado aparecer em canal público — medido no
 * arnês, onde o servidor não declara `default_permissions`: **os sete canais
 * apareceram restritos**, inclusive `#geral`.
 *
 * A pergunta que o cadeado responde na coluna é mais estreita: *este canal
 * nega ver ao cargo padrão?* — ou seja, "é do time todo ou de um grupo?". É a
 * primeira cláusula sozinha.
 *
 * `ViewChannel` é o bit 20 (`BIT_VER_CANAL`) — este comentário dizia "bit 0",
 * que é `ManageChannel`; ver `bits.ts`. `d` é a máscara de NEGADO. `BigInt` e não `number` porque as permissões deste protocolo passam
 * do bit 31 e os operadores bitwise do JavaScript truncam em 32 — a mesma
 * armadilha já registrada no editor de cargos.
 */
const VER_CANAL = BIT_VER_CANAL;

/** Descarta teto nulo ou zero: no fio, 0 nunca quis dizer "sem limite". */
function tetoHidratado(n: number | null | undefined): number | undefined {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

function ehRestrito(channel: Channel, tipo: CanalTipo): boolean {
  if (tipo !== "texto" && tipo !== "voz") return false;
  const negado = channel.defaultPermissions?.d;
  return typeof negado === "bigint" && (negado & VER_CANAL) === VER_CANAL;
}

export function toChannelSnapshot(
  channel: Channel,
  naoLidas: number,
  mencoes: number,
  /** Quem sou eu — para achar o OUTRO lado de uma conversa direta. */
  euId: string | undefined,
  /**
   * O teto de gente na sala — o `8` de "3/8".
   *
   * ⚠ **Entra por parâmetro porque o `Channel` do SDK NÃO expõe o objeto
   * `voice`.** Ele tem `isVoice`, que é derivado dele, e mais nada; o campo
   * mora no objeto hidratado, atrás de uma coleção privada. A primeira versão
   * casteou o `Channel` e leu `undefined` em silêncio — o "3/8" simplesmente
   * não apareceu, sem erro nenhum.
   *
   * Quem tem a coleção é o adapter. É a mesma razão de `naoLidas` e `euId`
   * entrarem por aqui: este módulo traduz uma entidade, não busca dados.
   */
  teto: number | undefined,
): ChannelSnapshot {
  const tipo = tipoDoCanal(channel);

  /*
    O destinatário sai de `recipientIds` menos eu, e NÃO de `channel.recipient`.

    O getter do SDK faz `client.user!.id` — estoura antes do `Ready`. E a coluna
    de conversas precisa ser desenhada na abertura, que é exatamente o momento
    em que `client.user` ainda não existe.
  */
  let destinatarioId: string | undefined;
  if (tipo === "dm") {
    for (const id of channel.recipientIds) {
      if (id !== euId) {
        destinatarioId = id;
        break;
      }
    }
  }

  /*
    O tempo vem do ULID da última mensagem — o protocolo não tem campo de
    "última atividade". Zero quando nunca houve mensagem: conversa recém-aberta
    vai para o fim, e não para um topo que ela não merece.
  */
  const ultimo = channel.lastMessageId;
  const ultimaEm = ultimo ? decodeTime(ultimo) : 0;

  return {
    id: channel.id,
    /*
      A imagem do grupo. `iconURL` do SDK já monta o endereço do `autumn`, e é
      `undefined` quando não há.

      ⚠ **Lido só para GRUPO, e o getter LANÇA no resto.** A intenção sempre foi
      essa — o comentário anterior dizia "inclusive para todo canal que não é
      grupo" —, mas ler o getter mesmo assim não é de graça: em DM ele passa por
      `Channel.recipient`, que faz `find` sobre os destinatários comparando com
      `client.user.id`. Sem sessão, `client.user` é `undefined` e o getter joga
      `Cannot read properties of undefined (reading 'id')`.

      Medido em navegador: abrir Conversas no arnês derrubava a coluna inteira
      para o limite de erro — "O painel de canais parou de funcionar" —, sem
      nada na tela dizendo por quê. É a família das duas armadilhas de SDK que
      esta camada já matou (`isVoice` que é `true` para DM, e o
      `channel_type: "VoiceChannel"` que não existe): o protocolo tem um jeito,
      o domínio quer outro, e a tradução é onde a diferença morre.
    */
    iconeUrl: channel.type === "Group" ? channel.iconURL : undefined,
    // `serverId` é string no SDK mesmo para canal de DM, onde vem vazia. O
    // domínio prefere `undefined` — "não pertence a servidor" é ausência, não
    // string vazia, e é o que impede um `if (serverId)` errado lá na frente.
    serverId: channel.serverId || undefined,
    name: channel.name,
    tipo,
    destinatarioId,
    participantes: tipo === "grupo" ? channel.recipientIds.size : 0,
    ultimaEm,
    ultimaMensagemId: ultimo ?? undefined,
    topico: channel.description || undefined,
    /* `slowmode` chegava pelo fio e ninguém desenhava — ver o campo. */
    modoLentoSegundos: channel.slowmode ?? 0,
    /*
      ⚠ **O getter chama-se `mature`, e o campo do protocolo é `nsfw`.** Escrever
      `channel.nsfw` compila em `any` num objeto menos tipado e devolve
      `undefined` em silêncio; aqui o TypeScript pegou, e é o tipo de renomeação
      que a camada de tradução existe para absorver uma vez só.
    */
    restritoPorIdade: channel.mature === true,
    /*
      ⚠ `voice.max_users` e não um campo de topo — o protocolo aninha o que é
      de voz. Ausência é sem limite. Zero no fio é teto de zero vagas, não o
      sentinela da tela; a hidratação abaixo descarta <= 0 para a tela não
      gravar de novo o mesmo defeito.
    */
    limiteDeUsuarios: tetoHidratado(
      (channel as unknown as { voice?: { max_users?: number | null } }).voice
        ?.max_users,
    ),
    naoLidas,
    mencoes,
    /*
      Lido do MODELO, não do store.

      O store é a fonte, mas quem responde é `channel.muted` — e ele passa pela
      opção `channelIsMuted` que o cliente registrou. Ler do modelo é o que
      garante uma verdade só: no dia em que silêncio herdar do servidor, a
      regra muda numa função e o snapshot continua certo.
    */
    silenciado: channel.muted,
    /*
      `potentiallyRestrictedChannel` devolve `string | boolean | undefined` —
      o `find` de cargo vaza um id quando acha. Normalizado a booleano aqui,
      porque o domínio responde uma PERGUNTA e o id de qual cargo restringe
      não interessa a nenhuma superfície.
    */
    privado: ehRestrito(channel, tipo),
    /*
      Só de canal de voz, e só quando há teto de verdade.

      O SDK já normaliza `max_users: 0` para `undefined` na hidratação; a
      guarda de tipo é para não expor teto em DM, onde `isVoice` é `true` por
      outra razão (ver `ehCanalDeVoz`).
    */
    limite: tipo === "voz" ? teto : undefined,
    /* Lido do evento CRU pelo store de voz — a hidratação reduz `voice` a
       `{ maxUsers }`. Quem republica quando muda é `consumirModosAlterados`. */
    modoDaSala: tipo === "voz" ? lerConfigDeVoz(channel.id).modoDaSala : undefined,
    /*
      `slowmode` é getter público e devolve `0` quando não há — sem
      normalização a fazer. É o raro campo do protocolo cujo nome e forma já
      são os do domínio.
    */
    modoLento: channel.slowmode,
    /* Lidos do evento CRU — o SDK os descarta. Ver `superficieVortex.ts`. */
    spoiler: camposDe(superficie, channel.id).spoiler,
    convitesPausados: camposDe(superficie, channel.id).convitesPausados,
  };
}

/**
 * O apelido do servidor ganha do username — é o nome que a pessoa escolheu
 * naquele lugar.
 *
 * O `ServerMember` entra por parâmetro, e não é buscado aqui, porque este
 * módulo traduz uma entidade de cada vez: quem sabe de qual servidor se fala é
 * o adapter, que é dono da chave composta.
 *
 * `membro` é opcional porque nem todo usuário renderizado é membro de servidor
 * — autor de DM não é. Sem ele, cai no username e em nenhum cargo, que é a
 * resposta certa e não um estado degradado.
 */
/**
 * `Friend | Incoming | Outgoing | Blocked | BlockedOther | None | User` → as
 * seis do produto.
 *
 * `User` é EU MESMO — o protocolo usa a mesma palavra para "relação com você
 * próprio". Cai em `nenhuma` porque a tela de amigos não deve me listar entre
 * meus amigos, e um sétimo caso só para isso seria um estado que nenhuma aba
 * mostra.
 */
const RELACAO: Record<string, Relacao> = {
  Friend: "amigo",
  Incoming: "recebido",
  Outgoing: "enviado",
  Blocked: "bloqueado",
  BlockedOther: "bloqueadoPor",
};

/** A relação crua do protocolo → a do produto. Ver `RELACAO`. */
export function relacaoDoProtocolo(bruta: string): Relacao {
  return RELACAO[bruta] ?? "nenhuma";
}

export function toRelacaoSnapshot(user: User): RelacaoSnapshot {
  const displayName = user.displayName || user.username;
  return {
    id: user.id,
    displayName,
    sigla: sigla(displayName),
    avatarUrl: urlDeAvatar(user),
    username: user.username,
    relacao: relacaoDoProtocolo(user.relationship),
    status: toPresence(user.status?.presence),
  };
}


export function toMemberSnapshot(
  user: User,
  membro: ServerMember | undefined,
  /**
   * EU, neste servidor.
   *
   * ⚠ Entra por PARÂMETRO e não é lido do `client` aqui: `map.ts` é tradução
   * pura, sem estado — é o que permite testá-lo com objetos de mentira. Quem
   * tem o cliente é o adapter, e é ele que sabe quem sou eu.
   */
  eu?: ServerMember,
): MemberSnapshot {
  const displayName = membro?.nickname || user.displayName || user.username;

  // `roleColour` pode vir `null` do protocolo — sem cargo colorido. `null` e
  // `undefined` significam a mesma coisa para o domínio, e carregar os dois
  // faria todo consumidor testar duas ausências diferentes.
  const cor = membro?.roleColour ?? undefined;

  /*
    O cargo que HASTEIA, o mesmo de onde a cor sai.

    `hoistedRole` devolve `null` quando nenhum cargo hasteia — normalizado a
    `undefined` pela mesma razão de `cor`: duas ausências diferentes fariam
    todo consumidor testar as duas.
  */
  const cargo = membro?.hoistedRole?.name || undefined;

  // `getTime()` aqui, e não o `Date`: o snapshot precisa ser comparável por
  // valor. Guardar o objeto faria toda republicação parecer mudança.
  const silenciadoAte = membro?.timeout?.getTime();

  const entrouEmMs = dataDeEntrada(membro);

  /*
    Do mais ALTO para o mais baixo — `orderedRoles` do SDK devolve o contrário
    ("from lowest to highest priority"), e a ordem importa: a pílula que
    aparece primeiro é a que identifica a pessoa. Inverter aqui, uma vez na
    escrita, é mais barato que todo consumidor lembrar de fazê-lo.
  */
  const cargosIds = membro
    ? [...membro.orderedRoles].reverse().map((c) => c.id)
    : [];

  /* O mais alto com ícone — `iconRole` do SDK. A URL sai vazia sem servidor
     de mídia configurado, e vazio vira ausência pela mesma razão de `cor`. */
  const cargoDoIcone = membro?.iconRole ?? undefined;
  const iconeDeCargoUrl = cargoDoIcone?.icon?.createFileURL() || undefined;

  /*
    ⚠ **Hierarquia, e o default de "não sei" é NÃO PODE.**

    `inferiorTo` compara o rank do alvo com o meu. Sem sessão, sem membro meu
    no servidor, ou comparando comigo mesmo, a resposta é `false` — e isso
    esconde a ação de moderação em vez de oferecê-la. É a mesma disciplina de
    `pode()`: o default de uma pergunta sem resposta é o lado seguro.
  */
  const abaixoDeMim =
    eu !== undefined && membro !== undefined && eu.id.user !== membro.id.user
      ? membro.inferiorTo(eu)
      : false;

  return {
    id: user.id,
    displayName,
    sigla: sigla(displayName),
    /* Avatar do MEMBRO ganha do global, pela mesma razão dos pronomes: o
       protocolo permite um por servidor, e quem define um está dizendo algo
       naquele lugar.

       ⚠ **`membro.avatar` e não `membro.avatarURL`, e a diferença me pegou.**
       O getter do SDK já faz o fallback sozinho — `this.avatar?.createFileURL()
       ?? this.user?.avatarURL` — e o do usuário, sem anexo, devolve a URL do
       avatar PADRÃO gerado pelo servidor. Encadear os dois getters entregava
       uma URL sempre, e a guarda de `urlDeAvatar` nunca era alcançada:
       medido no navegador, 41 `<img>` para `/default_avatar` numa tela onde
       ninguém tem foto. Conferir o ANEXO é o que devolve o controle a nós. */
    avatarUrl: membro?.avatar
      ? membro.avatarURL
      : urlDeAvatar(user),
    username: user.username,
    // Pronomes do MEMBRO ganham dos do usuário: o protocolo permite declarar
    // diferente por servidor, e quem faz isso está dizendo algo naquele lugar.
    pronomes: membro?.pronouns || user.pronouns || undefined,
    statusTexto: user.status?.text || undefined,
    cor,
    cargo,
    cargosIds,
    iconeDeCargoUrl,
    iconeDeCargoNome: iconeDeCargoUrl === undefined ? undefined : cargoDoIcone?.name,
    abaixoDeMim,
    silenciadoAte,
    entrouEm: entrouEmMs === undefined ? undefined : DATA_CURTA.format(entrouEmMs),
    entrouEmMs,
  };
}

/**
 * O instante de entrada, ou ausência.
 *
 * ⚠ **Data inválida e epoch zero viram `undefined`, e a tela mostra "—".** O
 * `joinedAt` do SDK é tipado como `Date` não-opcional, então um membro sem
 * `joined_at` no payload não dá `undefined` — dá `new Date(undefined)` ou
 * `new Date(0)`. Formatar isso escreve **"31 de dez. de 1969"** na coluna, que
 * é pior que vazio: parece um dado, e ninguém desconfia de uma data.
 *
 * Achado no arnês, onde o firehose criava membros sem `joined_at`. É a família
 * do "arnês mais pobre que o protocolo", com a diferença de que aqui o
 * conserto vale para produção também: um servidor que devolva o campo vazio
 * produziria exatamente a mesma linha.
 */
function dataDeEntrada(membro: ServerMember | undefined): number | undefined {
  const t = membro?.joinedAt?.getTime();
  if (t === undefined || Number.isNaN(t) || t === 0) return undefined;
  return t;
}

/**
 * A URL do avatar do usuário, ou ausência.
 *
 * ⚠ **`user.avatar` é conferido ANTES de chamar `avatarURL`**, e o getter do
 * SDK é a razão: ele é tipado como `string` não-opcional e, sem anexo,
 * devolve a URL do avatar PADRÃO gerado pelo servidor. Passá-la adiante
 * cobriria o gradiente com uma silhueta igual para todo mundo — trocando o
 * fallback que identifica pelo que só ocupa espaço, que é o contrário do que a
 * decisão de gradiente por ID existe para fazer.
 */
function urlDeAvatar(user: User): string | undefined {
  return user.avatar ? user.avatarURL : undefined;
}

/*
  "3 mar 2026" — dia, mês curto e ano.

  Com ano de propósito: a tabela de membros é ordenável por entrada e mistura
  quem chegou este mês com quem chegou há três anos. Sem o ano, "3 mar" não
  distingue os dois, que é justamente a pergunta que a coluna responde.
*/
const DATA_CURTA = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
