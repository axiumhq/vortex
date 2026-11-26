import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { criarPainelPreguicoso } from "../jornadas/chat/emoji/PainelPreguicoso";
import { chat, comum } from "../textos";
import { desmontar, montar, pegar } from "./ds/montar";
import { acoesDaPagina, esquecerRecarga } from "./lazyComNovaTentativa";

/**
 * O seletor de emoji é o único componente de UI carregado com `lazy`. O
 * `React.lazy` cacheia a promessa rejeitada, então uma falha do `import()`
 * quebrava toda abertura seguinte até F5. Aqui o `import()` falha de propósito.
 */

const modulo = () => import("../jornadas/chat/emoji/PainelDeEmoji");
const erroDeChunk = () =>
  new TypeError("Failed to fetch dynamically imported module: /assets/PainelDeEmoji-abc123.js");

const escolher = () => {};
const alerta = () => pegar('[role="alert"]');
const botaoTentar = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent === comum.tentarDeNovo,
  );
const painelCarregou = () => document.querySelector(`[aria-label="${chat.emoji.buscar}"]`) !== null;

let recarregar: Mock<() => void>;

beforeEach(() => {
  esquecerRecarga();
  recarregar = vi.fn<() => void>();
  vi.spyOn(acoesDaPagina, "recarregar").mockImplementation(recarregar);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  desmontar();
  esquecerRecarga();
  vi.restoreAllMocks();
});

describe("componente carregado sob demanda", () => {
  it("import que falha uma vez e depois funciona: a segunda abertura carrega", async () => {
    const carregar = vi.fn().mockRejectedValueOnce(new Error("rede caiu")).mockImplementation(modulo);
    const Painel = criarPainelPreguicoso(carregar);

    montar(<Painel aoEscolher={escolher} />);
    await expect.poll(alerta).not.toBeNull();
    desmontar();

    montar(<Painel aoEscolher={escolher} />);
    await expect.poll(painelCarregou).toBe(true);
    expect(alerta()).toBeNull();
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it("o erro mostra a frase e 'Tentar de novo', que faz um import novo", async () => {
    const carregar = vi.fn().mockRejectedValueOnce(new Error("rede caiu")).mockImplementation(modulo);
    const Painel = criarPainelPreguicoso(carregar);

    montar(<Painel aoEscolher={escolher} />);
    await expect.poll(alerta).not.toBeNull();
    expect(alerta()!.textContent).toContain(chat.emoji.falhaAoCarregar);
    // A mensagem técnica fica no console, nunca na tela.
    expect(alerta()!.textContent).not.toContain("rede caiu");

    botaoTentar()!.click();
    await expect.poll(painelCarregou).toBe(true);
    expect(alerta()).toBeNull();
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it("falha de rede comum não recarrega a página", async () => {
    const carregar = vi.fn().mockRejectedValue(new Error("rede caiu"));
    const Painel = criarPainelPreguicoso(carregar);

    montar(<Painel aoEscolher={escolher} />);
    for (let i = 0; i < 3; i++) {
      await expect.poll(botaoTentar).toBeDefined();
      botaoTentar()!.click();
    }
    await expect.poll(() => carregar.mock.calls.length).toBe(4);
    expect(recarregar).not.toHaveBeenCalled();
  });

  it("chunk de deploy antigo: recarrega só depois de uma nova tentativa falhar, e uma única vez", async () => {
    const carregar = vi.fn().mockImplementation(() => Promise.reject(erroDeChunk()));
    const Painel = criarPainelPreguicoso(carregar);

    montar(<Painel aoEscolher={escolher} />);
    await expect.poll(alerta).not.toBeNull();
    // Primeira falha: oferece tentar, não recarrega (rascunho e chamada de voz valem mais).
    expect(recarregar).not.toHaveBeenCalled();

    botaoTentar()!.click();
    await expect.poll(() => recarregar.mock.calls.length).toBe(1);

    // A página "recarregada" falha de novo: sem laço.
    for (let i = 0; i < 3; i++) {
      await expect.poll(botaoTentar).toBeDefined();
      botaoTentar()!.click();
    }
    await expect.poll(() => carregar.mock.calls.length).toBe(5);
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("chunk que chega limpa a marca: um deploy futuro na mesma aba ainda pode recarregar", async () => {
    sessionStorage.setItem("vortex:recarga-por-chunk", "1");
    const Painel = criarPainelPreguicoso(modulo);

    montar(<Painel aoEscolher={escolher} />);
    await expect.poll(painelCarregou).toBe(true);
    expect(sessionStorage.getItem("vortex:recarga-por-chunk")).toBeNull();
  });
});
