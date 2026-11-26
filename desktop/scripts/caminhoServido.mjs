import { resolve, sep } from "node:path";

/**
 * Traduz a URL de um pedido no arquivo que o servidor local da casca serve,
 * ou `undefined` quando o pedido não pode ser servido.
 *
 * ⚠ **`resolve` + prefixo com separador, e não `join` + `startsWith(raiz)`.**
 * O prefixo sem separador aceitaria `dist-outra/` como se fosse `dist/`, e a
 * checagem guardada numa variável não era reconhecida como guarda. Aqui o
 * caminho resolvido precisa SER a raiz ou estar abaixo dela.
 *
 * `decodeURIComponent` lança com `%` malformado: sem o `try`, um pedido como
 * `/%E0%A4%A` derrubava o servidor inteiro.
 *
 * @param {string} raiz pasta servida, absoluta
 * @param {string | undefined} url `req.url`
 * @returns {{ caminho: string, arquivo: string } | undefined}
 */
export function arquivoServido(raiz, url) {
  let caminho;
  try {
    caminho = decodeURIComponent((url ?? "/").split("?")[0]);
  } catch {
    return undefined;
  }
  if (caminho.includes("\0")) return undefined;

  const base = resolve(raiz);
  const arquivo = resolve(base, `.${sep}${caminho}`);
  if (arquivo !== base && !arquivo.startsWith(base + sep)) return undefined;
  return { caminho, arquivo };
}
