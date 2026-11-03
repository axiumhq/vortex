import "../../arnes/redeFalsa";

import { CHANNEL_ID, SERVER_ID, seed, startFirehose } from "nucleo/arnes/firehose";
import { messages } from "nucleo/sdk/adapter";
import { definirAparencia, restaurarAparencia } from "nucleo/store/aparencia";
import { definirDensidade } from "nucleo/store/densidade";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { definirPersonalizacao } from "../../tema/personalizado";
import { PERSONALIZACAO_PADRAO } from "../../tema/personalizar";
import { assentar, quadros } from "../../testes/esperas";
import { alturaDoTipo, type TipoDeLinha } from "./alturas";

import { AreaPrincipal } from "../../shell";
import { desmontar, montar, pegar } from "../../ui/ds/montar";
import { AreaDeChat } from "./AreaDeChat";
import { ListaDeMensagens } from "./ListaDeMensagens";

afterEach(() => {
  desmontar();
  restaurarAparencia();
  definirDensidade("confortavel");
  definirPersonalizacao({ ...PERSONALIZACAO_PADRAO });
});

let ids: readonly string[] = [];
beforeAll(async () => {
  ids = await seed(3000);
}, 60_000);

const log = () => pegar<HTMLElement>('[role="log"]')!;
const distanciaDoFim = () => log().scrollHeight - log().clientHeight - log().scrollTop;
const linhas = () => Array.from(document.querySelectorAll<HTMLElement>("[data-index]"));
/**
 * A lista PAROU: rolagem, altura total e a janela montada (índice e altura de cada linha)
 * iguais em leituras seguidas. Espera fixa aqui media a lista no meio da remedição quando o
 * runner do CI estava com a CPU disputada.
 */
const assentarLista = () =>
  assentar(() =>
    [log().scrollTop, log().scrollHeight, linhas().map((l) => `${l.dataset.index ?? ""}:${String(l.offsetHeight)}`).join(",")].join("|"),
  );

function montarLista(largura = 900) {
  document.documentElement.dataset.tema = "vidro";
  return montar(
    <div style={{ inlineSize: `${largura}px`, blockSize: "600px", display: "grid" }}>
      <AreaPrincipal>
        <ListaDeMensagens canalId={CHANNEL_ID} servidorId={SERVER_ID} />
      </AreaPrincipal>
    </div>,
  );
}

describe("ListaDeMensagens", () => {
  it("virtualiza: monta só a janela visível de milhares de mensagens", async () => {
    montarLista();
    await expect.poll(() => linhas().length).toBeGreaterThan(0);
    expect(ids.length).toBe(3000);
    expect(linhas().length).toBeLessThan(80);
    // O container de rolagem tem teto: se não tivesse, as 3000 linhas montariam.
    expect(log().clientHeight).toBeLessThanOrEqual(600);
  });

  it("nasce ancorada no fim e nenhuma linha mede 0px", async () => {
    montarLista();
    await expect.poll(distanciaDoFim, { timeout: 5000 }).toBeLessThanOrEqual(80);
    for (const l of linhas()) expect(l.offsetHeight).toBeGreaterThan(0);
  });

  it("segue o fim sob firehose (followOnAppend vivo)", async () => {
    montarLista();
    await expect.poll(distanciaDoFim, { timeout: 5000 }).toBeLessThanOrEqual(80);
    const antes = log().scrollHeight;
    const parar = startFirehose(500, ids);
    // Esta espera FICA: é a duração do estímulo (3s de firehose a 500 eventos/s), não uma
    // aposta sobre quando algo termina. O que vem depois espera estado.
    await new Promise((r) => setTimeout(r, 3000));
    parar();
    await assentarLista();
    expect(log().scrollHeight).toBeGreaterThan(antes);
    expect(distanciaDoFim()).toBeLessThanOrEqual(80);
  }, 20_000);

  it("arrastar a barra de rolagem descola do fim: mensagem nova não puxa de volta", async () => {
    montarLista();
    const el = log();
    // Leitura assentada: rolagem, altura total e a janela montada (índice e altura de cada
    // linha) iguais em várias leituras seguidas, e só então a condição. Duas leituras a 100ms
    // não bastavam: sob CPU disputada um quadro passa de 100ms, e a posição era guardada com
    // linhas recém-montadas ainda por medir — a compensação de medida delas (legítima: segura
    // o conteúdo no lugar) movia o `scrollTop` depois, e o teste acusava um puxão que não houve.
    // O `scrollToEnd` da carga inicial também segue reconciliando por alguns quadros, e um
    // arraste no meio dele seria atropelado pelo próprio virtualizador.
    const assentada = async (condicao: () => boolean) => {
      await expect.poll(condicao, { timeout: 5000 }).toBe(true);
      await assentarLista();
      expect(condicao()).toBe(true);
    };
    await assentada(() => distanciaDoFim() <= 80);

    // Arraste da barra: o alvo do ponteiro é o PRÓPRIO container (a barra pertence a
    // ele), e não há `wheel` nem tecla — só a rolagem que o navegador aplica.
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, buttons: 1, pointerType: "mouse" }));
    el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2);
    await assentada(() => distanciaDoFim() > 400);
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, buttons: 0, pointerType: "mouse" }));
    await assentada(() => distanciaDoFim() > 400);
    const posicao = el.scrollTop;
    const altura = el.scrollHeight;

    // Só mensagens: cada uma cresce o conteúdo no fim, que é o que reancorava.
    const parar = startFirehose(60, ids, { message: 1, update: 0, reaction: 0, typing: 0, presence: 0 });
    try {
      await expect.poll(() => el.scrollHeight, { timeout: 5000 }).toBeGreaterThan(altura + 200);
    } finally {
      parar();
    }
    await assentada(() => true);
    expect(Math.abs(el.scrollTop - posicao)).toBeLessThanOrEqual(2);
    expect(distanciaDoFim()).toBeGreaterThan(400);
  }, 30_000);

  it("remede ao mudar a largura: todas as linhas na janela batem com a altura do DOM", async () => {
    const alvo = montarLista(900);
    await expect.poll(distanciaDoFim, { timeout: 5000 }).toBeLessThanOrEqual(80);
    (alvo.firstElementChild as HTMLElement).style.inlineSize = "420px";
    await assentarLista();
    const virtuais = linhas();
    expect(virtuais.length).toBeGreaterThan(0);
    // Sem remedição, as linhas ficariam posicionadas pela estimativa e se sobreporiam.
    for (let i = 1; i < virtuais.length; i++) {
      const anterior = virtuais[i - 1]!.getBoundingClientRect();
      const atual = virtuais[i]!.getBoundingClientRect();
      expect(atual.top).toBeGreaterThanOrEqual(anterior.bottom - 1);
    }
    expect(distanciaDoFim()).toBeLessThanOrEqual(80);
  });

  it("a coluna ocupa a largura toda, alinhada ao início, sem centralizar em tela larga", async () => {
    montarLista(2000);
    await expect.poll(() => linhas().length).toBeGreaterThan(0);
    const coluna = linhas()[0]!.parentElement!.parentElement!.getBoundingClientRect();
    const area = log().getBoundingClientRect();
    // Sem teto: a coluna só cede a calha da barra de rolagem.
    expect(coluna.left).toBeCloseTo(area.left, 0);
    expect(coluna.width).toBeGreaterThan(area.width - 24);
    expect(coluna.width).toBeGreaterThan(56 * 16);
  });

  it("o composer fica sob a coluna: mesmo início, mesmo recuo lateral", async () => {
    document.documentElement.dataset.tema = "vidro";
    montar(
      <div style={{ inlineSize: "2000px", blockSize: "600px", display: "grid" }}>
        <AreaPrincipal>
          <AreaDeChat canalId={CHANNEL_ID} servidorId={SERVER_ID} />
        </AreaPrincipal>
      </div>,
    );
    await expect.poll(() => linhas().length).toBeGreaterThan(0);
    const area = log().getBoundingClientRect();
    const composer = pegar<HTMLElement>("textarea")!;
    await expect.poll(() => composer.getBoundingClientRect().width).toBeGreaterThan(56 * 16);
    const campo = composer.getBoundingClientRect();
    // O campo preenche a largura (menos o recuo e os botões da caixa), e não uma coluna centrada.
    expect(campo.left - area.left).toBeLessThanOrEqual(80);
    expect(area.right - campo.right).toBeLessThanOrEqual(120);
  });
});

describe("densidade e tamanho do texto na lista", () => {
  type Amostra = { readonly altura: number; readonly tipo: TipoDeLinha };
  const PASSOS = 30;

  /**
   * A altura real de cada linha "limpa" (sem divisor, resposta, reação, anexo nem estado de
   * envio), por índice: é para elas que a constante vale, o resto a lista soma por fora.
   * Como a chave é o índice, duas configurações medem AS MESMAS linhas e o que se compara é a
   * razão entre elas, sem o ruído de quais linhas cairam na janela.
   *
   * PASSOS janelas espaçadas, e não a lista inteira: a razão é média de centenas de linhas
   * já com 30 janelas, e cada passo custa um salto de rolagem com a janela remontada e
   * remedida. Com 150 passos por configuração (906 saltos no teste) o teste levava ~120s
   * numa CPU disputada e estourava o tempo; e o corpo de um teste que estoura CONTINUA
   * rodando — rolava a lista e trocava a densidade no meio do teste seguinte, que nunca
   * assentava. O `signal` corta o laço se o teste for abortado, pelo mesmo motivo.
   */
  async function varrer(signal: AbortSignal) {
    await expect.poll(() => linhas().length).toBeGreaterThan(0);
    const saida = new Map<number, Amostra>();
    for (let passo = 0; passo <= PASSOS; passo++) {
      signal.throwIfAborted();
      log().scrollTop = (log().scrollHeight - log().clientHeight) * (1 - passo / PASSOS);
      await quadros(1);
      for (const l of linhas()) {
        const i = Number(l.dataset["index"]);
        const m = messages.getSnapshot(ids[i] ?? "");
        if (!m || m.dia !== undefined || m.primeiraNaoLida || m.respostas.length > 0 || m.reactions.length > 0) continue;
        if (m.sendState !== "sent" || m.anexos.length > 0) continue;
        saida.set(i, { altura: l.offsetHeight, tipo: m.sistema ? "sistema" : m.iniciaGrupo ? "abreGrupo" : "continua" });
      }
    }
    return saida;
  }

  const razao = (base: Map<number, Amostra>, outra: Map<number, Amostra>, tipo: TipoDeLinha) => {
    let a = 0;
    let b = 0;
    let n = 0;
    for (const [i, x] of base) {
      const y = outra.get(i);
      if (!y || x.tipo !== tipo) continue;
      a += x.altura;
      b += y.altura;
      n += 1;
    }
    return { razao: b / a, n };
  };

  const casos = [
    ["compacto", 100],
    ["confortavel", 125],
    ["compacto", 125],
    ["confortavel", 90],
    ["compacto", 90],
  ] as const;

  it("a estimativa de altura de cada tipo acompanha a densidade e o tamanho do texto (mesmas linhas, razão a menos de 15%)", async ({ signal }) => {
    montarLista();
    const base = await varrer(signal);
    const resultados: string[] = [];
    const fora: string[] = [];
    for (const [densidade, texto] of casos) {
      definirDensidade(densidade);
      definirAparencia({ texto });
      await assentarLista();
      const outra = await varrer(signal);
      for (const tipo of ["abreGrupo", "continua", "sistema"] as const) {
        const medida = razao(base, outra, tipo);
        if (medida.n < 5) continue;
        const estimada = alturaDoTipo(tipo, densidade, texto) / alturaDoTipo(tipo, "confortavel", 100);
        resultados.push(`${densidade} ${String(texto)}% ${tipo}: medida ${medida.razao.toFixed(3)} estimada ${estimada.toFixed(3)} (n=${String(medida.n)})`);
        if (Math.abs(medida.razao - estimada) / estimada >= 0.15) fora.push(resultados.at(-1) ?? "");
      }
    }
    console.info(["[alturas]", ...resultados].join(" | "));
    expect(fora).toEqual([]);
  }, 120_000);

  it("compacta não tem avatar e mostra a hora de toda mensagem na calha", async () => {
    definirDensidade("compacto");
    montarLista();
    await expect.poll(() => linhas().length).toBeGreaterThan(0);
    expect(log().querySelectorAll("article [class*='Avatar']").length).toBe(0);
    const artigos = Array.from(log().querySelectorAll("article"));
    expect(artigos.length).toBeGreaterThan(3);
    for (const a of artigos) expect(a.querySelector("time")).not.toBeNull();
  });

  it("trocar a densidade com a lista aberta remede e mantém a lista colada no fim, sem sobreposição", async () => {
    montarLista();
    await expect.poll(distanciaDoFim, { timeout: 5000 }).toBeLessThanOrEqual(80);
    definirDensidade("compacto");
    await assentarLista();
    const virtuais = linhas();
    for (let i = 1; i < virtuais.length; i++) {
      const anterior = virtuais[i - 1]!.getBoundingClientRect();
      const atual = virtuais[i]!.getBoundingClientRect();
      expect(atual.top).toBeGreaterThanOrEqual(anterior.bottom - 1);
    }
    expect(distanciaDoFim()).toBeLessThanOrEqual(80);
    definirAparencia({ texto: 125 });
    await assentarLista();
    expect(distanciaDoFim()).toBeLessThanOrEqual(80);
    for (const l of linhas()) expect(l.offsetHeight).toBeGreaterThan(0);
  });
});
