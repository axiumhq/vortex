import "../../arnes/redeFalsa";

import { CHANNEL_ID, SERVER_ID, seed } from "nucleo/arnes/firehose";
import { messages } from "nucleo/sdk/adapter";
import { limparIndiceDeTopicos, topicoDaMensagem } from "nucleo/sdk/topicos";
import { anotarCanais, limparMetaDeCanal, semearListagem } from "nucleo/sdk/vortexCanal";
import { lerCanalAtivo, selecionarCanal } from "nucleo/store/navegacao";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AreaPrincipal } from "../../shell";
import { assentar, quadros } from "../../testes/esperas";
import { desmontar, montar } from "../../ui/ds/montar";
import { ALTURA_DO_RESUMO_DE_TOPICO } from "./alturas";
import { ListaDeMensagens } from "./ListaDeMensagens";

/**
 * A linha "N respostas" na lista real, com o mundo do arnês. O índice mensagem -> tópico
 * é zerado a cada teste e os tópicos são criados aqui, sobre mensagens escolhidas.
 */

/** IDs de tópico válidos: `decodeTime` rejeita o que não é ULID. */
const T1 = "01JTPCQ0000000000000000001";
const T2 = "01JTPCQ0000000000000000002";

let gente: string[] = [];
let longe = "";

beforeAll(async () => {
  const ids = await seed(200);
  const deGente = ids.filter((id) => !messages.getSnapshot(id)?.sistema);
  gente = deGente.slice(-8);
  longe = deGente[2]!;
}, 60_000);

beforeEach(() => {
  limparMetaDeCanal();
  limparIndiceDeTopicos();
});

afterEach(() => {
  desmontar();
  limparMetaDeCanal();
  limparIndiceDeTopicos();
  selecionarCanal(CHANNEL_ID);
});

const cru = (id: string, mensagem: string, nome: string) => ({
  _id: id,
  channel_type: "TextChannel",
  server: SERVER_ID,
  name: nome,
  thread: { parent: CHANNEL_ID, owner: "01DONO", message: mensagem },
});

function abrirTopico(id: string, mensagem: string, nome = "Densidade padrão") {
  anotarCanais([cru(id, mensagem, nome)]);
}

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

const linhaDe = (id: string) => document.querySelector<HTMLElement>(`[data-menu-mensagem="${id}"]`);
const resumoDe = (id: string) => linhaDe(id)?.querySelector<HTMLElement>("[data-topico-resumo]") ?? null;
const alturaDaLinha = (id: string) => linhaDe(id)!.closest<HTMLElement>("[data-index]")!.offsetHeight;
const log = () => document.querySelector<HTMLElement>('[role="log"]')!;
const assentarLista = () => assentar(() => `${String(log().scrollTop)}|${String(log().scrollHeight)}`);

describe("resumo do tópico sob a mensagem", () => {
  it("a constante é a altura medida (caixa mais o respiro de cima)", async () => {
    const alvo = gente.at(-2)!;
    abrirTopico(T1, alvo);
    semearListagem({ [T1]: 3 }, []);
    montarLista();
    await expect.poll(() => resumoDe(alvo), { timeout: 5000 }).not.toBeNull();
    const caixa = resumoDe(alvo)!;
    const medida = caixa.offsetHeight + parseFloat(getComputedStyle(caixa).marginBlockStart);
    expect(Math.abs(medida - ALTURA_DO_RESUMO_DE_TOPICO)).toBeLessThanOrEqual(2);
  });

  it("a estimativa soma a constante: linha que ainda não foi medida cresce exatamente ela", async () => {
    // `longe` está fora da janela medida: o que a lista sabe dela é só o `estimateSize`.
    montarLista();
    await expect.poll(() => log().scrollHeight, { timeout: 5000 }).toBeGreaterThan(0);
    await assentarLista();
    const sem = log().scrollHeight;
    desmontar();

    abrirTopico(T1, longe);
    montarLista();
    await expect.poll(() => log().scrollHeight, { timeout: 5000 }).toBeGreaterThan(0);
    await assentarLista();
    expect(log().scrollHeight - sem).toBe(ALTURA_DO_RESUMO_DE_TOPICO);
  });

  it("mudar a contagem não muda a altura da linha", async () => {
    const alvo = gente.at(-3)!;
    abrirTopico(T1, alvo);
    semearListagem({ [T1]: 1 }, []);
    montarLista();
    await expect.poll(() => resumoDe(alvo)?.textContent, { timeout: 5000 }).toContain("1 resposta");
    await assentarLista();
    expect(resumoDe(alvo)!.textContent).not.toContain("1 respostas");
    const antes = alturaDaLinha(alvo);

    semearListagem({ [T1]: 250 }, []);
    await expect.poll(() => resumoDe(alvo)?.textContent).toContain("99+ respostas");
    await assentarLista();
    expect(alturaDaLinha(alvo)).toBe(antes);

    semearListagem({ [T1]: 7 }, []);
    await expect.poll(() => resumoDe(alvo)?.textContent).toContain("7 respostas");
    await assentarLista();
    expect(alturaDaLinha(alvo)).toBe(antes);
  });

  it("sem contagem (e com nome enorme) a linha tem a mesma altura", async () => {
    const alvo = gente.at(-3)!;
    abrirTopico(T1, alvo);
    semearListagem({ [T1]: 4 }, []);
    montarLista();
    await expect.poll(() => resumoDe(alvo)?.textContent).toContain("4 respostas");
    await assentarLista();
    const comContagem = alturaDaLinha(alvo);
    desmontar();

    limparMetaDeCanal();
    limparIndiceDeTopicos();
    abrirTopico(T2, alvo, "Um nome de tópico muito longo ".repeat(12));
    montarLista();
    await expect.poll(() => resumoDe(alvo)?.textContent).toContain("Tópico");
    await assentarLista();
    const caixa = resumoDe(alvo)!;
    expect(caixa.textContent).not.toMatch(/\d resposta/);
    expect(alturaDaLinha(alvo)).toBe(comContagem);
    expect(caixa.offsetHeight).toBe(24);
    expect(caixa.getBoundingClientRect().height).toBe(24);
  });

  it("clicar abre o tópico: seleciona o canal dele", async () => {
    const alvo = gente.at(-2)!;
    abrirTopico(T1, alvo);
    semearListagem({ [T1]: 2 }, []);
    montarLista();
    await expect.poll(() => resumoDe(alvo), { timeout: 5000 }).not.toBeNull();
    expect(lerCanalAtivo()).not.toBe(T1);
    resumoDe(alvo)!.click();
    await expect.poll(lerCanalAtivo).toBe(T1);
  });

  it("mensagem sem tópico não tem resumo", async () => {
    abrirTopico(T1, gente.at(-2)!);
    montarLista();
    await expect.poll(() => resumoDe(gente.at(-2)!), { timeout: 5000 }).not.toBeNull();
    await quadros(3);
    const sem = gente.at(-4)!;
    expect(topicoDaMensagem(CHANNEL_ID, sem)).toBeUndefined();
    await expect.poll(() => linhaDe(sem)).not.toBeNull();
    expect(resumoDe(sem)).toBeNull();
    expect(document.querySelectorAll("[data-topico-resumo]")).toHaveLength(1);
  });
});
