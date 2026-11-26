import "../../arnes/redeFalsa";

import { SERVER_ID, seed } from "nucleo/arnes/firehose";
import { definirCanalAberto } from "nucleo/sdk/adapter";
import { definirFuncoesDoArnes } from "nucleo/sdk/funcoes";
import { escreverTopico, lerTopico, topicosConhecidos, type MetaDeTopico } from "nucleo/sdk/vortexCanal";
import { useTopicosSeguidosDoServidor } from "nucleo/store/hooks";
import { limparConexao } from "nucleo/store/conexao";
import { definirPalco, fecharPalco, lerPalco } from "nucleo/store/palcoDeVoz";
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
  fecharPalco();
  definirFuncoesDoArnes(["threads"]);
  definirProntidao(true);
  irPara(SERVER_ID, GERAL);
  definirCanalAberto(GERAL);
});
afterEach(() => {
  desmontar();
  fecharPalco();
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

  it("fica ausente dentro de um tópico: o canal já é o filho", async () => {
    irPara(SERVER_ID, idDo(REVISAO));
    definirCanalAberto(idDo(REVISAO));
    // Dentro de um tópico o cabeçalho é o DO TÓPICO (#459), que não tem fixadas: espera a área dele.
    montar(
      <div style={{ inlineSize: "1600px", blockSize: "860px" }}>
        <ShellDasSalas />
      </div>,
    );
    await expect.poll(() => pegar("[data-topico-aberto]")).not.toBeNull();
    expect(document.querySelector(`[aria-label='${topicos.botao}']`)).toBeNull();
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

  it("abas: tabpanel ligado à aba, setas trocam o recorte e o scroll volta ao topo", async () => {
    await abrir();
    await botao().click();
    await expect.poll(() => itens().length).toBeGreaterThan(0);
    const painelDeAbas = pegar("[role='tabpanel']")!;
    expect(painelDeAbas.getAttribute("aria-labelledby")).toBe(aba(topicos.recortes.ativos).element().id);

    aba(topicos.recortes.ativos).element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => aba(topicos.recortes.arquivados).element().getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(aba(topicos.recortes.arquivados).element());
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(() => aba(topicos.recortes.ativos).element().getAttribute("aria-selected")).toBe("true");
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
    // Abrir o canal também carrega os tópicos dele (#459): conta só o que "Tentar de novo" pediu.
    const antes = carregar.mock.calls.length;
    await page.getByRole("button", { name: topicos.estados.tentarDeNovo }).click();
    await expect.element(page.getByText(topicos.estados.vazioArquivados)).toBeVisible();
    expect(carregar).toHaveBeenCalledTimes(antes + 1);
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

  it("com o palco aberto, clicar no seguido fecha o palco e mostra o tópico", async () => {
    await abrir();
    await expect.poll(() => seguidos()).not.toBeNull();
    definirPalco({ tipo: "grade" });
    expect(lerPalco().tipo).toBe("grade");
    await page.getByRole("button", { name: REVISAO }).click();
    await expect.poll(() => lerPalco().tipo).toBe("fechado");
    await expect
      .poll(() => {
        const local = lerLocal();
        return local.tipo === "servidor" ? local.channelId : undefined;
      })
      .toBe(idDo(REVISAO));
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

/* Lei nº 1: a coluna de um servidor não acorda por tópico de outro. */
describe("a leitura dos seguidos é escopada por servidor", () => {
  function Sonda({ serverId, ativo, aoLer }: { serverId: string; ativo: boolean; aoLer: (m: unknown) => void }) {
    aoLer(useTopicosSeguidosDoServidor(serverId, ativo));
    return null;
  }
  const modelo = () => lerTopico(idDo(REVISAO))!;

  it("seguir um tópico de OUTRO servidor não re-renderiza quem lê este", async () => {
    const lidos: unknown[] = [];
    montar(<Sonda serverId={SERVER_ID} ativo aoLer={(m) => lidos.push(m)} />);
    await expect.poll(() => lidos.length).toBeGreaterThan(0);
    const antes = lidos.length;
    const mapa = lidos[lidos.length - 1];

    escreverTopico("01JQ0000000000000000OUTRO1", { ...modelo(), serverId: "OUTRO", nome: "De outro servidor" });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    expect(lidos.length).toBe(antes);
    expect(lidos[lidos.length - 1]).toBe(mapa);

    // Controle positivo: um seguido NESTE servidor acorda a leitura.
    escreverTopico("01JQ0000000000000000AQUI01", { ...modelo(), nome: "Deste servidor" });
    await expect.poll(() => lidos.length).toBeGreaterThan(antes);
  });

  it("desligada (servidor sem a função), nada acorda a leitura", async () => {
    const lidos: unknown[] = [];
    montar(<Sonda serverId={SERVER_ID} ativo={false} aoLer={(m) => lidos.push(m)} />);
    await expect.poll(() => lidos.length).toBeGreaterThan(0);
    const antes = lidos.length;
    escreverTopico("01JQ0000000000000000AQUI02", { ...modelo(), nome: "Também deste servidor" });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    expect(lidos.length).toBe(antes);
  });
});
