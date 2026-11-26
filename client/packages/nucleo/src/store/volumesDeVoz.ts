import { lerChamada } from "./chamada";
import { assinarQualquerSilencio, estaSilenciado } from "./sobrePessoas";

/**
 * O volume de cada pessoa na voz, só para você e só nesta máquina.
 *
 * ⚠ **Não existe no protocolo, e nem deveria.** É o que EU ouço de alguém — o
 * servidor não tem o que fazer com isso, e o LiveKit aplica o ganho no MEU
 * `GainNode`. Mesma família de `sobrePessoas.ts`: dado local sobre
 * outra pessoa, keyed por ID de usuário, fora do preset pela regra mais dura do
 * projeto (carrega IDs de gente).
 *
 * ⚠ **Guardado por USUÁRIO e não por sala.** Quem fala baixo fala baixo em
 * todo canal; ajustar de novo a cada sala seria o incômodo diário que este
 * controle existe para tirar.
 *
 * ⚠ **O volume e o "silenciar só para mim" são eixos SEPARADOS**, e o efetivo
 * é derivado. Silenciar não escreve 0 aqui: se escrevesse, dessilenciar não
 * teria para onde voltar e a pessoa perderia o ajuste que tinha feito.
 */

const CHAVE = "vortex:volumes-de-voz";

/** 100% é o padrão, e não é guardado — a ausência é o caso comum. */
export const VOLUME_PADRAO = 100;

/**
 * ⚠ **Até 300%, e acima de 100% é ganho real, não o `<audio>`.**
 * `HTMLMediaElement.volume` LANÇA fora de [0, 1]; o motor dá a cada faixa de
 * voz o MESMO `AudioContext` do som das telas e o LiveKit aplica o ganho num
 * `GainNode` por faixa (ver `sdk/audioAmplificavel.ts`). Sem Web Audio no
 * navegador o motor para em 100% — o valor guardado continua o escolhido.
 *
 * Valores guardados quando o teto era 100 continuam válidos sem migração: o
 * intervalo antigo está dentro do novo, e 60% continua sendo 60%.
 */
export const VOLUME_MAXIMO = 300;
/** O passo do deslizante. O store aceita qualquer inteiro; a UI anda de 5 em 5. */
export const VOLUME_PASSO = 5;

type Ouvinte = () => void;

const volumes = ler();
const porId = new Map<string, Set<Ouvinte>>();
const deQualquer = new Set<(userId: string) => void>();

function ler(): Map<string, number> {
  const saida = new Map<string, number>();
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return saida;
    const obj: unknown = JSON.parse(bruto);
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      return saida;
    }
    for (const [id, v] of Object.entries(obj as Record<string, unknown>)) {
      /* Forma errada é DESCARTADA, não corrigida — mesma disciplina de
         `sobrePessoas.ts`. Um `"80"` em string não vira 80. */
      if (typeof v === "number" && Number.isFinite(v)) {
        const limpo = limitar(v);
        if (limpo !== VOLUME_PADRAO) saida.set(id, limpo);
      }
    }
  } catch {
    /* Armazenamento bloqueado ou JSON corrompido: todo mundo a 100%. */
  }
  return saida;
}

function gravar(): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(Object.fromEntries(volumes)));
  } catch {
    /* Perder a persistência é degradação: o valor vale nesta sessão. */
  }
}

function limitar(v: number): number {
  return Math.min(VOLUME_MAXIMO, Math.max(0, Math.round(v)));
}

/** Em porcentagem inteira, de 0 a `VOLUME_MAXIMO`. */
export function lerVolume(userId: string): number {
  return volumes.get(userId) ?? VOLUME_PADRAO;
}

export function definirVolume(userId: string, porcento: number): void {
  const limpo = limitar(porcento);
  if (lerVolume(userId) === limpo) return;
  if (limpo === VOLUME_PADRAO) volumes.delete(userId);
  else volumes.set(userId, limpo);
  gravar();
  avisar(userId);
}

export function assinarVolume(userId: string, ouvinte: Ouvinte): () => void {
  let set = porId.get(userId);
  if (!set) {
    set = new Set();
    porId.set(userId, set);
  }
  set.add(ouvinte);
  return () => {
    const atual = porId.get(userId);
    if (!atual) return;
    atual.delete(ouvinte);
    if (atual.size === 0) porId.delete(userId);
  };
}

/**
 * O ganho que o LiveKit deve aplicar, de 0 a 3.
 *
 * Três eixos, e a ordem é do mais geral para o mais particular: **surdo** ganha
 * de **silenciado**, que ganha do **volume** — como o fone ganha do microfone
 * na linha da sala.
 *
 * ⚠ **Surdo entra AQUI, e não num `muted` espalhado pelos `<audio>`.** Ele
 * morava em `alternarSurdo`, que varria `querySelectorAll("audio")` — ou seja,
 * só os elementos que existiam NAQUELE instante. Faixa assinada depois
 * (alguém entra na sala, ou você abre a transmissão de alguém) nascia
 * tocando, sem erro nenhum. Com o surdo no ganho efetivo, ele alcança toda
 * faixa por onde o volume já passa: a recém-assinada em `TrackSubscribed` e as
 * antigas quando o motor reaplica.
 *
 * Nenhum dos três ESCREVE nos outros: desensurdecer devolve o volume por
 * pessoa, e quem estava em "silenciar só para mim" continua em 0.
 */
export function volumeEfetivo(userId: string): number {
  if (lerChamada().surdo) return 0;
  if (estaSilenciado(userId)) return 0;
  return lerVolume(userId) / 100;
}

/**
 * Quem mudou, por qualquer dos dois eixos POR PESSOA.
 *
 * O consumidor é o motor de voz, que não sabe de antemão quem vai entrar na
 * sala e por isso não pode assinar por ID.
 *
 * ⚠ **Surdo não passa por aqui**, e é de propósito: o ouvinte recebe o ID de
 * QUEM mudou, e surdo não é de ninguém — é seu. Quem o aplica é o motor, que
 * reaplica o ganho de todo mundo no mesmo gesto em que alterna o estado.
 */
export function assinarVolumeEfetivo(
  ouvinte: (userId: string) => void,
): () => void {
  deQualquer.add(ouvinte);
  const pararDeOuvirSilencio = assinarQualquerSilencio(ouvinte);
  return () => {
    deQualquer.delete(ouvinte);
    pararDeOuvirSilencio();
  };
}

function avisar(userId: string): void {
  for (const o of porId.get(userId) ?? []) o();
  for (const o of deQualquer) o(userId);
}

/** Só para teste — o estado é module-level. */
export function limparVolumes(): void {
  volumes.clear();
}
