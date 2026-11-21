import { lerChamada } from "./chamada";
import { estaSilenciado } from "./sobrePessoas";

/**
 * O volume do SOM de uma transmissão de tela, só para quem assiste e só nesta
 * máquina — de 0% a 300%.
 *
 * ⚠ **Eixo separado do volume da pessoa** (`volumesDeVoz.ts`). A voz de alguém
 * e o jogo que essa pessoa transmite chegam em faixas diferentes, e o ajuste
 * que se quer é quase sempre oposto: o jogo estoura, a voz some — ou o vídeo
 * foi capturado baixo e precisa de ganho. Um controle só para os dois obrigava
 * a escolher qual dos dois ouvir mal.
 *
 * ⚠ **Acima de 100% é real, e não passa pelo `<audio>`.** `HTMLMediaElement.
 * volume` LANÇA fora de [0, 1]; o motor dá a cada faixa de som de tela um
 * `AudioContext` e o LiveKit aplica o ganho num `GainNode` (ver
 * `sdk/audioAmplificavel.ts`). A voz das pessoas passa pelo mesmo contexto,
 * com o próprio eixo em `volumesDeVoz.ts`.
 *
 * Keyed pelo ID de quem TRANSMITE: quem compartilha um jogo alto compartilha
 * alto em toda sala. Mesma família de `volumesDeVoz.ts` — dado local sobre
 * outra pessoa, fora do preset (carrega IDs de gente).
 */

const CHAVE = "vortex:volumes-de-transmissao";

/** 100% é o padrão, e não é guardado — a ausência é o caso comum. */
export const VOLUME_DA_TRANSMISSAO_PADRAO = 100;
export const VOLUME_DA_TRANSMISSAO_MAXIMO = 300;
/** O passo do deslizante. O store aceita qualquer inteiro; a UI anda de 5 em 5. */
export const VOLUME_DA_TRANSMISSAO_PASSO = 5;

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
         `volumesDeVoz.ts`. */
      if (typeof v === "number" && Number.isFinite(v)) {
        const limpo = limitar(v);
        if (limpo !== VOLUME_DA_TRANSMISSAO_PADRAO) saida.set(id, limpo);
      }
    }
  } catch {
    /* Armazenamento bloqueado ou JSON corrompido: toda transmissão a 100%. */
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
  return Math.min(VOLUME_DA_TRANSMISSAO_MAXIMO, Math.max(0, Math.round(v)));
}

/** Em porcentagem inteira, de 0 a `VOLUME_DA_TRANSMISSAO_MAXIMO`. */
export function lerVolumeDaTransmissao(userId: string): number {
  return volumes.get(userId) ?? VOLUME_DA_TRANSMISSAO_PADRAO;
}

export function definirVolumeDaTransmissao(userId: string, porcento: number): void {
  if (!Number.isFinite(porcento)) return;
  const limpo = limitar(porcento);
  if (lerVolumeDaTransmissao(userId) === limpo) return;
  if (limpo === VOLUME_DA_TRANSMISSAO_PADRAO) volumes.delete(userId);
  else volumes.set(userId, limpo);
  gravar();
  for (const o of porId.get(userId) ?? []) o();
  for (const o of deQualquer) o(userId);
}

export function assinarVolumeDaTransmissao(userId: string, ouvinte: Ouvinte): () => void {
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
 * Qualquer transmissão mudou de volume. O consumidor é o motor de voz, que não
 * sabe de antemão quem vai transmitir e por isso não pode assinar por ID.
 * Silêncio e surdo chegam ao motor pelos caminhos que já existiam
 * (`assinarVolumeEfetivo` e `alternarSurdo`).
 */
export function assinarQualquerVolumeDaTransmissao(
  ouvinte: (userId: string) => void,
): () => void {
  deQualquer.add(ouvinte);
  return () => {
    deQualquer.delete(ouvinte);
  };
}

/**
 * O ganho que o motor aplica ao som da tela, de 0 a 3.
 *
 * A mesma ordem de `volumeEfetivo`: **surdo** ganha de **silenciado**, que
 * ganha do **volume**. Ensurdecer continua calando tudo, a transmissão
 * incluída, sem apagar o ajuste.
 */
export function volumeEfetivoDaTransmissao(userId: string): number {
  if (lerChamada().surdo) return 0;
  if (estaSilenciado(userId)) return 0;
  return lerVolumeDaTransmissao(userId) / 100;
}

/** Só para teste — o estado é module-level. */
export function limparVolumesDaTransmissao(): void {
  volumes.clear();
}
