import "../../arnes/redeFalsa";

import { CHANNEL_ID, SERVER_ID, seed } from "nucleo/arnes/firehose";
import { channelMessageIds, definirCanalAberto, seedChannel, usuarioLocalId } from "nucleo/sdk/adapter";
import { client } from "nucleo/sdk/client";
import { definirFuncoesDoArnes } from "nucleo/sdk/funcoes";
import { limparTopicosCarregados, nomeDeTopicoDe, topicoDaMensagem, topicos } from "nucleo/sdk/topicos";
import { anotarCanais } from "nucleo/sdk/vortexCanal";
import { irPara, lerCanalAtivo } from "nucleo/store/navegacao";
import { definirProntidao } from "nucleo/store/prontidao";
import { dispensarToast, lerToasts } from "nucleo/ui-logica/toastStore";
import { ulidDoInstante } from "nucleo/lib/ulid";
import { page, userEvent } from "vitest/browser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { quadros } from "../../testes/esperas";
import { chat, topico } from "../../textos";
import { desmontar, montar, pegar } from "../../ui/ds/montar";
import { pedirSalto } from "../chat/saltos";
import { ShellDasSalas } from "../salas/ShellDasSalas";
import { fecharDialogoDeTopico } from "./acoes";

/**
 * Tópico aberto na área principal, contra o app inteiro com o mundo do arnês.
 * O arnês semeia um tópico a cada 40 mensagens (o de índice 17 arquivado) e
 * liga a função `threads` do servidor; as escritas (`client.api`) são dubladas.
 */

const ctl = vi.hoisted(() => ({ negadas: new Set<string>() }));

vi.mock("nucleo/sdk/permissoes", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  pode: (_canal: string, acao: string) => !ctl.negadas.has(acao),
  podeNoServidor: () => true,
}));

beforeAll(async () => {
  await seed(60);
}, 60_000);

beforeEach(async () => {
  await page.viewport(1600, 900);
  document.documentElement.dataset.tema = "vidro";
  ctl.negadas.clear();
  definirFuncoesDoArnes(["polls", "threads"]);
  limparTopicosCarregados();
  definirProntidao(true);
  irPara(SERVER_ID, CHANNEL_ID);
  definirCanalAberto(CHANNEL_ID);
});
afterEach(() => {
  for (const t of lerToasts()) dispensarToast(t.id);
  fecharDialogoDeTopico();
  desmontar();
  vi.restoreAllMocks();
  definirFuncoesDoArnes(["polls", "threads"]);
  definirProntidao(false);
});

const ids = () => channelMessageIds.getSnapshot(CHANNEL_ID) ?? [];
const log = () => pegar<HTMLElement>('[role="log"]')!;
const linha = (id: string) => pegar<HTMLElement>(`[data-menu-mensagem="${CSS.escape(id)}"]`);
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const areaDoTopico = () => pegar<HTMLElement>("[data-topico-aberto]");
const cabecalhoDoTopico = () => page.elementLocator(pegar(`header[aria-label="${topico.cabecalho.rotulo}"]`)!);

async function abrirApp() {
  montar(
    <div style={{ inlineSize: "1600px", blockSize: "860px" }}>
      <ShellDasSalas />
    </div>,
  );
  await expect.poll(() => ids().length > 0 && pegar('[role="log"]') !== null).toBe(true);
}

/** Leva a mensagem para a janela do virtualizador e espera a linha montar. */
async function mostrar(id: string) {
  await expect
    .poll(() => {
      if (linha(id) === null) pedirSalto(CHANNEL_ID, id);
      return linha(id) !== null;
    })
    .toBe(true);
  return linha(id)!;
}

function clicarDireito(alvo: Element) {
  const r = alvo.getBoundingClientRect();
  alvo.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: Math.round(r.left + 40),
      clientY: Math.round(r.top + 10),
    }),
  );
}

async function abrirMenuDe(id: string) {
  clicarDireito(await mostrar(id));
  await expect.poll(() => menu()).not.toBeNull();
  return menu()!;
}

/** O canal cru de um tópico, como o servidor devolve depois de uma escrita. */
function cru(id: string, patch: { archived?: boolean } = {}) {
  const t = topicos.peek(id)!;
  return {
    _id: id,
    channel_type: "TextChannel",
    server: SERVER_ID,
    name: t.nome,
    thread: {
      parent: t.paiId,
      owner: t.donoId,
      message: t.aberturaId,
      archived: patch.archived ?? t.arquivado,
      tags: [],
      followers: t.seguidores,
    },
  };
}

/** A primeira linha inteira à vista no topo do scroller. */
function primeiraVisivel(): string | undefined {
  const topo = log().getBoundingClientRect().top;
  for (const el of document.querySelectorAll<HTMLElement>("[data-index]")) {
    if (el.getBoundingClientRect().top >= topo - 1) {
      return el.querySelector<HTMLElement>("[data-menu-mensagem]")?.dataset.menuMensagem;
    }
  }
  return undefined;
}

describe("a função do servidor", () => {
  it("sem `threads` a ação não existe: nem no menu nem na barra da mensagem", async () => {
    definirFuncoesDoArnes(["polls"]);
    await abrirApp();
    const alvo = ids()[30]!;
    const m = await abrirMenuDe(alvo);
    expect(m.textContent).toContain(chat.copiarTexto);
    expect(m.textContent).not.toContain(topico.criar);
    expect(linha(alvo)!.querySelector(`[aria-label="${topico.criar}"]`)).toBeNull();
    // A mensagem que JÁ tem tópico também não oferece abrir: a função é do servidor inteiro.
    const comTopico = ids()[57]!;
    expect(topicoDaMensagem(CHANNEL_ID, comTopico)).toBeDefined();
    await userEvent.keyboard("{Escape}");
    await mostrar(comTopico);
    expect(linha(comTopico)!.querySelector(`[aria-label="${topico.abrir}"]`)).toBeNull();
  });

  it("com `threads` a barra e o menu oferecem criar e abrir", async () => {
    await abrirApp();
    const semTopico = ids()[30]!;
    await mostrar(semTopico);
    expect(linha(semTopico)!.querySelector(`[aria-label="${topico.criar}"]`)).not.toBeNull();
    const comTopico = ids()[57]!;
    await mostrar(comTopico);
    expect(linha(comTopico)!.querySelector(`[aria-label="${topico.abrir}"]`)).not.toBeNull();
  });
});

describe("tópicos arquivados do canal", () => {
  it("abrir o canal busca os arquivados e o índice passa a conhecer a mensagem", async () => {
    const origem = ids()[33]!;
    expect(topicoDaMensagem(CHANNEL_ID, origem)).toBeUndefined();
    const arquivado = ulidDoInstante(Date.now() - 7_200_000)!;
    const get = vi.spyOn(client.api, "get").mockImplementation(((rota: string) =>
      Promise.resolve(
        rota.includes("archived=true")
          ? {
              threads: [
                {
                  _id: arquivado,
                  channel_type: "TextChannel",
                  server: SERVER_ID,
                  name: "arquivado antigo",
                  thread: { parent: CHANNEL_ID, owner: usuarioLocalId(), message: origem, archived: true, tags: [], followers: [] },
                },
              ],
              messages: [],
              users: [],
              message_counts: { [arquivado]: 4 },
            }
          : { threads: [], messages: [], users: [], message_counts: {} },
      )));
    await abrirApp();
    await expect.poll(() => topicoDaMensagem(CHANNEL_ID, origem)).toBe(arquivado);
    expect(get).toHaveBeenCalledWith(expect.stringContaining(`channel=${CHANNEL_ID}`));
  });

  it("sem a função do servidor, abrir o canal não busca tópico nenhum", async () => {
    definirFuncoesDoArnes(["polls"]);
    const get = vi.spyOn(client.api, "get");
    await abrirApp();
    await quadros(4);
    expect(get.mock.calls.some(([rota]) => String(rota).includes("/threads"))).toBe(false);
  });
});

describe("criar a partir da mensagem", () => {
  it("o diálogo nasce com o nome tirado do texto, recusa vazio e abre o tópico criado", async () => {
    await abrirApp();
    const alvo = ids()[31]!;
    const conteudo = client.messages.get(alvo)!.content ?? "";
    const novo = ulidDoInstante(Date.now())!;
    const post = vi.spyOn(client.api, "post").mockImplementation(((_rota: string, corpo: { name: string }) =>
      Promise.resolve({
        _id: novo,
        channel_type: "TextChannel",
        server: SERVER_ID,
        name: corpo.name,
        thread: { parent: CHANNEL_ID, owner: usuarioLocalId(), message: alvo, archived: false, tags: [], followers: [] },
      })) as never);

    const m = await abrirMenuDe(alvo);
    const item = [...m.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) =>
      el.textContent.includes(topico.criar),
    )!;
    item.click();

    const campo = page.getByRole("textbox", { name: topico.dialogo.rotuloDoNome });
    await expect.element(campo).toHaveValue(nomeDeTopicoDe(conteudo));
    expect(campo.element().getAttribute("maxlength")).toBe("100");

    await campo.clear();
    await page.getByRole("button", { name: topico.dialogo.confirmar }).click();
    await expect.element(page.getByRole("dialog").getByRole("alert")).toHaveTextContent(topico.dialogo.nomeObrigatorio);
    expect(post).not.toHaveBeenCalled();

    await campo.fill("Plano de lançamento");
    await page.getByRole("button", { name: topico.dialogo.confirmar }).click();

    await expect.poll(() => lerCanalAtivo()).toBe(novo);
    expect(post).toHaveBeenCalledWith(`/channels/${CHANNEL_ID}/threads`, {
      name: "Plano de lançamento",
      message: alvo,
      tags: [],
    });
    await expect.poll(() => areaDoTopico()?.dataset.topicoAberto).toBe(novo);
    await expect.element(cabecalhoDoTopico()).toHaveTextContent("Plano de lançamento");
    // O card da origem, com o texto da mensagem que abriu o tópico.
    await expect.poll(() => pegar("[data-raiz-do-topico]")?.textContent ?? "").toContain(topico.origem.iniciou);
    expect(page.getByRole("dialog").query()).toBeNull();
  });

  it("sem poder escrever no canal, criar some e abrir o que já existe continua", async () => {
    ctl.negadas.add("enviar");
    await abrirApp();
    const semTopico = ids()[32]!;
    await mostrar(semTopico);
    expect(linha(semTopico)!.querySelector(`[aria-label="${topico.criar}"]`)).toBeNull();
    const comTopico = ids()[57]!;
    await mostrar(comTopico);
    expect(linha(comTopico)!.querySelector(`[aria-label="${topico.abrir}"]`)).not.toBeNull();
  });
});

describe("abrir e voltar", () => {
  it("abre na área principal com o card da origem no topo do scroller e volta ao pai na mesma posição", async () => {
    await abrirApp();
    const origem = ids()[17]!;
    const topicoId = topicoDaMensagem(CHANNEL_ID, origem)!;
    // Algumas respostas dentro do tópico, para o card rolar junto com a lista.
    const respostas: string[] = [];
    for (let i = 0; i < 25; i++) {
      const id = ulidDoInstante(Date.now() - (25 - i) * 60_000)!;
      client.messages.getOrCreate(
        id,
        { _id: id, channel: topicoId, author: usuarioLocalId(), content: `resposta ${String(i)}` } as never,
        false,
      );
      respostas.push(id);
    }
    seedChannel(topicoId, respostas);

    await mostrar(origem);
    await quadros(4);
    const antes = primeiraVisivel();
    expect(antes).toBeDefined();
    const distanciaAntes = log().scrollHeight - log().clientHeight - log().scrollTop;
    expect(distanciaAntes).toBeGreaterThan(200);

    // O botão da barra de ações (escondido até o hover; o clique é o mesmo).
    linha(origem)!.querySelector<HTMLButtonElement>(`[aria-label="${topico.abrir}"]`)!.click();
    await expect.poll(() => areaDoTopico()?.dataset.topicoAberto).toBe(topicoId);
    await expect.poll(() => lerCanalAtivo()).toBe(topicoId);

    // O card mora DENTRO do scroller (rola junto), antes da primeira resposta.
    await expect.poll(() => log().querySelector("[data-raiz-do-topico]")).not.toBeNull();
    const card = log().querySelector<HTMLElement>("[data-raiz-do-topico]")!;
    expect(card.textContent).toContain(client.messages.get(origem)!.content.slice(0, 10));
    // Âncora no fim mesmo com o topo: a última resposta à vista.
    await expect.poll(() => log().scrollHeight - log().clientHeight - log().scrollTop).toBeLessThan(40);
    log().scrollTop = 0;
    await expect.poll(() => card.getBoundingClientRect().top - log().getBoundingClientRect().top).toBeLessThan(40);
    const primeiraResposta = pegar(`[data-menu-mensagem="${respostas[0]!}"]`)!;
    expect(primeiraResposta.getBoundingClientRect().top).toBeGreaterThanOrEqual(card.getBoundingClientRect().bottom - 1);

    // Arquivado (o de índice 17 nasce assim): a frase acima do campo, e o campo continua.
    await expect.element(page.getByRole("status").filter({ hasText: topico.arquivado })).toBeVisible();
    expect(pegar("textarea")).not.toBeNull();

    await page.getByRole("button", { name: /^Voltar para #/ }).click();
    await expect.poll(() => lerCanalAtivo()).toBe(CHANNEL_ID);
    await expect.poll(() => areaDoTopico()).toBeNull();
    // A linha que estava no topo continua à vista, e a lista NÃO foi para o fim.
    await expect
      .poll(() => {
        const el = antes === undefined ? null : linha(antes);
        if (el === null) return false;
        const r = el.getBoundingClientRect();
        const j = log().getBoundingClientRect();
        return r.top >= j.top - 1 && r.bottom <= j.bottom + 1;
      })
      .toBe(true);
    expect(log().scrollHeight - log().clientHeight - log().scrollTop).toBeGreaterThan(200);
  });

  it("a mensagem de origem apagada vira um aviso no lugar do card", async () => {
    const id = ulidDoInstante(Date.now())!;
    const sumida = ulidDoInstante(Date.now() - 3_600_000)!;
    const canal = {
      _id: id,
      channel_type: "TextChannel",
      server: SERVER_ID,
      name: "tópico órfão",
      thread: { parent: CHANNEL_ID, owner: usuarioLocalId(), message: sumida, archived: false, tags: [], followers: [] },
    };
    client.channels.getOrCreate(id, canal as never);
    anotarCanais([canal]);
    irPara(SERVER_ID, id);
    montar(
      <div style={{ inlineSize: "1600px", blockSize: "860px" }}>
        <ShellDasSalas />
      </div>,
    );
    await expect.poll(() => areaDoTopico()?.dataset.topicoAberto).toBe(id);
    await expect.element(page.getByText(topico.origem.apagada)).toBeVisible();
  });
});

describe("seguir e arquivar", () => {
  it("com permissão: seguir alterna e arquivar escreve no servidor", async () => {
    await abrirApp();
    const topicoId = topicoDaMensagem(CHANNEL_ID, ids()[57]!)!;
    irPara(SERVER_ID, topicoId);
    await expect.poll(() => areaDoTopico()?.dataset.topicoAberto).toBe(topicoId);

    const del = vi.spyOn(client.api, "delete").mockResolvedValue(undefined);
    const put = vi.spyOn(client.api, "put").mockResolvedValue(undefined);
    const seguir = page.getByRole("button", { name: topico.cabecalho.seguir });
    // O arnês semeia "eu" entre os seguidores.
    await expect.element(seguir).toHaveAttribute("aria-pressed", "true");
    await seguir.click();
    await expect.element(seguir).toHaveAttribute("aria-pressed", "false");
    expect(del).toHaveBeenCalledWith(`/channels/${topicoId}/follow`);
    await seguir.click();
    await expect.element(seguir).toHaveAttribute("aria-pressed", "true");
    expect(put).toHaveBeenCalledWith(`/channels/${topicoId}/follow`);

    const patch = vi
      .spyOn(client.api, "patch")
      .mockImplementation(((_rota: string, corpo: { archived: boolean }) =>
        Promise.resolve(cru(topicoId, { archived: corpo.archived }))) as never);
    await page.getByRole("button", { name: topico.cabecalho.arquivar }).click();
    expect(patch).toHaveBeenCalledWith(`/channels/${topicoId}/thread`, { archived: true });
    await expect.element(cabecalhoDoTopico()).toHaveTextContent(topico.cabecalho.arquivado);
    await expect.element(page.getByRole("status").filter({ hasText: topico.arquivado })).toBeVisible();

    await page.getByRole("button", { name: topico.cabecalho.reabrir }).click();
    expect(patch).toHaveBeenLastCalledWith(`/channels/${topicoId}/thread`, { archived: false });
    await expect.poll(() => topicos.peek(topicoId)?.arquivado).toBe(false);
  });

  it("sem gerenciar o canal e sem ser quem abriu: arquivar não aparece, seguir sim", async () => {
    ctl.negadas.add("gerenciarCanais");
    await abrirApp();
    const topicoId = topicoDaMensagem(CHANNEL_ID, ids()[57]!)!;
    expect(topicos.peek(topicoId)?.donoId).not.toBe(usuarioLocalId());
    irPara(SERVER_ID, topicoId);
    await expect.poll(() => areaDoTopico()?.dataset.topicoAberto).toBe(topicoId);
    await expect.element(page.getByRole("button", { name: topico.cabecalho.seguir })).toBeVisible();
    await quadros(2);
    expect(page.getByRole("button", { name: topico.cabecalho.arquivar }).query()).toBeNull();
    expect(page.getByRole("button", { name: topico.cabecalho.reabrir }).query()).toBeNull();
  });
});
