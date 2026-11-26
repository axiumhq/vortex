import { describe, expect, it, vi } from "vitest";

import { criarAudioAmplificavel, type FaixaAmplificavel } from "./audioAmplificavel";
import { criarContextoDeSaida, type AlvoDeGestos } from "./contextoDeSaida";

/** Dublê de `AudioContext`: estado mutável, `resume` e `close` de verdade. */
class ContextoFalso extends EventTarget {
  state: AudioContextState = "running";
  resume = vi.fn(() => {
    this.mudar("running");
    return Promise.resolve();
  });
  close = vi.fn(() => {
    this.mudar("closed");
    return Promise.resolve();
  });
  mudar(estado: AudioContextState) {
    this.state = estado;
    this.dispatchEvent(new Event("statechange"));
  }
}

/** Documento dublado que conta os ouvintes vivos. */
function alvo() {
  const ouvintes = new Map<string, Set<() => void>>();
  const a: AlvoDeGestos & { vivos: () => number; gesto: (tipo: string) => void } = {
    addEventListener(tipo, f) {
      let set = ouvintes.get(tipo);
      if (!set) {
        set = new Set();
        ouvintes.set(tipo, set);
      }
      set.add(f);
    },
    removeEventListener(tipo, f) {
      ouvintes.get(tipo)?.delete(f);
    },
    vivos: () => [...ouvintes.values()].reduce((n, s) => n + s.size, 0),
    gesto: (tipo) => {
      for (const f of ouvintes.get(tipo) ?? []) f();
    },
  };
  return a;
}

function construtor(ctx: ContextoFalso) {
  return function Falso() {
    return ctx;
  } as unknown as new () => AudioContext;
}

describe("contexto de saída", () => {
  it("construtor que lança devolve undefined, e a faixa toca pelo ELEMENTO", () => {
    const Lanca = function () {
      throw new DOMException("limite de contextos", "NotSupportedError");
    } as unknown as new () => AudioContext;
    const doc = alvo();
    expect(criarContextoDeSaida(Lanca, doc)).toBeUndefined();
    expect(doc.vivos()).toBe(0);

    const destino = document.createElement("div");
    const amp = criarAudioAmplificavel({
      criarContexto: () => criarContextoDeSaida(Lanca, doc),
      destino: () => destino,
      elementoControlaVolume: () => true,
    });
    const attach = vi.fn(() => document.createElement("audio"));
    const setVolume = vi.fn();
    const faixa: FaixaAmplificavel = {
      attachedElements: [],
      attach,
      setAudioContext: vi.fn(),
      setVolume,
    };
    expect(() => {
      amp.receber(faixa, 3);
    }).not.toThrow();
    expect(attach).toHaveBeenCalledTimes(1);
    expect(destino.children).toHaveLength(1);
    // Sem contexto, o teto é 100%.
    expect(setVolume).toHaveBeenLastCalledWith(1);
  });

  it("suspenso DEPOIS de rodar, o próximo gesto retoma — e de novo, e de novo", () => {
    const ctx = new ContextoFalso();
    const doc = alvo();
    expect(criarContextoDeSaida(construtor(ctx), doc)).toBe(ctx);

    doc.gesto("pointerdown");
    // Rodando: o gesto não chama `resume` à toa.
    expect(ctx.resume).not.toHaveBeenCalled();

    ctx.mudar("suspended");
    doc.gesto("pointerdown");
    expect(ctx.state).toBe("running");
    expect(ctx.resume).toHaveBeenCalledTimes(1);

    ctx.mudar("suspended");
    doc.gesto("keydown");
    expect(ctx.state).toBe("running");
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it("nascido suspenso também retoma no primeiro gesto", () => {
    const ctx = new ContextoFalso();
    ctx.state = "suspended";
    const doc = alvo();
    criarContextoDeSaida(construtor(ctx), doc);
    doc.gesto("keydown");
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("fechar o contexto remove os ouvintes do documento", async () => {
    const ctx = new ContextoFalso();
    const doc = alvo();
    criarContextoDeSaida(construtor(ctx), doc);
    expect(doc.vivos()).toBe(2);
    await ctx.close();
    expect(doc.vivos()).toBe(0);
    doc.gesto("pointerdown");
    expect(ctx.resume).not.toHaveBeenCalled();
  });
});
