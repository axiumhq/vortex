import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";

import { client } from "./client";
import {
  carregarTopicosDoCanal,
  limparIndiceDeTopicos,
  limparTopicosCarregados,
  topicoDaMensagem,
  topicoPorMensagem,
} from "./topicos";
import { aplicarEventoCru, anotarCanais, limparMetaDeCanal } from "./vortexCanal";

/**
 * O índice mensagem -> tópico.
 *
 * Errar não dá erro: dá a linha mostrando "abrir tópico" sobre uma mensagem que
 * já tem um, ou a referência de um tópico apagado grudada na mensagem.
 */

const PAI = "01PAI";
const T1 = ulid();
const T2 = ulid();

const cru = (id: string, mensagem: string | undefined, nome = "t") => ({
  _id: id,
  channel_type: "TextChannel",
  server: "01SRV",
  name: nome,
  thread: { parent: PAI, owner: "01DONO", ...(mensagem ? { message: mensagem } : {}) },
});

function limpar() {
  limparMetaDeCanal();
  limparIndiceDeTopicos();
  limparTopicosCarregados();
}
beforeEach(limpar);
afterEach(limpar);

describe("índice mensagem -> tópico", () => {
  it("criar acorda só a mensagem certa", () => {
    const a = vi.fn();
    const b = vi.fn();
    const pa = topicoPorMensagem.subscriber("MSG_A")(a);
    const pb = topicoPorMensagem.subscriber("MSG_B")(b);
    anotarCanais([cru(T1, "MSG_A")]);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(topicoPorMensagem.getSnapshot("MSG_A")).toBe(T1);
    expect(topicoDaMensagem(PAI, "MSG_A")).toBe(T1);
    pa();
    pb();
  });

  it("atualizar sem mexer na abertura não acorda ninguém; trocar a abertura acorda as duas pontas", () => {
    anotarCanais([cru(T1, "MSG_A")]);
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const soltar = [
      topicoPorMensagem.subscriber("MSG_A")(a),
      topicoPorMensagem.subscriber("MSG_B")(b),
      topicoPorMensagem.subscriber("MSG_C")(c),
    ];
    anotarCanais([cru(T1, "MSG_A", "renomeado")]);
    expect(a).not.toHaveBeenCalled();

    anotarCanais([cru(T1, "MSG_B", "renomeado")]);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).not.toHaveBeenCalled();
    expect(topicoPorMensagem.getSnapshot("MSG_A")).toBeNull();
    expect(topicoPorMensagem.getSnapshot("MSG_B")).toBe(T1);
    soltar.forEach((s) => s());
  });

  it("apagar o tópico remove do índice e acorda só a mensagem dele", () => {
    anotarCanais([cru(T1, "MSG_A"), cru(T2, "MSG_B")]);
    const a = vi.fn();
    const b = vi.fn();
    const sa = topicoPorMensagem.subscriber("MSG_A")(a);
    const sb = topicoPorMensagem.subscriber("MSG_B")(b);
    aplicarEventoCru({ type: "ChannelDelete", id: T1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(topicoDaMensagem(PAI, "MSG_A")).toBeUndefined();
    expect(topicoDaMensagem(PAI, "MSG_B")).toBe(T2);
    sa();
    sb();
  });

  it("getSnapshot é estável e o subscriber é o mesmo por mensagem", () => {
    anotarCanais([cru(T1, "MSG_A")]);
    expect(topicoPorMensagem.getSnapshot("MSG_A")).toBe(topicoPorMensagem.getSnapshot("MSG_A"));
    expect(topicoPorMensagem.subscriber("MSG_A")).toBe(topicoPorMensagem.subscriber("MSG_A"));
    expect(topicoPorMensagem.getSnapshot("NUNCA")).toBeUndefined();
  });

  it("canal diferente do pai não acha; tópico de fórum não entra no índice", () => {
    anotarCanais([cru(T1, "MSG_A")]);
    expect(topicoDaMensagem("01OUTRO", "MSG_A")).toBeUndefined();

    anotarCanais([
      { _id: PAI, channel_type: "TextChannel", server: "01SRV", name: "forum", forum: { tags: [] } },
      cru(T2, "MSG_F"),
    ]);
    expect(topicoDaMensagem(PAI, "MSG_F")).toBeUndefined();
  });
});

describe("carregarTopicosDoCanal", () => {
  const CANAL = "01CANALCARGA";
  let get: { mock: { calls: unknown[][] }; mockClear(): void; mockRestore(): void; mockImplementation(f: never): void };

  beforeEach(() => {
    client.channels.getOrCreate(CANAL, {
      _id: CANAL,
      channel_type: "TextChannel",
      server: "01SRV",
      name: "geral",
    } as never);
    get = vi.spyOn(client.api, "get").mockImplementation(((url: string) => {
      const arquivados = url.includes("archived=true");
      return Promise.resolve({
        threads: [
          {
            _id: arquivados ? T2 : T1,
            channel_type: "TextChannel",
            server: "01SRV",
            name: "t",
            thread: {
              parent: CANAL,
              owner: "01DONO",
              message: arquivados ? "MSG_ARQ" : "MSG_ATIVA",
              archived: arquivados,
            },
          },
        ],
        messages: [],
        users: [],
        message_counts: {},
      });
    }));
  });
  afterEach(() => get.mockRestore());

  it("busca ativos e arquivados, uma vez por canal", async () => {
    expect(await carregarTopicosDoCanal(CANAL)).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
    const urls = get.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("archived=true"))).toBe(true);
    expect(urls.every((u) => u.includes(`channel=${CANAL}`))).toBe(true);
    // Os arquivados também entram no índice: é para isso que existe.
    expect(topicoPorMensagem.peek("MSG_ARQ")).toBe(T2);
    expect(topicoPorMensagem.peek("MSG_ATIVA")).toBe(T1);

    await carregarTopicosDoCanal(CANAL);
    await carregarTopicosDoCanal(CANAL);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("chamadas concorrentes dividem a mesma ida; falha libera nova tentativa", async () => {
    await Promise.all([carregarTopicosDoCanal(CANAL), carregarTopicosDoCanal(CANAL)]);
    expect(get).toHaveBeenCalledTimes(2);

    limparTopicosCarregados();
    get.mockImplementation((() => Promise.reject(new Error("rede"))) as never);
    expect(await carregarTopicosDoCanal(CANAL)).toBe(false);
    get.mockClear();
    await carregarTopicosDoCanal(CANAL);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("canal desconhecido não vai à rede", async () => {
    expect(await carregarTopicosDoCanal("01NAOEXISTE")).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
});
