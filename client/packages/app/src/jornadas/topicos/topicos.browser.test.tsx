import "../../arnes/redeFalsa";

import { SERVER_ID, seed } from "nucleo/arnes/firehose";
import { definirCanalAberto } from "nucleo/sdk/adapter";
import { definirFuncoesDoArnes } from "nucleo/sdk/funcoes";
import { escreverTopico, lerTopico, topicosConhecidos, type MetaDeTopico } from "nucleo/sdk/vortexCanal";
import { limparConexao } from "nucleo/store/conexao";
import { limparBusca } from "nucleo/store/busca";
import { limparFixados } from "nucleo/store/fixados";
import { irPara, lerLocal } from "nucleo/store/navegacao";
import { limparPainelDeTopicos } from "nucleo/store/painelDeTopicos";
import { definirProntidao } from "nucleo/store/prontidao";
import { page, userEvent } from "vitest/browser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fixados, topicos } from "../../textos";
import { desmontar, montar, pegar } from "../../ui/ds/montar";
import { ShellDasSalas } from "../salas/ShellDasSalas";

/**
 * A lista de tópicos do canal e os tópicos seguidos na coluna, contra o app
 * inteiro e o mundo do arnês. `carregarTopicosDoCanal` é REST (o arnês não tem
 * rede), então é dublado: o arnês já semeou ativos e arquivados pelo mesmo
 * registro que a listagem escreveria.
 */

const ctl = vi.hoisted(() => ({ carregar: undefined as undefined | ((canal: string) => Promise<boolean>) }));

vi.mock("nucleo/sdk/topicos", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  carregarTopicosDoCanal: (canal: string) => ctl.carregar?.(canal) ?? Promise.resolve(true),
}));

const GERAL = "01JQ0000000000000000000010";
const REVISAO = "Revisão do editor de cargo"; // seguido
const BITRATE = "Bitrate padrão das salas"; // não seguido

/** O registro do arnês depois da semeadura: cada teste o devolve a este estado. */
let originais: ReadonlyMap<string, MetaDeTopico>;

beforeAll(async () => {
  await seed(60);
  originais = new Map(topicosConhecidos());
}, 60_000);

beforeEach(async () => {
  await page.viewport(1600, 900);
  document.documentElement.dataset.tema = "vidro";
  ctl.carregar = undefined;
  limparConexao();
  limparBusca();
  limparFixados();
  limparPainelDeTopicos();
  definirFuncoesDoArnes(["threads"]);
  definirProntidao(true);
  irPara(SERVER_ID, GERAL);
  definirCanalAberto(GERAL);
});
afterEach(() => {
  desmontar();
  for (const [id, meta] of originais) escreverTopico(id, meta);
  limparPainelDeTopicos();
  limparFixados();
  limparBusca();
  definirFuncoesDoArnes(undefined);
  definirProntidao(false);
  vi.restoreAllMocks();
});

const idDo = (nome: string): string => {
  for (const [id, meta] of topicosConhecidos()) if (meta.nome === nome) return id;
  throw new Error(`tópico do arnês não achado: ${nome}`);
};

async function abrir() {
  montar(
    <div style={{ inlineSize: "1600px", blockSize: "860px" }}>
      <ShellDasSalas />
    </div>,
  );
  await expect.element(page.getByRole("button", { name: fixados.botao, exact: true })).toBeVisible();
}

const botao = () => page.getByRole("button", { name: topicos.botao, exact: true });
const painel = () => pegar("[data-testid='painel-de-topicos']");
const itens = () => [...document.querySelectorAll<HTMLElement>("[data-topico-ir]")];
const nomesDosItens = () => itens().map((el) => el.querySelector("span")!.textContent);
const aba = (nome: string) => page.getByRole("tab", { name: nome, exact: true });
/** Os seguidos sob #geral (o arnês também tem seguidos sob o canal do firehose). */
const seguidos = () => pegar(`[aria-label='${topicos.seguidos.rotulo("geral")}']`);

describe("o botão", () => {
  it("fica ausente quando o servidor não anuncia a função", async () => {
    definirFuncoesDoArnes([]);
    await abrir();
    expect(document.querySelector(`[aria-label='${topicos.botao}']`)).toBeNull();
  });

  it("aparece com a função e liga e desliga o painel", async () => {
    await abrir();
    await expect.element(botao()).toBeVisible();
    expect(botao().element().getAttribute("aria-pressed")).toBe("false");

    await botao().click();
    await expect.poll(() => painel()).not.toBeNull();
    expect(botao().element().getAttribute("aria-pressed")).toBe("true");

    await botao().click();
    await expect.poll(() => painel()).toBeNull();
  });

  it("Esc fecha e devolve o foco ao botão", async () => {
    await abrir();
    await botao().click();
    await expect.poll(() => painel()).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => painel()).toBeNull();
    expect(document.activeElement).toBe(botao().element());
  });
});

describe("o painel", () => {
  it("lista os ativos com respostas e última atividade, e os arquivados em outro recorte", async () => {
    // Arquiva um dos dois do #geral: o arnês só traz arquivado no fórum.
    const idBitrate = idDo(BITRATE);
    escreverTopico(idBitrate, { ...lerTopico(idBitrate)!, arquivado: true });
    await abrir();
    await botao().click();

    await expect.poll(nomesDosItens).toEqual([REVISAO]);
    const item = itens()[0]!;
    expect(item.textContent).toContain("5 respostas");
    expect(item.getAttribute("aria-label")).toBe(topicos.lista.abrir(REVISAO));
    expect(aba(topicos.recortes.ativos).element().getAttribute("aria-selected")).toBe("true");

    await aba(topicos.recortes.arquivados).click();
    await expect.poll(nomesDosItens).toEqual([BITRATE]);
    expect(itens()[0]!.textContent).toContain("3 respostas");
  });

  it("clicar num tópico abre o canal dele", async () => {
    await abrir();
    await botao().click();
    await expect.poll(() => itens().length).toBeGreaterThan(0);

    await page.getByRole("button", { name: topicos.lista.abrir(BITRATE) }).click();
    await expect
      .poll(() => {
        const local = lerLocal();
        return local.tipo === "servidor" ? local.channelId : undefined;
      })
      .toBe(idDo(BITRATE));
    // O painel é do canal em que foi aberto: trocar de canal o fecha.
    await expect.poll(() => painel()).toBeNull();
  });

  it("vazio: diz que não há tópico no recorte", async () => {
    await abrir();
    await botao().click();
    await expect.poll(() => itens().length).toBeGreaterThan(0);
    await aba(topicos.recortes.arquivados).click();
    await expect.element(page.getByText(topicos.estados.vazioArquivados)).toBeVisible();
  });

  it("carregando: mostra o esqueleto enquanto os arquivados não chegam e a lista está vazia", async () => {
    let chegou!: (ok: boolean) => void;
    ctl.carregar = () => new Promise((r) => (chegou = r));
    await abrir();
    await botao().click();
    await aba(topicos.recortes.arquivados).click();
    await expect.element(page.getByRole("status", { name: topicos.estados.carregando })).toBeVisible();
    chegou(true);
    await expect.element(page.getByText(topicos.estados.vazioArquivados)).toBeVisible();
  });

  it("erro: diz a falha e 'Tentar de novo' refaz a carga", async () => {
    let falhar = true;
    const carregar = vi.fn(() => Promise.resolve(!falhar));
    ctl.carregar = carregar;
    await abrir();
    await botao().click();
    await aba(topicos.recortes.arquivados).click();
    await expect.element(page.getByText(topicos.estados.erro)).toBeVisible();

    falhar = false;
    await page.getByRole("button", { name: topicos.estados.tentarDeNovo }).click();
    await expect.element(page.getByText(topicos.estados.vazioArquivados)).toBeVisible();
    expect(carregar).toHaveBeenCalledTimes(2);
  });
});

describe("os seguidos na coluna", () => {
  it("só os seguidos aparecem sob o canal pai, e somem ao deixar de seguir", async () => {
    await abrir();
    await expect.poll(() => seguidos()).not.toBeNull();
    const lista = seguidos()!;
    expect(lista.textContent).toContain(REVISAO);
    expect(lista.textContent).not.toContain(BITRATE);
    // Aninhado sob o canal pai, e não solto na coluna.
    expect(lista.parentElement?.querySelector("button")?.textContent).toContain("geral");

    const id = idDo(REVISAO);
    escreverTopico(id, { ...lerTopico(id)!, seguidores: [] });
    await expect.poll(() => seguidos()).toBeNull();
  });

  it("sem a função, a coluna não aninha nada", async () => {
    definirFuncoesDoArnes([]);
    await abrir();
    expect(seguidos()).toBeNull();
  });

  it("clicar no seguido abre o tópico", async () => {
    await abrir();
    await expect.poll(() => seguidos()).not.toBeNull();
    await page.getByRole("button", { name: REVISAO }).click();
    await expect
      .poll(() => {
        const local = lerLocal();
        return local.tipo === "servidor" ? local.channelId : undefined;
      })
      .toBe(idDo(REVISAO));
  });
});

/* Por último: os 400 tópicos de massa ficam no registro (ele não tem remoção). */
describe("a lista é virtualizada", () => {
  it("centenas de tópicos montam só a janela visível", async () => {
    const modelo = lerTopico(idDo(REVISAO))!;
    for (let i = 0; i < 400; i++) {
      const id = `01JQ0000000000000000T${String(i).padStart(5, "0")}`;
      escreverTopico(id, { ...modelo, nome: `Massa ${String(i)}`, seguidores: [], aberturaId: undefined });
    }
    await abrir();
    await botao().click();
    await expect.poll(() => itens().length).toBeGreaterThan(5);
    expect(itens().length).toBeLessThan(60);
  });
});
