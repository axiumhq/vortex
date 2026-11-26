import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assinarMinutoAtual, lerMinutoAtual, MINUTO_MS } from "./relogioDeEnquetes";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-20T12:00:10Z"));
});
afterEach(() => vi.useRealTimers());

describe("relógio de enquetes", () => {
  it("só liga o setInterval com o 1º assinante", () => {
    expect(vi.getTimerCount()).toBe(0);
    const parar = assinarMinutoAtual(() => {});
    expect(vi.getTimerCount()).toBe(1);
    const parar2 = assinarMinutoAtual(() => {});
    expect(vi.getTimerCount()).toBe(1);
    parar();
    parar2();
  });

  it("desliga no último cleanup, e não antes", () => {
    const a = assinarMinutoAtual(() => {});
    const b = assinarMinutoAtual(() => {});
    a();
    expect(vi.getTimerCount()).toBe(1);
    b();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleanup duplicado é inofensivo", () => {
    const a = assinarMinutoAtual(() => {});
    const b = assinarMinutoAtual(() => {});
    a();
    a();
    expect(vi.getTimerCount()).toBe(1);
    b();
  });

  it("publica a cada minuto e o snapshot é estável entre publicações", () => {
    const o = vi.fn();
    const parar = assinarMinutoAtual(o);
    const inicial = lerMinutoAtual();
    expect(lerMinutoAtual()).toBe(inicial);

    vi.advanceTimersByTime(MINUTO_MS);
    expect(o).toHaveBeenCalledTimes(1);
    expect(lerMinutoAtual()).toBe(inicial + MINUTO_MS);
    expect(lerMinutoAtual()).toBe(lerMinutoAtual());

    vi.advanceTimersByTime(MINUTO_MS);
    expect(o).toHaveBeenCalledTimes(2);
    parar();
  });

  it("depois do desligamento o tempo passa sem avisar ninguém", () => {
    const o = vi.fn();
    assinarMinutoAtual(o)();
    vi.advanceTimersByTime(5 * MINUTO_MS);
    expect(o).not.toHaveBeenCalled();
  });
});
