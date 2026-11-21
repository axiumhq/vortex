/**
 * O caminho do áudio REMOTO que pode passar de 100%: a voz de cada pessoa e o
 * som de uma tela compartilhada.
 *
 * ⚠ **Por que não `webAudioMix` na sala.** O LiveKit aplica ganho acima de 1
 * quando a faixa tem um `AudioContext`; sem ele escreve em
 * `HTMLMediaElement.volume`, que lança fora de [0, 1]. `webAudioMix` muda o
 * caminho de TODA faixa da sala por dentro do SDK, onde o motor não decide a
 * ordem entre contexto e `attach`. Aqui o motor dá o contexto faixa a faixa,
 * por `setAudioContext` antes do `attach`: o `<audio>` fica mudo e o som sai
 * pelo `GainNode` que o LiveKit liga no contexto.
 *
 * ⚠ **Um contexto para a sala inteira, um `GainNode` por faixa.** Criar um
 * `AudioContext` por pessoa custaria uma thread de áudio do sistema cada; o
 * nó de ganho é barato.
 *
 * ⚠ **O ganho NÃO passa por `RemoteParticipant.setVolume`.** Aquele guarda o
 * valor num mapa e o reaplica em toda faixa nova ANTES de ela ter contexto —
 * um 3 ali lançaria no `attach` e derrubaria o som da pessoa inteira. Quem
 * aplica é este módulo, na faixa, depois do contexto.
 *
 * ⚠ **A saída de áudio precisa ser repetida no contexto.** `switchActiveDevice`
 * da sala troca o `sinkId` dos elementos, e o elemento aqui está mudo: sem
 * `AudioContext.setSinkId` o som continuaria no dispositivo padrão enquanto o
 * resto ia para o fone escolhido.
 *
 * ⚠ **Onde o contexto NÃO troca de saída (Firefox), até 100% a faixa toca pelo
 * ELEMENTO.** `HTMLMediaElement.setSinkId` existe lá e é por ele que a sala
 * leva o som ao fone escolhido; passar tudo pelo contexto trocaria "ouvir no
 * fone" por "poder passar de 100%", que ninguém pediu. Só acima de 100% a faixa
 * vai para o contexto — e aí o dispositivo padrão é o preço aceito do ganho.
 * Onde o contexto troca de saída, toda faixa fica nele e nada alterna.
 *
 * ⚠ **No iOS o elemento não serve, e a faixa fica SEMPRE no contexto.** O
 * Safari do iOS também não tem `AudioContext.setSinkId`, mas lá
 * `element.volume` é só leitura: o caminho do elemento faria ensurdecer (ganho
 * 0) e todo volume abaixo de 100% pararem de atenuar. Ver
 * `elementoControlaVolume`.
 *
 * ⚠ **No contexto, o elemento tem de CONTINUAR mudo.** `Room.startAudio()`
 * desmuta todo `<audio>` remoto quando a sala não usa `webAudioMix` — e ele
 * roda quando o microfone local é adquirido e quando a página volta a ficar
 * visível no iOS. Desmutado, o elemento tocaria junto do `GainNode`: voz
 * dobrada a 100% e audível a 0% (no iOS `element.volume` não tem efeito). Um
 * ouvinte de `volumechange` no próprio elemento devolve o mudo, venha de onde
 * vier o desmute.
 *
 * O anel de "falando" não passa por aqui: `ActiveSpeakersChanged` é calculado
 * pelo servidor a partir dos pacotes que ELE recebe, antes de qualquer ganho
 * local.
 *
 * Sem LiveKit importado: o motor passa as faixas e o teste passa dublês com a
 * mesma forma.
 */

/** O que este módulo usa de uma `RemoteAudioTrack`. */
export interface FaixaAmplificavel {
  readonly attachedElements: readonly HTMLMediaElement[];
  attach(): HTMLMediaElement;
  setAudioContext(contexto: AudioContext | undefined): void;
  setVolume(volume: number): void;
}

export interface OpcoesDoAudioAmplificavel {
  /** `undefined` quando o navegador não tem Web Audio. */
  criarContexto: () => AudioContext | undefined;
  /** Onde os `<audio>` moram (fora da árvore React). */
  destino: () => HTMLElement;
  /**
   * Se `HTMLMediaElement.volume` atenua de fato nesta plataforma. Padrão:
   * `elementoControlaVolume()`. Falso no iOS.
   */
  elementoControlaVolume?: () => boolean;
}

interface Plataforma {
  readonly userAgent: string;
  readonly platform: string;
  readonly maxTouchPoints: number;
}

/**
 * `element.volume` funciona aqui? Por capacidade primeiro: escrever num
 * elemento de teste e reler — no iOS o atributo é só leitura e continua em 1.
 * A detecção do iOS/iPadOS (inclusive o iPad que se apresenta como Mac com
 * toque) fica de reserva para quando não há documento onde testar.
 */
export function elementoControlaVolume(
  doc: Document | undefined = typeof document === "undefined" ? undefined : document,
  plataforma: Plataforma | undefined = typeof navigator === "undefined" ? undefined : navigator,
): boolean {
  if (plataforma && ehIos(plataforma)) return false;
  if (!doc) return true;
  try {
    const teste = doc.createElement("audio");
    teste.volume = 0.5;
    return Math.abs(teste.volume - 0.5) < 0.01;
  } catch {
    return false;
  }
}

function ehIos(p: Plataforma): boolean {
  if (/iPad|iPhone|iPod/.test(p.userAgent)) return true;
  /* iPadOS 13+ diz ser um Mac; o toque é o que o entrega. */
  return p.platform === "MacIntel" && p.maxTouchPoints > 1;
}

/** O ganho que se consegue aplicar com Web Audio: 300%. */
export const GANHO_MAXIMO = 3;

export interface AudioAmplificavel {
  /**
   * A faixa chegou (primeira assinatura, re-assinatura ou reconexão): escolhe
   * o caminho, anexa se ninguém anexou e aplica o ganho, de 0 a 3.
   */
  receber(faixa: FaixaAmplificavel, ganho: number): void;
  /** Reaplica um ganho numa faixa já anexada (e troca de caminho se preciso). */
  aplicar(faixa: FaixaAmplificavel, ganho: number): void;
  /** O seletor de saída mudou. `undefined` ou `"default"` = padrão do sistema. */
  trocarSaida(deviceId: string | undefined): Promise<void>;
  /** A sala acabou. */
  fechar(): void;
}

type ContextoComSaida = AudioContext & { setSinkId?: (id: string) => Promise<void> };

export function criarAudioAmplificavel(opcoes: OpcoesDoAudioAmplificavel): AudioAmplificavel {
  let contexto: ContextoComSaida | undefined;
  let saida: string | undefined;
  /* Faixas tocando pelo contexto AGORA. Fraco: a faixa morre com a assinatura. */
  let comContexto = new WeakSet<FaixaAmplificavel>();
  /*
    O DONO atual de cada elemento, lido pelo guarda de mudo a cada evento. O
    LiveKit RECICLA elementos desanexados: um ouvinte que capturasse a primeira
    faixa remutaria a faixa seguinte que toca pelo elemento, ou deixaria de
    remutar a que toca pelo contexto.
  */
  const dono = new WeakMap<HTMLMediaElement, FaixaAmplificavel>();
  const controlaVolume = opcoes.elementoControlaVolume ?? (() => elementoControlaVolume());
  let elementoServe: boolean | undefined;

  function obterContexto(): ContextoComSaida | undefined {
    if (!contexto) {
      contexto = opcoes.criarContexto();
      if (contexto) void aplicarSaidaNoContexto(contexto);
    }
    return contexto;
  }

  async function aplicarSaidaNoContexto(c: ContextoComSaida): Promise<void> {
    if (typeof c.setSinkId !== "function") return;
    /* `"default"` não é aceito por `AudioContext.setSinkId`; a string vazia é o
       padrão do sistema. */
    const id = saida === undefined || saida === "default" ? "" : saida;
    try {
      await c.setSinkId(id);
    } catch {
      /* Dispositivo sumiu: o padrão do sistema assume, como no resto da sala. */
    }
  }

  /** O contexto onde esta faixa deve tocar com este ganho, ou nenhum. */
  function contextoPara(ganho: number): ContextoComSaida | undefined {
    const c = obterContexto();
    if (!c) return undefined;
    /* Contexto que não troca de saída só compensa onde o elemento não alcança. */
    if (typeof c.setSinkId !== "function" && ganho <= 1) {
      elementoServe ??= controlaVolume();
      if (elementoServe) return undefined;
    }
    return c;
  }

  function guardarMudo(faixa: FaixaAmplificavel): void {
    for (const el of faixa.attachedElements) {
      /* O dono muda ANTES do mudo: o `volumechange` que a escrita dispara já
         tem de ver a faixa nova. */
      const novo = !dono.has(el);
      dono.set(el, faixa);
      /* Pelo elemento, ele É a saída — inclusive o reciclado de uma faixa que
         tocava pelo contexto e o deixou mudo. */
      el.muted = comContexto.has(faixa);
      if (!novo) continue;
      el.addEventListener("volumechange", () => {
        /* Desmutado por fora (`startAudio`) enquanto o dono toca pelo contexto. */
        const atual = dono.get(el);
        if (atual && comContexto.has(atual) && !el.muted) el.muted = true;
      });
    }
  }

  function irParaContexto(faixa: FaixaAmplificavel, c: ContextoComSaida): void {
    if (comContexto.has(faixa)) return;
    /* Antes do `attach` é ele que liga o `GainNode`; depois, liga na hora. */
    faixa.setAudioContext(c);
    comContexto.add(faixa);
  }

  function irParaElemento(faixa: FaixaAmplificavel): void {
    if (!comContexto.has(faixa)) return;
    comContexto.delete(faixa);
    faixa.setAudioContext(undefined);
    /* O `attach` com contexto deixou o elemento mudo; quem toca agora é ele. */
    for (const el of faixa.attachedElements) el.muted = false;
  }

  function limpar(ganho: number): number {
    return Number.isFinite(ganho) ? Math.max(0, ganho) : 1;
  }

  function aplicar(faixa: FaixaAmplificavel, ganho: number): void {
    const g = limpar(ganho);
    const c = contextoPara(g);
    if (c) irParaContexto(faixa, c);
    else irParaElemento(faixa);
    guardarMudo(faixa);
    /*
      ⚠ **Fora do contexto o teto volta a ser 1**, e não é cautela: o LiveKit
      escreveria 3 em `HTMLMediaElement.volume` e LANÇARIA dentro do handler
      de `TrackSubscribed`, derrubando o som inteiro em vez de só o ganho
      extra. O percentual guardado não muda; só o que se consegue aplicar.
    */
    const teto = comContexto.has(faixa) ? GANHO_MAXIMO : 1;
    faixa.setVolume(Math.min(teto, g));
  }

  return {
    receber(faixa, ganho) {
      const c = contextoPara(limpar(ganho));
      if (c) irParaContexto(faixa, c);
      if (faixa.attachedElements.length === 0) opcoes.destino().appendChild(faixa.attach());
      aplicar(faixa, ganho);
    },
    aplicar,
    async trocarSaida(deviceId) {
      saida = deviceId;
      if (contexto) await aplicarSaidaNoContexto(contexto);
    },
    fechar() {
      void contexto?.close().catch(() => {});
      contexto = undefined;
      comContexto = new WeakSet();
    },
  };
}
