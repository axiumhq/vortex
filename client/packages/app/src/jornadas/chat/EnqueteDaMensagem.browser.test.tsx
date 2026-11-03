import "../../arnes/redeFalsa";

import { CHANNEL_ID, SERVER_ID, enquetesDoArnes, seed } from "nucleo/arnes/firehose";
import { republicarEnquete } from "nucleo/sdk/adapter";
import { client } from "nucleo/sdk/client";
import { definirEnqueteBruta, lerEnqueteBruta, type EnqueteBruta } from "nucleo/store/enquetes";
import { dispensarToast, lerToasts } from "nucleo/ui-logica/toastStore";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AreaPrincipal } from "../../shell";
import { quadros } from "../../testes/esperas";
import { desmontar, montar } from "../../ui/ds/montar";
import { alturaDaEnquete } from "./alturas";
import { ListaDeMensagens } from "./ListaDeMensagens";

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

beforeAll(async () => {
  await seed(200);
  ({ aberta, encerrada } = enquetesDoArnes()!);
  brutaAberta = lerEnqueteBruta(aberta)!;
  brutaEncerrada = lerEnqueteBruta(encerrada)!;
}, 60_000);

afterEach(() => {
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
const opcoesDe = (id: string) => Array.from(caixaDe(id)?.querySelectorAll<HTMLButtonElement>("button") ?? []);
const opcao = (id: string, texto: string) => opcoesDe(id).find((b) => b.textContent?.includes(texto))!;
const alturaDaLinha = (id: string) => linhaDe(id)!.closest<HTMLElement>("[data-index]")!.offsetHeight;
const rodape = (id: string) => caixaDe(id)!.lastElementChild!.textContent;

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
    expect(rodape(aberta)).toMatch(/fecha em 2[12] h/);
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
    expect(rodape(encerrada)).toBe("25 votos · encerrada");
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
    expect(rodape(aberta)).toContain("fecha em 2 min");

    vi.advanceTimersByTime(3 * 60_000);
    await expect.poll(() => caixaDe(aberta)!.dataset.enquete).toBe("encerrada");
    expect(opcao(aberta, "Confortável").dataset.venceu).toBeDefined();
    expect(opcoesDe(aberta).every((b) => b.disabled)).toBe(true);
  });
});
