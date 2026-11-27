/**
 * ULID como CURSOR — as duas contas que a leitura e a busca precisam.
 *
 * O protocolo ordena mensagem por `_id`, e `_id` é ULID: dez caracteres de
 * tempo em Crockford base32 seguidos de dezesseis de aleatório. Comparar duas
 * strings é comparar dois instantes, e é isso que permite duas coisas sem
 * campo novo nenhum:
 *
 * - **Marcar como não lida** grava o cursor de leitura NUMA mensagem anterior.
 *   Quando a anterior não está carregada, o cursor é o ULID imediatamente
 *   abaixo — `ulidAnterior` —, que o servidor aceita porque o `ack` não confere
 *   se a mensagem existe.
 * - **Filtro de data na busca** vira `before`/`after`, que a rota já aceita:
 *   `ulidDoInstante` dá o menor ULID de um milissegundo.
 *
 * ⚠ **Sem a biblioteca `ulid`, e a ausência é deliberada.** Ela gera ULID
 * aleatório e decodifica tempo; nenhuma das duas contas daqui — decrementar e
 * zerar o aleatório — ela expõe, e escrevê-las por cima de `encodeTime`
 * dependeria de o alfabeto dela ser o mesmo que o do servidor. Aqui o alfabeto
 * está escrito, e o teste o confere contra um ULID do protocolo.
 */

const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TAMANHO = 26;
const TEMPO = 10;

/** É um ULID que o servidor aceitaria: 26 caracteres do alfabeto Crockford. */
export function ehUlid(id: string): boolean {
  if (id.length !== TAMANHO) return false;
  for (const c of id) if (!ALFABETO.includes(c)) return false;
  return true;
}

/**
 * O ULID imediatamente ANTERIOR — o maior que ainda é menor que `id`.
 *
 * Decremento com empréstimo, da direita para a esquerda, como numa subtração
 * de papel: `…01` vira `…00`, `…10` vira `…0Z`. `undefined` para o menor ULID
 * possível e para o que não é ULID — um cursor inventado a partir de lixo
 * mandaria o `ack` para um instante que ninguém escolheu.
 */
export function ulidAnterior(id: string): string | undefined {
  if (!ehUlid(id)) return undefined;

  const digitos = [...id];
  for (let i = digitos.length - 1; i >= 0; i--) {
    const valor = ALFABETO.indexOf(digitos[i] ?? "");
    if (valor > 0) {
      digitos[i] = ALFABETO[valor - 1] ?? "0";
      return digitos.join("");
    }
    digitos[i] = ALFABETO[ALFABETO.length - 1] ?? "Z";
  }
  return undefined;
}

/**
 * O MENOR ULID de um instante: o tempo codificado e o aleatório zerado.
 *
 * É a fronteira certa nos dois sentidos: toda mensagem gerada naquele
 * milissegundo ou depois é `>=` a ela, e toda anterior é `<`. `undefined` fora
 * do intervalo de 48 bits que o ULID representa.
 */
export function ulidDoInstante(ms: number): string | undefined {
  if (!Number.isFinite(ms) || ms < 0 || ms > 2 ** 48 - 1) return undefined;

  let resto = Math.floor(ms);
  let tempo = "";
  for (let i = 0; i < TEMPO; i++) {
    tempo = (ALFABETO[resto % 32] ?? "0") + tempo;
    resto = Math.floor(resto / 32);
  }
  return tempo + "0".repeat(TAMANHO - TEMPO);
}

/** O instante em milissegundos codificado nos 10 primeiros caracteres do ULID, ou `undefined`. */
export function instanteDoUlid(id: string): number | undefined {
  if (!ehUlid(id)) return undefined;
  let ms = 0;
  for (let i = 0; i < TEMPO; i++) {
    const valor = ALFABETO.indexOf(id[i] ?? "");
    if (valor < 0) return undefined;
    ms = ms * 32 + valor;
  }
  return ms;
}
