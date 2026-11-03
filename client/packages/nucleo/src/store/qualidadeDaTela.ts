import {
  ALTURA_DE,
  RESOLUCOES,
  TAXAS,
  type Resolucao,
  type Taxa,
} from "../sdk/seletorDeTela";

/**
 * A qualidade escolhida para a transmissão em curso.
 *
 * ⚠ **Os DEGRAUS moram aqui e não no motor, e a razão é o bundle.** Quem
 * precisa da lista para DESENHAR é o HUD do palco; quem precisa dela para
 * APLICAR é `sdk/motorDeVoz.ts`, que carrega meio megabyte de WebRTC e por
 * isso só entra por `await import()`. Com a lista lá, o HUD a importaria e
 * arrastaria o LiveKit para o grafo estático. `sdk/seletorDeTela.ts` não
 * importa LiveKit, e é de lá que os dois eixos vêm — são os MESMOS do painel
 * de escolher a fonte, e uma segunda lista divergiria na primeira mudança.
 *
 * ⚠ **Dois eixos, e não uma lista de combinações.** O HUD tinha quatro degraus
 * fixos (1080p60, 1080p30, 720p30, 480p30): sem 1440p, sem a resolução da
 * fonte, e com 720p a 60 fps impossível de pedir. O design e o painel de
 * escolha já separavam resolução de taxa; o HUD agora também.
 *
 * ⚠ **Guarda o que foi PEDIDO, e não o que a fonte entrega.** Pedir 1080p de
 * uma janela de 900px devolve 900, e quem responde "o que está no ar" é
 * `qualidadeRealDaTela()`, que mede.
 */

export { RESOLUCOES, TAXAS, type Resolucao, type Taxa };

export interface QualidadeDaTela {
  readonly resolucao: Resolucao;
  readonly taxa: Taxa;
}

/**
 * O que a transmissão pede quando ninguém escolheu nada.
 *
 * ⚠ **30 fps, e não os 15 que saíam antes.** Sem codificação explícita o
 * LiveKit publica tela com `ScreenSharePresets.h1080fps15`: o codificador
 * travava em 15 quadros e 2,5 Mbps, e nenhuma escolha de captura passava
 * disso. É a "tela travada" que quem assiste percebe primeiro.
 */
export const QUALIDADE_PADRAO: QualidadeDaTela = {
  resolucao: "1080p",
  taxa: 30,
};

export function rotuloDaQualidade(q: QualidadeDaTela): string {
  return `${q.resolucao} · ${String(q.taxa)} fps`;
}

/**
 * As constraints de uma escolha, prontas para `applyConstraints`.
 *
 * ⚠ **`ideal` e NUNCA `exact`.** Com `exact`, uma tela de 1366×768 recusaria
 * 1080p com `OverconstrainedError` — e o erro chegaria como "não deu para
 * trocar" numa escolha que o navegador teria atendido em 768p de bom grado.
 *
 * ⚠ **"Fonte" não leva altura nenhuma.** `applyConstraints` SUBSTITUI o
 * conjunto inteiro, então omitir a altura é o que tira o teto que uma escolha
 * anterior tinha posto.
 */
export function constraintsDe(q: QualidadeDaTela): MediaTrackConstraints {
  const altura = ALTURA_DE[q.resolucao];
  return {
    ...(altura === undefined ? {} : { height: { ideal: altura } }),
    frameRate: { ideal: q.taxa },
  };
}

/**
 * Banda de upload, em kbps, por resolução e taxa.
 *
 * Os degraus de 15 e 30 partem dos presets de tela do próprio LiveKit
 * (`h720fps15` 1,5 Mbps · `h1080fps15` 2,5 · `h1080fps30` 5); 60 fps e 1440p
 * sobem na mesma proporção. O design escreve "~8 Mbps de upload" para 1440p ou
 * 60 fps, e é onde a tabela cai.
 *
 * "Fonte" pode ser 4K, e ganha um degrau acima de 1440p.
 */
const KBPS: Record<Resolucao, Record<Taxa, number>> = {
  "720p": { 15: 1_500, 30: 2_500, 60: 4_000 },
  "1080p": { 15: 2_500, 30: 5_000, 60: 8_000 },
  "1440p": { 15: 4_000, 30: 8_000, 60: 12_000 },
  Fonte: { 15: 6_000, 30: 10_000, 60: 16_000 },
};

/**
 * O que o CODIFICADOR pode gastar numa escolha.
 *
 * ⚠ **Sem isto a escolha de taxa não chega a quem assiste.** A captura
 * entrega 60 quadros e o codificador, publicado com `maxFramerate: 15`, joga
 * fora três de cada quatro. Constraint de captura e parâmetro de envio são
 * duas travas diferentes, e as duas precisam ser abertas.
 */
export function codificacaoDe(q: QualidadeDaTela): {
  maxBitrate: number;
  maxFramerate: number;
} {
  return { maxBitrate: KBPS[q.resolucao][q.taxa] * 1000, maxFramerate: q.taxa };
}

/**
 * 30 fps já pede movimento. O padrão da transmissão é 1080p30, e `detail`
 * nessa taxa segura texto e entrega poucos quadros. 15 fps continua em
 * detalhe: aí a nitidez é o que a pessoa escolheu.
 */
export function pedeMovimento(q: QualidadeDaTela): boolean {
  return q.taxa >= 30;
}

/**
 * `undefined` = nenhuma transmissão sua em curso.
 *
 * Guardado como referência estável: `getSnapshot` não pode alocar.
 */
let escolhida: QualidadeDaTela | undefined;

const ouvintes = new Set<() => void>();

export function assinarQualidadeDaTela(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function qualidadeEscolhida(): QualidadeDaTela | undefined {
  return escolhida;
}

export function definirQualidadeEscolhida(q: QualidadeDaTela | undefined): void {
  /* Por CAMPO: quem chama monta o objeto no clique, e por referência um
     clique na opção já marcada acordaria o menu à toa. */
  if (
    escolhida === q ||
    (escolhida !== undefined &&
      q !== undefined &&
      escolhida.resolucao === q.resolucao &&
      escolhida.taxa === q.taxa)
  ) {
    return;
  }
  escolhida = q;
  for (const o of ouvintes) o();
}

/**
 * Sair da transmissão esquece a escolha: a próxima é de OUTRA fonte, e o HUD
 * abriria marcando algo que a faixa nova nunca recebeu.
 */
export function esquecerQualidadeDaTela(): void {
  definirQualidadeEscolhida(undefined);
}
