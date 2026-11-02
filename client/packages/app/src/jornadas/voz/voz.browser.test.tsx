import "../../arnes/redeFalsa";

import {
  RAIZ,
  definirUsuarioLocal,
  canaisDeTexto,
  canaisDeVoz,
  channels,
  members,
  presence,
  secoesOnline,
  serverIds,
  servers,
  vozPorCanal,
} from "nucleo/sdk/adapter";
import { chaveDeMembro, SEM_CARGO, type ParticipanteDeVoz } from "nucleo/sdk/domain";
import { definirChamada, definirFalantes, limparChamada } from "nucleo/store/chamada";
import { definirQualidadeEscolhida } from "nucleo/store/qualidadeDaTela";
import { definirFalhaDeVoz, limparFalhaDeVoz } from "nucleo/store/falhaDeVoz";
import { limparFaixaDoPalco } from "nucleo/store/faixaDoPalco";
import { irParaCasa } from "nucleo/store/navegacao";
import { definirPalco, fecharPalco, lerPalco } from "nucleo/store/palcoDeVoz";
import { definirColunaDeSalas, limparPreferenciasDaSala } from "nucleo/store/preferenciasDaSala";
import { definirProntidao } from "nucleo/store/prontidao";
import {
  concluirEscolhaDeTela,
  lerSeletorDeTela,
  pedirEscolhaDeTela,
  responderEscolhaDeTela,
} from "nucleo/store/seletorDeTela";
import { abrirServidor, limparUltimoLugar } from "nucleo/store/ultimoLugar";
import { lerVolumeDaTransmissao, limparVolumesDaTransmissao } from "nucleo/store/volumesDeTransmissao";
import { lerVolume, limparVolumes } from "nucleo/store/volumesDeVoz";
import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shell, voz } from "../../textos";
import { desmontar, montar, pegar } from "../../ui/ds/montar";
import { ShellDasSalas } from "../salas/ShellDasSalas";

const ctl = vi.hoisted(() => ({
  chamadas: [] as string[],
  assinaturas: [] as string[],
  /** Chaves (`usuário:fonte`) cuja publicação ainda NÃO chegou ao LiveKit. */
  semPublicacao: new Set<string>(),
  /** A publicação chega: o `TrackPublished` do motor, na contabilidade real. */
  publicar: undefined as ((userId: string, fonte: "camera" | "tela") => void) | undefined,
  /** Zera a contabilidade entre testes, como a saída da sala. */
  limparAssinaturas: (): void => undefined,
}));

vi.mock("nucleo/sdk/permissoes", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  pode: () => true,
  podeNoServidor: () => true,
}));
vi.mock("nucleo/sdk/chamada", async (original) => {
  /*
    ⚠ **A dublagem antiga devolvia `true` para todo pedido, e a corrida ficava
    invisível.** O ladrilho de tela monta pelo protocolo Stoat e pode pedir antes
    de a publicação existir no LiveKit; com "sempre deu certo" não havia como ver
    o pedido ser descartado. Esta usa a CONTABILIDADE de verdade
    (`criarAssinaturaDeVideo`), com publicações falsas que o teste controla.

    Por padrão toda chave tem publicação, mas ela NÃO entrega faixa — os testes
    anteriores contam com o "Recebendo o primeiro quadro…". A publicação que
    `ctl.publicar` cria entrega: `setSubscribed(true)` faz o papel do
    `TrackSubscribed` e escreve uma faixa de vídeo real (de um canvas).
  */
  async function dublarPedirVideo() {
    const { criarAssinaturaDeVideo } = await import("nucleo/sdk/assinaturaDeVideo");
    const { chaveDeVideo, faixasDeVideo } = await import("nucleo/store/video");
    type Publicacao = { trackSid: string; setSubscribed: (sim: boolean) => void };
    const publicacoes = new Map<string, Publicacao>();

    function faixaDeCanvas(): MediaStreamTrack {
      const c = document.createElement("canvas");
      c.width = 16;
      c.height = 16;
      c.getContext("2d")?.fillRect(0, 0, 16, 16);
      const [faixa] = c.captureStream().getVideoTracks();
      if (!faixa) throw new Error("sem faixa de canvas");
      return faixa;
    }

    function publicacao(chave: string, entrega: boolean): Publicacao {
      return {
        trackSid: `TR_${chave}`,
        setSubscribed: (sim) => {
          if (!entrega) return;
          if (sim) faixasDeVideo.set(chave, faixaDeCanvas());
          else faixasDeVideo.apagar(chave);
        },
      };
    }

    function video(userId: string, fonte: "camera" | "tela") {
      const chave = chaveDeVideo(userId, fonte);
      if (ctl.semPublicacao.has(chave)) return undefined;
      let pub = publicacoes.get(chave);
      if (!pub) {
        pub = publicacao(chave, false);
        publicacoes.set(chave, pub);
      }
      return pub;
    }

    const assinatura = criarAssinaturaDeVideo({
      video,
      audioDaTela: () => undefined,
      aplicarQualidade: (userId, fonte, q) => {
        ctl.assinaturas.push(`q:${userId}:${fonte}:${q}`);
      },
    });

    ctl.publicar = (userId, fonte) => {
      const chave = chaveDeVideo(userId, fonte);
      ctl.semPublicacao.delete(chave);
      publicacoes.set(chave, publicacao(chave, true));
      assinatura.publicacaoChegou(userId, fonte);
    };
    ctl.limparAssinaturas = () => {
      assinatura.limpar();
      publicacoes.clear();
      ctl.semPublicacao.clear();
      faixasDeVideo.limpar();
    };

    return (userId: string, fonte: "camera" | "tela", q: Parameters<typeof assinatura.pedir>[2]) => {
      ctl.assinaturas.push(`+${userId}:${fonte}`);
      const devolver = assinatura.pedir(userId, fonte, q);
      return () => {
        ctl.assinaturas.push(`-${userId}:${fonte}`);
        devolver();
      };
    };
  }
  const pedirVideo = await dublarPedirVideo();

  const registra = (nome: string) => () => {
    ctl.chamadas.push(nome);
    return Promise.resolve();
  };
  return {
    ...(await original<Record<string, unknown>>()),
    entrarNaChamada: (id: string) => {
      ctl.chamadas.push(`entrar:${id}`);
      return Promise.resolve(true);
    },
    sairDaChamada: registra("sair"),
    alternarMudo: registra("mudo"),
    alternarSurdo: registra("surdo"),
    alternarCamera: registra("camera"),
    alternarTela: registra("tela"),
    pedirVideo,
  };
});

const S = "S1";
const parcial = <T,>(v: object) => v as unknown as T;

const participante = (userId: string, extra: Partial<ParticipanteDeVoz> = {}): ParticipanteDeVoz => ({
  userId,
  estado: "voz",
  desde: 1,
  mudo: false,
  surdo: false,
  mudoPeloServidor: false,
  surdoPeloServidor: false,
  ...extra,
});

function canal(id: string, name: string, tipo: "texto" | "voz", extra: object = {}) {
  channels.set(
    id,
    parcial({ id, serverId: S, name, tipo, naoLidas: 0, mencoes: 0, silenciado: false, ...extra }),
  );
}

function semear(pessoas: ParticipanteDeVoz[]) {
  serverIds.set(RAIZ, [S]);
  servers.set(S, parcial({ id: S, name: "Grupo", sigla: "GR", naoLidas: 0, mencoes: 0, avatarUrl: undefined }));
  canaisDeTexto.set(S, ["T1", "T2"]);
  canaisDeVoz.set(S, ["V1"]);
  canal("T1", "geral", "texto", { naoLidas: 3 });
  canal("T2", "avisos", "texto");
  canal("V1", "Jogatina", "voz");
  vozPorCanal.set("V1", pessoas);
  secoesOnline.set(S, [{ id: SEM_CARGO, rotulo: "online", cor: undefined, ids: ["U1", "U2", "U3"] }]);
  for (const [id, nome] of [
    ["U1", "Ana"],
    ["U2", "Caio"],
    ["U3", "Eva"],
    ["U4", "Davi"],
  ] as const) {
    members.set(chaveDeMembro(S, id), parcial({ id, displayName: nome, sigla: nome.slice(0, 2) }));
    presence.set(id, "online");
  }
}

beforeEach(() => {
  document.documentElement.dataset.tema = "vidro";
  localStorage.clear();
  limparUltimoLugar();
  limparPreferenciasDaSala();
  limparChamada();
  limparFalhaDeVoz();
  limparFaixaDoPalco();
  limparVolumesDaTransmissao();
  limparVolumes();
  fecharPalco();
  irParaCasa();
  ctl.chamadas = [];
  ctl.assinaturas = [];
  ctl.limparAssinaturas();
  definirProntidao(false);
  definirUsuarioLocal("U4");
});
afterEach(() => {
  desmontar();
  definirProntidao(false);
  fecharPalco();
  limparFalhaDeVoz();
});

async function abrir(pessoas: ParticipanteDeVoz[]) {
  semear(pessoas);
  await page.viewport(1600, 900);
  definirProntidao(true);
  abrirServidor(S);
  montar(
    <div style={{ inlineSize: "1600px", blockSize: "860px" }}>
      <ShellDasSalas />
    </div>,
  );
  await expect.element(page.getByRole("heading", { name: "Grupo", level: 2 })).toBeVisible();
}

const quatro = () => [
  participante("U1", { estado: "tela" }),
  participante("U2"),
  participante("U3", { mudo: true }),
  participante("U4"),
];
/** Clique direto no elemento: o véu do diálogo e a animação de entrada atrapalham o clique por coordenada. */
async function clicar(alvo: { element(): Element }) {
  await expect.element(alvo as never).toBeVisible();
  (alvo.element() as HTMLElement).click();
}
const palco = () => pegar("[data-testid='palco']");
const ladrilhos = () => [...document.querySelectorAll<HTMLElement>("[data-testid='ladrilho-de-pessoa']")];

function entrarNoPalco(estado: "dentro" | "conectando" | "reconectando" = "dentro") {
  definirChamada({ estado, channelId: "V1", desde: Date.now() });
  definirPalco({ tipo: "grade" });
}

describe("palco em tela cheia", () => {
  it("ocupa a área principal: sem coluna de membros, sem chat, com o cabeçalho e o botão do chat", async () => {
    await abrir(quatro());
    expect(pegar("[data-testid='lista-de-membros']")).not.toBeNull();
    entrarNoPalco();
    await expect.poll(palco).not.toBeNull();

    // A gaveta de membros colapsa e o chat não existe.
    expect(pegar("[data-testid='lista-de-membros']")?.offsetParent ?? null).toBeNull();
    expect(pegar("[data-testid='shell-grade']")!.dataset.gaveta).toBe("oculta");
    expect(document.querySelector("textarea, [aria-label*='Mensagem']")).toBeNull();

    const area = pegar("main")!.getBoundingClientRect();
    const p = palco()!.getBoundingClientRect();
    expect(p.width).toBeGreaterThan(area.width - 4);
    expect(p.height).toBeGreaterThan(area.height - 4);

    await expect.element(page.getByRole("heading", { name: "Jogatina", level: 2 })).toBeVisible();
    expect(palco()!.textContent).toContain("4 pessoas");
    expect(palco()!.textContent).toContain("Ana ao vivo");
    await expect.element(page.getByRole("button", { name: /Abrir o chat, geral, 3 novas/ })).toBeVisible();
  });

  it("transmissão em foco com a tira de pessoas; miniatura de outra transmissão troca o foco", async () => {
    await abrir([
      participante("U1", { estado: "tela" }),
      participante("U2", { estado: "tela" }),
      participante("U3"),
      participante("U4"),
    ]);
    entrarNoPalco();
    await expect.poll(() => pegar("[data-testid='foco-do-palco']")).not.toBeNull();

    // Foco na primeira transmissão de outra pessoa; sem faixa ainda, o aviso honesto.
    expect(pegar("[data-testid='foco-do-palco']")!.dataset.pessoa).toBe("U1");
    expect(pegar("[data-testid='foco-do-palco']")!.textContent).toContain(voz.palco.recebendoQuadro);
    expect(pegar("[data-testid='foco-do-palco']")!.textContent).toContain("AO VIVO");
    // O volume da transmissão NÃO mora sobre o vídeo: só dentro do menu `⋯`.
    expect(pegar("[data-testid='foco-do-palco']")!.querySelector("input[type='range']")).toBeNull();
    expect(document.querySelector("[data-testid='volume-da-transmissao']")).toBeNull();
    expect(pegar("[data-testid='tira-do-palco']")!.querySelector("input[type='range']")).toBeNull();

    // A tira tem as pessoas que não são o foco e a miniatura da outra transmissão.
    const tira = pegar("[data-testid='tira-do-palco']")!;
    expect(tira.querySelectorAll("[data-testid='ladrilho-de-pessoa']").length).toBe(3);
    await page.getByRole("button", { name: voz.palco.assistir("Caio") }).click();
    expect(lerPalco()).toEqual({ tipo: "assistindo", userId: "U2" });
    await expect.poll(() => pegar("[data-testid='foco-do-palco']")!.dataset.pessoa).toBe("U2");
  });

  describe("volume da transmissão", () => {
    const deslizante = () => page.getByRole("slider", { name: voz.palco.volumeDaTransmissao });
    const volumeDaVoz = () => page.getByRole("slider", { name: voz.palco.volumeDaVoz });
    const elemento = () => deslizante().element() as HTMLInputElement;
    const sliders = () => document.querySelectorAll("input[type='range']").length;

    async function abrirTransmissao(comSom: boolean) {
      await abrir([participante("U1", { estado: "tela" }), participante("U3")]);
      entrarNoPalco();
      if (comSom) definirChamada({ telaComSom: ["U1"] });
      await expect.poll(() => pegar("[data-testid='foco-do-palco']")).not.toBeNull();
    }
    async function abrirMenuDoFoco() {
      await page
        .getByRole("button", { name: voz.palco.opcoesDe("Ana") })
        .first()
        .click();
      await expect.element(deslizante()).toBeVisible();
    }

    it("o botão direito no vídeo em foco abre o menu", async () => {
      await abrirTransmissao(true);
      pegar("[data-testid='foco-do-palco']")!.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
      await expect.element(deslizante()).toBeVisible();
    });

    it("não há deslizante sobre o vídeo; ele só existe dentro do menu", async () => {
      await abrirTransmissao(true);
      expect(sliders()).toBe(0);
      await abrirMenuDoFoco();
      const menu = pegar("[data-testid='menu-do-participante']")!;
      expect(sliders()).toBe(2);
      expect(menu.querySelectorAll("input[type='range']").length).toBe(2);
      expect(pegar("[data-testid='foco-do-palco']")!.querySelector("input[type='range']")).toBeNull();
    });

    it("o ⋯ do foco é discreto, mas alcançável pelo teclado", async () => {
      await abrirTransmissao(true);
      const botao = pegar("[data-testid='foco-do-palco'] [data-testid='opcoes-do-participante']") as HTMLElement;
      expect(getComputedStyle(botao).opacity).toBe("0");
      botao.focus();
      await expect.poll(() => getComputedStyle(botao).opacity).toBe("1");
      await userEvent.keyboard("{Enter}");
      await expect.element(deslizante()).toBeVisible();
    });

    it("quem não transmite tem só o volume da voz", async () => {
      await abrirTransmissao(true);
      const eva = ladrilhos().find((l) => l.dataset.pessoa === "U3")!;
      eva.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      await expect.element(volumeDaVoz()).toBeVisible();
      expect(sliders()).toBe(1);
      expect(deslizante().elements().length).toBe(0);
    });

    it("sem som, fica desligado e diz por quê; com som, liga", async () => {
      await abrirTransmissao(false);
      await abrirMenuDoFoco();
      await expect.element(deslizante()).toBeDisabled();
      await expect.element(deslizante()).toHaveAccessibleDescription(voz.palco.transmissaoSemSom);

      definirChamada({ telaComSom: ["U1"] });
      await expect.element(deslizante()).toBeEnabled();
      expect(pegar("[data-testid='menu-do-participante']")!.textContent).not.toContain(voz.palco.transmissaoSemSom);
    });

    it("vai de 0% a 300% pelo teclado, de 5 em 5, com marca em 100%", async () => {
      await abrirTransmissao(true);
      await abrirMenuDoFoco();
      const el = elemento();
      expect(el.min).toBe("0");
      expect(el.max).toBe("300");
      expect(el.step).toBe("5");
      expect(el.getAttribute("aria-valuetext")).toBe("100%");
      expect([...(el.list?.options ?? [])].map((o) => o.value)).toEqual(["100"]);

      el.focus();
      await userEvent.keyboard("{ArrowRight}");
      await expect.poll(() => lerVolumeDaTransmissao("U1")).toBe(105);
      await userEvent.keyboard("{End}");
      await expect.poll(() => lerVolumeDaTransmissao("U1")).toBe(300);
      await expect.element(deslizante()).toHaveAttribute("aria-valuetext", "300%");
      await userEvent.keyboard("{Home}");
      await expect.poll(() => lerVolumeDaTransmissao("U1")).toBe(0);
      await expect.element(deslizante()).toHaveAttribute("aria-valuetext", "0%");
    });

    it("voz (0–100%) e transmissão (0–300%) são independentes no mesmo menu", async () => {
      await abrirTransmissao(true);
      await abrirMenuDoFoco();
      await expect.element(volumeDaVoz()).toBeVisible();
      const vozEl = volumeDaVoz().element() as HTMLInputElement;
      expect(vozEl.max).toBe("100");
      expect(vozEl.getAttribute("aria-valuetext")).toBe("100%");
      vozEl.focus();
      await userEvent.keyboard("{ArrowLeft}");
      await expect.poll(() => lerVolume("U1")).toBe(95);
      await userEvent.keyboard("{Home}");
      await expect.poll(() => lerVolume("U1")).toBe(0);
      expect(lerVolumeDaTransmissao("U1")).toBe(100);

      elemento().focus();
      await userEvent.keyboard("{End}");
      await expect.poll(() => lerVolumeDaTransmissao("U1")).toBe(300);
      expect(lerVolume("U1")).toBe(0);

      await userEvent.keyboard("{Escape}");
      await expect.poll(() => document.querySelector("[data-testid='menu-do-participante']")).toBeNull();

      // Na tira, o botão direito no ladrilho abre o menu daquela pessoa.
      const eva = ladrilhos().find((l) => l.dataset.pessoa === "U3")!;
      eva.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const volumeDaEva = volumeDaVoz();
      await expect.element(volumeDaEva).toBeVisible();
      (volumeDaEva.element() as HTMLInputElement).focus();
      await userEvent.keyboard("{Home}");
      await expect.poll(() => lerVolume("U3")).toBe(0);
      expect(lerVolume("U1")).toBe(0);
      expect(lerVolumeDaTransmissao("U3")).toBe(100);
    });

    it("o mouse muda o valor, e ele sobrevive a fechar e abrir de novo", async () => {
      await abrirTransmissao(true);
      await abrirMenuDoFoco();
      const caixa = elemento().getBoundingClientRect();
      // Clique perto do fim do trilho: bem acima de 100%.
      await deslizante().click({ position: { x: Math.round(caixa.width * 0.9), y: Math.round(caixa.height / 2) } });
      await expect.poll(() => lerVolumeDaTransmissao("U1")).toBeGreaterThan(200);
      const escolhido = lerVolumeDaTransmissao("U1");
      expect(escolhido % 5).toBe(0);
      expect(JSON.parse(localStorage.getItem("vortex:volumes-de-transmissao") ?? "{}")).toEqual({ U1: escolhido });

      desmontar();
      fecharPalco();
      await abrirTransmissao(true);
      await abrirMenuDoFoco();
      await expect.element(deslizante()).toHaveAttribute("aria-valuetext", `${String(escolhido)}%`);
    });
 });

  it("a faixa tem miniaturas 16:9 de altura fixa, centradas e sem esticar", async () => {
    await abrir([
      participante("U1", { estado: "tela" }),
      participante("U2", { estado: "tela" }),
      participante("U3"),
      participante("U4"),
    ]);
    entrarNoPalco();
    await expect.poll(() => pegar("[data-testid='tira-do-palco']")).not.toBeNull();
    const tira = pegar("[data-testid='tira-do-palco']")!;
    const filhos = [...tira.children] as HTMLElement[];
    expect(filhos.length).toBe(4);
    const alturaToken = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--vx-tira-altura"));
    for (const f of filhos) {
      const r = f.getBoundingClientRect();
      expect(r.height).toBeCloseTo(alturaToken, 0);
      expect(r.width / r.height).toBeCloseTo(16 / 9, 1);
    }
    // Cabendo, a faixa fica centrada (a mesma folga dos dois lados), e não esticada.
    const t = tira.getBoundingClientRect();
    const primeiro = filhos[0]!.getBoundingClientRect();
    const ultimo = filhos[filhos.length - 1]!.getBoundingClientRect();
    expect(Math.abs(primeiro.left - t.left - (t.right - ultimo.right))).toBeLessThanOrEqual(2);
    expect(ultimo.right - primeiro.left).toBeLessThan(t.width);
  });

  it("não cabendo, a faixa rola na horizontal sem cortar o início", async () => {
    await page.viewport(700, 900);
    const muitos = Array.from({ length: 14 }, (_, i) => participante(`P${String(i)}`));
    await abrir([participante("U1", { estado: "tela" }), participante("U4"), ...muitos]);
    entrarNoPalco();
    await expect.poll(() => pegar("[data-testid='tira-do-palco']")).not.toBeNull();
    const tira = pegar("[data-testid='tira-do-palco']")!;
    expect(tira.scrollWidth).toBeGreaterThan(tira.clientWidth);
    expect(tira.scrollLeft).toBe(0);
    expect(tira.children[0]!.getBoundingClientRect().left).toBeGreaterThanOrEqual(tira.getBoundingClientRect().left - 1);
  });

  it("a seta recolhe a faixa a uma barra fina, devolve a altura ao foco e lembra a escolha", async () => {
    await abrir([
      participante("U1", { estado: "tela" }),
      participante("U2"),
      participante("U3"),
      participante("U4"),
    ]);
    entrarNoPalco();
    definirChamada({ comCamera: ["U2"] });
    await expect.poll(() => ctl.assinaturas).toContain("+U2:camera");
    const focoAntes = pegar("[data-testid='foco-do-palco']")!.getBoundingClientRect().height;

    await page.getByRole("button", { name: voz.palco.recolherFaixa }).click();
    await expect.poll(() => pegar("[data-testid='tira-do-palco']")).toBeNull();
    // Nada de miniatura montada: a assinatura do vídeo de U2 foi devolvida.
    await expect.poll(() => ctl.assinaturas).toContain("-U2:camera");
    expect(pegar("[data-testid='faixa-do-palco']")!.getBoundingClientRect().height).toBeLessThanOrEqual(40);
    await expect
      .poll(() => pegar("[data-testid='foco-do-palco']")!.getBoundingClientRect().height)
      .toBeGreaterThan(focoAntes);
    expect(localStorage.getItem("vortex:faixa-do-palco-recolhida")).toBe("1");
    expect(document.querySelector("button[aria-expanded='false']")).not.toBeNull();

    await page.getByRole("button", { name: voz.palco.expandirFaixa }).click();
    await expect.poll(() => pegar("[data-testid='tira-do-palco']")).not.toBeNull();
    await expect.poll(() => ctl.assinaturas.filter((a) => a === "+U2:camera").length).toBe(2);
  });

  it("a PRÓPRIA tela na miniatura é um cartão, sem vídeo e sem assinar", async () => {
    await abrir([
      participante("U1", { estado: "tela" }),
      participante("U2"),
      participante("U4", { estado: "tela" }),
    ]);
    entrarNoPalco();
    await expect.poll(() => pegar("[data-testid='foco-do-palco']")?.dataset.pessoa).toBe("U1");
    const mini = pegar("[data-testid='ladrilho-de-tela'][data-pessoa='U4']")!;
    expect(mini.textContent).toContain(voz.palco.vocePassaTransmitindo);
    expect(mini.querySelector("video")).toBeNull();
    expect(ctl.assinaturas).not.toContain("+U4:tela");
  });

  it("ver em grade tira o foco; sem transmissão o palco mostra só as pessoas, sem buraco", async () => {
    await abrir(quatro());
    entrarNoPalco();
    await expect.poll(() => pegar("[data-testid='foco-do-palco']")).not.toBeNull();
    await page.getByRole("button", { name: voz.palco.verEmGrade }).click();
    await expect.poll(() => pegar("[data-testid='grade-do-palco']")).not.toBeNull();
    expect(pegar("[data-testid='foco-do-palco']")).toBeNull();

    // Sem ninguém transmitindo.
    fecharPalco();
    vozPorCanal.set("V1", [participante("U1"), participante("U2")]);
    definirPalco({ tipo: "grade" });
    await expect.poll(() => ladrilhos().length).toBe(2);
    expect(pegar("[data-testid='grade-do-palco']")).not.toBeNull();
  });

  it("o anel de fala vem do store efêmero e acende só o ladrilho de quem fala", async () => {
    await abrir(quatro());
    entrarNoPalco();
    await expect.poll(() => ladrilhos().length).toBeGreaterThan(0);
    const de = (id: string) => ladrilhos().find((l) => l.dataset.pessoa === id)!;
    // O foco é a tela de Ana: as outras três pessoas e ela mesma estão na tira ou fora dela.
    definirFalantes(["U2"]);
    await expect.poll(() => de("U2").dataset.falando).toBe("true");
    expect(de("U3").dataset.falando).toBe("false");
    expect(de("U2").getAttribute("aria-label")).toContain("falando");
    definirFalantes([]);
    await expect.poll(() => de("U2").dataset.falando).toBe("false");
  });

  it("assina o vídeo só enquanto o ladrilho está no palco e devolve ao sair dele", async () => {
    await abrir(quatro());
    entrarNoPalco();
    await expect.poll(() => ctl.assinaturas).toContain("+U1:tela");
    // O foco pede a camada alta.
    expect(ctl.assinaturas).toContain("q:U1:tela:alta");

    // Ler outro canal fecha o palco: o ladrilho desmonta e a faixa é devolvida.
    await page.getByRole("button", { name: /avisos/ }).click();
    await expect.poll(() => ctl.assinaturas).toContain("-U1:tela");
    expect(palco()).toBeNull();
  });

  /*
    ⚠ **"Fica preso em 'Recebendo o primeiro quadro…'" — relatado por quem
    usa.** O `screensharing` do Stoat monta o ladrilho antes de o LiveKit
    publicar a faixa. O pedido tem de ficar guardado e ser cumprido quando ela
    chega, sem o ladrilho desmontar.
  */
  it("a faixa publicada DEPOIS de o ladrilho mostrar 'Recebendo o primeiro quadro…' faz o vídeo aparecer", async () => {
    ctl.semPublicacao.add("U1:tela");
    await abrir(quatro());
    entrarNoPalco();
    const foco = () => pegar("[data-testid='foco-do-palco']");
    await expect.poll(() => foco()?.textContent ?? "").toContain(voz.palco.recebendoQuadro);
    await expect.poll(() => ctl.assinaturas).toContain("+U1:tela");
    // Pedido feito, nada assinado ainda: não há publicação para receber a camada.
    expect(ctl.assinaturas).not.toContain("q:U1:tela:alta");
    const antes = foco()!;

    ctl.publicar?.("U1", "tela");
    await expect.poll(() => foco()?.querySelector("video") ?? null).not.toBeNull();
    expect(foco()).toBe(antes);
    expect(foco()!.textContent).not.toContain(voz.palco.recebendoQuadro);
    expect(ctl.assinaturas).toContain("q:U1:tela:alta");
    expect(ctl.assinaturas).not.toContain("-U1:tela");
  });

  it("o palco aberto deixa a coluna de salas aberta; recolher é uma preferência e a faixa abre por mouse e por foco, sem desmontar", async () => {
    await abrir(quatro());
    entrarNoPalco();
    const faixa = () => pegar("[data-testid='faixa-de-salas']");
    const lista = () => pegar("[data-testid='lista-de-salas']");
    await expect.poll(faixa).toBeNull();
    expect(pegar("aside[aria-label='" + shell.salas.rotulo + "']")).not.toBeNull();

    definirColunaDeSalas("faixa");
    await expect.poll(faixa).not.toBeNull();

    // Fechada: a faixa tem 56px, a lista está montada mas inerte.
    const grade = pegar("[data-testid='shell-grade']")!;
    await expect.poll(() => getComputedStyle(grade).gridTemplateColumns.split(" ")[2]).toBe("56px");
    const listaAntes = lista()!;
    expect(listaAntes.hasAttribute("inert")).toBe(true);
    expect(listaAntes.textContent).toContain("Jogatina");
    expect(faixa()!.querySelector("button[aria-label^='Jogatina']")).not.toBeNull();

    // Mouse: abrir ao passar, fechar ao sair.
    const raiz = listaAntes.closest("[data-faixa-raiz]") as HTMLElement;
    await userEvent.hover(raiz.querySelector("[data-testid='faixa-de-salas']")!);
    await expect.poll(() => lista()!.hasAttribute("inert")).toBe(false);
    await userEvent.unhover(raiz);
    await userEvent.hover(pegar("[data-testid='palco']")!);
    await expect.poll(() => lista()!.hasAttribute("inert")).toBe(true);

    // Teclado: foco em uma sala da faixa abre; foco fora fecha. Mesma lista (não desmontou).
    faixa()!.querySelector<HTMLElement>("button[aria-label^='Jogatina']")!.focus();
    await expect.poll(() => lista()!.hasAttribute("inert")).toBe(false);
    expect(lista()).toBe(listaAntes);
    (document.activeElement as HTMLElement).blur();
    await expect.poll(() => lista()!.hasAttribute("inert")).toBe(true);
  });

  it("a tira do palco pede a camada baixa e a grade a média", async () => {
    await abrir(quatro());
    entrarNoPalco();
    definirChamada({ comCamera: ["U2"] });
    // Na tira (há foco): miniatura, a camada mais barata.
    await expect.poll(() => ctl.assinaturas).toContain("q:U2:camera:baixa");
    expect(ctl.assinaturas).not.toContain("q:U2:camera:media");

    // Na grade o ladrilho pode ocupar boa parte da tela: camada média.
    await page.getByRole("button", { name: voz.palco.verEmGrade }).click();
    await expect.poll(() => ctl.assinaturas).toContain("q:U2:camera:media");
  });

  it("a cápsula tem os cinco controles, com o recurso no nome e o estado em aria-pressed", async () => {
    await abrir(quatro());
    entrarNoPalco();
    await expect.element(page.getByRole("button", { name: voz.microfone })).toBeVisible();
    for (const nome of [voz.microfone, voz.audioRecebido, voz.camera, voz.compartilharTela]) {
      expect(document.querySelector(`button[aria-label='${nome}'][aria-pressed]`)).not.toBeNull();
    }
    expect(document.querySelector(`button[aria-label='${voz.sairDaChamada}']`)).not.toBeNull();

    await page.getByRole("button", { name: voz.microfone }).click();
    await page.getByRole("button", { name: voz.audioRecebido }).click();
    await page.getByRole("button", { name: voz.camera }).click();
    await page.getByRole("button", { name: voz.compartilharTela }).click();
    expect(ctl.chamadas).toEqual(["mudo", "surdo", "camera", "tela"]);

    await page.getByRole("button", { name: voz.sairDaChamada }).click();
    expect(ctl.chamadas.at(-1)).toBe("sair");
  });

  it("clicar num canal de texto com a chamada de pé abre o canal com a chamada no widget", async () => {
    await abrir(quatro());
    entrarNoPalco();
    await expect.poll(palco).not.toBeNull();

    await page.getByRole("button", { name: /avisos/ }).click();
    await expect.poll(palco).toBeNull();
    await expect.element(page.getByRole("region", { name: voz.chamada })).toBeVisible();
    // A gaveta volta e o canal é o clicado.
    expect(pegar("[data-testid='lista-de-membros']")).not.toBeNull();
    expect(document.querySelector("aside [aria-current]")?.textContent).toContain("avisos");

    // E "Voltar ao palco" devolve a tela.
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === voz.voltarAoPalco)?.click();
    await expect.poll(palco).not.toBeNull();
  });
});

describe("estados de conexão", () => {
  it("conectando: o palco já está aberto, com as pessoas conhecidas e sem afirmar qualidade", async () => {
    await abrir(quatro());
    entrarNoPalco("conectando");
    await expect.element(page.getByRole("status").filter({ hasText: voz.conexao.conectandoASala })).toBeVisible();
    expect(palco()!.dataset.estado).toBe("conectando");
    expect(ladrilhos().length).toBe(4);
    expect(palco()!.textContent).not.toMatch(/p\d\d|fps/);
    // A cápsula diz que está conectando.
    expect(palco()!.textContent).toContain(voz.conexao.conectandoASala);
    // Sem o motor, câmera e tela ainda não agem sobre uma sala que não existe.
    expect(document.querySelector(`button[aria-label='${voz.camera}']`)).toBeNull();
  });

  it("falha: painel com o motivo e 'Tentar de novo', sem a pessoa aparecer como dentro", async () => {
    await abrir(quatro());
    definirPalco({ tipo: "grade" });
    definirFalhaDeVoz({ channelId: "V1", motivo: "O servidor de voz não respondeu." });

    const painel = page.getByRole("alertdialog");
    await expect.element(painel).toBeVisible();
    expect(pegar("[role='alertdialog']")!.textContent).toContain(voz.conexao.falhouTitulo("Jogatina"));
    expect(pegar("[role='alertdialog']")!.textContent).toContain("O servidor de voz não respondeu.");
    expect(palco()!.dataset.estado).toBe("falhou");
    // Sem cápsula: a pessoa não está na sala.
    expect(document.querySelector(`button[aria-label='${voz.sairDaChamada}']`)).toBeNull();

    await page.getByRole("button", { name: voz.conexao.tentarDeNovo }).click();
    expect(ctl.chamadas).toContain("entrar:V1");
  });

  it("falha: 'Voltar' dispensa o aviso e fecha o palco", async () => {
    await abrir(quatro());
    definirPalco({ tipo: "grade" });
    definirFalhaDeVoz({ channelId: "V1", motivo: "x" });
    await page.getByRole("button", { name: voz.conexao.voltar }).click();
    await expect.poll(palco).toBeNull();
    expect(lerPalco().tipo).toBe("fechado");
  });

  it("reconectando: faixa de aviso e conteúdo congelado, sem tirar a pessoa da sala", async () => {
    await abrir(quatro());
    entrarNoPalco("reconectando");
    await expect
      .element(page.getByRole("status").filter({ hasText: voz.conexao.reconectandoDetalhe }))
      .toBeVisible();
    expect(pegar("[data-testid='palco'] [data-congelado='true']")).not.toBeNull();
    // A cápsula continua: sair ainda é possível.
    expect(document.querySelector(`button[aria-label='${voz.sairDaChamada}']`)).not.toBeNull();
  });

  it("fora da sala: oferece entrar de novo e o palco abre na hora", async () => {
    await abrir(quatro());
    definirPalco({ tipo: "grade" });
    await expect.element(page.getByRole("heading", { name: voz.conexao.foraTitulo("Jogatina") })).toBeVisible();
    await page.getByRole("button", { name: voz.conexao.entrarNaSala }).click();
    expect(ctl.chamadas).toContain("entrar:V1");
  });
});

describe("escolher o que transmitir", () => {
  const dialogo = () => pegar("[role='dialog']");

  afterEach(() => {
    responderEscolhaDeTela(undefined);
    concluirEscolhaDeTela();
    delete (window as { vortexTela?: unknown }).vortexTela;
  });

  it("na web: qualidade e som, sem lista de fontes (quem lista é o sistema), e devolve a escolha", async () => {
    await abrir(quatro());
    entrarNoPalco();
    const escolha = pedirEscolhaDeTela("sistema");
    await expect.element(page.getByRole("dialog", { name: voz.transmitir.titulo })).toBeVisible();
    expect(dialogo()!.textContent).toContain(voz.transmitir.seletorDoSistema);
    expect(dialogo()!.querySelector("[role='radiogroup'][aria-label]")).toBeNull();

    // Padrão: 1080p, 30 quadros.
    const marcados = [
      ...dialogo()!.querySelectorAll("[role='radiogroup'][aria-labelledby] [role='radio'][aria-checked='true']"),
    ].map((e) => e.textContent);
    expect(marcados).toEqual(["1080p", "30"]);

    await clicar(page.getByRole("radio", { name: "1440p" }));
    await clicar(page.getByRole("radio", { name: "60" }));
    await expect.element(page.getByRole("note")).toBeVisible();
    expect(pegar("[role='note']")!.textContent).toContain("1440p a 60 quadros");

    await clicar(page.getByRole("button", { name: voz.transmitir.transmitir }));
    expect(await escolha).toMatchObject({ fonteId: undefined, resolucao: "1440p", taxa: 60 });
    // Não fecha no clique: fica iniciando até o motor concluir.
    await expect.element(page.getByRole("button", { name: voz.transmitir.iniciando })).toBeVisible();
    expect(lerSeletorDeTela().fase).toBe("iniciando");
    concluirEscolhaDeTela();
    await expect.poll(dialogo).toBeNull();
  });

  it("cancelar (e Esc) resolve com nada e fecha", async () => {
    await abrir(quatro());
    const escolha = pedirEscolhaDeTela("sistema");
    await clicar(page.getByRole("button", { name: voz.transmitir.cancelar }));
    expect(await escolha).toBeUndefined();
    await expect.poll(dialogo).toBeNull();

    const outra = pedirEscolhaDeTela("sistema");
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await clicar(page.getByRole("dialog"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await outra).toBeUndefined();
  });

  it("o som aparece desabilitado, com o motivo, onde o navegador não captura áudio", async () => {
    await abrir(quatro());
    const original = navigator.mediaDevices.getSupportedConstraints.bind(navigator.mediaDevices);
    navigator.mediaDevices.getSupportedConstraints = () => ({});
    try {
      void pedirEscolhaDeTela("sistema");
      await expect.element(page.getByRole("dialog")).toBeVisible();
      const interruptor = dialogo()!.querySelector("[role='switch']")!;
      expect(interruptor.getAttribute("aria-disabled")).toBe("true");
      expect(interruptor.getAttribute("aria-checked")).toBe("false");
      expect(dialogo()!.textContent).toContain(voz.transmitir.somIndisponivel);
    } finally {
      navigator.mediaDevices.getSupportedConstraints = original;
    }
  });

  it("na casca: lista telas e janelas pela ponte (ponto de extensão do Electron) e devolve a fonte", async () => {
    const fonte = (id: string, nome: string, tipo: "tela" | "janela") => ({
      id,
      nome,
      tipo,
      meta: tipo === "tela" ? "2560×1440" : undefined,
      miniatura: "",
      icone: undefined,
    });
    (window as { vortexTela?: unknown }).vortexTela = {
      seletorProprio: () => Promise.resolve(true),
      fontes: () => Promise.resolve([fonte("screen:1", "Tela 1", "tela"), fonte("window:9", "Deadlock", "janela")]),
      escolher: () => Promise.resolve(true),
      cancelar: () => Promise.resolve(),
      permissao: () => Promise.resolve("concedida"),
      abrirAjustes: () => Promise.resolve(),
    };
    await abrir(quatro());
    const escolha = pedirEscolhaDeTela("casca");
    await expect.element(page.getByRole("radio", { name: /Tela 1, 2560×1440, escolhida/ })).toBeVisible();
    await clicar(page.getByRole("tab", { name: voz.transmitir.janelas }));
    await expect.element(page.getByRole("radio", { name: /Deadlock, escolhida/ })).toBeVisible();
    await clicar(page.getByRole("button", { name: voz.transmitir.transmitir }));
    expect(await escolha).toMatchObject({ fonteId: "window:9", audio: true });
  });
});

describe("polimento do palco", () => {
  const transmitindoEu = () => [participante("U1"), participante("U2"), participante("U4", { estado: "tela" })];
  function transmitir() {
    definirChamada({ estado: "dentro", channelId: "V1", desde: Date.now() });
    definirPalco({ tipo: "transmitindo" });
  }

  afterEach(() => {
    definirQualidadeEscolhida(undefined);
    definirFalantes([]);
  });

  it("a própria tela, antes do primeiro quadro, tem um rótulo só e centralizado", async () => {
    await abrir(transmitindoEu());
    transmitir();
    await expect.poll(() => pegar("[data-testid='foco-do-palco']")?.dataset.pessoa).toBe("U4");
    const foco = pegar("[data-testid='foco-do-palco']")!;
    expect(foco.textContent.split(voz.palco.suaTela).length - 1).toBe(1);
    expect(foco.textContent).not.toContain(voz.palco.recebendoQuadro);
    expect(foco.querySelector("input[type='range']")).toBeNull();
  });

  it("você aparece nas miniaturas mesmo transmitindo", async () => {
    await abrir(transmitindoEu());
    transmitir();
    await expect.poll(() => pegar("[data-testid='tira-do-palco']")).not.toBeNull();
    const meu = pegar("[data-testid='tira-do-palco'] [data-testid='ladrilho-de-pessoa'][data-pessoa='U4']")!;
    expect(meu.textContent).toContain(voz.palco.voce);
  });

  it("microfone cortado vence a fala: o ladrilho não diz 'falando'", async () => {
    await abrir(quatro());
    entrarNoPalco();
    await page.getByRole("button", { name: voz.palco.verEmGrade }).click();
    await expect.poll(() => ladrilhos().length).toBe(4);
    definirFalantes(["U3", "U2"]);
    const de = (id: string) => ladrilhos().find((l) => l.dataset.pessoa === id)!;
    await expect.poll(() => de("U2").dataset.falando).toBe("true");
    expect(de("U2").textContent).toContain(voz.estado.falando.toLowerCase());
    expect(de("U3").dataset.falando).toBe("false");
    expect(de("U3").textContent).not.toContain(voz.estado.falando.toLowerCase());
    expect(de("U3").textContent).toContain(voz.estado.mudo.toLowerCase());
  });

  it("selo de qualidade: o escolhido na própria transmissão; sem dado, sem selo", async () => {
    await abrir(transmitindoEu());
    transmitir();
    await expect.poll(() => pegar("[data-testid='foco-do-palco']")).not.toBeNull();
    expect(pegar("[data-testid='selo-de-qualidade']")).toBeNull();
    definirQualidadeEscolhida({ resolucao: "1080p", taxa: 60 });
    await expect.poll(() => pegar("[data-testid='selo-de-qualidade']")?.textContent).toBe("1080p60");
    definirQualidadeEscolhida({ resolucao: "Fonte", taxa: 30 });
    await expect.poll(() => pegar("[data-testid='selo-de-qualidade']")).toBeNull();
  });

  it("tela cheia pede o elemento do palco e o botão acompanha a saída (Esc)", async () => {
    await abrir(quatro());
    entrarNoPalco();
    await expect.poll(() => pegar("[data-testid='tela-cheia']")).not.toBeNull();
    const botao = pegar("[data-testid='tela-cheia']")!;
    expect(botao.getAttribute("aria-pressed")).toBe("false");
    botao.click();
    await expect.poll(() => document.fullscreenElement).toBe(palco());
    await expect.poll(() => pegar("[data-testid='tela-cheia']")!.getAttribute("aria-pressed")).toBe("true");
    await document.exitFullscreen();
    await expect.poll(() => pegar("[data-testid='tela-cheia']")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("o atalho para o chat mostra o canal e quantas mensagens novas há", async () => {
    await abrir(quatro());
    entrarNoPalco();
    const b = page.getByRole("button", { name: /Abrir o chat, geral, 3 novas/ });
    await expect.element(b).toBeVisible();
    expect((b.element() as HTMLElement).textContent.replace(/\s+/g, " ").trim()).toBe("# geral · 3 novas");
  });
});
