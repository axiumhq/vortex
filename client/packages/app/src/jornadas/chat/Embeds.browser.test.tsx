import "../../arnes/redeFalsa";

import { CHANNEL_ID, SERVER_ID, seed } from "nucleo/arnes/firehose";
import { messages } from "nucleo/sdk/adapter";
import type { EmbedSnapshot } from "nucleo/sdk/domain";
import { definirAparencia, restaurarAparencia } from "nucleo/store/aparencia";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AreaPrincipal } from "../../shell";
import { assentarRolagem, quadros } from "../../testes/esperas";
import { desmontar, montar, pegar } from "../../ui/ds/montar";
import { ListaDeMensagens } from "./ListaDeMensagens";

/**
 * As prévias de link na lista real: o cartão, a caixa reservada antes da imagem,
 * o player que só carrega ao clique, o limite de três — e, o que mais importa, a
 * chegada TARDIA do embed sem a lista pular.
 */

afterEach(() => {
  desmontar();
  restaurarAparencia();
});

beforeAll(async () => {
  await seed(200);
}, 60_000);

const log = () => pegar<HTMLElement>('[role="log"]')!;
const distanciaDoFim = () => log().scrollHeight - log().clientHeight - log().scrollTop;
const linhas = () => Array.from(document.querySelectorAll<HTMLElement>("[data-index]"));

function montarLista() {
  document.documentElement.dataset.tema = "vidro";
  return montar(
    <div style={{ inlineSize: "900px", blockSize: "600px", display: "grid" }}>
      <AreaPrincipal>
        <ListaDeMensagens canalId={CHANNEL_ID} servidorId={SERVER_ID} />
      </AreaPrincipal>
    </div>,
  );
}

/** Uma imagem que nunca chega: a caixa reservada tem de existir mesmo assim. */
const SEM_REDE = "http://127.0.0.1:9/nunca.png";

function site(over: Partial<EmbedSnapshot> = {}): EmbedSnapshot {
  return {
    id: "https://exemplo.com/post",
    tipo: "site",
    url: "https://exemplo.com/post",
    origem: "Exemplo",
    titulo: "Um post sobre cartões",
    descricao: "O resumo do post, que o servidor leu da página.",
    blocos: undefined,
    imagem: undefined,
    imagemGrande: false,
    video: undefined,
    especial: undefined,
    cor: "#35c2cc",
    ...over,
  };
}

/** Troca os embeds de uma mensagem como o `MessageUpdate` faz: pelo store, uma entidade só. */
function chegar(id: string, embeds: readonly EmbedSnapshot[]) {
  const atual = messages.peek(id);
  if (!atual) throw new Error(`mensagem ${id} não resolvida`);
  messages.set(id, { ...atual, embeds });
}

/** A última linha de verdade na tela, pelo ID que ela mesma declara. */
const ultimaId = () => {
  const todas = Array.from(document.querySelectorAll<HTMLElement>("[data-menu-mensagem]"));
  return todas[todas.length - 1]!.getAttribute("data-menu-mensagem")!;
};
/** Só os cartões que ESTE teste pôs: o firehose também gera embeds em outras linhas. */
const cartoes = () => Array.from(document.querySelectorAll<HTMLElement>("[data-embed]")).filter((c) => c.textContent?.includes(MARCA) || c.querySelector(`[href^="${MARCA_URL}"]`));
const MARCA = "Um post sobre cartões";
const MARCA_URL = "https://exemplo.com/";

/** Espera a lista PARAR: posição e altura iguais em 7 leituras seguidas (âncora e remedição quietas). */
const assentar = () => assentarRolagem(log, { leituras: 7 });

async function prontaNoFim() {
  montarLista();
  await expect.poll(distanciaDoFim, { timeout: 5000 }).toBeLessThanOrEqual(80);
  // Colada não é parada: a âncora e a remedição ainda movem a janela de linhas montadas.
  await assentar();
  expect(distanciaDoFim()).toBeLessThanOrEqual(80);
}

describe("prévia de link", () => {
  it("cartão de site: origem, título como link, descrição e barra de cor", async () => {
    await prontaNoFim();
    chegar(ultimaId(), [site()]);
    await expect.poll(() => cartoes().length, { timeout: 5000 }).toBe(1);
    const c = cartoes()[0]!;
    expect(c.textContent).toContain("Exemplo");
    expect(c.textContent).toContain("O resumo do post");
    const titulo = c.querySelector<HTMLAnchorElement>("a")!;
    expect(titulo.textContent).toBe("Um post sobre cartões");
    expect(titulo.getAttribute("href")).toBe("https://exemplo.com/post");
    expect(titulo.rel).toContain("noopener");
    expect(titulo.target).toBe("_blank");
    expect(c.style.getPropertyValue("--cor-do-embed")).toBe("#35c2cc");
  });

  it("imagem grande reserva a caixa pelo width/height ANTES de carregar", async () => {
    await prontaNoFim();
    chegar(ultimaId(), [
      site({ imagemGrande: true, imagem: { url: SEM_REDE, largura: 800, altura: 400 } }),
    ]);
    await expect.poll(() => cartoes().length, { timeout: 5000 }).toBe(1);
    const moldura = cartoes()[0]!.querySelector<HTMLElement>("[data-embed-midia='imagem']")!;
    const img = moldura.querySelector("img")!;
    // Sem um byte da imagem, a caixa já tem a proporção 2:1 na largura máxima.
    expect(img.complete && img.naturalWidth > 0).toBe(false);
    expect(Math.round(moldura.offsetWidth)).toBe(400);
    expect(Math.round(moldura.offsetHeight)).toBe(200);
  });

  it("sem imagem (servidor sem proxy) o cartão é só de texto", async () => {
    await prontaNoFim();
    chegar(ultimaId(), [site()]);
    await expect.poll(() => cartoes().length, { timeout: 5000 }).toBe(1);
    expect(cartoes()[0]!.querySelector("img")).toBeNull();
  });

  it("special: miniatura com play, e o iframe SÓ existe depois do clique", async () => {
    await prontaNoFim();
    chegar(ultimaId(), [
      site({
        titulo: "Um vídeo",
        imagem: { url: SEM_REDE, largura: 1280, altura: 720 },
        especial: {
          servico: "YouTube",
          playerUrl: "https://www.youtube-nocookie.com/embed/abc?modestbranding=1",
          audio: false,
        },
      }),
    ]);
    await expect.poll(() => cartoes().length, { timeout: 5000 }).toBe(1);
    const player = cartoes()[0]!.querySelector<HTMLElement>("[data-player='YouTube']")!;
    expect(document.querySelector("iframe")).toBeNull();
    expect(Math.round(player.offsetHeight)).toBe(225);

    cartoes()[0]!.querySelector<HTMLButtonElement>("button[aria-label='Reproduzir YouTube']")!.click();
    await expect.poll(() => document.querySelector("iframe")).not.toBeNull();
    const frame = document.querySelector("iframe")!;
    expect(frame.src).toContain("https://www.youtube-nocookie.com/embed/abc");
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    // Tocar não pula: a caixa do player é a mesma da miniatura.
    expect(Math.round(player.offsetHeight)).toBe(225);
  });

  it("mostra no máximo três e diz quantos faltam", async () => {
    await prontaNoFim();
    chegar(
      ultimaId(),
      Array.from({ length: 5 }, (_, i) => site({ id: `https://exemplo.com/${String(i)}`, titulo: `Link ${String(i)}` })),
    );
    await expect.poll(() => cartoes().length, { timeout: 5000 }).toBe(3);
    expect(cartoes()[0]!.closest("[data-embeds]")!.textContent).toContain("e mais 2");
  });

  it("desligar a prévia nas configurações esconde os cartões", async () => {
    await prontaNoFim();
    chegar(ultimaId(), [site()]);
    await expect.poll(() => cartoes().length, { timeout: 5000 }).toBe(1);
    definirAparencia({ previasDeLink: false });
    await expect.poll(() => cartoes().length, { timeout: 5000 }).toBe(0);
    definirAparencia({ previasDeLink: true });
    await expect.poll(() => cartoes().length, { timeout: 5000 }).toBe(1);
  });
});

describe("chegada tardia do embed", () => {
  it("no fim: a lista continua colada ao fim depois que o cartão cresce a linha", async () => {
    await prontaNoFim();
    const antes = log().scrollHeight;
    chegar(ultimaId(), [site({ imagemGrande: true, imagem: { url: SEM_REDE, largura: 800, altura: 400 } })]);
    await expect.poll(() => log().scrollHeight, { timeout: 4000 }).toBeGreaterThan(antes + 100);
    await expect.poll(distanciaDoFim, { timeout: 4000 }).toBeLessThanOrEqual(80);
  });

  /**
   * Sobe com gesto de verdade. A lista só solta o fim se o `scroll` chegar DENTRO da janela
   * de 150ms que um `wheel` abre; sob carga o `scroll` atrasa e a janela fecha antes. Por
   * isso o `wheel` é disparado na captura do próprio `scroll`, imediatamente antes do
   * ouvinte da lista — o mesmo que uma roda de verdade faz, sem depender do relógio.
   */
  async function subirComGesto() {
    const gesto = () => {
      log().dispatchEvent(new WheelEvent("wheel", { deltaY: -400, bubbles: true }));
    };
    window.addEventListener("scroll", gesto, { capture: true });
    try {
      const rolou = new Promise<void>((resolver) => {
        log().addEventListener("scroll", () => { resolver(); }, { once: true });
      });
      log().scrollTop = Math.max(0, log().scrollTop - 4000);
      // Teto, não espera: se a posição não mudou (já no topo) o `scroll` nunca vem. Quando
      // muda, ele é despachado nos passos de renderização do quadro seguinte, antes dos
      // callbacks de rAF — dois quadros pintados sem ele significam que não virá.
      await Promise.race([rolou, quadros(2)]);
    } finally {
      window.removeEventListener("scroll", gesto, { capture: true });
    }
  }

  async function lerNoMeio() {
    await prontaNoFim();
    // Sobe até o meio, com gesto de verdade para a lista soltar o fim, e só conta como
    // "lendo" quando FICA lá: sob carga a âncora ainda age e puxa de volta ao fim, e aí
    // sobe de novo. Pronto = longe do fim, com ao menos duas linhas inteiras na tela e
    // parada por várias leituras seguidas (uma linha muito alta com embed + resumo de
    // tópico pode ocupar quase toda a caixa de 600px e deixar só uma linha inteira).
    let anterior = "";
    let iguais = 0;
    await expect
      .poll(
        async () => {
          if (distanciaDoFim() <= 800) {
            await subirComGesto();
            iguais = 0;
            return 0;
          }
          const agora = `${String(log().scrollTop)}|${String(log().scrollHeight)}`;
          iguais = agora === anterior ? iguais + 1 : 0;
          anterior = agora;
          if (iguais >= 2 && linhasInteiras().length < 2 && log().scrollTop > 0) {
            await subirComGesto();
            iguais = 0;
            return 0;
          }
          return iguais;
        },
        { timeout: 10_000, interval: 80 },
      )
      .toBeGreaterThanOrEqual(8);
    expect(distanciaDoFim()).toBeGreaterThan(800);
  }

  function linhasInteiras() {
    const caixa = log().getBoundingClientRect();
    return linhas().filter((l) => topo(l) >= caixa.top && l.getBoundingClientRect().bottom <= caixa.bottom);
  }

  /** Linha de referência longe das bordas: a do meio das inteiras na tela (a primeira se couberem só duas). */
  function referencia() {
    const caixa = log().getBoundingClientRect();
    const inteiras = linhasInteiras();
    expect(inteiras.length).toBeGreaterThan(1);
    // Com poucas linhas altas na tela, a do meio seria a última: fica a primeira.
    return { caixa, inteiras, ancora: inteiras[inteiras.length > 2 ? Math.floor((inteiras.length - 1) / 2) : 0]! };
  }

  /** O topo da âncora depois do embed, relido até estabilizar; o índice pode remontar. */
  async function topoDepois(indice: string) {
    await expect.poll(() => cartoes().length, { timeout: 5000 }).toBeGreaterThan(0);
    await assentar();
    const linha = linhas().find((l) => l.dataset.index === indice);
    expect(linha, `índice ${indice} sumiu; fim a ${String(distanciaDoFim())}px, rolagem ${String(log().scrollTop)}`).toBeDefined();
    return topo(linha!);
  }
  const idDaLinha = (l: HTMLElement) => l.querySelector("[data-menu-mensagem]")!.getAttribute("data-menu-mensagem")!;
  const topo = (l: HTMLElement) => l.getBoundingClientRect().top;

  it("lendo no meio: cartão numa linha ACIMA da tela não move o que se lê", async () => {
    await lerNoMeio();
    const { caixa, ancora } = referencia();
    // Uma linha montada (overscan) que está INTEIRA acima da borda de cima.
    const acima = linhas().filter((l) => l.getBoundingClientRect().bottom <= caixa.top);
    expect(acima.length).toBeGreaterThan(0);
    const topoAntes = topo(ancora);
    const indice = ancora.dataset.index!;

    chegar(idDaLinha(acima[acima.length - 1]!), [
      site({ imagemGrande: true, imagem: { url: SEM_REDE, largura: 800, altura: 400 } }),
    ]);

    expect(Math.abs((await topoDepois(indice)) - topoAntes)).toBeLessThanOrEqual(2);
  });

  it("lendo no meio: cartão numa linha mais ABAIXO na tela não move as linhas de cima", async () => {
    await lerNoMeio();
    const { inteiras, ancora } = referencia();
    const topoAntes = topo(ancora);
    const indice = ancora.dataset.index!;

    chegar(idDaLinha(inteiras[inteiras.length - 1]!), [site()]);

    expect(Math.abs((await topoDepois(indice)) - topoAntes)).toBeLessThanOrEqual(2);
  });
});
