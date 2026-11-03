import { afterEach, describe, expect, it } from "vitest";

import { recipienteDoPortal } from "./portal";

afterEach(() => {
  Reflect.deleteProperty(document, "fullscreenElement");
});

function telaCheia(el: Element) {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => el,
  });
}

describe("recipienteDoPortal", () => {
  it("fora da tela cheia o portal fica no body", () => {
    expect(recipienteDoPortal()).toBeUndefined();
  });

  it("em tela cheia o portal nasce no elemento", () => {
    const secao = document.createElement("section");
    telaCheia(secao);
    expect(recipienteDoPortal()).toBe(secao);
  });

  it("svg em tela cheia não vira container", () => {
    telaCheia(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    expect(recipienteDoPortal()).toBeUndefined();
  });
});
