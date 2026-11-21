import { describe, expect, it, vi } from "vitest";

import {
  criarAudioAmplificavel,
  elementoControlaVolume,
  type FaixaAmplificavel,
} from "./audioAmplificavel";

/** Dublê de `RemoteAudioTrack`: registra a ordem e o que foi aplicado. */
/** `reciclado`: o elemento que o LiveKit devolve de outra faixa no `attach`. */
function faixa(reciclado?: HTMLMediaElement) {
  const ordem: string[] = [];
  const f = {
    attachedElements: [] as HTMLMediaElement[],
    contexto: undefined as AudioContext | undefined,
    volume: undefined as number | undefined,
    ordem,
    attach() {
      ordem.push("attach");
      const el = reciclado ?? document.createElement("audio");
      /* Como o LiveKit: com contexto, o elemento nasce mudo e o som sai do GainNode. */
      if (f.contexto) el.muted = true;
      f.attachedElements.push(el);
      return el;
    },
    setAudioContext(c: AudioContext | undefined) {
      ordem.push("contexto");
      f.contexto = c;
    },
    setVolume(v: number) {
      /* O `<audio>` lança fora de [0, 1]; com contexto o ganho vai ao GainNode. */
      if (!f.contexto && v > 1) throw new DOMException("fora de [0, 1]", "IndexSizeError");
      f.volume = v;
    },
  };
  return f satisfies FaixaAmplificavel;
}

function espiao() {
  const setSinkId = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve());
  const close = vi.fn(() => Promise.resolve());
  const ctx = { setSinkId, close } as unknown as AudioContext;
  return { ctx, setSinkId, close };
}

function contexto(): AudioContext {
  return espiao().ctx;
}

/** Firefox: há Web Audio, mas o contexto não troca de saída. */
function contextoSemSaida(): AudioContext {
  return { close: vi.fn(() => Promise.resolve()) } as unknown as AudioContext;
}

/** O que `Room.startAudio()` faz com todo `<audio>` remoto sem `webAudioMix`. */
function startAudio(el: HTMLMediaElement) {
  el.muted = false;
  /* O `Event` do jsdom deste documento, e não o global do Node. */
  const Evento = el.ownerDocument.defaultView?.Event ?? Event;
  el.dispatchEvent(new Evento("volumechange"));
}

function montar(
  ganhos: Record<string, number>,
  criar: () => AudioContext | undefined = contexto,
  /* `false` é o iOS, onde `element.volume` é só leitura. */
  volumeDoElemento = true,
) {
  const destino = document.createElement("div");
  const criarContexto = vi.fn(criar);
  const amp = criarAudioAmplificavel({
    criarContexto,
    destino: () => destino,
    elementoControlaVolume: () => volumeDoElemento,
  });
  /* O motor calcula o ganho de cada um; aqui ele sai do mapa do teste. */
  const som = {
    receber: (id: string, f: FaixaAmplificavel) => {
      amp.receber(f, ganhos[id] ?? 1);
    },
    aplicar: (id: string, f: FaixaAmplificavel) => {
      amp.aplicar(f, ganhos[id] ?? 1);
    },
    trocarSaida: (id: string | undefined) => amp.trocarSaida(id),
    fechar: () => {
      amp.fechar();
    },
  };
  return { som, destino, criarContexto };
}

describe("áudio amplificável (voz e som da tela)", () => {
  it("dá o contexto ANTES de anexar e aplica ganho acima de 100%", () => {
    const { som, destino } = montar({ ana: 3 });
    const f = faixa();
    som.receber("ana", f);
    expect(f.ordem).toEqual(["contexto", "attach"]);
    expect(f.contexto).toBeDefined();
    expect(destino.children).toHaveLength(1);
    expect(f.volume).toBe(3);
  });

  it("reaplica o volume guardado quando a faixa é re-assinada (faixa nova)", () => {
    const ganhos = { ana: 2.5 };
    const { som, criarContexto } = montar(ganhos);
    som.receber("ana", faixa());
    ganhos.ana = 0.4;
    const nova = faixa();
    som.receber("ana", nova);
    expect(nova.contexto).toBeDefined();
    expect(nova.volume).toBe(0.4);
    /* Um contexto por sala, não um por faixa. */
    expect(criarContexto).toHaveBeenCalledTimes(1);
  });

  it("depois de fechar (reconexão, outra sala), a faixa nova ganha contexto novo", () => {
    const { som, criarContexto } = montar({ ana: 2 });
    som.receber("ana", faixa());
    som.fechar();
    const nova = faixa();
    som.receber("ana", nova);
    expect(criarContexto).toHaveBeenCalledTimes(2);
    expect(nova.volume).toBe(2);
  });

  it("não anexa de novo a faixa que já toca, e aplica o ganho atual", () => {
    const ganhos = { ana: 1.5 };
    const { som, destino } = montar(ganhos);
    const f = faixa();
    som.receber("ana", f);
    ganhos.ana = 0;
    som.receber("ana", f);
    expect(destino.children).toHaveLength(1);
    expect(f.ordem.filter((o) => o === "contexto")).toHaveLength(1);
    expect(f.volume).toBe(0);
  });

  it("sem Web Audio o teto volta a 100% em vez de lançar", () => {
    const { som } = montar({ ana: 3 }, () => undefined);
    const f = faixa();
    expect(() => {
      som.receber("ana", f);
    }).not.toThrow();
    expect(f.volume).toBe(1);
  });

  it("leva a saída escolhida ao contexto; padrão vira string vazia", async () => {
    const { ctx, setSinkId, close } = espiao();
    const { som } = montar({ ana: 1 }, () => ctx);
    await som.trocarSaida("fone-usb");
    som.receber("ana", faixa());
    await vi.waitFor(() => {
      expect(setSinkId).toHaveBeenLastCalledWith("fone-usb");
    });
    await som.trocarSaida("default");
    expect(setSinkId).toHaveBeenLastCalledWith("");
    som.fechar();
    expect(close).toHaveBeenCalled();
  });

  it("voz e som da tela da mesma pessoa dividem UM contexto, não um por faixa", () => {
    const { som, destino, criarContexto } = montar({});
    const voz = faixa();
    const tela = faixa();
    som.receber("x", voz);
    som.receber("x", tela);
    expect(criarContexto).toHaveBeenCalledTimes(1);
    expect(voz.contexto).toBe(tela.contexto);
    expect(destino.children).toHaveLength(2);
  });

  it("prende o ganho entre 0 e 3", () => {
    const { som } = montar({ alto: 7, negativo: -2, nan: Number.NaN });
    const a = faixa();
    const b = faixa();
    const c = faixa();
    som.receber("alto", a);
    som.receber("negativo", b);
    som.receber("nan", c);
    expect(a.volume).toBe(3);
    expect(b.volume).toBe(0);
    expect(c.volume).toBe(1);
  });

  it("startAudio() não desmuta o elemento de uma faixa que toca pelo contexto", () => {
    const { som } = montar({ ana: 0 });
    const f = faixa();
    som.receber("ana", f);
    const el = f.attachedElements[0]!;
    expect(el.muted).toBe(true);
    startAudio(el);
    // Sem o guarda, a 0% a voz voltaria a tocar inteira pelo elemento.
    expect(el.muted).toBe(true);
    expect(f.volume).toBe(0);
  });

  it("contexto ligado DEPOIS do attach também deixa o elemento mudo", () => {
    const ganhos = { ana: 0.5 };
    const { som } = montar(ganhos, contextoSemSaida);
    const f = faixa();
    som.receber("ana", f);
    ganhos.ana = 2;
    som.aplicar("ana", f);
    const el = f.attachedElements[0]!;
    expect(f.contexto).toBeDefined();
    expect(el.muted).toBe(true);
    startAudio(el);
    expect(el.muted).toBe(true);
  });

  describe("onde o contexto troca de saída (Chrome)", () => {
    it("toda faixa fica no contexto, inclusive abaixo de 100%", () => {
      const ganhos = { ana: 0.5 };
      const { som } = montar(ganhos);
      const f = faixa();
      som.receber("ana", f);
      expect(f.contexto).toBeDefined();
      ganhos.ana = 2;
      som.aplicar("ana", f);
      ganhos.ana = 0.3;
      som.aplicar("ana", f);
      expect(f.ordem.filter((o) => o === "contexto")).toHaveLength(1);
      expect(f.volume).toBe(0.3);
    });
  });

  describe("onde só o elemento troca de saída (Firefox)", () => {
    it("até 100% toca pelo ELEMENTO, que segue a saída escolhida", () => {
      const { som } = montar({ ana: 0.6 }, contextoSemSaida);
      const f = faixa();
      som.receber("ana", f);
      const el = f.attachedElements[0]!;
      expect(f.contexto).toBeUndefined();
      expect(el.muted).toBe(false);
      expect(f.volume).toBe(0.6);
      // startAudio desmuta o elemento, que aqui É a saída: nada a desfazer.
      startAudio(el);
      expect(el.muted).toBe(false);
    });

    it("acima de 100% vai para o contexto, e volta ao elemento ao descer", () => {
      const ganhos = { ana: 1 };
      const { som } = montar(ganhos, contextoSemSaida);
      const f = faixa();
      som.receber("ana", f);
      const el = f.attachedElements[0]!;
      expect(f.contexto).toBeUndefined();

      ganhos.ana = 2.5;
      som.aplicar("ana", f);
      expect(f.contexto).toBeDefined();
      expect(el.muted).toBe(true);
      expect(f.volume).toBe(2.5);

      ganhos.ana = 0.8;
      som.aplicar("ana", f);
      expect(f.contexto).toBeUndefined();
      expect(el.muted).toBe(false);
      expect(f.volume).toBe(0.8);
    });

    it("faixa que chega acima de 100% já nasce no contexto, antes do attach", () => {
      const { som } = montar({ ana: 3 }, contextoSemSaida);
      const f = faixa();
      som.receber("ana", f);
      expect(f.ordem).toEqual(["contexto", "attach"]);
      expect(f.volume).toBe(3);
    });
  });

  describe("no iOS (sem setSinkId no contexto e com element.volume só leitura)", () => {
    it("fica no contexto mesmo abaixo de 100% e a 0 — ensurdecer continua calando", () => {
      const ganhos = { ana: 0.5 };
      const { som } = montar(ganhos, contextoSemSaida, false);
      const f = faixa();
      som.receber("ana", f);
      const el = f.attachedElements[0]!;
      expect(f.contexto).toBeDefined();
      expect(f.volume).toBe(0.5);
      ganhos.ana = 0;
      som.aplicar("ana", f);
      expect(f.contexto).toBeDefined();
      expect(f.volume).toBe(0);
      startAudio(el);
      expect(el.muted).toBe(true);
    });

    it("detecta o iOS e o iPad que se diz Mac; volume que não muda também conta", () => {
      const ua = (userAgent: string, platform = "", maxTouchPoints = 0) => ({ userAgent, platform, maxTouchPoints });
      expect(elementoControlaVolume(undefined, ua("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"))).toBe(false);
      expect(elementoControlaVolume(undefined, ua("Mozilla/5.0 (Macintosh)", "MacIntel", 5))).toBe(false);
      expect(elementoControlaVolume(undefined, ua("Mozilla/5.0 (Macintosh)", "MacIntel", 0))).toBe(true);
      expect(elementoControlaVolume(document, ua("Mozilla/5.0 (X11; Linux) Firefox/130"))).toBe(true);
      /* O iOS real: o atributo existe e ignora a escrita. */
      const soLeitura = {
        createElement: () => ({
          get volume() {
            return 1;
          },
          set volume(_v: number) {},
        }),
      } as unknown as Document;
      expect(elementoControlaVolume(soLeitura, ua("Mozilla/5.0 (Macintosh)", "MacIntel", 0))).toBe(false);
    });
  });

  describe("elemento reciclado pelo LiveKit", () => {
    it("de uma faixa no contexto para uma no elemento: o guarda não cala a nova", () => {
      const ganhos = { ana: 2, bia: 0.5 };
      const { som } = montar(ganhos, contextoSemSaida);
      const a = faixa();
      som.receber("ana", a);
      const el = a.attachedElements[0]!;
      expect(el.muted).toBe(true);
      a.attachedElements.length = 0;

      const b = faixa(el);
      som.receber("bia", b);
      expect(b.contexto).toBeUndefined();
      expect(el.muted).toBe(false);
      startAudio(el);
      expect(el.muted).toBe(false);
      expect(b.volume).toBe(0.5);
    });

    it("de uma faixa no elemento para uma no contexto: o guarda passa a valer", () => {
      const ganhos = { ana: 0.5, bia: 2 };
      const { som } = montar(ganhos, contextoSemSaida);
      const a = faixa();
      som.receber("ana", a);
      const el = a.attachedElements[0]!;
      expect(el.muted).toBe(false);
      a.attachedElements.length = 0;

      const b = faixa(el);
      som.receber("bia", b);
      expect(b.contexto).toBeDefined();
      startAudio(el);
      expect(el.muted).toBe(true);
      expect(b.volume).toBe(2);
    });
  });
});
