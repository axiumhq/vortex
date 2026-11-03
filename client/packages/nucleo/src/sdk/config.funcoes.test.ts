import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  client: {} as {
    configuration: { features?: { vortex?: unknown } } | undefined;
    configured: () => boolean;
  },
  setConfigurado: undefined as unknown as (v: boolean) => void,
}));

vi.mock("./client", async () => {
  const { createSignal: sinal } = await import("solid-js");
  const [configurado, setConfigurado] = sinal(false);
  estado.client.configuration = undefined;
  estado.client.configured = configurado;
  estado.setConfigurado = setConfigurado;
  return { client: estado.client };
});

import {
  assinarFuncoesDoServidor,
  definirFuncoesDoArnes,
  servidorTemEnquetes,
  servidorTemFuncao,
} from "./config";

beforeEach(() => {
  estado.client.configuration = undefined;
  estado.setConfigurado(false);
  definirFuncoesDoArnes(undefined);
});
afterEach(() => definirFuncoesDoArnes(undefined));

describe("servidorTemFuncao / servidorTemEnquetes", () => {
  it("sem configuração -> false", () => {
    expect(servidorTemEnquetes()).toBe(false);
  });

  it("features.vortex ausente -> false (servidor Stoat puro)", () => {
    estado.client.configuration = { features: {} };
    expect(servidorTemEnquetes()).toBe(false);
  });

  it("não-array -> false", () => {
    for (const v of ["polls", { polls: true }, 1, null]) {
      estado.client.configuration = { features: { vortex: v } };
      expect(servidorTemEnquetes()).toBe(false);
    }
  });

  it("array sem 'polls' -> false; com 'polls' -> true", () => {
    estado.client.configuration = { features: { vortex: ["outra"] } };
    expect(servidorTemEnquetes()).toBe(false);
    estado.client.configuration = { features: { vortex: ["outra", "polls"] } };
    expect(servidorTemEnquetes()).toBe(true);
    expect(servidorTemFuncao("outra")).toBe(true);
    expect(servidorTemFuncao("nao-existe")).toBe(false);
  });

  it("o arnês liga a função sem servidor, e undefined devolve à configuração", () => {
    definirFuncoesDoArnes(["polls"]);
    expect(servidorTemEnquetes()).toBe(true);
    definirFuncoesDoArnes(undefined);
    expect(servidorTemEnquetes()).toBe(false);
  });
});

describe("assinarFuncoesDoServidor", () => {
  it("avisa quando a configuração chega, e o leitor passa a ver true", () => {
    const o = vi.fn();
    const parar = assinarFuncoesDoServidor(o);
    expect(o).not.toHaveBeenCalled();
    estado.client.configuration = { features: { vortex: ["polls"] } };
    estado.setConfigurado(true);
    expect(o).toHaveBeenCalledTimes(1);
    expect(servidorTemEnquetes()).toBe(true);
    parar();
  });

  it("avisa quando o arnês mexe", () => {
    const o = vi.fn();
    const parar = assinarFuncoesDoServidor(o);
    definirFuncoesDoArnes(["polls"]);
    expect(o).toHaveBeenCalledTimes(1);
    parar();
  });

  it("cleanup: depois dele nada mais é avisado", () => {
    const o = vi.fn();
    assinarFuncoesDoServidor(o)();
    estado.setConfigurado(true);
    definirFuncoesDoArnes(["polls"]);
    expect(o).not.toHaveBeenCalled();
  });
});
