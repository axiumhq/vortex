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
}

/** O ganho que se consegue aplicar com Web Audio: 300%. */
export const GANHO_MAXIMO = 3;

export interface AudioAmplificavel {
  /**
   * A faixa chegou (primeira assinatura, re-assinatura ou reconexão): dá o
   * contexto, anexa se ninguém anexou e aplica o ganho, de 0 a 3.
   */
  receber(faixa: FaixaAmplificavel, ganho: number): void;
  /** Reaplica um ganho numa faixa já anexada. */
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
  /* Faixas que receberam o contexto. Fraco: a faixa morre com a assinatura. */
  let comContexto = new WeakSet<FaixaAmplificavel>();

  function obterContexto(): ContextoComSaida | undefined {
    if (!contexto) {
      contexto = opcoes.criarContexto();
      if (contexto) void aplicarSaidaNoContexto(contexto);
    }
    return contexto;
  }

  async function aplicarSaidaNoContexto(c: ContextoComSaida): Promise<void> {
    if (!c.setSinkId) return;
    /* `"default"` não é aceito por `AudioContext.setSinkId`; a string vazia é o
       padrão do sistema. */
    const id = saida === undefined || saida === "default" ? "" : saida;
    try {
      await c.setSinkId(id);
    } catch {
      /* Dispositivo sumiu: o padrão do sistema assume, como no resto da sala. */
    }
  }

  function aplicar(faixa: FaixaAmplificavel, ganho: number): void {
    /*
      ⚠ **Sem contexto o teto volta a ser 1**, e não é cautela: o LiveKit
      escreveria 3 em `HTMLMediaElement.volume` e LANÇARIA dentro do handler
      de `TrackSubscribed`, derrubando o som inteiro em vez de só o ganho
      extra.
    */
    const teto = comContexto.has(faixa) ? GANHO_MAXIMO : 1;
    const limpo = Number.isFinite(ganho) ? ganho : 1;
    faixa.setVolume(Math.min(teto, Math.max(0, limpo)));
  }

  return {
    receber(faixa, ganho) {
      const c = obterContexto();
      if (c && !comContexto.has(faixa)) {
        /* ANTES do `attach`: é ele que liga o `GainNode` e emudece o elemento. */
        faixa.setAudioContext(c);
        comContexto.add(faixa);
      }
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
