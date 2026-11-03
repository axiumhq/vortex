import "../../arnes/redeFalsa";

import { CHANNEL_ID, SERVER_ID, enquetesDoArnes, seed } from "nucleo/arnes/firehose";
import { definirUsuarioLocal, republicarEnquete, usuarioLocalId } from "nucleo/sdk/adapter";
import { client } from "nucleo/sdk/client";
import { definirEnqueteBruta, lerEnqueteBruta, type EnqueteBruta } from "nucleo/store/enquetes";
import { dispensarToast, lerToasts } from "nucleo/ui-logica/toastStore";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AreaPrincipal } from "../../shell";
import { quadros } from "../../testes/esperas";
import { desmontar, montar } from "../../ui/ds/montar";
import { alturaDaEnquete } from "./alturas";
import { ListaDeMensagens } from "./ListaDeMensagens";

/*
  Permissão e "quem sou eu" controlados pelo teste. Sem servidor, `pode`
  responde `true` para tudo (ver `SEM_SERVIDOR` em `permissoes.ts`), e a
  regra "só autor ou gerente encerra" seria intestável. "Quem sou eu" é
  trocado pelo caminho real (`definirUsuarioLocal`) e devolvido no fim: mockar
  o adapter inteiro trava o import (ele importa quem o importa).
*/
const ctl = vi.hoisted(() => ({ negadas: new Set<string>() }));

vi.mock("nucleo/sdk/permissoes", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  pode: (_canal: string, acao: string) => !ctl.negadas.has(acao),
}));

/**
 * A enquete na lista real, com o mundo do arnês (uma aberta e uma encerrada
 * semeadas perto do fim) e a rede dublada: `conectado()` lê o estado do
 * socket e `client.api.put` é a rota do voto.
 */

const ESTADO_CONECTADO = 2; // ConnectionState.Connected
const eventos = client.events as unknown as { state: () => number };
const estadoOriginal = eventos.state;

let aberta = "";
let encerrada = "";
let brutaAberta: EnqueteBruta;
let brutaEncerrada: EnqueteBruta;
/** Gente de verdade do arnês (autores das mensagens semeadas): nome e avatar resolvem. */
let gente: string[] = [];
let euDoArnes = "";

beforeAll(async () => {
  const ids = await seed(200);
  gente = [...new Set(ids.map((id) => client.messages.get(id)?.authorId).filter((a): a is string => !!a))];
  ({ aberta, encerrada } = enquetesDoArnes()!);
  euDoArnes = usuarioLocalId()!;
  brutaAberta = lerEnqueteBruta(aberta)!;
  brutaEncerrada = lerEnqueteBruta(encerrada)!;
}, 60_000);

afterEach(() => {
  ctl.negadas.clear();
  if (usuarioLocalId() !== euDoArnes) definirUsuarioLocal(euDoArnes);
  vi.useRealTimers();
  vi.restoreAllMocks();
  eventos.state = estadoOriginal;
  for (const t of lerToasts()) dispensarToast(t.id);
  // Devolve as semeadas enquanto as linhas ainda assinam: a republicação só acorda quem assina.
  definirEnqueteBruta(aberta, brutaAberta);
  definirEnqueteBruta(encerrada, brutaEncerrada);
  republicarEnquete(aberta);
  republicarEnquete(encerrada);
  desmontar();
});

function montarLista() {
  document.documentElement.dataset.tema = "vidro";
  return montar(
    <div style={{ inlineSize: "900px", blockSize: "900px", display: "grid" }}>
      <AreaPrincipal>
        <ListaDeMensagens canalId={CHANNEL_ID} servidorId={SERVER_ID} />
      </AreaPrincipal>
    </div>,
  );
}

/** Troca a enquete semeada com a linha MONTADA: a republicação só acorda quem assina. */
function semear(id: string, bruta: EnqueteBruta) {
  definirEnqueteBruta(id, bruta);
  republicarEnquete(id);
}

const linhaDe = (id: string) => document.querySelector<HTMLElement>(`[data-menu-mensagem="${id}"]`);
const caixaDe = (id: string) => linhaDe(id)?.querySelector<HTMLElement>("[data-enquete]") ?? null;
const opcoesDe = (id: string) =>
  Array.from(caixaDe(id)?.querySelectorAll<HTMLButtonElement>("[role='group'] button") ?? []);
const opcao = (id: string, texto: string) => opcoesDe(id).find((b) => b.textContent?.includes(texto))!;
const alturaDaLinha = (id: string) => linhaDe(id)!.closest<HTMLElement>("[data-index]")!.offsetHeight;
const rodape = (id: string) => caixaDe(id)!.querySelector("[data-rodape-texto]")!.textContent;
/** A faixa inteira do rodapé: resumo, prazo e ações. */
const faixaDoRodape = (id: string) => caixaDe(id)!.querySelector("[data-rodape-texto]")!.parentElement!.textContent;
const acaoDoRodape = (id: string, texto: string) =>
  Array.from(caixaDe(id)?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (b) => !b.closest("[role='group']") && b.textContent === texto,
  ) ?? null;
const dialogo = () => document.querySelector<HTMLElement>("[role='dialog']");

async function aparecer(id: string, bruta?: EnqueteBruta) {
  montarLista();
  await expect.poll(() => caixaDe(id), { timeout: 5000 }).not.toBeNull();
  if (bruta) semear(id, bruta);
  await quadros(3);
}

/** Socket "aberto" e a rota do voto respondendo com o que o teste mandar. */
function ligarRede(put: () => Promise<unknown>) {
  eventos.state = () => ESTADO_CONECTADO;
  // Com socket aberto a lista confirma a leitura ao ficar no fim; o arnês não tem a coleção de não lidas.
  vi.spyOn(client.channels.get(CHANNEL_ID)!, "ack").mockResolvedValue(undefined);
  return vi.spyOn(client.api, "put").mockImplementation(put as never);
}

describe("enquete na mensagem", () => {
  it("aberta: cabeçalho, marcas, porcentagens e rodapé", async () => {
    await aparecer(aberta);
    const caixa = caixaDe(aberta)!;
    expect(caixa.dataset.enquete).toBe("aberta");
    expect(caixa.textContent).toContain("Enquete · uma resposta");
    expect(caixa.querySelector("[role='group']")!.getAttribute("aria-label")).toBe("Qual densidade vai como padrão?");
    expect(opcao(aberta, "Confortável").textContent).toContain("🅰");
    expect(opcao(aberta, "Confortável").textContent).toContain("61%");
    expect(opcao(aberta, "Compacto").textContent).toContain("39%");
    expect(rodape(aberta)).toContain("23 votos");
    expect(faixaDoRodape(aberta)).toMatch(/fecha em 2[12] h/);
  });

  it("a estimativa da caixa é a altura medida (tipo medido, não chutado)", async () => {
    await aparecer(aberta);
    const caixa = caixaDe(aberta)!;
    const medida = caixa.offsetHeight + parseFloat(getComputedStyle(caixa).marginBlockStart);
    expect(Math.abs(medida - alturaDaEnquete(2))).toBeLessThanOrEqual(2);
  });

  it.each([
    ["com porcentagens à vista", false],
    ["com resultado no fim", true],
  ])("votar não muda a altura da linha (%s)", async (_nome, esconder) => {
    ligarRede(() => Promise.resolve(undefined));
    await aparecer(aberta, { ...brutaAberta, esconder });
    const antes = alturaDaLinha(aberta);
    const caixaAntes = caixaDe(aberta)!.offsetHeight;

    opcao(aberta, "Compacto").click();
    await expect.poll(() => opcao(aberta, "Compacto").getAttribute("aria-pressed")).toBe("true");
    await quadros(3);

    expect(rodape(aberta)).toContain("24 votos · você votou");
    expect(caixaDe(aberta)!.offsetHeight).toBe(caixaAntes);
    expect(alturaDaLinha(aberta)).toBe(antes);
  });

  it("voto que falha volta ao anterior e avisa", async () => {
    let recusar!: (e: Error) => void;
    const put = ligarRede(() => new Promise((_ok, falha) => (recusar = falha)));
    await aparecer(aberta);

    opcao(aberta, "Compacto").click();
    // Otimista: preenche na hora.
    await expect.poll(() => opcao(aberta, "Compacto").getAttribute("aria-pressed")).toBe("true");
    expect(put).toHaveBeenCalledOnce();

    recusar(new Error("recusado"));
    await expect.poll(() => opcao(aberta, "Compacto").getAttribute("aria-pressed")).toBe("false");
    expect(opcoesDe(aberta).every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(rodape(aberta)).toContain("23 votos");
    expect(lerToasts().map((t) => t.titulo)).toContain("O voto não foi registrado.");
  });

  it("resultado no fim esconde as porcentagens até votar, e o total fica", async () => {
    ligarRede(() => Promise.resolve(undefined));
    await aparecer(aberta, { ...brutaAberta, esconder: true });

    expect(caixaDe(aberta)!.textContent).not.toMatch(/\d+%/);
    expect(rodape(aberta)).toContain("23 votos · resultado no fim");

    opcao(aberta, "Confortável").click();
    await expect.poll(() => caixaDe(aberta)!.textContent).toMatch(/63%/);
    expect(rodape(aberta)).toContain("24 votos · você votou");
  });

  it("encerrada: selo, troféu na vencedora, botões travados e rodapé", async () => {
    await aparecer(encerrada);
    const caixa = caixaDe(encerrada)!;
    expect(caixa.dataset.enquete).toBe("encerrada");
    expect(caixa.textContent).toContain("Enquete encerrada");
    expect(caixa.textContent).toContain("Resultado");
    const vencedora = opcao(encerrada, "64 kbps");
    expect(vencedora.dataset.venceu).toBeDefined();
    expect(vencedora.querySelector("svg[aria-label='Mais votada']")).not.toBeNull();
    expect(opcao(encerrada, "96 kbps").querySelector("svg")).toBeNull();
    expect(opcoesDe(encerrada).every((b) => b.disabled)).toBe(true);
    // `ended_at` vira data no rodapé: "25 votos · encerrada em 3 de nov., 13:57".
    expect(rodape(encerrada)).toMatch(/^25 votos · encerrada em \d{1,2} de \S+ \d{2}:\d{2}$/u);
  });

  it("empate: o troféu fica com a primeira resposta", async () => {
    const empate = new Map([
      ["r0", new Set(["x1", "x2"])],
      ["r1", new Set(["y1", "y2"])],
    ]);
    await aparecer(encerrada, { ...brutaEncerrada, votos: empate });
    expect(opcao(encerrada, "64 kbps").dataset.venceu).toBeDefined();
    expect(opcao(encerrada, "96 kbps").dataset.venceu).toBeUndefined();
  });

  it("prazo que vence com a linha aberta encerra pelo relógio, sem evento", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    // Na virada de um minuto: o relógio é por minuto, e o texto do prazo fica determinístico.
    const minuto = Math.ceil(Date.now() / 60_000) * 60_000;
    vi.setSystemTime(minuto + 1000);
    await aparecer(aberta, { ...brutaAberta, expiraEm: minuto + 90_000 });
    expect(caixaDe(aberta)!.dataset.enquete).toBe("aberta");
    expect(faixaDoRodape(aberta)).toContain("fecha em 2 min");

    vi.advanceTimersByTime(3 * 60_000);
    await expect.poll(() => caixaDe(aberta)!.dataset.enquete).toBe("encerrada");
    expect(opcao(aberta, "Confortável").dataset.venceu).toBeDefined();
    expect(opcoesDe(aberta).every((b) => b.disabled)).toBe(true);
  });
});

/** A seção de uma resposta no modal: os IDs de quem votou, na ordem da tela. */
const votantesDe = (resposta: string) =>
  Array.from(
    dialogo()
      ?.querySelector(`section[aria-label="${resposta}"]`)
      ?.querySelectorAll<HTMLElement>("[data-votante]") ?? [],
  ).map((li) => li.dataset.votante);

describe("ver votos", () => {
  it("lista quem votou em cada resposta, com nome resolvido", async () => {
    const [p1, p2, p3] = gente;
    await aparecer(aberta, {
      ...brutaAberta,
      votos: new Map([
        ["r0", new Set([p1!, p2!])],
        ["r1", new Set([p3!])],
      ]),
    });

    acaoDoRodape(aberta, "Ver votos")!.click();
    await expect.poll(dialogo).not.toBeNull();
    expect(dialogo()!.textContent).toContain("Quem votou");
    expect(votantesDe("Confortável")).toEqual([p1, p2]);
    expect(votantesDe("Compacto")).toEqual([p3]);
    // Nome e avatar do store de membros, não o ID cru nem "Alguém".
    await expect
      .poll(() => Array.from(dialogo()!.querySelectorAll("[data-votante]")).map((li) => li.textContent))
      .not.toContain("Alguém");
    expect(dialogo()!.querySelector("[data-votante]")!.textContent).not.toContain(p1!);
  });

  it("resposta sem voto diz 'ninguém' em vez de sumir", async () => {
    await aparecer(aberta, { ...brutaAberta, votos: new Map([["r0", new Set([gente[0]!])]]) });
    acaoDoRodape(aberta, "Ver votos")!.click();
    await expect.poll(dialogo).not.toBeNull();
    expect(dialogo()!.querySelector('section[aria-label="Compacto"]')!.textContent).toContain(
      "Ninguém votou nesta resposta",
    );
  });

  it("some com o resultado escondido, e o modal repete a guarda", async () => {
    ligarRede(() => Promise.resolve(undefined));
    await aparecer(aberta, { ...brutaAberta, esconder: true });
    // Resultado no fim, aberta, sem o meu voto: nada de "Ver votos".
    expect(acaoDoRodape(aberta, "Ver votos")).toBeNull();

    opcao(aberta, "Compacto").click();
    await expect.poll(() => acaoDoRodape(aberta, "Ver votos")).not.toBeNull();
    acaoDoRodape(aberta, "Ver votos")!.click();
    await expect.poll(() => dialogo()?.querySelector("[data-votos-da-enquete]") ?? null).not.toBeNull();

    // O servidor desfaz o meu voto com o modal aberto: a lista some de dentro dele.
    semear(aberta, { ...brutaAberta, esconder: true });
    await expect.poll(() => dialogo()?.querySelector("[data-votos-escondidos]") ?? null).not.toBeNull();
    expect(dialogo()!.querySelector("[data-votante]")).toBeNull();
  });
});

describe("encerrar", () => {
  const autorDe = (id: string) => client.messages.get(id)!.authorId!;
  /** Alguém que NÃO escreveu a enquete aberta. */
  const outraPessoa = () => gente.find((g) => g !== autorDe(aberta))!;
  const encerrar = () => acaoDoRodape(aberta, "Encerrar");

  it("não aparece para quem não é autor nem gerencia mensagens", async () => {
    ctl.negadas.add("encerrarEnquete");
    definirUsuarioLocal(outraPessoa());
    await aparecer(aberta);
    expect(acaoDoRodape(aberta, "Ver votos")).not.toBeNull();
    expect(encerrar()).toBeNull();
  });

  it("aparece para o autor, mesmo sem permissão de gerenciar", async () => {
    ctl.negadas.add("encerrarEnquete");
    definirUsuarioLocal(autorDe(aberta));
    await aparecer(aberta);
    expect(encerrar()).not.toBeNull();
  });

  it("aparece para quem gerencia mensagens", async () => {
    definirUsuarioLocal(outraPessoa());
    await aparecer(aberta);
    expect(encerrar()).not.toBeNull();
  });

  it("não aparece na enquete já encerrada", async () => {
    await aparecer(encerrada);
    expect(acaoDoRodape(encerrada, "Encerrar")).toBeNull();
  });

  it("pede confirmação, chama a rota e a linha não muda de altura", async () => {
    ligarRede(() => Promise.resolve(undefined));
    const post = vi.spyOn(client.api, "post").mockResolvedValue(undefined);
    await aparecer(aberta);
    const antes = alturaDaLinha(aberta);

    encerrar()!.click();
    await expect.poll(dialogo).not.toBeNull();
    expect(dialogo()!.textContent).toContain("Encerrar a enquete?");
    // Abrir a pergunta não chama nada.
    expect(post).not.toHaveBeenCalled();

    dialogo()!.querySelector<HTMLButtonElement>("button[type='submit']")!.click();
    await expect.poll(() => post.mock.calls.length).toBe(1);
    expect(post.mock.calls[0]![0]).toBe(`/channels/${CHANNEL_ID}/messages/${aberta}/poll/end`);
    await expect.poll(() => caixaDe(aberta)!.dataset.enquete).toBe("encerrada");
    await expect.poll(dialogo).toBeNull();
    expect(encerrar()).toBeNull();
    await quadros(3);
    expect(alturaDaLinha(aberta)).toBe(antes);
  });

  it("cancelar não chama a rota", async () => {
    ligarRede(() => Promise.resolve(undefined));
    const post = vi.spyOn(client.api, "post").mockResolvedValue(undefined);
    await aparecer(aberta);
    encerrar()!.click();
    await expect.poll(dialogo).not.toBeNull();
    Array.from(dialogo()!.querySelectorAll("button")).find((b) => b.textContent === "Cancelar")!.click();
    await expect.poll(dialogo).toBeNull();
    expect(post).not.toHaveBeenCalled();
    expect(caixaDe(aberta)!.dataset.enquete).toBe("aberta");
  });

  it("falha mostra toast e mantém a enquete aberta", async () => {
    ligarRede(() => Promise.resolve(undefined));
    vi.spyOn(client.api, "post").mockRejectedValue(new Error("403"));
    await aparecer(aberta);
    encerrar()!.click();
    await expect.poll(dialogo).not.toBeNull();
    dialogo()!.querySelector<HTMLButtonElement>("button[type='submit']")!.click();
    await expect.poll(() => lerToasts().map((t) => t.titulo)).toContain("Não deu para encerrar a enquete.");
    expect(caixaDe(aberta)!.dataset.enquete).toBe("aberta");
  });

  it("MessagePollEnd do socket substitui a enquete e mostra o resultado", async () => {
    await aparecer(aberta, { ...brutaAberta, esconder: true });
    const antes = alturaDaLinha(aberta);
    expect(caixaDe(aberta)!.textContent).not.toMatch(/\d+%/);

    const fim = "2026-11-02T18:40:00.000Z";
    client.events.emit("event", {
      type: "MessagePollEnd",
      id: aberta,
      poll: {
        question: brutaAberta.pergunta,
        answers: brutaAberta.respostas.map((r) => ({ id: r.id, text: r.texto })),
        max_answers: 1,
        hide_results: true,
        ended_at: fim,
        votes: { r0: ["x1"], r1: ["y1", "y2", "y3"] },
      },
    } as never);

    await expect.poll(() => caixaDe(aberta)!.dataset.enquete).toBe("encerrada");
    // Resultado à vista, com o placar do evento — não o de antes.
    expect(opcao(aberta, "Compacto").textContent).toContain("75%");
    expect(opcao(aberta, "Compacto").dataset.venceu).toBeDefined();
    const esperado = new Intl.DateTimeFormat("pt-BR", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(Date.parse(fim));
    expect(rodape(aberta)).toBe(`4 votos · encerrada em ${esperado}`);
    expect(acaoDoRodape(aberta, "Ver votos")).not.toBeNull();
    expect(encerrar()).toBeNull();
    await quadros(3);
    expect(alturaDaLinha(aberta)).toBe(antes);
  });
});
