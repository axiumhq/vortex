/**
 * O `AudioContext` por onde a voz e o som das telas saem — ver
 * `sdk/audioAmplificavel.ts`.
 *
 * ⚠ **Criar pode LANÇAR, e falha aqui é `undefined`, não exceção.**
 * `new AudioContext()` dá `NotSupportedError` quando o navegador não aceita mais
 * um contexto. Lançando, a exceção saía do `receber` antes do `attach` e a voz
 * não tocava — de novo em cada assinatura. Com `undefined` o gerenciador toca
 * pelo elemento, com o teto de 100%: perde o ganho extra, não a voz.
 *
 * ⚠ **Com a voz no contexto, contexto suspenso é sala MUDA.** Ele nasce na
 * primeira faixa, depois do clique em "entrar", e o navegador aceita pela
 * ativação que a página já teve. Mas pode nascer suspenso (entrar sem gesto:
 * moderação te moveu) ou ser suspenso DEPOIS (o iOS suspende ao sair da
 * página). Por isso a recuperação fica armada a vida inteira do contexto: todo
 * toque ou tecla chama `resume()` se ele estiver suspenso — dentro do gesto,
 * que é o que o navegador exige. Os ouvintes saem quando o contexto fecha,
 * venha o fechamento de onde vier (erro nº 5 do briefing).
 */

/** O que este módulo usa do documento. */
export interface AlvoDeGestos {
  addEventListener(tipo: string, ouvinte: () => void, captura: boolean): void;
  removeEventListener(tipo: string, ouvinte: () => void, captura: boolean): void;
}

const GESTOS = ["pointerdown", "keydown"] as const;

export function criarContextoDeSaida(
  Construtor: (new () => AudioContext) | undefined = typeof AudioContext === "undefined"
    ? undefined
    : AudioContext,
  alvo: AlvoDeGestos | undefined = typeof document === "undefined" ? undefined : document,
): AudioContext | undefined {
  if (!Construtor) return undefined;
  let contexto: AudioContext;
  try {
    contexto = new Construtor();
  } catch {
    return undefined;
  }
  if (!alvo) return contexto;

  const retomar = () => {
    if (contexto.state === "suspended") void contexto.resume().catch(() => {});
  };
  const desarmar = () => {
    if (contexto.state !== "closed") return;
    for (const g of GESTOS) alvo.removeEventListener(g, retomar, true);
    contexto.removeEventListener("statechange", desarmar);
  };
  for (const g of GESTOS) alvo.addEventListener(g, retomar, true);
  contexto.addEventListener("statechange", desarmar);
  return contexto;
}
