import { client } from "nucleo/sdk/client";
import { chaveDeMembro, type MemberSnapshot, type MessageSnapshot } from "nucleo/sdk/domain";
import { members, messages, presence } from "nucleo/sdk/adapter";
import { fecharCartaoDeUsuario } from "nucleo/store/cartaoDeUsuario";
import { irPara, lerLocal } from "nucleo/store/navegacao";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { salas } from "../../textos";
import { desmontar, montar, pegar } from "../../ui/ds/montar";
import { CorpoDaMensagem } from "../chat/CorpoDaMensagem";
import { LinhaDeMensagem } from "../chat/LinhaDeMensagem";
import { CartaoDeUsuario } from "./CartaoDeUsuario";

const SERVIDOR = "01SRV";
const CANAL = "01CHN";
const USUARIO = "01USR";

function membroSnap(parcial: Partial<MemberSnapshot> = {}): MemberSnapshot {
  return {
    id: USUARIO,
    displayName: "zola",
    sigla: "ZO",
    username: "e",
    pronomes: "ele/dele",
    statusTexto: "construindo o Vortex",
    cor: undefined,
    cargo: "Dono",
    cargosIds: [],
    iconeDeCargoUrl: undefined,
    iconeDeCargoNome: undefined,
    avatarUrl: undefined,
    entrouEm: undefined,
    entrouEmMs: undefined,
    silenciadoAte: undefined,
    abaixoDeMim: false,
    ...parcial,
  };
}

function mensagemSnap(parcial: Partial<MessageSnapshot> = {}): MessageSnapshot {
  return {
    id: "01MSG",
    channelId: CANAL,
    authorId: USUARIO,
    content: "olá mundo",
    blocos: [{ tipo: "paragrafo", de: 0, filhos: [{ tipo: "texto", de: 0, valor: "olá mundo" }] }],
    conviteCodigo: undefined,
    fixada: false,
    figurinha: undefined,
    createdAt: Date.now(),
    createdAtCurto: "13:40",
    createdAtText: "13:40:00",
    iniciaGrupo: true,
    dia: undefined,
    primeiraNaoLida: false,
    mencionaVoce: false,
    editedAt: undefined,
    sendState: "sent",
    sistema: undefined,
    respostas: [],
    reactions: [],
    anexos: [],
    embeds: [],
    enquete: undefined,
    ...parcial,
  };
}

beforeEach(() => {
  fecharCartaoDeUsuario();
  irPara(SERVIDOR, CANAL);
  members.set(chaveDeMembro(SERVIDOR, USUARIO), membroSnap());
  presence.set(USUARIO, "online");
  messages.set("01MSG", mensagemSnap());
});

afterEach(() => {
  desmontar();
  fecharCartaoDeUsuario();
  vi.restoreAllMocks();
});

function mockUsuario(extra: Record<string, unknown> = {}) {
  return {
    id: USUARIO,
    username: "e",
    displayName: "zola",
    pronouns: "ele/dele",
    status: { text: "construindo o Vortex", presence: "Online" },
    online: true,
    relationship: "None",
    avatar: undefined,
    avatarURL: undefined,
    fetchProfile: vi.fn().mockResolvedValue({ content: "Criador do Vortex", bannerURL: undefined }),
    ...extra,
  } as never;
}

describe("CartaoDeUsuario", () => {
  it("abre ao clicar no nome do autor da mensagem, exibe nome de exibição, @username, cargo, recado e bio", async () => {
    vi.spyOn(client.users, "get").mockReturnValue(mockUsuario());

    montar(
      <>
        <LinhaDeMensagem id="01MSG" servidorId={SERVIDOR} />
        <CartaoDeUsuario />
      </>,
    );

    const botaoNome = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "zola",
    );
    expect(botaoNome).toBeDefined();
    await userEvent.click(botaoNome!);

    await expect.poll(() => pegar('[data-testid="cartao-de-usuario"]')).not.toBeNull();
    const cartao = pegar('[data-testid="cartao-de-usuario"]')!;
    expect(cartao.textContent).toContain("zola");
    expect(cartao.textContent).toContain("@e");
    expect(cartao.textContent).toContain("ele/dele");
    expect(cartao.textContent).toContain("construindo o Vortex");
    await expect.poll(() => cartao.textContent).toContain("Criador do Vortex");

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => pegar('[data-testid="cartao-de-usuario"]')).toBeNull();
  });

  it("abre ao clicar em uma menção no corpo da mensagem", async () => {
    vi.spyOn(client.users, "get").mockReturnValue(
      mockUsuario({ fetchProfile: vi.fn().mockResolvedValue({ content: "", bannerURL: undefined }) }),
    );

    montar(
      <>
        <CorpoDaMensagem
          servidorId={SERVIDOR}
          blocos={[
            {
              tipo: "paragrafo",
              de: 0,
              filhos: [{ tipo: "mencao", de: 0, valor: USUARIO }],
            },
          ]}
        />
        <CartaoDeUsuario />
      </>,
    );

    const mencao = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "@zola",
    );
    expect(mencao).toBeDefined();
    await userEvent.click(mencao!);

    await expect.poll(() => pegar('[data-testid="cartao-de-usuario"]')).not.toBeNull();
    expect(pegar('[data-testid="cartao-de-usuario"]')!.textContent).toContain("@e");
  });

  it("botão Enviar mensagem abre a conversa direta e fecha o cartão", async () => {
    vi.spyOn(client.users, "get").mockReturnValue(
      mockUsuario({
        fetchProfile: vi.fn().mockResolvedValue({ content: "", bannerURL: undefined }),
        openDM: vi.fn().mockResolvedValue({ id: "01DM" }),
      }),
    );

    montar(
      <>
        <LinhaDeMensagem id="01MSG" servidorId={SERVIDOR} />
        <CartaoDeUsuario />
      </>,
    );

    const botaoNome = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "zola",
    );
    await userEvent.click(botaoNome!);

    await expect.poll(() => pegar('[data-testid="cartao-de-usuario"]')).not.toBeNull();
    const enviar = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      b.textContent?.includes(salas.cartaoDeUsuario.enviarMensagem),
    );
    expect(enviar).toBeDefined();
    await userEvent.click(enviar!);

    await expect.poll(() => lerLocal()).toEqual({ tipo: "dm", channelId: "01DM" });
    expect(pegar('[data-testid="cartao-de-usuario"]')).toBeNull();
  });
});
