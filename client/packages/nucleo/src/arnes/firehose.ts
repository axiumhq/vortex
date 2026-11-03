/**
 * Firehose sintético.
 *
 * Dirige o SDK DE VERDADE — `getOrCreate` roda a hidratação real, emite os
 * eventos reais e mexe nos stores Solid reais. Nada aqui é mock. Um SDK
 * mockado testaria a peça de menor risco e deixaria a de maior risco de fora.
 *
 * Não há websocket nem backend: `new Client()` não conecta.
 *
 * Regressão de escopo nunca aparece em uso normal de desenvolvimento. Só em
 * servidor grande com usuário real. Isto é o que a pega antes.
 */
import { decodeTime, monotonicFactory, ulid } from "ulid";

import { definirEnqueteBruta, lerEuDasEnquetes } from "../store/enquetes";
import { definirFuncoesDoArnes } from "../sdk/funcoes";
import { registrarFigurinhaLocal } from "../sdk/figurinhasDeMensagem";
import { FIGURINHAS_DO_ARNES, semearExpressoesDoArnes } from "./expressoesDoArnes";
import {
  definirPerfilDoServidor,
  definirQuemExibeTag,
} from "../store/perfilDoServidor";
import {
  definirChamada,
  definirFalantes,
  encerrarChamada,
  lerChamada,
} from "../store/chamada";
import { definirPalco } from "../store/palcoDeVoz";
import { chaveDeVideo, faixasDeVideo } from "../store/video";
import {
  definirAnuncio,
  definirContagemDisponivel,
  limparEspectadores,
} from "../store/espectadores";
import { abrirConversa, selecionarCanal } from "../store/navegacao";

import { count, countMax } from "./stats";
import {
  aplicarVozDoCanal,
  channelMessageIds,
  definirUsuarioLocal,
  estadoDaFila,
  diagnostico,
  prependHistory,
  registrarServidor,
  seedChannel,
  semearMudoDoServidor,
  semearSurdoDoServidor,
  semearVoz,
  semearPresenca,
  startAdapter,
} from "../sdk/adapter";
import type { PresenceStatus } from "../sdk/domain";
import { client } from "../sdk/client";
import { anotarCanais, semearListagem } from "../sdk/vortexCanal";
import { dublarRedeDoServidor, registrarPreviaDublada } from "./rede";
import { BIT_VER_CANAL } from "../sdk/bits";

/** `ViewChannel` negado, no formato do fio (string decimal). */
const VER_CANAL_NEGADO = String(BIT_VER_CANAL);

const nextId = monotonicFactory();

export const CHANNEL_ID = "01JQ0000000000000000000000";
export const SERVER_ID = "01JQ0000000000000000000001";
const FORUM_ID = "01JQ000000000000000000001F";
const GALERIA_ID = "01JQ000000000000000000001G";
const USER_COUNT = 40;

/**
 * Quantas pessoas distintas digitam sob o firehose.
 *
 * Três, para o indicador passar pelos três casos que o design desenha: uma
 * com nome, duas com "e", e a contagem a partir daí. Ver o `case "typing"`.
 */
const QUEM_DIGITA = 3;

const userIds: string[] = [];

/** O "eu" do arnês, fixo — o mesmo que `definirUsuarioLocal` recebe. */
const USUARIO_LOCAL = "01JQ0000000000000001000000";

/**
 * O mundo do arnês: três servidores, com canais e membros.
 *
 * Um servidor só provava metade das colunas laterais. Rail com um item não
 * exercita estado ativo nem não-lidas; e não-lidas SÓ existem em canal que
 * não está aberto — com um canal, o contador nunca sairia de zero e a
 * contabilidade passaria despercebida quebrada.
 *
 * Os IDs são fixos e legíveis de propósito: aparecem no DOM durante depuração,
 * e ULID aleatório num arnês é ruído sem benefício.
 */
type Servidor = {
  id: string;
  nome: string;
  canais: {
    id: string;
    nome: string;
    voz?: boolean;
    dentro?: number;
    topico?: string;
    /*
      ⚠ **O arnês mais pobre que o protocolo, quarta vez.** `privado` e `teto`
      são campos reais — `default_permissions` e `voice.max_users` — e sem eles
      o cadeado e o "3/8" da coluna seriam intestáveis, exatamente como
      `ehMencao` passou três fases sem devolver `true`.
    */
    privado?: boolean;
    teto?: number;
    /** `voice.kind` do fork — sala de vídeo ou palco (D-VOZ-04). */
    sala?: "video" | "stage";
    /** Segundos entre mensagens. O "Modo lento · 30 s" do design. */
    lento?: number;
    /** Fórum (ou galeria, com `media`) — o objeto cru que só este fork manda. */
    forum?: { media?: boolean; tags?: { id: string; name: string; colour?: string }[] };
    /**
     * `nsfw` — restrição de idade (D-CCANAL-06). Arnês mais pobre que o
     * protocolo, 13ª vez: o campo existe desde o Revolt e nenhum canal do
     * firehose o tinha, então a porta de confirmação nasceria inalcançável.
     */
    adulto?: boolean;
  }[];
  categorias?: {
    id: string;
    title: string;
    channels: string[];
    /** Sobreposições da categoria (fork do `api`) — o banner de
        dessincronização só existe quando a categoria tem alguma. */
    default_permissions?: { a: string; d: string };
  }[];
  /** Quantos dos `userIds` pertencem a ele. */
  membros: number;
};

const MUNDO: Servidor[] = [
  {
    id: SERVER_ID,
    nome: "Vortex",
    canais: [
      {
        id: CHANNEL_ID,
        nome: "spike",
        topico: "Onde o firehose despeja 10 mil mensagens e a âncora tem que aguentar.",
      },
      { id: "01JQ0000000000000000000010", nome: "geral" },
      // Modo lento num canal só: a faixa do composer precisa do caso COM e do
      // caso SEM. Com em todos, o ramo `0` nunca renderizaria.
      { id: "01JQ0000000000000000000011", nome: "links", lento: 30 },
      // Restrito: o cadeado do design. Um canal só, porque o marcador tem de
      // se distinguir varrendo — se todos tivessem, ele não diria nada.
      { id: "01JQ000000000000000000001P", nome: "liderança", privado: true },
      /*
        Fórum e galeria — os tipos que este fork acrescenta. As tags e as
        descrições são as do design, palavra por palavra, para a tela medir o
        mesmo que a desenhada.
      */
      {
        id: FORUM_ID,
        nome: "ideias",
        topico: "Um post por ideia. Use as tags e feche quando decidir.",
        forum: {
          tags: [
            { id: "bug", name: "bug", colour: "#E8596B" },
            { id: "melhoria", name: "melhoria", colour: "#35C2CC" },
            { id: "pesquisa", name: "pesquisa", colour: "#8B7BE8" },
            { id: "resolvido", name: "resolvido", colour: "#46C98A" },
            { id: "backlog", name: "backlog", colour: "#6E7783" },
          ],
        },
      },
      {
        id: GALERIA_ID,
        nome: "galeria",
        topico: "Referências visuais. Sempre com legenda e crédito.",
        forum: { media: true },
      },
      // Sala COM teto e sala SEM: o "3/8" e a ausência dele. Com teto em todas,
      // o caso `undefined` nunca renderizaria.
      { id: "01JQ0000000000000000000012", nome: "voz-geral", voz: true, dentro: 2, teto: 8 },
      // Cheia: 3 de 3. É o estado de aviso, e é o que barra quem clica.
      { id: "01JQ0000000000000000000013", nome: "voz-jogos", voz: true, dentro: 3, teto: 3 },
      // Sala VAZIA, e ela é o caso mais fácil de quebrar sem perceber: se o
      // componente renderizasse um cabeçalho "ninguém aqui" por canal, cada
      // servidor pagaria altura permanente para dizer que não há nada.
      { id: "01JQ0000000000000000000014", nome: "voz-silencio", voz: true, dentro: 0 },
      /*
        Sala de VÍDEO e PALCO — `voice.kind` do fork (D-VOZ-04). O nome e o
        "1/25" são os do design; sem elas o ícone por tipo nasceria
        construído e inalcançável.
      */
      {
        id: "01JQ0000000000000000000015",
        nome: "Apresentações",
        voz: true,
        dentro: 1,
        teto: 25,
        sala: "video",
      },
      { id: "01JQ0000000000000000000016", nome: "palco", voz: true, dentro: 0, sala: "stage" },
    ],
    categorias: [
      {
        id: "01JQC000000000000000CONVERSA",
        title: "conversa",
        channels: [
          "01JQ0000000000000000000010",
          "01JQ0000000000000000000011",
          "01JQ000000000000000000001P",
          FORUM_ID,
          GALERIA_ID,
        ],
      },
      {
        id: "01JQC0000000000000000000VOZ",
        title: "voz",
        channels: [
          "01JQ0000000000000000000012",
          "01JQ0000000000000000000013",
          "01JQ0000000000000000000014",
          "01JQ0000000000000000000015",
          "01JQ0000000000000000000016",
        ],
      },
    ],
    membros: USER_COUNT,
  },
  {
    id: "01JQ0000000000000000000002",
    nome: "Ponte de Estado",
    canais: [
      /* `adapter` segue a categoria (privado = o mesmo `ViewChannel` negado
         que ela carrega) e `medições` não: um sincronizado e um divergente,
         para o banner de dessincronização e o diff dele (D-CCANAL-09/10). */
      { id: "01JQ0000000000000000000020", nome: "adapter", privado: true },
      { id: "01JQ0000000000000000000021", nome: "medições" },
    ],
    categorias: [
      {
        id: "01JQC0000000000000000PONTE",
        title: "ponte",
        channels: ["01JQ0000000000000000000020", "01JQ0000000000000000000021"],
        default_permissions: { a: "0", d: VER_CANAL_NEGADO },
      },
    ],
    membros: 12,
  },
  {
    id: "01JQ0000000000000000000003",
    nome: "Rascunhos",
    canais: [
      { id: "01JQ0000000000000000000030", nome: "ideias" },
      // +18 num servidor que não é o do firehose: a porta substitui a lista,
      // e no `spike` ela esconderia as dez mil mensagens que o gate mede.
      { id: "01JQ0000000000000000000031", nome: "sem-filtro", adulto: true },
    ],
    membros: 5,
  },
];

/**
 * Presença inicial variada.
 *
 * Todo mundo online mediria só metade da member list: os dois baldes, a
 * ordenação dentro de cada um e as quatro silhuetas do ponto ficariam sem
 * exercício. A distribuição é fixa por índice — arnês que sorteia produz
 * captura de tela diferente a cada execução.
 */
const PRESENCAS: PresenceStatus[] = ["online", "online", "idle", "dnd", "offline"];

/**
 * Cargos do arnês.
 *
 * IDs no mesmo formato ULID do resto — 26 caracteres. Não é preciosismo: um ID
 * curto aqui já produziu confusão antes, quando o ID de usuário colidiu com o
 * de canal e só apareceu na detecção de menção.
 */
const CARGOS = {
  fundacao: "01JQR0000000000000FUNDACAO",
  moderacao: "01JQR0000000000000MODERACAO",
  veterano: "01JQR0000000000000VETERANO0",
} as const;

/**
 * Quem tem qual cargo.
 *
 * A distribuição importa mais que os números: a maioria SEM cargo, para que a
 * seção "sem cargo" exista e se possa conferir que ela cai por último; e
 * `veterano` cobrindo gente que também é moderação, porque o desempate entre
 * dois cargos da mesma pessoa é justamente o que a lógica de "mais sênior"
 * decide.
 */
function cargosDe(i: number): string[] {
  const out: string[] = [];
  if (i === 0) out.push(CARGOS.fundacao);
  else if (i % 7 === 3) out.push(CARGOS.moderacao);
  if (i % 5 === 2) out.push(CARGOS.veterano);
  return out;
}

const WORDS =
  "vortex canal mensagem servidor presença digitando reação âncora scroll virtualização adapter store snapshot render frame orçamento escopo".split(
    " ",
  );

/** Comprimento variado de propósito: altura de linha uniforme mede o caso fácil. */
function body(seed: number): string {
  const words = 3 + (seed * 7) % 60;
  const out: string[] = [];
  for (let i = 0; i < words; i++) {
    out.push(WORDS[(seed + i) % WORDS.length]!);
  }
  if (seed % 23 === 0) {
    out.push(`https://exemplo.invalid/${"x".repeat(300)}`);
  }

  /*
    Uma em cada 31 menciona VOCÊ.

    Faltava, e a ausência era invisível: `ehMencao` existe no adapter desde a
    fase 3 e NUNCA devolveu `true` no arnês, porque nenhum corpo gerado continha
    `<@id>`. O contador de menções do canal e do servidor estava implementado,
    testado por leitura e jamais visto na tela.

    Uma em 31 é o suficiente para haver várias num canal de 10 mil e raro o
    bastante para não virar o caso comum — que é justamente o que faz "ir para
    a próxima" valer alguma coisa. Menção em toda mensagem seria a mesma coisa
    que menção em nenhuma.
  */
  if (seed % 31 === 5) {
    out.push(`<@${USUARIO_LOCAL}>`);
  }

  /*
    ⚠ **Markdown, e a ausência dele era o buraco mais fundo deste arnês.**

    O corpo gerado era só palavras soltas com uma URL ocasional — então o
    pipeline inteiro de `markdown/analisar.ts` (32 testes, cache por conteúdo,
    três decisões de segurança sobre link) NUNCA tinha sido visto na tela. O
    bloco de código com cabeçalho, a lista com marcador, a citação, o título e
    o negrito existiam, compilavam, tinham teste — e não havia como olhar.

    É a mesma família do `ehMencao` que passou três fases sem devolver `true`,
    e a sexta vez que este arnês fica mais pobre que o protocolo.

    Frequências baixas e PRIMAS entre si: cada forma aparece o bastante para
    ser encontrada rolando, e raro o suficiente para a lista continuar
    parecendo conversa em vez de documentação.
  */
  /*
    ⚠ **Um link de convite, e a ausência dele é a 12ª vez que este arnês fica
    mais pobre que o protocolo.** O embed de convite no chat (D-EVT-40) lê o
    CORPO da mensagem; sem um link colado ali ele nasceria construído e
    inalcançável — a família do painel de fixadas, que só chegava à tela para
    quem o posicionasse à mão.

    Uma em 53, e primo com as outras frequências pela mesma razão: várias num
    canal de dez mil e raro o bastante para a lista continuar parecendo
    conversa.
  */
  if (seed % 53 === 7) {
    out.push("https://vortex.exemplo/convite/a9Kq2");
  }

  const texto = out.join(" ");

  if (seed % 29 === 4) {
    return `${texto}

\`\`\`ts
const allow = base | roles;
if (memberOverride) return memberOverride;
\`\`\``;
  }
  if (seed % 37 === 6) {
    return `${texto}

- primeiro item
- segundo item
- terceiro item`;
  }
  if (seed % 43 === 8) {
    return `> ${texto}`;
  }
  if (seed % 47 === 9) {
    return `## ${WORDS[seed % WORDS.length]!}

${texto}`;
  }
  if (seed % 19 === 2) {
    return `**${WORDS[seed % WORDS.length]!}** ${texto} _${WORDS[(seed + 3) % WORDS.length]!}_`;
  }
  return texto;
}

/**
 * Nomes de gente, não `user0..user39`.
 *
 * A member list ordena por nome e mostra iniciais no avatar — com `user0` a
 * ordenação é trivialmente correta por acidente (prefixo comum, sufixo
 * numérico) e as siglas são todas "U". Nomes reais exercitam o colator, a
 * acentuação e a sigla de duas letras.
 */
/**
 * A relação de cada pessoa comigo.
 *
 * Uma de cada quatro é amiga, uma em sete mandou pedido, uma em onze recebeu o
 * meu, e uma em dezenove está bloqueada — números primos entre si para as
 * faixas não se sobreporem sempre nos mesmos índices.
 */
function relacaoDe(i: number): string {
  if (i === 0) return "User";
  if (i % 19 === 5) return "Blocked";
  if (i % 7 === 3) return "Incoming";
  if (i % 11 === 4) return "Outgoing";
  if (i % 4 === 1) return "Friend";
  return "None";
}

const NOMES =
  "Ana Bruno Camila Diego Elisa Fábio Gabriela Henrique Íris João Kátia Lucas Mariana Nuno Olívia Pedro Quirino Renata Sofia Tiago Úrsula Vitor Wanda Xavier Yara Zeca Alice Bento Clara Davi Emília Felipe Giulia Hugo Isabel Joana Kauê Laura Miguel Nina".split(
    " ",
  );

let mundoPronto = false;

function ensureWorld() {
  // Idempotente: `seed()` pode ser chamado de novo pelo arnês, e recriar o
  // mundo duplicaria membros em cada servidor.
  if (mundoPronto) return;
  mundoPronto = true;

/**
 * Recados de exemplo para a segunda linha da member list.
 *
 * Comprimentos diferentes de propósito: a linha trunca em uma só, e uma
 * amostra de string única não prova nem o truncamento nem o caso longo.
 */
const RECADOS = [
  "no deep work",
  "Spotify · Khruangbin",
  "Jogando Factorio",
  "focada, volto mais tarde",
  "em reunião até as 16h, mande recado que eu leio depois",
  "☕",
];

  for (let i = 0; i < USER_COUNT; i++) {
    /**
     * Prefixo próprio para usuário.
     *
     * O prefixo anterior produzia, para `i === 0`, exatamente a string do
     * `CHANNEL_ID` — 26 caracteres idênticos. Passava despercebido porque
     * usuário e canal vivem em coleções separadas do SDK, mas deixou de ser
     * inofensivo com a detecção de menção: `<@id>` no conteúdo passa a
     * carregar um ID que também nomeia um canal, e qualquer depuração por
     * busca de string no DOM mistura os dois.
     */
    const id = `01JQ0000000000000001${String(i).padStart(6, "0")}`;
    userIds.push(id);
    // O primeiro é "eu". Placeholder honesto enquanto não há sessão: o
    // composer precisa de autor, e mensagem sem autor renderiza sem cabeçalho
    // em vez de dar erro — bug caro de enxergar.
    if (i === 0) definirUsuarioLocal(id);
    client.users.getOrCreate(id, {
      _id: id,
      username: NOMES[i % NOMES.length]!,
      discriminator: "0001",
      // Pronomes e status em parte das pessoas: o cartão de perfil precisa
      // mostrar tanto o caso com quanto o sem — campo opcional que aparece
      // sempre não prova que a ausência foi tratada.
      ...(i % 4 === 1 ? { pronouns: "ela/dela" } : {}),
      ...(i % 4 === 2 ? { pronouns: "ele/dele" } : {}),
      /*
        Recados VARIADOS, e não um só repetido.

        Um em cada quatro, com textos de comprimentos diferentes — a segunda
        linha da member list trunca, e uma amostra de string única não prova
        que o truncamento funciona nem que a coluna aguenta o caso longo.
      */
      ...(i % 4 === 3
        ? {
            status: {
              text: RECADOS[i % RECADOS.length]!,
              presence: i % 8 === 3 ? "Busy" : "Online",
            },
          }
        : {}),
      online: true,
      /*
        A relação com cada pessoa, para a tela de amigos ter o que mostrar.

        Distribuída por resto de divisão, e não toda "Friend": a tela tem
        quatro abas e uma aba vazia não prova que ela funciona. Foi por não
        haver dado assim que `ehMencao` passou três fases sem nunca devolver
        `true` — o arnês mais pobre que o protocolo esconde a superfície.
      */
      relationship: relacaoDe(i),
    } as never);
    // O "eu" está sempre online — a própria presença nunca é ausente.
    semearPresenca(id, i === 0 ? "online" : PRESENCAS[i % PRESENCAS.length]!);
  }

  for (const servidor of MUNDO) {
    for (const canal of servidor.canais) {
      // Canal de voz é TextChannel COM objeto `voice` — o protocolo não tem
      // um `channel_type` de voz. Ver `ehCanalDeVoz` em `map.ts`.
      const cru = {
        _id: canal.id,
        channel_type: "TextChannel",
        server: servidor.id,
        name: canal.nome,
        // Tópico só em alguns: um arnês onde todo canal tem descrição nunca
        // exercitaria o cabeçalho sem tópico, que é o caso comum.
        ...(canal.topico ? { description: canal.topico } : {}),
        ...(canal.voz
          ? { voice: { max_users: canal.teto, ...(canal.sala ? { kind: canal.sala } : {}) } }
          : {}),
        /*
          `default_permissions` com `ViewChannel` NEGADO — é assim que o
          protocolo diz "restrito", e é o que `potentiallyRestrictedChannel`
          lê. Bit 20 (`ViewChannel`) — era "1", que é o bit 0
          (`ManageChannel`); ver `sdk/bits.ts`. Em string porque o protocolo
          transporta permissão como string decimal.
        */
        ...(canal.privado ? { default_permissions: { a: "0", d: VER_CANAL_NEGADO } } : {}),
        ...(canal.lento ? { slowmode: canal.lento } : {}),
        ...(canal.adulto ? { nsfw: true } : {}),
        ...(canal.forum ? { forum: canal.forum } : {}),
      };
      client.channels.getOrCreate(canal.id, cru as never);
      // O SDK descarta `forum` na hidratação; o registro guarda — ver `vortexCanal.ts`.
      anotarCanais([cru]);
      // E `voice.kind` também — o store de voz lê o cru, como no socket.
      if (canal.voz) aplicarVozDoCanal({ type: "ChannelCreate", ...cru });
    }

    client.servers.getOrCreate(servidor.id, {
      _id: servidor.id,
      owner: userIds[0],
      name: servidor.nome,
      /*
        ⚠ **12ª vez que o arnês aparece mais pobre que o protocolo.**
        `Server.description` existe desde sempre; o firehose criava servidor
        sem nenhuma, e a prévia do card de convite — que é METADE da tela de
        Perfil do servidor — abria com o corpo vazio. A caixa media 319 onde o
        design mede 370, e a diferença era literalmente o texto que não existe.

        Três linhas de propósito: o card trunca em três, e uma descrição de uma
        linha nunca exercita o corte.
      */
      /* A frase é a do MOCK do design, palavra por palavra: é ela que faz a
         prévia do card medir o mesmo que a desenhada. */
      description:
        "Servidor de produto e design do Vortex. Roadmap aberto, crítica " +
        "semanal e releases quinzenais.",
      /*
        ⚠ **O servidor CONCEDE ver canal por padrão, e sem isto o arnês mentia
        sobre o produto.** Servidor real declara `default_permissions`; o
        arnês não declarava, e nada dependia disso até o cadeado existir.

        É a quinta vez que o arnês aparece mais pobre que o protocolo. As
        outras quatro estão no `CLAUDE.md`, e o padrão é sempre o mesmo:
        campo que o protocolo tem, o arnês não gera, e a superfície que
        depende dele é intestável ou testa o caso errado.

        Estava `0` — nenhuma permissão concedida —, e isso fez a primeira
        versão do cadeado marcar os SETE canais como restritos, `#geral`
        incluído. O defeito era do arnês E do critério: ver `ehRestrito`.

        `ViewChannel` é o bit 0. Os outros permanecem como estão — `pode()`
        já tem a exceção documentada para o desenvolvimento sem sessão.
      */
      default_permissions: 1,
      channels: servidor.canais.map((c) => c.id),
      /*
        Categorias — e uma delas deixa canal DE FORA de propósito.

        O protocolo força uma categoria "default" para o que sobrou fora de
        grupo, e ela renderiza sem cabeçalho. Um arnês onde todo canal está
        categorizado nunca exercitaria esse caminho, que é justamente o mais
        comum num servidor real recém-criado.
      */
      ...(servidor.categorias ? { categories: servidor.categorias } : {}),
      /*
        Cargos, e um deles NÃO é hasteado de propósito.

        `hoist: false` significa "colore o nome mas não abre seção" — é a
        distinção que o protocolo faz e que um arnês só com cargos hasteados
        nunca exercitaria. Sem ela, um bug que tratasse todo cargo como seção
        passaria despercebido aqui e apareceria num servidor real.

        `rank` menor = mais sênior, conforme o SDK documenta.
      */
      roles: {
        [CARGOS.fundacao]: {
          name: "fundação",
          /*
            O preset holográfico — o mesmo texto que `HOLOGRAFICO` em
            `tema/cargo.ts`. Literal e não import de propósito: o arnês faz o
            papel do SERVIDOR, e o servidor não importa constante do cliente.
            Se as duas divergirem, o cargo vira gradiente comum na tela, que é
            o que aconteceria com um `colour` escrito por outro cliente.
          */
          colour: "linear-gradient(100deg, #8FE9F0, #C9B6F5 45%, #F3C6A8)",
          hoist: true,
          rank: 0,
          permissions: { a: 0, d: 0 },
        },
        [CARGOS.moderacao]: {
          name: "moderação",
          /*
            ⚠ Gradiente, e é o arnês mais pobre que o protocolo pela 12ª vez:
            o `RE_COLOUR` do servidor aceita gradiente desde sempre e os três
            cargos daqui eram hex, então o caminho de leitura do gradiente
            nasceria construído e nunca visto. Este é HASTEADO de propósito —
            abre seção na member list, que é onde o gradiente entra.
          */
          colour: "linear-gradient(90deg, #9BDCB4, #8B7BE8)",
          hoist: true,
          rank: 1,
          permissions: { a: 0, d: 0 },
        },
        [CARGOS.veterano]: {
          name: "veterano",
          colour: "#f0cd8d",
          hoist: false,
          rank: 2,
          permissions: { a: 0, d: 0 },
        },
      },
    } as never);

    /*
      As quatro páginas que passam por REDE — convites, banimentos, emoji e
      auditoria. Ver `dev/rede.ts`: sem isto elas ficam em "Carregando…" para
      sempre, e a varredura 1:1 contra a referência não tinha como cobri-las.
    */
    dublarRedeDoServidor(
      servidor.id,
      userIds,
      servidor.canais.map((c) => c.id),
    );

    /*
      Os `ServerMember`, que é onde moram apelido, cargo e castigo.

      Sem isto a member list mostraria username para todo mundo e nenhum dos
      três campos apareceria — e o pior: pareceria funcionando. O arnês precisa
      exercitar a chave composta, senão ela é só tipo bonito.

      A coleção do SDK indexa por `server + user` CONCATENADO, sem separador.
      A nossa `ChaveDeMembro` usa `:` de propósito — é chave do domínio, não do
      protocolo, e misturar as duas é como o resto do app perderia a fronteira.
    */
    const membros = userIds.slice(0, servidor.membros);
    membros.forEach((userId, i) => {
      client.serverMembers.getOrCreate(
        { server: servidor.id, user: userId },
        {
          _id: { server: servidor.id, user: userId },
          /*
            ⚠ **Datas ESPALHADAS, e `new Date(0)` era o defeito.** Todo mundo
            entrando em 1970 fazia a coluna "entrou em" da página de membros
            mostrar "31 de dez. de 1969" em mil linhas — e a ordenação por
            entrada não tinha o que ordenar. É o "arnês mais pobre que o
            protocolo" de novo, e o conserto no `map.ts` (data inválida vira
            ausência) trata o sintoma; este trata a causa.

            Espalhadas em PRIMOS: um passo de 37 dias sobre 250 pessoas cobre
            uns 25 anos sem repetir mês, o que é o que faz a ordenação e o
            formato com ano serem exercitados de verdade.
          */
          joined_at: new Date(
            Date.parse("2026-08-30") - i * 37 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          // Um em cada três tem apelido: o suficiente para ver a mistura de
          // apelido e username na mesma coluna, que é o caso real.
          ...(i % 3 === 0 ? { nickname: `${NOMES[i % NOMES.length]!}-vx` } : {}),
          // Um em cada onze em castigo, sempre no futuro — no passado o estado
          // é indistinguível de "sem castigo" e não exercitaria nada.
          ...(i % 11 === 5
            ? { timeout: new Date(Date.now() + 36e5).toISOString() }
            : {}),
          // Poucos com cargo, e a maioria sem — a proporção de um servidor
          // real. Uma lista onde todo mundo tem cargo não mostra se a seção
          // "sem cargo" cai no lugar certo, que é o último.
          roles: cargosDe(i),
        },
      );
    });

    /*
      Tag, emblema e características — campos do fork que o SDK descarta, então
      a semeadura escreve direto no store (é o que o evento cru faria).

      ⚠ Só no servidor principal, e só um em cada quatro exibindo: sem um
      servidor sem tag e sem alguém que NÃO exibe, nem a ausência nem o
      seletor do menu seriam exercitados.
    */
    if (servidor.id === SERVER_ID) {
      definirPerfilDoServidor(servidor.id, {
        tag: "VTX",
        caracteristicas: ["🛠 produto", "🎨 design", "💬 open source"],
      });
      definirQuemExibeTag(
        servidor.id,
        membros.filter((_, i) => i % 4 === 0),
      );
    }

    /*
      Gente DENTRO dos canais de voz, desde a semeadura.

      É o ponto inteiro da sala: `Ready.voice_states` entrega os ocupantes no
      login, antes de entrar em canal nenhum. Semear só quando alguém "entra"
      exercitaria o caminho de evento e deixaria de fora justamente o que
      diferencia sala de chamada.

      Um dos ocupantes com a tela ligada, para o estado não-padrão existir.
    */
    servidor.canais
      .filter((c) => c.voz)
      .forEach((canal, n) => {
        // Fatias disjuntas: ninguém em duas salas ao mesmo tempo, que é o que
        // o protocolo garante e o que a coluna assume.
        const dentro = membros.slice(n * 4, n * 4 + (canal.dentro ?? 0));
        /* Um por sala silenciado PELO SERVIDOR — o `SRV`. Fora do
           `semearVoz` porque o fato é do MEMBRO, não do estado de voz:
           `can_publish` mora em `ServerMember` no protocolo. */
        dentro.forEach((userId, k) => {
          /* ⚠ `n === 1 && k === 0` e não `k === 3`: as salas têm 2 e 3
             pessoas, então o índice 3 nunca existe — a primeira versão
             semeava um estado inalcançável, que é exatamente o defeito que a
             semeadura existe para evitar. */
          semearMudoDoServidor(servidor.id, userId, n === 1 && k === 0);
          /* ⚠ E o `can_receive`, que NUNCA tinha sido semeado: o campo existia
             no snapshot desde o menu do participante e nenhuma pessoa do rig
             o tinha em `true`, então o ícone de ensurdecido pelo servidor
             nascia inalcançável. Outra sala e outra pessoa que o mudo, de
             propósito: com os dois na mesma linha nunca se veria o caso de um
             só, que é o mais comum. */
          semearSurdoDoServidor(servidor.id, userId, n === 0 && k === 1);
        });
        semearVoz(
          canal.id,
          dentro.map((userId, k) => ({
            userId,
            // Fixo, não `Date.now()`: a ordem da sala é por chegada, e um
            // arnês com relógio real produz captura diferente a cada corrida.
            desde: 1700000000000 + k * 60000,
            tela: n === 0 && k === 0,
            camera: n === 1 && k === 1,
            /*
              ⚠ **Arnês mais pobre que o protocolo — de novo, e o campo já
              existia.** `is_publishing` e `is_receiving` chegam no objeto do
              SDK desde sempre; a semeadura os fixava em `true`, então mudo e
              surdo por participante eram INTESTÁVEIS e o ícone nasceria
              inalcançável.

              Um de cada por sala, e nunca a mesma pessoa: com os dois na
              mesma linha só se veria o fone, porque surdo implica mudo.
            */
            mudo: k === 1,
            surdo: k === 2,
          })),
        );
      });

    // Registro, não evento: é setup em massa, e o caminho de evento existe
    // para chegada incremental. A mesma separação do `seedChannel`.
    registrarServidor(servidor.id, membros);
  }

  semearConversas();
  semearTopicos();
}

/**
 * Posts do fórum, itens da galeria e tópicos de mensagem.
 *
 * ⚠ **O arnês mais pobre que o protocolo, de novo — e dessa vez preventivo.**
 * Sem isto as três telas nasceriam construídas e inalcançáveis sem servidor:
 * a listagem de tópicos é REST, e o firehose não tem rede. Escreve pelo mesmo
 * registro que o evento cru escreve (`anotarCanais` + `semearListagem`), então
 * quem lê não distingue arnês de servidor.
 *
 * Arquivado, spoiler, gif, vídeo, post sem mídia e tópico que eu sigo — um de
 * cada, porque cada um é um ramo da tela que só aparece com o dado.
 */
function semearTopicos(): void {
  const eu = userIds[0]!;
  const agora = Date.now();
  const hora = 3_600_000;
  const canais: object[] = [];
  const aberturas: object[] = [];
  const contagens: Record<string, number> = {};

  const topico = (
    pai: string,
    nome: string,
    quando: number,
    autor: string,
    extra: {
      tags?: string[];
      archived?: boolean;
      pinned?: boolean;
      inReview?: boolean;
      seguir?: boolean;
      mensagens: number;
      reacoes?: Record<string, number>;
    },
    corpo: string,
    anexo?: { nome: string; tipo: "Image" | "Video"; gif?: boolean; bytes?: number },
    daMensagem?: boolean,
  ) => {
    const id = ulidEm(quando);
    const mid = ulidEm(quando + 1);
    canais.push({
      _id: id,
      channel_type: "TextChannel",
      server: SERVER_ID,
      name: nome,
      last_message_id: ulidEm(quando + 5 * 60_000),
      thread: {
        parent: pai,
        owner: autor,
        message: mid,
        archived: extra.archived ?? false,
        ...(extra.pinned ? { pinned: true } : {}),
        ...(extra.inReview ? { in_review: true } : {}),
        tags: extra.tags ?? [],
        followers: extra.seguir ? [autor, eu] : [autor],
      },
    });
    aberturas.push({
      _id: mid,
      channel: daMensagem ? pai : id,
      author: autor,
      content: corpo,
      // O `🎯 4` do card: o mapa cru `emoji → IDs`, com gente de verdade.
      ...(extra.reacoes
        ? {
            reactions: Object.fromEntries(
              Object.entries(extra.reacoes).map(([emoji, n]) => [emoji, userIds.slice(0, n)]),
            ),
          }
        : {}),
      ...(anexo
        ? {
            attachments: [
              {
                _id: "a" + mid,
                tag: "attachments",
                filename: anexo.nome,
                content_type: anexo.gif ? "image/gif" : anexo.tipo === "Video" ? "video/mp4" : "image/png",
                size: anexo.bytes ?? 180_000,
                metadata: { type: anexo.tipo, width: 800, height: 600 },
              },
            ],
          }
        : {}),
    });
    contagens[id] = extra.mensagens;
  };

  const p = (i: number) => userIds[(i * 7) % userIds.length]!;
  topico(FORUM_ID, "Rail duplica a pasta ao arrastar servidor de volta", agora - 20 * hora, p(1), { tags: ["bug", "resolvido"], pinned: true, inReview: true, seguir: true, mensagens: 13, reacoes: { "👀": 1, "🎯": 4 } }, "Reproduz em 100% das vezes com duas pastas aninhadas. Gravação anexada.", { nome: "captura.png", tipo: "Image" });
  topico(FORUM_ID, "Densidade compacta deveria ser o padrão em telas pequenas?", agora - 3 * hora, p(2), { tags: ["pesquisa"], pinned: true, mensagens: 9, reacoes: { "🧠": 6 } }, "Abaixo de 1024 o confortável come metade da altura útil da timeline.");
  topico(FORUM_ID, "Tri-state precisa de atalho de teclado", agora - 6 * hora, p(3), { tags: ["melhoria"], seguir: true, mensagens: 6, reacoes: { "⚡": 9 } }, "Editar 40 permissões com mouse é lento. Proposta: 1/2/3 sobre a linha focada.");
  topico(FORUM_ID, "Soundboard com sons externos: onde entra a permissão?", agora - 26 * hora, p(4), { tags: ["melhoria", "backlog"], mensagens: 4, reacoes: { "👀": 2 } }, "Hoje a matriz separa usar soundboard e usar sons externos, mas a UI não deixa isso claro.", { nome: "diagrama.png", tipo: "Image" });
  topico(FORUM_ID, "Estudo: leitura da timeline em ultrawide", agora - 50 * hora, p(5), { tags: ["pesquisa", "resolvido"], archived: true, mensagens: 15, reacoes: { "🧠": 11 } }, "Testamos 1040 e 1200 de largura máxima com 6 pessoas. 1040 ganhou em varredura.", { nome: "grafico.png", tipo: "Image" });
  topico(FORUM_ID, "Cor de cargo holográfica quebra contraste no tema claro", agora - 74 * hora, p(6), { tags: ["bug"], mensagens: 7, reacoes: { "🐛": 3 } }, "No claro o gradiente cai para 2.1:1 sobre superfície branca.", { nome: "captura-claro.png", tipo: "Image" });

  /*
    Os doze itens da referência, espaçados de 5 h: a galeria agrupa por DIA de
    publicação, e com todos no mesmo dia o rótulo "Ontem" nunca apareceria —
    o arnês mais pobre que a tela. Tamanhos distintos pela mesma razão: o
    total da barra só prova a soma se as parcelas diferirem.
  */
  const midias: [string, string, "Image" | "Video", boolean?][] = [
    ["Rail com pastas — v4", "rail-v4.png", "Image"],
    ["Matriz tri-state em 1440", "matriz.png", "Image"],
    ["Gravação do bug de arraste", "arraste.mp4", "Video"],
    ["Estudo de densidade", "densidade.png", "Image"],
    ["Referência de overlay in-game", "overlay.gif", "Image", true],
    ["Print do crash — conteúdo sensível", "SPOILER_crash.png", "Image"],
    ["Paleta no tema claro", "paleta.png", "Image"],
    ["Fluxo de compartilhar tela", "tela.mp4", "Video"],
    ["Ícones — grade 20", "icones.png", "Image"],
    ["Antes e depois do composer", "composer.png", "Image"],
    ["Teste de waveform", "waveform.gif", "Image", true],
    ["Card de convite — variações", "convite.png", "Image"],
  ];
  midias.forEach(([legenda, arquivo, tipo, gif], i) =>
    topico(GALERIA_ID, legenda, agora - (i + 1) * 5 * hora, p(i + 1), { mensagens: ((i * 5) % 8) + 1 }, "", {
      nome: arquivo,
      tipo,
      gif,
      bytes: tipo === "Video" ? 38_000_000 + i * 1_000_000 : 240_000 + i * 90_000,
    }),
  );

  // Tópicos de MENSAGEM em #geral — a abertura mora no canal pai.
  topico("01JQ0000000000000000000010", "Revisão do editor de cargo", agora - 30 * hora, p(8), { seguir: true, mensagens: 5 }, "Abri a revisão do editor de cargo — comentem aqui para não perder o fio.", undefined, true);
  topico("01JQ0000000000000000000010", "Bitrate padrão das salas", agora - 28 * hora, p(9), { mensagens: 3 }, "Qual bitrate a gente deixa de padrão nas salas novas?", undefined, true);

  for (const c of canais) client.channels.getOrCreate((c as { _id: string })._id, c as never);
  anotarCanais(canais);
  semearListagem(contagens, aberturas);
}

/**
 * As conversas da casa: DMs, um grupo e as notas.
 *
 * Sem isto a coluna da casa abre vazia e nada da etapa 3 é verificável — o
 * mesmo buraco que fez a semeadura de não-lidas existir: **o arnês mais pobre
 * que o protocolo esconde a superfície**.
 *
 * `lastMessageId` é ULID de verdade e ESPAÇADO, porque a coluna ordena por
 * recência decodificando o tempo dele. Todas com o mesmo carimbo dariam uma
 * ordem estável por acidente, que é o pior tipo de teste: passa e não prova.
 */
function semearConversas(): void {
  const eu = userIds[0]!;

  // Notas: a conversa consigo mesmo, que todo mundo tem uma.
  client.channels.getOrCreate(
    "01JQ0000000000000009000000",
    {
      _id: "01JQ0000000000000009000000",
      channel_type: "SavedMessages",
      user: eu,
    } as never,
  );

  // Cinco DMs com gente de relações diferentes, espaçadas no tempo.
  for (let n = 0; n < 5; n++) {
    const outro = userIds[1 + n * 3]!;
    const id = `01JQ000000000000000A${String(n).padStart(6, "0")}`;
    client.channels.getOrCreate(id, {
      _id: id,
      channel_type: "DirectMessage",
      active: true,
      recipients: [eu, outro],
      // Uma hora de distância entre elas: a ordem por recência tem de ser
      // observável, e não um empate resolvido pelo ID.
      last_message_id: ulidEm(Date.now() - n * 3_600_000),
    } as never);
  }

  /*
    ⚠ **Duas DMs de DESCONHECIDO criadas AGORA** — arnês mais pobre que o
    protocolo de novo. As cinco de cima têm ID de 2025, anterior a qualquer
    `inicio` da fila de solicitações, então todas ficam na coluna e a aba de
    solicitações só seria vista vazia. Uma com texto comum e outra com link de
    convite: sem a segunda, o ramo "SUSPEITO" nasceria inalcançável.
  */
  const desconhecidas = [
    {
      outro: userIds[2]!,
      texto:
        "oi! vi seu post sobre a matriz de permissões, posso perguntar uma coisa?",
    },
    {
      outro: userIds[6]!,
      texto: "ganhe nitro grátis entrando aqui https://discord.gg/promo-zone",
    },
  ];
  for (const [n, d] of desconhecidas.entries()) {
    const id = ulidEm(Date.now() - n * 1000);
    const mensagemId = ulidEm(Date.now() - n * 1000 + 1);
    client.channels.getOrCreate(id, {
      _id: id,
      channel_type: "DirectMessage",
      active: true,
      recipients: [eu, d.outro],
      last_message_id: mensagemId,
    } as never);
    registrarPreviaDublada(id, {
      _id: mensagemId,
      author: d.outro,
      content: d.texto,
    });
  }

  // Um grupo, para a linha com contagem de participantes existir.
  client.channels.getOrCreate(
    "01JQ000000000000000B000000",
    {
      _id: "01JQ000000000000000B000000",
      channel_type: "Group",
      name: "spike — off",
      owner: eu,
      recipients: [eu, userIds[2]!, userIds[5]!, userIds[8]!],
      last_message_id: ulidEm(Date.now() - 30 * 60_000),
    } as never,
  );
}

/**
 * Uma pessoa fala algumas vezes seguidas, depois outra assume.
 *
 * Trocar de autor a cada mensagem faria TODA linha abrir grupo, e o
 * agrupamento não seria exercitado nem visto. Corridas de 1 a 5 aproximam
 * conversa — que é a distribuição que a lista precisa aguentar.
 */
function autorDe(seed: number): string {
  const bloco = Math.floor(seed / 3) + (seed % 7 === 0 ? 1 : 0);
  return userIds[bloco % userIds.length]!;
}

/**
 * De vez em quando, uma linha do SISTEMA em vez de fala.
 *
 * Uma a cada 97 — raro como no uso real, e o número é primo de propósito: com
 * um divisor da corrida de autores (1 a 5) ou do passo de tempo, os eventos
 * cairiam sempre na mesma posição relativa do grupo e o caso "alguém entra e
 * fala em seguida" nunca apareceria. É exatamente o caso que a regra de
 * agrupamento existe para cobrir.
 *
 * Os tipos cobrem as formas do domínio: as estruturadas com um usuário, a
 * estruturada com dois, a de canal renomeado — e a chamada, nas suas DUAS
 * faces.
 *
 * ⚠ **`call_started` não existia aqui, e é a linha que mais aparece num canal
 * de voz de verdade.** Quem usa mandou a captura de um canal com nove delas
 * seguidas e nada mais; aqui não havia UMA. Enquanto isso o `toSistema` a
 * deixava cair no `default` e descartava `by` e `finished_at` — ou seja, a
 * tradução perdia dados e o arnês não tinha como mostrar.
 *
 * ⚠ **As duas faces são estados DIFERENTES, e só juntas provam a linha:**
 * `finished_at` ausente é a chamada DE PÉ, que é o caso que ganha o botão de
 * entrar; com valor, é a encerrada, que mostra a duração. Semear só uma
 * deixaria metade da linha construída e inalcançável — a família que esta
 * tabela de pendências já registrou como "construído e invisível".
 *
 * As durações são espalhadas de propósito para exercer os três degraus de
 * `duracaoCurta`: segundos, minutos e horas.
 */
const DURACOES_DE_CHAMADA = [42_000, 8 * 60_000, 73 * 60_000];

function sistemaDe(seed: number, autor: string, id: string): object | undefined {
  if (seed % 97 !== 0 || seed === 0) return undefined;

  const outro = autorDe(seed + 7);
  switch ((seed / 97) % 6) {
    case 0:
      return { type: "user_joined", id: autor, by: outro };
    case 1:
      return { type: "user_left", id: autor, by: outro };
    case 2:
      return { type: "user_added", id: autor, by: outro };
    case 3:
      return { type: "channel_renamed", name: "spike", by: autor };
    case 4: {
      /*
        Encerrada. `finished_at` é contado a partir do TEMPO DO ULID e não de
        `Date.now()`: o SDK deriva `startedAt` de `decodeTime(parent._id)`, e
        misturar as duas bases daria "durou 3 dias" numa mensagem semeada no
        histórico.
      */
      const dura =
        DURACOES_DE_CHAMADA[(seed / 97) % DURACOES_DE_CHAMADA.length] ?? 42_000;
      return {
        type: "call_started",
        by: autor,
        finished_at: new Date(decodeTime(id) + dura).toISOString(),
      };
    }
    default:
      /* De pé: sem `finished_at`. É esta que ganha "Entrar na chamada". */
      return { type: "call_started", by: autor };
  }
}

let ultimoId = "";

/**
 * Anexos, em proporções que exercitam os dois tetos.
 *
 * Uma em 17 leva imagem, e as proporções são escolhidas para cobrir os casos
 * que quebram a reserva de espaço: paisagem larga, retrato muito alto (que o
 * teto de ALTURA precisa segurar, senão a linha vira uma coluna de milhares de
 * pixels) e quadrado. Uma em 41 leva arquivo sem dimensão, que é o outro
 * caminho de render.
 *
 * A URL aponta para um host que não existe — não há servidor de arquivos aqui.
 * E isso é adequado: o que precisa ser verificado é que a CAIXA está certa
 * antes de qualquer byte chegar, e imagem que nunca carrega é o teste mais
 * duro possível dessa propriedade.
 */
const PROPORCOES = [
  { largura: 1600, altura: 900 },
  { largura: 600, altura: 1600 },
  { largura: 800, altura: 800 },
] as const;

function anexosDe(seed: number) {
  if (seed % 41 === 7) {
    return {
      attachments: [
        {
          _id: `f${seed}`,
          tag: "attachments",
          filename: `relatorio-${seed}.pdf`,
          // `size` em bytes, e ele NÃO existia: o rodapé do anexo mostra
          // nome · peso, e sem este campo a metade direita nunca aparecia.
          // Quinta vez que o arnês fica mais pobre que o protocolo.
          size: 120_000 + (seed % 900) * 1_000,
          metadata: { type: "File" },
        },
      ],
    };
  }
  /*
    ⚠ **Áudio, e ele NÃO existia — nona vez que o arnês fica mais pobre que o
    protocolo.** `Metadata.type === "Audio"` é do protocolo desde sempre; o
    firehose só sabia produzir imagem e arquivo, então o player de mensagem de
    voz nasceria construído e inalcançável, que é a família de defeito que o
    painel de fixadas já mostrou uma vez.

    Primo com os outros dois (41 e 17) de propósito: períodos que se cruzam
    pouco, para as três formas de anexo aparecerem na mesma janela.
  */
  if (seed % 29 === 5) {
    return {
      attachments: [
        {
          _id: `f${seed}`,
          tag: "attachments",
          filename: `recado-${seed}.ogg`,
          size: 40_000 + (seed % 300) * 900,
          metadata: { type: "Audio" },
        },
      ],
    };
  }

  /*
    ⚠ **Imagem MAIS vídeo na mesma mensagem — 14ª vez que o arnês fica mais
    pobre que o protocolo, e esta escondia duas coisas de uma vez.**

    Toda mensagem do firehose tinha NO MÁXIMO um anexo, e nenhuma tinha vídeo.
    Consequência: a galeria do visualizador — setas, contador "i de N" e a
    tira de miniaturas — nunca tinha sido vista a partir da timeline, porque
    ela só aparece com mais de uma mídia; e o ramo de VÍDEO do visualizador
    era inalcançável por clique, porque a linha desenha vídeo com `<video>` e
    só a imagem abre o lightbox. Era assim que um `.mp4` na segunda posição
    da galeria saía como `<img>` quebrado sem ninguém ver.

    Período 37, primo com os outros três (41, 29, 17), para as quatro formas
    de anexo caberem na mesma janela sem se atropelarem.
  */
  if (seed % 37 === 11) {
    const p = PROPORCOES[seed % PROPORCOES.length]!;
    return {
      attachments: [
        {
          _id: `f${seed}a`,
          tag: "attachments",
          filename: `captura-${seed}.png`,
          size: 90_000 + (seed % 400) * 1_100,
          metadata: { type: "Image", width: p.largura, height: p.altura },
        },
        {
          _id: `f${seed}b`,
          tag: "attachments",
          filename: `gravacao-${seed}.mp4`,
          size: 2_400_000 + (seed % 700) * 2_000,
          metadata: { type: "Video", width: 1280, height: 720 },
        },
      ],
    };
  }

  if (seed % 17 !== 3) return {};

  const p = PROPORCOES[seed % PROPORCOES.length]!;
  return {
    attachments: [
      {
        _id: `f${seed}`,
        tag: "attachments",
        filename: `imagem-${seed}.png`,
        // Faixa larga de propósito: o formatador troca de unidade em 1.000,
        // e uma amostra que nunca passa de KB não exerce o caminho de MB.
        size: 3_000 + (seed % 5_000) * 1_100,
        metadata: { type: "Image", width: p.largura, height: p.altura },
      },
    ],
  };
}

function createMessage(seed: number, quando?: number): string {
  const id = quando === undefined ? nextId() : nextId(quando);
  const author = autorDe(seed);
  const system = sistemaDe(seed, author, id);
  /*
    Uma em 97 é FIGURINHA — a mensagem inteira, sem texto. Anotada ANTES do
    `getOrCreate`, pelo mesmo mapa que o evento cru alimenta: é o caminho que o
    SDK descarta e que precisa de exercício. Fora da amostra de altura por
    tipo, como o anexo.
  */
  const figurinha =
    !system && seed % 97 === 13
      ? FIGURINHAS_DO_ARNES[seed % FIGURINHAS_DO_ARNES.length]?.id
      : undefined;
  if (figurinha) registrarFigurinhaLocal(id, figurinha);

  client.messages.getOrCreate(
    id,
    {
      _id: id,
      channel: CHANNEL_ID,
      author,
      // O protocolo põe o texto da linha de sistema em `system`, NÃO em
      // `content` — e é por isso que a linha renderizava vazia antes: o
      // componente lia `content` e encontrava string vazia.
      content: system || figurinha ? "" : body(seed),
      // Uma em cada 13 é resposta à anterior — o suficiente para a citação
      // aparecer na janela visível sem dominar a lista, e para o teste de
      // altura de linha ver os dois casos.
      ...(seed % 13 === 6 && seed > 0 ? { replies: [ultimoId] } : {}),
      ...anexosDe(seed),
      // Reações em parte das mensagens, e uma delas COM o usuário local: sem
      // isso o chip aceso nunca apareceria, e o estado que decide se o clique
      // adiciona ou remove ficaria sem exercício.
      // Algumas fixadas — o painel precisa nascer com conteúdo, e o item
      // desafixar precisa de alvo.
      ...(seed % 211 === 40 ? { pinned: true } : {}),
      /*
        ⚠ **Uma em 23 nasce EDITADA, e nenhuma nascia — sétima vez que o arnês
        fica mais pobre que o protocolo.**

        `editedAt` só era escrito pelo evento `update` do firehose (1 em 31,
        e só durante a corrida) e pelo botão "Editar a última". Com a lista
        semeada e parada, que é como a tela é olhada na maior parte do tempo,
        NENHUMA mensagem tinha a marca — e o defeito de a marca não aparecer
        em linha de continuação sobreviveu por causa disso.

        `+ 1` no tempo para a edição ser depois do envio, que é o único
        invariante que essa dupla de campos tem.
      */
      ...(seed % 23 === 5 ? { edited: new Date((quando ?? Date.now()) + 1).toISOString() } : {}),
      /*
        Um cartão de link a cada 29 mensagens.

        ⚠ **O arnês mais pobre que o protocolo, SEXTA vez** — e desta a
        superfície inteira era código que ninguém tinha visto rodar. O embed
        vem do SERVIDOR, então nada no cliente o produziria por acidente.

        Três formas, e não uma: com miniatura, sem miniatura, e sem `site_name`
        (para o caminho que deriva a origem do host da URL). Um arnês com uma
        forma só provaria que a mais comum funciona.

        Um dos três traz `colour`, que é a barra colorida passando pelo clamp —
        o caminho que garante que cor de terceiro não some na superfície.
      */
      ...(seed % 29 === 7
        ? {
            embeds: [
              {
                type: "Website",
                url: `https://exemplo.invalid/spec/${seed}`,
                title: `Resolução de permissões — v${(seed % 9) + 1}`,
                description:
                  "Cadeia completa de @everyone até override de membro, com exemplos de conflito e hierarquia.",
                ...(seed % 87 === 7 ? {} : { site_name: "exemplo.invalid" }),
                ...(seed % 58 === 7
                  ? {
                      image: {
                        url: `https://exemplo.invalid/og/${seed}.png`,
                        width: 1200,
                        height: 630,
                        size: "Preview",
                      },
                    }
                  : {}),
                ...(seed % 116 === 7 ? { colour: "#f0cd8d" } : {}),
              },
            ],
          }
        : {}),
      ...(seed % 17 === 4
        ? {
            reactions: {
              "👍": seed % 34 === 4 ? [autorDe(seed + 1), USUARIO_LOCAL] : [autorDe(seed + 1)],
              ...(seed % 51 === 4 ? { "🔥": [autorDe(seed + 2), autorDe(seed + 3)] } : {}),
            },
          }
        : {}),
      ...(system ? { system } : {}),
      // `as never` como o resto das semeaduras deste arquivo: o payload de
      // hidratação é do PROTOCOLO, e o arnês não pode importar `stoat.js`
      // para nomear o tipo — a fronteira proíbe, com razão.
    } as never,
    true,
  );
  ultimoId = id;
  /*
    O canal passa a saber qual é a última mensagem.

    É o que um servidor de verdade mantém (`Channel.lastMessageId`), e sem isso
    o arnês não conseguia exercitar a semeadura de não lidas no `Ready`: sem
    saber onde a conversa está, não há como dizer se o cursor de leitura ficou
    para trás. O arnês estava mais pobre que o protocolo, e o teste é que
    mostrou.
  */
  client.channels.updateUnderlyingObject(CHANNEL_ID, { lastMessageId: id });
  return id;
}

/**
 * Semeia o canal. Custo de setup, fora da janela medida.
 *
 * Em fatias com yield entre elas: síncrono, 10k hidratações bloqueiam a main
 * thread por segundos sob throttle 4x — o suficiente para o clique seguinte
 * enfileirar com segundos de input delay e para o primeiro frame da medição
 * virar uma barra que domina o p99.
 *
 * Publica a lista UMA vez, no fim: publicar por fatia geraria renders de
 * setup que não interessam a ninguém.
 */
/**
 * Uma chamada FALSA, para o cartão de voz existir sem servidor.
 *
 * ⚠ **Quarta vez que o arnês está mais pobre que o protocolo**, e agora o
 * padrão já tem nome no `CLAUDE.md`. Sem isto, o cartão de chamada, os
 * controles e o anel de fala seriam código que ninguém nunca viu — e a etapa 6
 * inteira dependeria de uma instância de LiveKit para ter a primeira captura de
 * tela.
 *
 * O que ela NÃO simula, de propósito: WebRTC, faixas de áudio e o `Room`. Isto
 * enche o STORE, que é a fronteira que o app enxerga — a mesma separação entre
 * carga em massa e caminho de evento que `seedChannel` estabeleceu.
 */
/**
 * Transmissão falsa — o palco, sem WebRTC.
 *
 * ⚠ **Arnês mais pobre que o protocolo, 11ª vez.** A `chamadaFalsa` fixava
 * `tela: false`, então o `PalcoDeTransmissao` inteiro — prévia, selo de AO
 * VIVO, cronômetro, HUD, fila e coluna — era construído e INALCANÇÁVEL no
 * navegador: a única porta era uma sala LiveKit de verdade. É a mesma família
 * do painel de fixadas, que passou meses renderizando quebrado porque nada no
 * caminho normal chegava até ele.
 *
 * A prévia fica no xadrez, e isso é honesto: sem motor não há faixa, e o
 * palco desenha exatamente o que desenha enquanto o primeiro quadro não vem.
 *
 * `camera: true` junto de propósito — é o que faz aparecer o ladrilho
 * SEPARADO da própria câmera, que é a regra do design mais fácil de quebrar
 * sem ninguém ver.
 */
export function transmissaoFalsa(): void {
  if (lerChamada().estado === "fora") return;
  const ligando = !lerChamada().tela;
  /*
    ⚠ **Arnês mais pobre que o protocolo, 14ª vez — e esta escondeu DOIS
    defeitos relatados por quem usa.**

    Faltava a combinação, não a peça: `transmissaoFalsa` acendia só a SUA tela
    e `chamadaEmVideoFalsa` só a dos outros. "Eu transmitindo E outra pessoa
    transmitindo ao mesmo tempo" não existia em nenhum botão do arnês — que é
    exatamente o estado onde os dois defeitos moram: não havia caminho até a
    tela do outro (`PalcoDeVoz` deriva `dono` como "a sua ganha", e a fila era
    um `<div>`), e o som da tela nunca era pedido.

    Os dois eram alcançáveis só numa sala LiveKit com duas pessoas
    compartilhando ao mesmo tempo. É a mesma família das treze anteriores, com
    a diferença de que aqui cada peça existia e o que faltava era o CRUZAMENTO.

    Uma pessoa e não a lista toda: duas telas no ar já provam a troca, e a
    terceira só somaria ruído à fila.
  */
  const outros = lerChamada().participantes.slice(1);
  definirChamada({
    tela: ligando,
    camera: ligando,
    telaPausada: false,
    telaAudio: ligando ? "ligado" : "sem",
    transmitindo: ligando ? outros.slice(0, 1) : [],
  });
  faixaSinteticaDeTela(ligando);
  espectadoresSinteticos(ligando);
  faixaSinteticaDeTela(ligando, "camera");
  /*
    ⚠ **A SALA, espelhando o motor.** Ele deixou de abrir a prancha ao começar
    a transmitir — a prévia aparece num ladrilho da grade —, e um arnês que
    abrisse a prancha exercitaria um caminho que o produto não tem. É a
    armadilha de sempre, na direção menos vista: o arnês DIFERENTE do produto,
    e não mais pobre que ele.

    Desligar também vai para a grade, e não fecha: quem para de transmitir
    continua na chamada, e a sala é o conteúdo do canal.
  */
  definirPalco({ tipo: "grade" });
}

/**
 * Chamada COM VÍDEO — a grade e o "assistindo", sem WebRTC.
 *
 * ⚠ **Arnês mais pobre que o protocolo, 12ª vez.** A grade e a tela de
 * assistir dependem de `comCamera`, `transmitindo` e `mudos`, que só o motor
 * escreve — e o motor só existe com uma sala LiveKit de verdade. Sem isto as
 * duas telas nasceriam construídas e INALCANÇÁVEIS no navegador, que é o
 * defeito do painel de fixadas e o mesmo que `transmissaoFalsa` acabou de
 * consertar para o palco de transmissão.
 *
 * As faixas de vídeo não existem, e isso é honesto: o ladrilho mostra o avatar
 * com o xadrez por trás, que é exatamente o que ele mostra no intervalo entre
 * pedir a faixa e ela chegar.
 *
 * ⚠ **Cada lista pega gente DIFERENTE**, e não a mesma pessoa três vezes: uma
 * amostra em que quem transmite é também quem está mudo não prova que os três
 * marcadores são independentes — é a mesma lição do recado repetido na member
 * list.
 */
/**
 * Uma faixa de vídeo de MENTIRA, para a prévia da própria tela existir.
 *
 * ⚠ **Arnês mais pobre que o protocolo, 13ª vez — e esta escondeu um defeito
 * de produção por uma rodada inteira.** `transmissaoFalsa` acendia
 * `chamada.tela` e não publicava faixa nenhuma, então todo consumidor que LÊ
 * `faixasDeVideo` mostrava o xadrez. Isso parecia correto ("sem motor não há
 * faixa, e o xadrez é o que se desenha enquanto ela não vem") e mascarava a
 * coisa real: o motor nunca publicava a faixa local de tela no store. O
 * sintoma só apareceu numa chamada de verdade, relatado por quem usa.
 *
 * ⚠ **A chave é `participantes[0]`, e é ela que o leitor procura.** No motor,
 * `participantesDe` põe o participante LOCAL em primeiro; no arnês, o primeiro
 * é um ocupante qualquer da sala. Publicar sob a mesma chave que o leitor
 * consulta é o que faz este teste valer alguma coisa — publicar sob "o meu id"
 * exercitaria um caminho que ninguém percorre.
 *
 * Canvas e não vídeo parado: uma imagem estática não distingue "a faixa
 * chegou" de "a faixa congelou", que é exatamente a diferença que a limpeza
 * do `LocalTrackUnpublished` existe para preservar.
 */
/*
  ⚠ Arnês mais pobre que o protocolo — e agora pela CÂMERA. `transmissaoFalsa`
  acende `camera: true` para o ladrilho "Você · câmera" existir, mas só a
  TELA tinha faixa sintética: o ladrilho nascia sem vídeo, e o vídeo dele
  (D-TELA-15) seria construído e inalcançável no `/dev`. Uma pintura por
  fonte, e a da câmera com outra cor para as duas não se confundirem.
*/
const pinturas = new Map<"tela" | "camera", ReturnType<typeof setInterval>>();

/**
 * Quem assiste a sua tela, sem LiveKit.
 *
 * ⚠ **Arnês mais pobre que o protocolo, de novo, se isto faltasse.** Os
 * anúncios de `vx.assiste` só chegam de uma sala de verdade, então a coluna
 * "Espectadores" e o "N assistindo" nasceriam inalcançáveis no `/dev`. Uma
 * pessoa em cada uma das quatro frases do design — 1080p, 720p pela rede,
 * tela cheia e "não está assistindo" —, porque uma amostra só não prova que as
 * quatro se distinguem.
 */
function espectadoresSinteticos(ligando: boolean): void {
  const [dono, ...outros] = lerChamada().participantes;
  if (!ligando || !dono) {
    limparEspectadores();
    return;
  }
  definirContagemDisponivel(true);
  const [a, b, c] = outros;
  if (a) definirAnuncio(a, [{ dono, altura: 1080, rede: false, cheia: false }]);
  if (b) definirAnuncio(b, [{ dono, altura: 720, rede: true, cheia: false }]);
  if (c) definirAnuncio(c, [{ dono, altura: 1080, rede: false, cheia: true }]);
}

function faixaSinteticaDeTela(ligando: boolean, fonte: "tela" | "camera" = "tela"): void {
  const quem = lerChamada().participantes[0];
  if (!quem) return;
  const chave = chaveDeVideo(quem, fonte);

  const anterior = pinturas.get(fonte);
  if (anterior !== undefined) {
    clearInterval(anterior);
    pinturas.delete(fonte);
  }
  if (!ligando) {
    faixasDeVideo.apagar(chave);
    return;
  }

  const tela = document.createElement("canvas");
  tela.width = 640;
  tela.height = 360;
  const pincel = tela.getContext("2d");
  if (!pincel) return;

  let quadro = 0;
  const pintar = () => {
    quadro += 1;
    pincel.fillStyle = "#14181e";
    pincel.fillRect(0, 0, 640, 360);
    pincel.fillStyle = fonte === "tela" ? "#35c2cc" : "#e8596b";
    pincel.fillRect((quadro * 8) % 640, 150, 120, 60);
    pincel.fillStyle = "#e6eaf0";
    pincel.font = "20px monospace";
    pincel.fillText(`${fonte === "tela" ? "tela" : "câmera"} sintética do arnês`, 24, 40);
  };
  pintar();
  pinturas.set(fonte, setInterval(pintar, 200));

  const faixa = tela.captureStream(5).getVideoTracks()[0];
  if (faixa) faixasDeVideo.set(chave, faixa);
}

export function chamadaEmVideoFalsa(): void {
  const dentro = lerChamada().participantes;
  if (dentro.length === 0) return;

  definirChamada({
    comCamera: dentro.filter((_, i) => i % 2 === 1),
    transmitindo: dentro.slice(1, 2),
    telaComSom: dentro.slice(1, 2),
    mudos: dentro.filter((_, i) => i % 3 === 2),
  });
  definirPalco({ tipo: "grade" });
}

/**
 * O histórico do chat embutido na sala — e ele não existia.
 *
 * ⚠ **Arnês mais pobre que o protocolo, 12ª vez.** A sala do arnês nascia sem
 * mensagem nenhuma, então o chat da sala só mostrava o estado vazio — e o
 * defeito que quem usa relatou (linhas de sistema escrevendo umas por cima das
 * outras, buracos entre mensagens curtas) era inalcançável aqui. É a forma
 * da captura: uma fileira de "iniciou uma chamada", um divisor de dia, duas
 * mensagens curtas do mesmo autor e mais chamadas.
 *
 * Pelo caminho de MASSA (`seedChannel`), como `seed`. Uma vez só: chamar a
 * chamada falsa de novo não duplica o histórico.
 */
function semearChatDaSala(sala: string, dentro: readonly string[]): void {
  if ((channelMessageIds.peek(sala)?.length ?? 0) > 0) return;
  const pessoas = dentro.length > 0 ? dentro : userIds.slice(0, 3);
  const quem = (i: number) => pessoas[i % pessoas.length]!;
  const ids: string[] = [];
  let quando = Date.now() - 2 * 86_400_000;

  const criar = (
    autor: string,
    conteudo: string,
    sistema?: object,
    passo = 37 * 60_000,
  ) => {
    quando += passo;
    const id = ulid(quando);
    client.messages.getOrCreate(
      id,
      {
        _id: id,
        channel: sala,
        author: autor,
        content: conteudo,
        ...(sistema ? { system: sistema } : {}),
      } as never,
      // `false`: não emite `messageCreate`. O adapter já está ligado quando a
      // chamada falsa roda, e carga em massa pelo caminho de evento é o que
      // `seed` documenta como destruidor de âncora.
      false,
    );
    ids.push(id);
  };
  const chamada = (i: number, dura?: number) =>
    criar(quem(i), "", {
      type: "call_started",
      by: quem(i),
      ...(dura === undefined
        ? {}
        : { finished_at: new Date(quando + 37 * 60_000 + dura).toISOString() }),
    });

  for (let i = 0; i < 5; i++) chamada(i, 4_000);
  quando += 86_400_000;
  criar(quem(0), "teste");
  // Um minuto depois: CONTINUA o grupo, que é a terceira forma de linha.
  criar(quem(0), "teste 2", undefined, 60_000);
  for (let i = 0; i < 3; i++) chamada(2, 8 * 60_000);
  criar(quem(1), "alguém ouvindo? o áudio caiu aqui por uns segundos");
  chamada(1);

  seedChannel(sala, ids);
}

export function chamadaFalsa(): () => void {
  ensureWorld();

  /*
    ⚠ **A chamada acontece num canal que EXISTE no mundo, e não acontecia.**

    Ela usava `01JQ…0004` — um id que nenhum canal do arnês tem — e uma lista
    de participantes tirada de `userIds` por índice, sem relação com quem
    `semearVoz` pôs nas salas. Resultado: o cartão flutuante mostrava quatro
    pessoas falando, e as MESMAS salas na coluna de canais não acendiam
    ninguém. O arnês descrevia dois mundos.

    Não deu erro porque as duas metades estavam certas isoladamente: a
    chamada tinha participantes válidos e a coluna tinha ocupantes válidos. O
    defeito só existe na relação, que é a mesma família do recuo do rail.

    Agora a sala é `voz-geral` e os falantes são exatamente quem `semearVoz`
    pôs lá — o anel na coluna e o do cartão passam a descrever o mesmo fato.
  */
  const sala = SALA_DO_ARNES;
  const dentro = ocupantesDe(sala);
  if (dentro.length === 0) return () => {};

  definirChamada({
    estado: "dentro",
    /*
      ⚠ Aqui o fixo é o DESLOCAMENTO, não o instante — e é a exceção à regra
      de cima. A ordem de chegada da sala usa epoch congelado porque o que
      importa é a ordem relativa entre duas pessoas; um cronômetro mede
      distância até AGORA, e um epoch de 2023 mostraria mil horas de chamada.
      O deslocamento fixo dá a mesma leitura em toda corrida, que é o que a
      reprodutibilidade pede.
    */
    desde: Date.now() - (42 * 60 + 17) * 1000,
    channelId: sala,
    participantes: dentro,
    mudo: false,
    surdo: false,
    camera: false,
    tela: false,
    /*
      ⚠ **Arnês mais pobre que o protocolo, de novo.** A chamada falsa não
      definia `qualidade`, então ela ficava em `desconhecida` — o estado
      ANTES do primeiro relatório — e o medidor de quatro barras nascia com
      zero acesas. Um componente novo que só sabe renderizar o caso vazio é
      indistinguível de um componente quebrado.

      `otima` porque é o caso comum de uma chamada que acabou de conectar; os
      outros três se veem trocando esta linha, que é o que o rig serve para
      permitir.
    */
    qualidade: "otima",
  });

  /*
    ⚠ **Navega E abre a sala — as duas metades do `RoomEvent.Connected`.**

    Sem a navegação a sala não apareceria: ela é o conteúdo do canal da
    chamada, e o arnês abre num canal de TEXTO. O botão acenderia o cartão do
    canto e mais nada, que é exatamente o defeito que esta rodada consertou no
    produto — o arnês reproduziria o bug já corrigido.
  */
  semearChatDaSala(sala, dentro);
  selecionarCanal(sala);
  definirPalco({ tipo: "grade" });

  /*
    Quem fala muda a cada ~700ms.

    Rápido o bastante para o anel piscar como pisca de verdade, e devagar o
    bastante para dar para ver. O evento real do LiveKit chega mais rápido que
    isto — o throttle de 120ms do store efêmero é o que segura os dois casos.
  */
  const timer = setInterval(() => {
    const quantos = 1 + Math.floor((Date.now() / 700) % 2);
    const inicio = Math.floor(Date.now() / 700) % dentro.length;
    const falantes = Array.from(
      { length: quantos },
      (_, i) => dentro[(inicio + i) % dentro.length]!,
    );
    definirFalantes(falantes);
  }, 700);

  return () => {
    clearInterval(timer);
    definirFalantes([]);
    encerrarChamada();
  };
}

/**
 * A DM das chamadas diretas falsas — a primeira de `semearConversas`, com
 * `userIds[1]` do outro lado.
 */
const DM_DO_ARNES = "01JQ000000000000000A000000";

/**
 * Alguém liga para você numa DM — pelo caminho do PROTOCOLO, e não do store.
 *
 * ⚠ **Emite os eventos crus no `EventClient`, e é o ponto.** O adapter lê
 * `VoiceChannelJoin` e `VoiceCallUpdate` do evento cru, porque o SDK descarta
 * o segundo; semear o store de toque direto exercitaria o aviso e deixaria de
 * fora a tradução, que é a parte que quebra em silêncio. Aqui os dois sinais
 * chegam na ordem do `voice-ingress` — o `Join` primeiro —, então a
 * deduplicação também é exercitada.
 *
 * Atender tenta a sala de verdade e falha sem LiveKit, com o toast de erro:
 * é o que o produto faz sem servidor de voz. A tela da chamada tem botão
 * próprio (`chamadaDiretaFalsa`).
 */
export function chamadaRecebidaFalsa(): void {
  ensureWorld();
  const quem = userIds[1]!;
  const agora = new Date().toISOString();
  client.events.emit("event", {
    type: "VoiceChannelJoin",
    id: DM_DO_ARNES,
    state: {
      id: quem,
      joined_at: agora,
      is_receiving: true,
      is_publishing: true,
      screensharing: false,
      camera: false,
    },
  } as never);
  client.events.emit("event", {
    type: "VoiceCallUpdate",
    initiator_id: quem,
    channel_id: DM_DO_ARNES,
    started_at: agora,
    ended: false,
  } as never);
}

/** Quem ligou desiste — a sala esvazia e o toque para. */
export function desistirDaChamadaFalsa(): void {
  client.events.emit("event", {
    type: "VoiceChannelLeave",
    id: DM_DO_ARNES,
    user: userIds[1]!,
  } as never);
}

/**
 * A chamada DIRETA em andamento — a tela de duas pessoas, sem WebRTC.
 *
 * Mesma família da `chamadaFalsa`: enche o store que o app enxerga e deixa o
 * motor de fora. O outro lado fala a cada ~900ms para o anel aparecer.
 */
export function chamadaDiretaFalsa(): () => void {
  ensureWorld();
  const eu = userIds[0]!;
  const outro = userIds[1]!;
  definirChamada({
    estado: "dentro",
    desde: Date.now() - (4 * 60 + 12) * 1000,
    channelId: DM_DO_ARNES,
    participantes: [eu, outro],
    mudo: false,
    surdo: false,
    camera: false,
    tela: false,
    qualidade: "otima",
  });
  abrirConversa(DM_DO_ARNES);
  definirPalco({ tipo: "grade" });
  const timer = setInterval(() => {
    definirFalantes(Math.floor(Date.now() / 900) % 2 === 0 ? [outro] : []);
  }, 900);
  return () => {
    clearInterval(timer);
    definirFalantes([]);
    encerrarChamada();
  };
}

/**
 * A sala onde a chamada falsa acontece — `voz-geral`.
 *
 * A primeira das duas com gente, e a que tem teto (`3/8`), então o cartão, o
 * anel na coluna e a contagem descrevem a mesma sala.
 */
const SALA_DO_ARNES = "01JQ0000000000000000000012";

/**
 * Quem `semearVoz` pôs naquela sala.
 *
 * Recalculado com a mesma conta de `ensureWorld` em vez de guardado: uma
 * segunda cópia da regra é a fonte da divergência que esta função existe para
 * fechar.
 */
function ocupantesDe(salaId: string): string[] {
  const servidor = MUNDO[0];
  if (!servidor) return [];
  const membros = userIds.slice(0, servidor.membros);
  const vozes = servidor.canais.filter((c) => c.voz);
  const n = vozes.findIndex((c) => c.id === salaId);
  const canal = vozes[n];
  if (!canal) return [];
  return membros.slice(n * 4, n * 4 + (canal.dentro ?? 0));
}

/** Um ULID com o tempo pedido — a coluna da casa ordena decodificando isto. */
function ulidEm(quando: number): string {
  return ulid(quando);
}

export async function seed(count: number, chunk = 250): Promise<string[]> {
  // O adapter só entra DEPOIS da carga.
  //
  // Assinar antes faz cada mensagem criada emitir `messageCreate`, e a lista
  // passa a crescer evento a evento durante a carga. No fim, `seedChannel`
  // republica as 10k de uma vez — e o salto de N para 10.000 destrói a
  // âncora: a lista termina no começo do histórico em vez de no fim.
  //
  // Carga em massa e chegada incremental são caminhos diferentes. Misturar os
  // dois dá duas fontes competindo pela mesma lista.
  ensureWorld();
  /* O arnês simula um servidor com enquetes (`features.vortex`). */
  definirFuncoesDoArnes(["polls"]);

  const ids: string[] = [];

  // Espalhado por ~5 dias, terminando agora: o passo de ~43s fica dentro da
  // janela de 7 minutos, então quem agrupa é a corrida de autor, e as
  // viradas de meia-noite produzem divisores de data de verdade.
  const inicio = Date.now() - 5 * 86_400_000;
  const passo = Math.max(1, Math.floor((5 * 86_400_000) / count));

  for (let i = 0; i < count; i++) {
    ids.push(createMessage(i, inicio + i * passo));
    if (i % chunk === chunk - 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  semearExpressoesDoArnes(SERVER_ID);
  seedChannel(CHANNEL_ID, ids);
  semearEnquetes(ids);
  ultimaLista = ids;
  // Agora sim: a partir daqui, mensagem nova chega por evento.
  startAdapter();

  /*
    ⚠ **O mundo nasce com não-lidas, e antes não nascia.**

    Quarta vez que o arnês fica mais pobre que o protocolo, e o padrão já tem
    nome nas pendências: `ehMencao` passou três fases sem devolver `true`, a
    semeadura de não-lidas era intestável sem `lastMessageId`, e as quatro abas
    de amigos abriam vazias. Aqui era o RAIL: o firehose fala sempre no canal
    aberto, onde `contabilizarNaoLida` sai na primeira linha, e nenhum outro
    servidor jamais recebia nada.

    Consequência medida no navegador: os três servidores com
    `data-naolidas="false"`, o estado `atencao` da lâmina nunca renderizado, e
    quem usa relatando que a marca de não-lida "continua do mesmo jeito" — ela
    estava correta e não tinha o que mostrar. `falarEmOutroCanal` existia e
    exercitava o caminho, mas um clique por mensagem: o estado só aparecia para
    quem já sabia que ele existia.

    DEPOIS de `startAdapter`, de propósito: é o caminho de EVENTO que contabiliza,
    e é justamente ele que precisa ser exercitado. E fora da janela de medição —
    isto é estado, não vazão, então o gate não muda.

    ⚠ **E depois de um macrotask, o que não é detalhe.** `reemitirServidor` sai
    na primeira linha quando ninguém assina aquele servidor — a mesma regra de
    escopo que segura o gate. Chamando isto de forma síncrona, as nove
    mensagens caem antes de o rail montar e assinar: a contagem entra no mapa e
    o snapshot nunca é republicado.

    Medido: os três servidores em `data-naolidas="false"` depois da semeadura, e
    UM clique em "Falar em outro canal" acendendo os três de uma vez — porque a
    contagem acumulada estava lá esperando alguém reemitir. Guardar o dado sem
    publicar é a forma que este defeito toma, e ela não dá erro.
  */
  return ids;
}

/** As enquetes semeadas. A aberta é o alvo dos votos do firehose (`pollVote`). */
let enquetesSemeadas: { readonly aberta: string; readonly encerrada: string } | undefined;

/** Quais mensagens do arnês carregam as enquetes semeadas — para teste e gate. */
export function enquetesDoArnes(): { readonly aberta: string; readonly encerrada: string } | undefined {
  return enquetesSemeadas;
}

/**
 * Duas enquetes no histórico — uma aberta e uma encerrada.
 *
 * ⚠ **Sétima vez que o arnês fica mais pobre que o protocolo, e desta vez o
 * protocolo é que é mais pobre que o produto.** Enquete não existe no Stoat
 * (ver `store/enquetes.ts`), então o dado não pode vir do SDK como o resto
 * deste arquivo vem: ele é escrito direto no store de cliente, exatamente como
 * `definirChamada` já é escrito para a chamada falsa.
 *
 * Sem isto a superfície ficaria construída e inalcançável — a família de
 * defeito que o painel de fixadas já mostrou uma vez: custa manutenção, não
 * entrega nada, e de fora é idêntica a ausente.
 *
 * As DUAS formas, porque elas diferem em cinco detalhes visuais e uma só não
 * prova a outra: a aberta tem prazo, voto e barra neutra; a encerrada tem
 * selo, troféu e barra verde.
 */
function semearEnquetes(ids: readonly string[]): void {
  /*
    Perto do fim, para caírem na primeira janela de leitura sem ninguém rolar —
    e só em mensagem de GENTE. A posição fixa (`-6`) caía numa linha de sistema
    ("fulano adicionou…"), que a lista agrupa e que não desenha rodapé: a
    enquete aberta existia no store e nunca aparecia, e os votos do firehose
    iam para uma linha que ninguém assina.
  */
  const deGente = ids.filter((id) => !client.messages.get(id)?.systemMessage);
  const aberta = deGente[deGente.length - 5];
  const encerrada = deGente[deGente.length - 2];
  if (!aberta || !encerrada) return;
  enquetesSemeadas = { aberta, encerrada };

  /* Votos são IDs, como o protocolo manda — contagem é derivada no store. */
  const gente = (n: number, prefixo: string) =>
    new Set(Array.from({ length: n }, (_, i) => `${prefixo}${String(i)}`));
  const eu = lerEuDasEnquetes();

  definirEnqueteBruta(aberta, {
    pergunta: "Qual densidade vai como padrão?",
    respostas: [
      { id: "r0", texto: "Confortável" },
      { id: "r1", texto: "Compacto" },
    ],
    maximo: 1,
    expiraEm: Date.now() + 22 * 3_600_000,
    encerradaEm: undefined,
    esconder: false,
    votos: new Map([
      ["r0", gente(14, "a")],
      ["r1", gente(9, "b")],
    ]),
  });

  definirEnqueteBruta(encerrada, {
    pergunta: "Bitrate padrão das salas?",
    respostas: [
      { id: "r0", texto: "64 kbps" },
      { id: "r1", texto: "96 kbps" },
    ],
    maximo: 1,
    expiraEm: Date.now() - 3_600_000,
    encerradaEm: Date.now() - 3_600_000,
    esconder: false,
    votos: new Map([
      ["r0", eu ? new Set([...gente(15, "c"), eu]) : gente(16, "c")],
      ["r1", gente(9, "d")],
    ]),
  });
}

/**
 * Faz o mundo nascer com não-lidas.
 *
 * ⚠ **Quarta vez que o arnês fica mais pobre que o protocolo**, e o padrão já
 * tem nome nas pendências: `ehMencao` passou três fases sem devolver `true`, a
 * semeadura de não-lidas era intestável sem `lastMessageId`, e as quatro abas
 * de amigos abriam vazias. Aqui era o RAIL: o firehose fala sempre no canal
 * aberto, onde `contabilizarNaoLida` sai na primeira linha, e nenhum outro
 * servidor jamais recebia nada.
 *
 * Consequência medida no navegador: os três servidores com
 * `data-naolidas="false"`, o estado `atencao` da lâmina NUNCA renderizado, e
 * quem usa relatando que a marca de não-lida "continua do mesmo jeito" — ela
 * estava correta e não tinha o que mostrar. `falarEmOutroCanal` exercitava o
 * caminho, mas um clique por mensagem: o estado só existia para quem já sabia
 * que ele existia.
 *
 * ⚠ **Chamado DEPOIS de o arnês abrir o servidor, e isso não é preferência.**
 * `reemitirServidor` sai na primeira linha quando ninguém assina aquele
 * servidor — a mesma regra de escopo que segura o gate. Chamando isto dentro
 * de `seed`, as nove mensagens caem na janela em que o rail ainda não assinou:
 * a contagem entra no mapa e o snapshot nunca é republicado.
 *
 * Medido, e é o que fecha o diagnóstico: depois da semeadura os canais já
 * mostravam "1 menção" e "2 não lidas", e os SERVIDORES continuavam em zero —
 * então a contabilidade rodou e só a publicação do rollup faltou. Navegar para
 * outro servidor acendia os três de uma vez, com a contagem acumulada
 * intacta. Adiar por tempo não resolvia; o que resolve é a UI já estar
 * assinando.
 */
export async function semearNaoLidas(quantas = 9): Promise<void> {
  /*
    Espera o shell assentar, e a razão é a regra de escopo.

    `reemitirServidor` sai na primeira linha quando ninguém assina aquele
    servidor — é a mesma economia que segura o gate. Chamando isto no mesmo
    tique em que `selecionarServidor` roda, as mensagens caem antes de o rail
    re-renderizar e assinar: a contagem entra no mapa e o rollup nunca é
    publicado. Medido: canais com "1 menção" e "2 não lidas" enquanto os três
    servidores seguiam em zero.

    ⚠ **E uma lição de método que custou várias tentativas:** três leituras
    minhas disseram "não funcionou" e as três foram tiradas ANTES do commit da
    navegação. A mesma família do "medir no dev server" e do "medir com a aba
    sem compor" que este projeto já registrou duas vezes — o instrumento
    reprovando o momento em vez do código.

    O valor é folgado de propósito: isto é setup de arnês, roda uma vez, e fora
    de qualquer janela medida.
  */
  await new Promise((resolve) => setTimeout(resolve, 1000));
  for (let i = 0; i < quantas; i++) falarEmOutroCanal();
  /* Duas no chat da sala de vídeo — o "▣ Apresentações 2" do design. Sem
     isto o contador na linha de voz (D-VOZ-04) nasceria inalcançável: o
     `falarEmOutroCanal` pula voz de propósito. */
  for (let i = 0; i < 2; i++) falarNoCanal(SALA_DE_VIDEO_ID);
}

const SALA_DE_VIDEO_ID = "01JQ0000000000000000000015";

function falarNoCanal(alvo: string): void {
  falas++;
  const id = nextId();
  client.messages.getOrCreate(
    id,
    { _id: id, channel: alvo, author: autorDe(falas), content: body(falas) },
    true,
  );
}

let ultimaLista: readonly string[] = [];

/**
 * Edita a mensagem mais recente. Existe para provar, à mão e observável, a
 * afirmação central da arquitetura: editar uma mensagem toca UMA linha.
 */
/**
 * Edita um id ESPECÍFICO e devolve o diagnóstico completo.
 * Chamado com um id lido do DOM, elimina qualquer dúvida sobre a mensagem
 * estar montada e assinada no momento da escrita.
 */
export function editarId(id: string) {
  const antes = diagnostico(id);
  const conteudo = "EDITADA " + new Date().toLocaleTimeString("pt-BR");
  client.messages.updateUnderlyingObject(id, { content: conteudo, editedAt: new Date() });
  const depois = diagnostico(id);
  return {
    id,
    conteudo,
    antes,
    depois,
    sdkAtualizou: depois.noSdk === conteudo,
    storeAcompanhou: depois.noStore === conteudo,
  };
}

export function editarUltima() {
  // Varre do fim para trás até achar um id REALMENTE assinado. Editar uma
  // mensagem desmontada não testa nada.
  let id: string | undefined;
  for (let i = ultimaLista.length - 1; i >= 0 && i > ultimaLista.length - 400; i--) {
    const candidato = ultimaLista[i];
    if (candidato && diagnostico(candidato).assinado) {
      id = candidato;
      break;
    }
  }
  if (!id) {
    const n = ultimaLista.length;
    return {
      erro: 'nenhum id assinado',
      tamanhoDaLista: n,
      amostraDoFim: [n - 1, n - 10, n - 30].map((i) => ({
        i,
        id: ultimaLista[i],
        ...(ultimaLista[i] ? diagnostico(ultimaLista[i]) : {}),
      })),
    };
  }
  const conteudo = "EDITADA " + new Date().toLocaleTimeString("pt-BR");
  client.messages.updateUnderlyingObject(id, {
    content: conteudo,
    editedAt: new Date(),
  });
  // Leitura de volta pelo getter do PRÓPRIO SDK: separa 'a escrita não
  // aplicou' de 'a escrita aplicou mas meu efeito não rastreia'.
  const d = diagnostico(id);
  return { id, conteudo, ...d, escritaAplicou: d.noSdk === conteudo, storeAcompanhou: d.noStore === conteudo };
}


/**
 * Carrega uma pagina de historico ANTIGO.
 *
 * Os ids sao gerados com timestamp anterior ao do seed, para a ordem ULID
 * bater com a posicao na lista — carregar historico com id mais novo que o
 * que ja esta na tela mentiria sobre a ordenacao.
 */
export function carregarHistorico(quantas = 50): string[] {
  const base = Date.now() - 86_400_000;
  const antigas: string[] = [];

  for (let i = quantas - 1; i >= 0; i--) {
    const id = nextId(base + i);
    client.messages.getOrCreate(id, {
      _id: id,
      channel: CHANNEL_ID,
      author: userIds[i % userIds.length]!,
      content: `historico ${quantas - i} — ` + body(i + 7),
    });
    antigas.push(id);
  }

  antigas.reverse();
  prependHistory(CHANNEL_ID, antigas);
  ultimaLista = antigas.concat(ultimaLista);
  return antigas;
}

/**
 * Manda uma mensagem para um canal que NÃO está aberto.
 *
 * Existe porque não-lida é, por definição, o que acontece longe dos olhos: o
 * firehose fala sempre no canal aberto, e ali `contabilizarNaoLida` sai na
 * primeira linha. Sem este caminho, a contabilidade inteira — contador do
 * canal, rollup do servidor, menção, zerar ao abrir — poderia estar quebrada
 * e o arnês passaria verde.
 *
 * Uma a cada três menciona o usuário local, para o badge de menção sair do
 * zero sem que toda mensagem vire menção.
 */
let falas = 0;

export function falarEmOutroCanal(): string | undefined {
  const outros = MUNDO.flatMap((s) =>
    s.canais.filter((c) => !c.voz && c.id !== CHANNEL_ID).map((c) => c.id),
  );
  const alvo = outros[falas % outros.length];
  if (!alvo) return undefined;

  falas++;
  const id = nextId();
  const mencao = falas % 3 === 0 ? `<@${userIds[0]!}> ` : "";
  client.messages.getOrCreate(
    id,
    {
      _id: id,
      channel: alvo,
      author: autorDe(falas),
      content: `${mencao}${body(falas)}`,
    },
    true,
  );
  return alvo;
}

/** Quantas mensagens o índice do canal tem? `null` = nunca publicado. */
function tamanhoDaLista(id: string): number | null {
  return channelMessageIds.getSnapshot(id)?.length ?? null;
}

export type FirehoseMix = {
  message: number;
  update: number;
  reaction: number;
  typing: number;
  presence: number;
  /** `MessagePollVote` na enquete aberta semeada. */
  pollVote: number;
};

/** Proporção de um canal movimentado: presença domina, mensagem é minoria. */
const DEFAULT_MIX: FirehoseMix = {
  presence: 53,
  /* ~10 votos/s a 500 ev/s: o gate mede que um voto acorda SÓ a linha da enquete. */
  pollVote: 2,
  typing: 20,
  reaction: 15,
  update: 6,
  message: 4,
};

export function startFirehose(
  eventsPerSecond: number,
  existing: readonly string[],
  mix: FirehoseMix = DEFAULT_MIX,
) {
  const table: (keyof FirehoseMix)[] = [];
  for (const [kind, weight] of Object.entries(mix)) {
    for (let i = 0; i < weight; i++) table.push(kind as keyof FirehoseMix);
  }

  const ids = [...existing];
  let n = 0;

  /**
   * Alvo de edição e reação: a CAUDA da lista, não o acervo inteiro.
   *
   * Sortear entre 10k mensagens faz quase todo evento cair em mensagem não
   * assinada — barato, e mentiroso. Num chat real se edita e se reage ao que
   * acabou de ser dito, que é exatamente o que está na tela e assinado. Sem
   * este viés o gate aprova o caminho fácil e a regressão de escopo passa.
   */
  const RECENTES = 120;
  const recente = (k: number) =>
    ids[Math.max(0, ids.length - 1 - (k % RECENTES))];
  // Um tick a cada 16ms disparando um lote: aproxima rajada de websocket
  // melhor que um setInterval por evento, e não afoga o event loop com timers.
  const perTick = Math.max(1, Math.round((eventsPerSecond * 16) / 1000));

  const timer = setInterval(() => {
    // Cronometrado: o gerador roda no mesmo thread que o app e sofre o
    // mesmo throttle. Sem isto, um pico do PRÓPRIO gerador é indistinguível
    // de jank do app — e o gate reprovaria o arnês, não o código.
    const inicioDoTick = performance.now();
    for (let i = 0; i < perTick; i++) {
      const kind = table[n++ % table.length]!;

      switch (kind) {
        case "message":
          ids.push(createMessage(n));
          break;

        case "update": {
          const id = recente(n * 31);
          if (id) {
            // Forma de objeto parcial — a mesma que o próprio SDK usa em
            // handleEvent. A forma de caminho de 3 argumentos não propagava,
            // e o firehose ficava sem exercitar edição nenhuma.
            client.messages.updateUnderlyingObject(id, {
              content: body(n),
              editedAt: new Date(),
            });
          }
          break;
        }

        case "reaction": {
          const id = recente(n * 17);
          const message = id ? client.messages.get(id) : undefined;
          if (message) {
            const emoji = ["👍", "🔥", "🎯", "🧊"][n % 4]!;
            const users = message.reactions.get(emoji);
            if (users) users.add(userIds[n % userIds.length]!);
            else message.reactions.set(emoji, new Set([userIds[n % userIds.length]!]) as never);
          }
          break;
        }

        case "typing": {
          /*
            ⚠ **Um punhado de pessoas, não as quarenta — oitava vez que o
            arnês fica mais pobre que o protocolo, agora por EXCESSO.**

            O ciclo antigo percorria `userIds` inteiro, então o conjunto de
            quem digita saturava em 20 e nunca esvaziava: a faixa dizia "20
            pessoas estão digitando…" para sempre. Os dois casos que o design
            desenha — uma pessoa com nome, duas com "e" — eram inalcançáveis,
            e foi assim que "alguém está digitando…" sobreviveu no ar depois
            de a member list existir.

            A VAZÃO não muda: a mesma fatia dos 500 ev/s continua sendo de
            digitação. O que muda é o número de pessoas distintas, e um canal
            onde três pessoas alternam é mais parecido com um canal de verdade
            do que um onde vinte digitam sem parar.
          */
          const channel = client.channels.get(CHANNEL_ID);
          const user = client.users.get(userIds[n % QUEM_DIGITA]!);
          if (channel && user) {
            client.emit(n % 2 ? "channelStartTyping" : "channelStopTyping", channel, user);
          }
          break;
        }

        case "pollVote": {
          /*
            Pelo caminho cru do socket, o mesmo de um `MessagePollVote` real:
            `anotarEventoDeEnquete` aplica e `republicarEnquete` acorda só a
            linha da enquete. Outras pessoas, nunca o "eu" — trocar o meu voto
            por baixo de quem está olhando não é carga, é ruído.
          */
          const alvo = enquetesSemeadas?.aberta;
          const user = userIds[1 + (n % (userIds.length - 1))];
          if (alvo && user) {
            const respostas = [["r0"], ["r1"], []][n % 3]!;
            client.events.emit("event", {
              type: "MessagePollVote",
              id: alvo,
              user_id: user,
              answers: respostas,
            } as never);
          }
          break;
        }

        case "presence": {
          const id = userIds[n % userIds.length]!;
          const user = client.users.get(id);
          if (user) {
            // Precisa mexer em status.presence: mudar só `online` deixava o
            // adapter mapeando sempre para "offline", e nenhuma linha
            // re-renderizava. Presença não estava sendo testada.
            const presences = ["Online", "Idle", "Busy", "Invisible"] as const;
            client.users.updateUnderlyingObject(id, {
              status: { presence: presences[n % presences.length] },
            } as never);
            client.emit("userUpdate", user, {} as never);
          }
          break;
        }
      }
    }
    count("eventos", perTick);
    const custo = performance.now() - inicioDoTick;
    count("tickMs", custo);
    countMax("maxTickMs", custo);
  }, 16);

  return () => clearInterval(timer);
}

// Sonda de console, no nível do módulo — expor de dentro de um componente é
// mutação de global durante o render, e o React Compiler reprova com razão.
if (import.meta.env.DEV) {
  (globalThis as never as Record<string, unknown>).__editarId = editarId;
  (globalThis as never as Record<string, unknown>).__diagnostico = diagnostico;
  /**
   * Sonda de coleção: o canal tem índice? quantas mensagens?
   *
   * Existe porque a pergunta "a lista está vazia porque a mensagem não entrou
   * no índice, ou porque o componente não leu?" não tem resposta pelo DOM — os
   * dois casos renderizam a mesma coisa: nada.
   */
  (globalThis as never as Record<string, unknown>).__fila = estadoDaFila;
  (globalThis as never as Record<string, unknown>).__lista = tamanhoDaLista;
}
