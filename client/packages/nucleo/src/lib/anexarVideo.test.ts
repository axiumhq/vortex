import { afterEach, describe, expect, it, vi } from "vitest";

import { anexarVideo } from "./anexarVideo";

class Fluxo {
  constructor(public tracks: MediaStreamTrack[]) {}
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function faixaFalsa() {
  const ouvintes = new Map<string, () => void>();
  return {
    addEventListener(tipo: string, fn: () => void) {
      ouvintes.set(tipo, fn);
    },
    removeEventListener(tipo: string) {
      ouvintes.delete(tipo);
    },
    disparar(tipo: string) {
      ouvintes.get(tipo)?.();
    },
    tem(tipo: string) {
      return ouvintes.has(tipo);
    },
  };
}

describe("anexarVideo", () => {
  it("toca ao anexar e de novo no unmute", () => {
    vi.stubGlobal("MediaStream", Fluxo);
    const play = vi.fn(() => Promise.resolve());
    const el = { srcObject: null, play } as unknown as HTMLVideoElement;
    const faixa = faixaFalsa();

    anexarVideo(el, faixa as unknown as MediaStreamTrack);

    expect(play).toHaveBeenCalledTimes(1);
    expect(el.srcObject).toBeInstanceOf(Fluxo);
    faixa.disparar("unmute");
    expect(play).toHaveBeenCalledTimes(2);
    faixa.disparar("pause");
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("soltar tira o ouvinte e o fluxo", () => {
    vi.stubGlobal("MediaStream", Fluxo);
    const play = vi.fn(() => Promise.resolve());
    const el = { srcObject: null, play } as unknown as HTMLVideoElement;
    const faixa = faixaFalsa();

    const soltar = anexarVideo(el, faixa as unknown as MediaStreamTrack);
    soltar();

    expect(el.srcObject).toBeNull();
    expect(faixa.tem("unmute")).toBe(false);
  });
});
