import { count } from "nucleo/arnes/stats";
import { lerAparencia } from "nucleo/store/aparencia";
import { lerDensidade, type Densidade } from "nucleo/store/densidade";

/**
 * Estimativa de altura de linha, por TIPO. Medida, não chutada.
 *
 * Linha de sistema é uma frase curta; a que abre grupo carrega avatar, nome e
 * hora; a continuação é só o corpo. Estimar as três pelo mesmo número faz a
 * barra de rolagem errar na proporção de cada tipo, e erro de estimativa é o
 * que desengata o `followOnAppend` (lição do spike: a lista passa a derivar e o
 * gate mede uma lista parada).
 *
 * Os números saem do relatório do arnês (`/dev`), que reporta a altura real
 * partida por tipo. A ordem inversa (escrever a constante e conferir depois) é
 * como um `estimateSize: 44` sobreviveu três fases no `client`. Dependem da
 * LARGURA da coluna: medidos a 1600x900 (coluna de leitura de ~850px), 10k mensagens
 * do firehose: 96,1px abre grupo, 77,3px continua, 34,1px sistema.
 */
export const ALTURA_POR_TIPO = {
  sistema: 34,
  abreGrupo: 96,
  continua: 77,
} as const;

export type TipoDeLinha = keyof typeof ALTURA_POR_TIPO;

/**
 * A mesma estimativa por DENSIDADE. A compacta não tem avatar e tem menos respiro,
 * mas o corpo da mensagem é quem manda na altura: medido nas MESMAS linhas, ela encolhe
 * só ~9% a linha que abre grupo e ~6,5% a continuação (a linha de sistema não muda).
 * Estimar com os números da confortável faria a barra de rolagem errar na proporção
 * de cada tipo e a âncora derivar ao trocar de densidade.
 */
export const ALTURA_POR_DENSIDADE: Readonly<Record<Densidade, Readonly<Record<TipoDeLinha, number>>>> = {
  confortavel: ALTURA_POR_TIPO,
  compacto: { sistema: 34, abreGrupo: 87, continua: 72 },
};

/**
 * Quanto a altura acompanha o tamanho do texto, medido nas mesmas linhas a 90% e a 125%.
 * Texto maior quebra em mais linhas, então a altura sobe MAIS que a escala (125% dá ~1,35×);
 * a 90% o ganho é menor (~0,915×). A linha de sistema é uma frase curta com respiro fixo.
 */
function fatorDeTexto(tipo: TipoDeLinha, texto: number): number {
  const e = texto / 100 - 1;
  if (tipo === "sistema") return 1 + e * 0.6;
  return 1 + e * (e >= 0 ? 1.4 : 0.85);
}

/** A altura estimada de um tipo de linha na densidade e no tamanho de texto (%) dados. */
export function alturaDoTipo(tipo: TipoDeLinha, densidade: Densidade, texto: number): number {
  return Math.round(ALTURA_POR_DENSIDADE[densidade][tipo] * fatorDeTexto(tipo, texto));
}

/** Piso de quem ainda não foi resolvido. Nunca zero: zero realimenta a medição. */
export const ALTURA_ESTIMADA = 80;

/** O divisor de dia vive dentro da linha que abre o dia. */
export const ALTURA_DO_DIVISOR = 32;

/** O divisor de "novas mensagens" também vive dentro da linha. */
export const ALTURA_DO_DIVISOR_DE_NOVAS = 36;

/** A prévia da resposta, irmã da linha: uma linha de 18px mais o respiro de cima. */
export const ALTURA_DA_CITACAO = 22;

/** A fileira de reações sob o corpo: chip de 24px mais o respiro. */
export const ALTURA_DAS_REACOES = 28;

/**
 * A caixa da enquete sob o corpo: uma parte fixa (respiro, cabeçalho, pergunta
 * de uma linha, rodapé) e uma por resposta. Medida no navegador, não chutada:
 * `EnqueteDaMensagem.browser.test.tsx` compara esta conta com a caixa real.
 * A pergunta longa que quebra em duas linhas erra para menos, como o anexo
 * erra para menos numa legenda longa.
 */
export const ALTURA_DA_ENQUETE = { fixa: 116, porResposta: 52 } as const;

export function alturaDaEnquete(respostas: number): number {
  return ALTURA_DA_ENQUETE.fixa + ALTURA_DA_ENQUETE.porResposta * respostas;
}

/** A linha de estado de envio ("Enviando…", "Não foi enviada"). */
export const ALTURA_DO_ESTADO_DE_ENVIO = 22;

/** Quão perto do topo (px) a lista pede a página anterior do histórico. */
export const LIMIAR_DE_PAGINACAO = 600;

/** Quão longe do fim (px) aparece o atalho "Ir para as mensagens recentes". */
export const LIMIAR_DE_LONGE = 800;

/** Quão longe do fim ainda conta como "no fim". Um número para os dois lados concordarem. */
export const LIMIAR_DE_FIM = 80;

const AVISADO = new Set<string>();

/** Soma e contagem por (densidade, tamanho de texto, tipo): trocar de ajuste não mistura médias. */
const AMOSTRAS = new Map<string, { soma: number; n: number }>();

function conferir(tipo: TipoDeLinha, media: number, densidade: Densidade, texto: number) {
  const chave = `${densidade}|${String(texto)}|${tipo}`;
  if (AVISADO.has(chave)) return;
  const esperada = alturaDoTipo(tipo, densidade, texto);
  const erro = Math.abs(media - esperada) / esperada;
  if (erro < 0.15) return;
  AVISADO.add(chave);
  console.error(
    `[vortex] a estimativa de altura da linha "${tipo}" (${densidade}, texto ${String(texto)}%) está a ` +
      `${(erro * 100).toFixed(0)}% do real: estima ${String(esperada)}px, mede ${media.toFixed(1)}px. ` +
      `A linha mudou de forma. Estimativa errada não quebra nada, só faz a barra de rolagem mentir sobre o histórico.`,
  );
}

/**
 * Soma a altura medida de uma linha ao relatório do arnês e, em dev, confere a
 * estimativa do tipo contra a média (com amostra suficiente para ela significar
 * algo), na densidade e no tamanho de texto em uso. Linhas com divisor de dia ficam
 * fora: a constante descreve a linha sem ele.
 */
export function amostrarAltura(tipo: TipoDeLinha, altura: number, comDivisor: boolean) {
  if (altura <= 0) return;
  count("alturaSoma", altura);
  count("alturaAmostras");
  if (comDivisor) return;
  if (tipo === "sistema") {
    count("alturaSistemaSoma", altura);
    count("alturaSistemaAmostras");
  } else if (tipo === "abreGrupo") {
    count("alturaGrupoSoma", altura);
    count("alturaGrupoAmostras");
  } else {
    count("alturaContinuaSoma", altura);
    count("alturaContinuaAmostras");
  }
  if (import.meta.env.DEV) {
    const densidade = lerDensidade();
    const texto = lerAparencia().texto;
    const chave = `${densidade}|${String(texto)}|${tipo}`;
    const a = AMOSTRAS.get(chave) ?? { soma: 0, n: 0 };
    a.soma += altura;
    a.n += 1;
    AMOSTRAS.set(chave, a);
    if (a.n > 200) conferir(tipo, a.soma / a.n, densidade, texto);
  }
}

/** Soma real e estimada do bloco de embeds, por (densidade, tamanho de texto). */
const AMOSTRAS_DE_EMBED = new Map<string, { real: number; estimada: number; n: number }>();
let embedAvisado = false;

/**
 * A prévia de link chega DEPOIS do envio e muda a altura da linha. A constante do tipo
 * descreve a linha sem ela; o bloco de embeds tem estimativa própria (`alturaDeEmbeds`,
 * calculada do metadata) e é conferida aqui, à parte: a média de uma linha com cartão
 * não pode contaminar a do tipo, nem a do tipo esconder um cartão que mudou de forma.
 *
 * `real` é a altura MEDIDA do bloco (respiro de cima incluído), não a da linha menos
 * uma constante: a linha varia com o texto e o ruído esconderia o cartão. Em dev, se a
 * média real sair 20% da estimada (com amostra suficiente), avisa.
 */
export function amostrarAlturaDeEmbeds(real: number, estimada: number) {
  if (real <= 0 || estimada <= 0) return;
  count("alturaComEmbedSoma", real);
  count("alturaComEmbedAmostras");
  if (!import.meta.env.DEV || embedAvisado) return;
  const chave = `${lerDensidade()}|${String(lerAparencia().texto)}`;
  const a = AMOSTRAS_DE_EMBED.get(chave) ?? { real: 0, estimada: 0, n: 0 };
  a.real += real;
  a.estimada += estimada;
  a.n += 1;
  AMOSTRAS_DE_EMBED.set(chave, a);
  if (a.n <= 30) return;
  const erro = Math.abs(a.real - a.estimada) / a.estimada;
  if (erro < 0.2) return;
  embedAvisado = true;
  console.error(
    `[vortex] a estimativa de altura dos embeds está a ${(erro * 100).toFixed(0)}% do real: ` +
      `estima ${(a.estimada / a.n).toFixed(0)}px, mede ${(a.real / a.n).toFixed(0)}px por linha. ` +
      `O cartão mudou de forma: remeça \`caixaDoEmbed.ts\`. Estimativa errada não quebra nada, só faz a barra de rolagem mentir.`,
  );
}
