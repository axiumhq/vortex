import "../../arnes/redeFalsa";

import { channels } from "nucleo/sdk/adapter";
import { client } from "nucleo/sdk/client";
import type { ChannelSnapshot } from "nucleo/sdk/domain";
import { corpoDaEnquete } from "nucleo/sdk/enquetes";
import { definirFuncoesDoArnes } from "nucleo/sdk/funcoes";
import { limparRascunho } from "nucleo/store/rascunhos";
import { dispensarToast, lerToasts } from "nucleo/ui-logica/toastStore";
import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chat } from "../../textos";
import { desmontar, montar, pegar } from "../../ui/ds/montar";
import { Composer } from "./Composer";
import { DURACOES, MAXIMO_DA_PERGUNTA, MAXIMO_DA_RESPOSTA, validarEnquete } from "./CriarEnquete";

/**
 * Criar enquete pelo composer, com a rede dublada: `conectado()` lê o estado do
 * socket e `client.api.post` é a rota da mensagem. O gate é a função anunciada
 * pelo servidor (`definirFuncoesDoArnes`) e a permissão de enviar.
 */

const C = "C1";
const S = "S1";
const t = chat.criarEnquete;

const ctl = vi.hoisted(() => ({ negadas: new Set<string>() }));
vi.mock("nucleo/sdk/permissoes", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  pode: (_canal: string, acao: string) => !ctl.negadas.has(acao),
  podeNoServidor: () => true,
}));

const ESTADO_CONECTADO = 2; // ConnectionState.Connected
const eventos = client.events as unknown as { state: () => number };
const estadoOriginal = eventos.state;

const post = vi.fn<(caminho: string, corpo: unknown) => Promise<unknown>>();

beforeEach(() => {
  document.documentElement.dataset.tema = "vidro";
  ctl.negadas.clear();
  limparRascunho(C);
  channels.set(C, {
    id: C,
    serverId: S,
    name: "geral",
    tipo: "texto",
    topico: undefined,
    naoLidas: 0,
    mencoes: 0,
    silenciado: false,
  } as unknown as ChannelSnapshot);
  definirFuncoesDoArnes(["polls"]);
  eventos.state = () => ESTADO_CONECTADO;
  post.mockReset();
  post.mockResolvedValue({});
  vi.spyOn(client.api, "post").mockImplementation(post as never);
});

afterEach(() => {
  desmontar();
  vi.restoreAllMocks();
  eventos.state = estadoOriginal;
  definirFuncoesDoArnes(undefined);
  for (const toast of lerToasts()) dispensarToast(toast.id);
});

const botao = () => pegar<HTMLButtonElement>("[data-gatilho-de-enquete]");
const dialogo = () => pegar<HTMLElement>("[role='dialog']");
const campoDaPergunta = () => page.getByRole("textbox", { name: t.pergunta });
const campoDaResposta = (n: number) => page.getByRole("textbox", { name: t.resposta(n), exact: true });

async function abrir() {
  montar(<Composer canalId={C} servidorId={S} />);
  await expect.poll(botao).not.toBeNull();
  botao()!.click();
  await expect.poll(dialogo).not.toBeNull();
}

async function escolher(rotulo: string, opcao: string) {
  await page.getByRole("button", { name: new RegExp(`^${rotulo}:`) }).click();
  await page.getByRole("menuitemradio", { name: opcao }).click();
  await expect.poll(() => pegar("[role='menu']")).toBeNull();
}

const criar = () => page.getByRole("button", { name: t.criar, exact: true }).click();

describe("botão de criar enquete", () => {
  it("aparece com a função do servidor e permissão de enviar", async () => {
    montar(<Composer canalId={C} servidorId={S} />);
    await expect.poll(botao).not.toBeNull();
    expect(botao()!.getAttribute("aria-label")).toBe(t.botao);
  });

  it("some sem a função no servidor (não fica cinza)", async () => {
    definirFuncoesDoArnes([]);
    montar(<Composer canalId={C} servidorId={S} />);
    await expect.poll(() => pegar("textarea")).not.toBeNull();
    expect(botao()).toBeNull();
  });

  it("aparece quando a função chega depois de montado", async () => {
    definirFuncoesDoArnes([]);
    montar(<Composer canalId={C} servidorId={S} />);
    await expect.poll(() => pegar("textarea")).not.toBeNull();
    expect(botao()).toBeNull();
    definirFuncoesDoArnes(["polls"]);
    await expect.poll(botao).not.toBeNull();
  });

  it("some sem permissão de enviar", async () => {
    ctl.negadas.add("enviar");
    montar(<Composer canalId={C} servidorId={S} />);
    await expect.element(page.getByText(chat.semPermissaoParaEscrever)).toBeVisible();
    expect(botao()).toBeNull();
  });
});

describe("criar enquete", () => {
  it.each(DURACOES.flatMap((d) => [false, true].map((multipla) => [d.rotulo, d.horas, multipla] as const)))(
    "%s, múltipla=%s: o POST leva o corpo da enquete",
    async (rotulo, horas, multipla) => {
      await abrir();
      await campoDaPergunta().fill("Qual densidade?");
      await campoDaResposta(1).fill("Confortável");
      await campoDaResposta(2).fill("Compacta");
      await page.getByRole("button", { name: t.adicionarResposta(10) }).click();
      await campoDaResposta(3).fill("Tanto faz");
      if (multipla) await escolher(t.tipo, t.multiplasRespostas);
      await escolher(t.duracao, rotulo);
      await criar();

      await expect.poll(() => post.mock.calls.length).toBe(1);
      const esperado = corpoDaEnquete({
        pergunta: "Qual densidade?",
        respostas: ["Confortável", "Compacta", "Tanto faz"],
        duracaoHoras: horas,
        multipla,
        resultadoNoFim: false,
      });
      expect(post.mock.calls[0]).toEqual([`/channels/${C}/messages`, esperado]);
      expect((esperado["poll"] as { max_answers: number }).max_answers).toBe(multipla ? 3 : 1);
      await expect.poll(dialogo).toBeNull();
    },
  );

  it("padrão é uma resposta e um dia; reordenar por teclado, remover e resultado no fim chegam ao corpo", async () => {
    await abrir();
    expect(page.getByRole("button", { name: new RegExp(`^${t.tipo}: ${t.umaResposta}`) }).query()).not.toBeNull();
    expect(page.getByRole("button", { name: new RegExp(`^${t.duracao}: ${t.duracoes.umDia}`) }).query()).not.toBeNull();

    await campoDaPergunta().fill("Q");
    await campoDaResposta(1).fill("a");
    await campoDaResposta(2).fill("b");
    await page.getByRole("button", { name: t.adicionarResposta(10) }).click();
    await campoDaResposta(3).fill("c");

    // Alt+↓ no campo da primeira: a ordem vira b, a, c, e o foco segue a resposta.
    await campoDaResposta(1).click();
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
    await expect.poll(() => (document.activeElement as HTMLInputElement).value).toBe("a");
    expect((document.activeElement as HTMLElement).getAttribute("aria-label")).toBe(t.resposta(2));

    // Alt+↑ pela alça da terceira: c sobe para o meio.
    (pegar<HTMLButtonElement>(`button[aria-label="${t.moverResposta(3)}"]`)!).focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    await expect.poll(() => (pegar<HTMLInputElement>(`input[aria-label="${t.resposta(2)}"]`)!).value).toBe("c");

    // Remove a primeira (b): sobram c, a.
    await page.getByRole("button", { name: t.removerResposta(1) }).click();
    await page.getByRole("switch", { name: t.resultadoNoFim }).click();
    await criar();

    await expect.poll(() => post.mock.calls.length).toBe(1);
    expect(post.mock.calls[0]![1]).toEqual(
      corpoDaEnquete({ pergunta: "Q", respostas: ["c", "a"], duracaoHoras: 24, multipla: false, resultadoNoFim: true }),
    );
  });

  it("remover só existe acima de duas e adicionar some em dez", async () => {
    await abrir();
    expect(page.getByRole("button", { name: t.removerResposta(1) }).query()).toBeNull();
    for (let i = 0; i < 8; i++) await page.getByRole("button", { name: t.adicionarResposta(10) }).click();
    await expect.poll(() => dialogo()!.querySelectorAll("[data-resposta]").length).toBe(10);
    expect(page.getByRole("button", { name: t.adicionarResposta(10) }).query()).toBeNull();
  });
});

describe("validação", () => {
  it("pergunta vazia bloqueia o envio e diz por quê", async () => {
    await abrir();
    await campoDaResposta(1).fill("a");
    await campoDaResposta(2).fill("b");
    await criar();
    await expect.element(page.getByText(t.erros.perguntaVazia)).toBeVisible();
    await expect.element(campoDaPergunta()).toHaveAttribute("aria-invalid", "true");
    expect(post).not.toHaveBeenCalled();
    expect(dialogo()).not.toBeNull();
  });

  it("menos de duas respostas preenchidas bloqueia; corrigir libera", async () => {
    await abrir();
    await campoDaPergunta().fill("   ");
    await campoDaResposta(1).fill("só uma");
    await criar();
    await expect.element(page.getByText(t.erros.poucasRespostas)).toBeVisible();
    await expect.element(page.getByText(t.erros.perguntaVazia)).toBeVisible();
    expect(post).not.toHaveBeenCalled();

    await campoDaPergunta().fill("Agora sim?");
    await campoDaResposta(2).fill("outra");
    await expect.poll(() => page.getByText(t.erros.poucasRespostas).query()).toBeNull();
    await criar();
    await expect.poll(() => post.mock.calls.length).toBe(1);
  });

  it("os campos travam no limite do servidor", async () => {
    await abrir();
    await expect.element(campoDaPergunta()).toHaveAttribute("maxlength", String(MAXIMO_DA_PERGUNTA));
    await expect.element(campoDaResposta(1)).toHaveAttribute("maxlength", String(MAXIMO_DA_RESPOSTA));
    await campoDaPergunta().fill("x".repeat(MAXIMO_DA_PERGUNTA));
    await expect.element(page.getByText(t.restam(0))).toBeVisible();
  });

  it("a validação espelha a do servidor (texto que passou do teto por fora do campo)", () => {
    expect(validarEnquete("x".repeat(301), ["a", "b"]).pergunta).toBe(t.erros.perguntaLonga(300));
    expect(validarEnquete("x".repeat(300), ["a", "b"])).toEqual({});
    expect(validarEnquete("Q", ["a", "y".repeat(101)]).respostas).toBe(t.erros.respostaLonga(100));
    expect(validarEnquete("Q", ["a", "y".repeat(100)])).toEqual({});
    // Conta caractere como o servidor, não unidade UTF-16: 100 emojis cabem.
    expect(validarEnquete("Q", ["a", "😀".repeat(100)])).toEqual({});
    expect(validarEnquete("Q", ["a", " ", ""]).respostas).toBe(t.erros.poucasRespostas);
  });
});

describe("erro do servidor", () => {
  it("mantém o formulário preenchido e mostra o toast", async () => {
    let recusar!: (e: Error) => void;
    post.mockImplementation(() => new Promise((_ok, falha) => (recusar = falha)));
    await abrir();
    await campoDaPergunta().fill("Q?");
    await campoDaResposta(1).fill("a");
    await campoDaResposta(2).fill("b");
    await criar();

    // Enviando: o botão marca ocupado e os campos travam.
    await expect.element(page.getByRole("button", { name: t.criar, exact: true })).toHaveAttribute("aria-busy", "true");
    await expect.element(campoDaPergunta()).toBeDisabled();

    recusar(new Error("recusado"));
    await expect.poll(() => lerToasts().map((x) => x.titulo)).toContain("Não deu para criar a enquete.");
    await expect.element(campoDaPergunta()).toBeEnabled();
    expect(dialogo()).not.toBeNull();
    await expect.element(campoDaPergunta()).toHaveValue("Q?");
    await expect.element(campoDaResposta(2)).toHaveValue("b");
  });

  it("sem conexão não envia, avisa e mantém o formulário", async () => {
    eventos.state = () => 0;
    await abrir();
    await campoDaPergunta().fill("Q?");
    await campoDaResposta(1).fill("a");
    await campoDaResposta(2).fill("b");
    await criar();
    await expect.poll(() => lerToasts().map((x) => x.titulo)).toContain("Sem conexão.");
    expect(post).not.toHaveBeenCalled();
    expect(dialogo()).not.toBeNull();
  });
});
