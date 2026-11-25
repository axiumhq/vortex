import { describe, expect, it } from "vitest";

import { lerNotificacoes } from "../store/notificacoes";
import {
  decidirEntrega,
  decidirEntregaDeChamada,
  decidirEntregaDeEvento,
  emSilencioNoturno,
  mudancaDeAmizade,
  textoDeAmizade,
  type ContextoDeChamada,
  textoDaNotificacao,
  type Contexto,
  type MensagemRecebida,
} from "./decidir";

const prefs = { ...lerNotificacoes(), silencioNoturno: false };

/* Uma quarta às 15:00 — fora de qualquer silêncio. */
const QUARTA_15H = new Date(2026, 8, 16, 15, 0);

const msg = (m: Partial<MensagemRecebida> = {}): MensagemRecebida => ({
  mensagemId: "m",
  channelId: "c",
  serverId: "s",
  tipoDoCanal: "servidor",
  autorNome: "zola",
  canalNome: "geral",
  servidorNome: "go drinking",
  texto: "oi",
  minha: false,
  mencionaVoce: false,
  mencionaTodos: false,
  mencionaCargo: false,
  ...m,
});

const ctx = (c: Partial<Contexto> = {}): Contexto => ({
  prefs,
  nivel: undefined,
  silenciado: false,
  servidorSilenciado: false,
  suprimirTodos: false,
  suprimirCargos: false,
  naoPerturbe: false,
  agora: QUARTA_15H,
  janelaEmFoco: false,
  vendoCanal: false,
  ...c,
});

const canais = (m: MensagemRecebida, c: Contexto) =>
  [...(decidirEntrega(m, c)?.canais ?? [])].sort();

describe("quem notifica", () => {
  it("menção direta com a janela atrás: som e notificação do sistema", () => {
    expect(canais(msg({ mencionaVoce: true }), ctx())).toEqual(["push", "som"]);
  });

  it("DM com a janela à frente: toast e som, sem notificação do sistema", () => {
    expect(canais(msg({ tipoDoCanal: "dm", serverId: undefined }), ctx({ janelaEmFoco: true }))).toEqual([
      "som",
      "toast",
    ]);
  });

  /* O padrão de canal de servidor é só menções. */
  it("mensagem comum em canal sem nível: nada", () => {
    expect(decidirEntrega(msg(), ctx({ janelaEmFoco: true }))).toBeUndefined();
  });

  it("mensagem comum em canal 'todas': toast", () => {
    expect(canais(msg(), ctx({ janelaEmFoco: true, nivel: "todas" }))).toEqual(["toast"]);
  });

  it("a própria mensagem nunca notifica", () => {
    expect(decidirEntrega(msg({ minha: true, mencionaVoce: true }), ctx())).toBeUndefined();
  });

  it("vendo o canal com a janela à frente: nada", () => {
    expect(
      decidirEntrega(msg({ mencionaVoce: true }), ctx({ janelaEmFoco: true, vendoCanal: true })),
    ).toBeUndefined();
  });

  /* O canal aberto numa janela minimizada ainda precisa avisar. */
  it("canal aberto mas janela atrás: notifica", () => {
    expect(canais(msg({ mencionaVoce: true }), ctx({ vendoCanal: true }))).toEqual(["push", "som"]);
  });

  it("não perturbe, canal silenciado e nível 'nada' calam tudo", () => {
    const m = msg({ mencionaVoce: true });
    expect(decidirEntrega(m, ctx({ naoPerturbe: true }))).toBeUndefined();
    expect(decidirEntrega(m, ctx({ silenciado: true }))).toBeUndefined();
    expect(decidirEntrega(m, ctx({ nivel: "nada" }))).toBeUndefined();
  });

  it("notificações no desktop desligadas: sem notificação do sistema", () => {
    expect(canais(msg({ mencionaVoce: true }), ctx({ prefs: { ...prefs, desktop: false } }))).toEqual(["som"]);
  });
});

describe("servidor e canal", () => {
  it("servidor silenciado cala até a menção direta", () => {
    expect(
      decidirEntrega(msg({ mencionaVoce: true }), ctx({ servidorSilenciado: true })),
    ).toBeUndefined();
  });

  /* Silêncio de servidor não alcança conversa: DM não mora em servidor. */
  it("servidor silenciado não cala DM", () => {
    expect(
      canais(msg({ tipoDoCanal: "dm", serverId: undefined }), ctx({ servidorSilenciado: true })),
    ).toEqual(["push", "som"]);
  });

  it("padrão do servidor 'todas' (já resolvido em nivel) libera mensagem comum", () => {
    expect(canais(msg(), ctx({ janelaEmFoco: true, nivel: "todas" }))).toEqual(["toast"]);
  });

  it("@everyone conta como menção, a menos que o servidor suprima", () => {
    expect(canais(msg({ mencionaTodos: true }), ctx())).toEqual(["push", "som"]);
    expect(decidirEntrega(msg({ mencionaTodos: true }), ctx({ suprimirTodos: true }))).toBeUndefined();
  });

  /* Suprimir rebaixa a mensagem comum — não descarta. */
  it("@everyone suprimido em canal 'todas' ainda avisa como mensagem", () => {
    expect(
      decidirEntrega(msg({ mencionaTodos: true }), ctx({ suprimirTodos: true, nivel: "todas", janelaEmFoco: true }))
        ?.evento,
    ).toBe("mensagem");
  });

  it("suprimir @everyone não cala o @você que veio junto", () => {
    expect(
      decidirEntrega(
        msg({ mencionaTodos: true, mencionaVoce: true }),
        ctx({ suprimirTodos: true }),
      )?.evento,
    ).toBe("mencaoDireta");
  });

  it("menção de cargo suprimida", () => {
    expect(
      decidirEntrega(msg({ mencionaCargo: true }), ctx({ janelaEmFoco: true }))?.evento,
    ).toBe("mencaoDeCargo");
    expect(
      decidirEntrega(msg({ mencionaCargo: true }), ctx({ janelaEmFoco: true, suprimirCargos: true })),
    ).toBeUndefined();
  });
});

describe("amizade", () => {
  it("pedido recebido", () => {
    expect(mudancaDeAmizade("None", "Incoming")).toBe("pedido");
    expect(mudancaDeAmizade(undefined, "Incoming")).toBe("pedido");
  });

  it("aceite só quando o pedido era MEU", () => {
    expect(mudancaDeAmizade("Outgoing", "Friend")).toBe("aceite");
    /* Eu aceitei o pedido dela: não é notícia. */
    expect(mudancaDeAmizade("Incoming", "Friend")).toBeUndefined();
    expect(mudancaDeAmizade(undefined, "Friend")).toBeUndefined();
  });

  it("repetição e desfazer não avisam", () => {
    expect(mudancaDeAmizade("Incoming", "Incoming")).toBeUndefined();
    expect(mudancaDeAmizade("Friend", "None")).toBeUndefined();
    expect(mudancaDeAmizade("None", "Blocked")).toBeUndefined();
  });

  it("passa pelo não perturbe, pelo horário e pela matriz", () => {
    const base = { prefs, naoPerturbe: false, agora: QUARTA_15H, janelaEmFoco: true };
    /* O padrão de amizade é só toast. */
    expect([...(decidirEntregaDeEvento("amizade", base)?.canais ?? [])]).toEqual(["toast"]);
    expect(decidirEntregaDeEvento("amizade", { ...base, naoPerturbe: true })).toBeUndefined();
    expect(decidirEntregaDeEvento("amizade", { ...base, janelaEmFoco: false })).toBeUndefined();
    expect(
      decidirEntregaDeEvento("amizade", {
        ...base,
        prefs: { ...prefs, silencioNoturno: true, silencioDas: "14:00", silencioAte: "16:00", silencioDias: [3] },
      }),
    ).toBeUndefined();
  });

  it("o texto do design", () => {
    expect(textoDeAmizade("pedido", "bea.t")).toEqual({
      titulo: "bea.t",
      corpo: "enviou um pedido de amizade",
    });
    expect(textoDeAmizade("aceite", "bea.t").corpo).toBe("aceitou seu pedido de amizade");
  });
});

describe("horário de silêncio", () => {
  const noturno = { ...prefs, silencioNoturno: true, silencioDas: "22:00", silencioAte: "08:00", silencioDias: [1, 2, 3, 4, 5] };

  it("segunda às 23:00 está em silêncio", () => {
    expect(emSilencioNoturno(noturno, new Date(2026, 8, 14, 23, 0))).toBe(true);
  });

  /* A madrugada pertence ao dia em que o silêncio começou. */
  it("sábado às 02:00 conta como sexta à noite — silêncio", () => {
    expect(emSilencioNoturno(noturno, new Date(2026, 8, 19, 2, 0))).toBe(true);
  });

  it("segunda às 02:00 conta como domingo à noite — livre", () => {
    expect(emSilencioNoturno(noturno, new Date(2026, 8, 14, 2, 0))).toBe(false);
  });

  it("quarta às 15:00 está livre", () => {
    expect(emSilencioNoturno(noturno, QUARTA_15H)).toBe(false);
  });
});

describe("texto", () => {
  it("diz quem e onde, e limpa menções cruas", () => {
    const t = textoDaNotificacao(msg({ texto: "oi <@01ARZ3NDEKTSV4RRFFQ69G5FAV>, olha" }), true);
    expect(t.titulo).toBe("zola em #geral · go drinking");
    expect(t.corpo).toBe("oi @menção, olha");
  });

  it("sem prévia, não mostra o conteúdo", () => {
    expect(textoDaNotificacao(msg({ texto: "segredo" }), false).corpo).toBe("Nova mensagem");
  });
});

describe("chamada recebida", () => {
  const noturno = { ...prefs, silencioNoturno: true, silencioDas: "22:00", silencioAte: "08:00", silencioDias: [1, 2, 3, 4, 5] };
  /* Segunda às 23:00 — dentro do horário de silêncio. */
  const SEGUNDA_23H = new Date(2026, 8, 14, 23, 0);

  const chamada = (c: Partial<ContextoDeChamada> = {}): ContextoDeChamada => ({
    prefs,
    naoPerturbe: false,
    agora: QUARTA_15H,
    janelaEmFoco: false,
    silenciado: false,
    amigo: false,
    ...c,
  });
  const por = (c: ContextoDeChamada) => [...(decidirEntregaDeChamada(c)?.canais ?? [])].sort();

  it("janela atrás: toast, som e push", () => {
    expect(por(chamada())).toEqual(["push", "som", "toast"]);
  });

  /* O toast da chamada fica mesmo com a janela à frente — e ao contrário do
     da mensagem, com ela ATRÁS também: ele é a única forma de atender. */
  it("janela à frente: toast e som, sem push", () => {
    expect(por(chamada({ janelaEmFoco: true }))).toEqual(["som", "toast"]);
  });

  it("não perturbe cala tudo, inclusive o aviso", () => {
    expect(decidirEntregaDeChamada(chamada({ naoPerturbe: true }))).toBeUndefined();
  });

  it("conversa silenciada: só o toast", () => {
    expect(por(chamada({ silenciado: true }))).toEqual(["toast"]);
  });

  it("horário de silêncio: só o toast — menos para amigo", () => {
    expect(por(chamada({ prefs: noturno, agora: SEGUNDA_23H }))).toEqual(["toast"]);
    expect(por(chamada({ prefs: noturno, agora: SEGUNDA_23H, amigo: true }))).toEqual(["push", "som", "toast"]);
  });

  it("obedece a matriz: sem a coluna, sem o canal", () => {
    const soSom = { ...prefs, matriz: new Set(["chamada:som"]) };
    expect(por(chamada({ prefs: soSom }))).toEqual(["som"]);
    expect(decidirEntregaDeChamada(chamada({ prefs: { ...prefs, matriz: new Set() } }))).toBeUndefined();
  });
});

describe("tópicos: só a menção avisa", () => {
  const topico = (m: Partial<MensagemRecebida> = {}) =>
    msg({ ehTopico: true, paiId: "pai", ...m });

  it("menção em tópico notifica como menção em canal", () => {
    expect(canais(topico({ mencionaVoce: true }), ctx())).toEqual(
      canais(msg({ mencionaVoce: true }), ctx()),
    );
    expect(decidirEntrega(topico({ mencionaVoce: true }), ctx())?.evento).toBe("mencaoDireta");
  });

  it("mensagem comum em tópico seguido não toca nem notifica", () => {
    expect(decidirEntrega(topico(), ctx())).toBeUndefined();
  });

  it("nem com o nível do canal em \"todas\"", () => {
    expect(decidirEntrega(topico(), ctx({ nivel: "todas", janelaEmFoco: true }))).toBeUndefined();
    /* o canal comum, no mesmo nível, avisaria — a regra é do tópico */
    expect(decidirEntrega(msg(), ctx({ nivel: "todas", janelaEmFoco: true }))).toBeDefined();
  });

  it("menção em tópico respeita silêncio e foco", () => {
    expect(decidirEntrega(topico({ mencionaVoce: true }), ctx({ silenciado: true }))).toBeUndefined();
    expect(
      decidirEntrega(topico({ mencionaVoce: true }), ctx({ vendoCanal: true, janelaEmFoco: true })),
    ).toBeUndefined();
  });
});
