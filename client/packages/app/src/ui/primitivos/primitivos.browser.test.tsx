import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { dispensarToast, toast } from "nucleo/ui-logica/toastStore";

import "../../tema/theme.css";
import { Avisos } from "./Avisos";
import { ConteudoDoDialogo, Dialogo, DialogoGatilho } from "./Dialogo";
import {
  ConteudoDoMenu,
  GatilhoDoMenu,
  ItemDeMenu,
  MenuSuspenso,
  SeparadorDeMenu,
} from "./Menus";

let raiz: Root | undefined;
let alvo: HTMLElement | undefined;

function montar(ui: React.ReactNode) {
  alvo = document.createElement("div");
  document.body.append(alvo);
  raiz = createRoot(alvo);
  flushSync(() => raiz?.render(ui));
}

afterEach(() => {
  raiz?.unmount();
  alvo?.remove();
  raiz = undefined;
  alvo = undefined;
});

const pegar = (seletor: string) => document.querySelector<HTMLElement>(seletor);

describe("Dialogo", () => {
  it("abre, fecha com Esc e devolve o foco ao gatilho", async () => {
    montar(
      <Dialogo>
        <DialogoGatilho data-testid="gatilho">Abrir</DialogoGatilho>
        <ConteudoDoDialogo titulo="Convidar pessoas" descricao="Escolha quem entra.">
          <p>Corpo</p>
        </ConteudoDoDialogo>
      </Dialogo>,
    );
    const gatilho = pegar('[data-testid="gatilho"]')!;
    await userEvent.click(gatilho);
    await expect.poll(() => pegar('[role="dialog"]')).not.toBeNull();
    expect(pegar('[role="dialog"]')!.getAttribute("aria-labelledby")).not.toBeNull();
    // O foco está preso dentro do diálogo.
    expect(pegar('[role="dialog"]')!.contains(document.activeElement)).toBe(true);

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => pegar('[role="dialog"]')).toBeNull();
    await expect.poll(() => document.activeElement).toBe(gatilho);
  });

  it("prende o Tab dentro do diálogo", async () => {
    montar(
      <Dialogo defaultOpen>
        <ConteudoDoDialogo titulo="Prender foco" tituloOculto>
          <button>Um</button>
          <button>Dois</button>
        </ConteudoDoDialogo>
      </Dialogo>,
    );
    await expect.poll(() => pegar('[role="dialog"]')).not.toBeNull();
    for (let i = 0; i < 6; i++) {
      await userEvent.keyboard("{Tab}");
      expect(pegar('[role="dialog"]')!.contains(document.activeElement)).toBe(true);
    }
  });
});

describe("MenuSuspenso", () => {
  function menu() {
    const escolhidos: string[] = [];
    montar(
      <MenuSuspenso>
        <GatilhoDoMenu data-testid="gatilho">Opções</GatilhoDoMenu>
        <ConteudoDoMenu>
          <ItemDeMenu onSelect={() => escolhidos.push("a")}>Alfa</ItemDeMenu>
          <ItemDeMenu onSelect={() => escolhidos.push("b")}>Beta</ItemDeMenu>
          <SeparadorDeMenu />
          <ItemDeMenu disabled>Gama</ItemDeMenu>
          <ItemDeMenu variante="perigo" onSelect={() => escolhidos.push("d")}>
            Delta
          </ItemDeMenu>
        </ConteudoDoMenu>
      </MenuSuspenso>,
    );
    return escolhidos;
  }

  it("navega por teclado, pula item desabilitado e seleciona com Enter", async () => {
    const escolhidos = menu();
    pegar('[data-testid="gatilho"]')!.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => pegar('[role="menu"]')).not.toBeNull();

    // Aberto pelo teclado, o Radix já foca o primeiro item.
    await expect.poll(() => document.activeElement?.textContent).toBe("Alfa");
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Beta");
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Delta");

    await userEvent.keyboard("{Enter}");
    expect(escolhidos).toEqual(["d"]);
    await expect.poll(() => pegar('[role="menu"]')).toBeNull();
  });

  it("mostra um único anel de foco no item focado", async () => {
    menu();
    pegar('[data-testid="gatilho"]')!.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => document.activeElement?.textContent).toBe("Alfa");

    const estilo = getComputedStyle(document.activeElement!);
    expect(estilo.outlineStyle).toBe("solid");
    expect(estilo.outlineWidth).toBe("2px");
    expect(estilo.outlineColor).toBe("rgb(255, 255, 255)");
    // Um anel só: nenhum box-shadow de foco somado ao contorno.
    expect(estilo.boxShadow).toBe("none");
    // O contêiner do menu não desenha anel próprio.
    expect(getComputedStyle(pegar('[role="menu"]')!).outlineStyle).not.toBe("solid");
  });
});

describe("Avisos", () => {
  it("mostra o aviso disparado pelo store e o dispensa", async () => {
    montar(<Avisos />);
    toast({ tipo: "info", titulo: "Convite copiado" });
    await expect.poll(() => document.body.textContent).toContain("Convite copiado");
    await userEvent.click(pegar('[aria-label="Dispensar aviso"]')!);
    await expect.poll(() => document.body.textContent).not.toContain("Convite copiado");
  });

  it("a área dos avisos só pega o ponteiro em cima de um aviso, nunca no vão entre eles", async () => {
    // Um alvo de tela cheia por baixo: o que não for aviso tem de chegar até ele.
    montar(
      <>
        <button data-testid="fundo" style={{ position: "fixed", inset: 0 }}>
          Fundo
        </button>
        <Avisos />
      </>,
    );
    const ids = [
      toast({ tipo: "erro", titulo: "Falha ao salvar" }),
      toast({ tipo: "erro", titulo: "Falha ao enviar" }),
    ];
    await expect.poll(() => document.querySelectorAll("li[data-tipo]").length).toBe(2);
    await expect.poll(() => document.querySelector("li[data-tipo]")?.getAttribute("style") ?? "").not.toBe("");

    const [primeiro, segundo] = [...document.querySelectorAll<HTMLElement>("li[data-tipo]")].map((li) =>
      li.getBoundingClientRect(),
    );
    const x = primeiro!.left + primeiro!.width / 2;
    const vao = (Math.min(primeiro!.bottom, segundo!.bottom) + Math.max(primeiro!.top, segundo!.top)) / 2;
    // O vão é da caixa da lista (grid com gap): sem o conserto, ele engolia o clique.
    expect(document.elementFromPoint(x, vao)).toBe(pegar('[data-testid="fundo"]'));
    // Em cima do aviso, o aviso continua clicável.
    expect(document.elementFromPoint(x, primeiro!.top + 4)?.closest("li[data-tipo]")).not.toBeNull();

    for (const id of ids) dispensarToast(id);
  });
});
