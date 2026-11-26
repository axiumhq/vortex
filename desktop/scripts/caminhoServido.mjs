import { sep } from "node:path";

/**
 * O caminho decodificado de `req.url`, sem a querystring, ou `undefined`
 * quando não dá para servi-lo.
 *
 * `decodeURIComponent` lança com `%` malformado: sem o `try`, um pedido como
 * `/%E0%A4%A` derrubava o servidor inteiro.
 *
 * @param {string | undefined} url
 * @returns {string | undefined}
 */
export function caminhoDoPedido(url) {
  let caminho;
  try {
    caminho = decodeURIComponent((url ?? "/").split("?")[0]);
  } catch {
    return undefined;
  }
  if (caminho.includes("\0")) return undefined;
  return caminho;
}

/**
 * `arquivo` (já passado por `resolve`) é a própria `raiz` ou está abaixo dela.
 *
 * ⚠ **Prefixo COM separador.** `startsWith(raiz)` sozinho aceitaria
 * `dist-outra/` como se fosse `dist/`.
 *
 * @param {string} raiz absoluta e resolvida
 * @param {string} arquivo absoluto e resolvido
 */
export function dentroDe(raiz, arquivo) {
  return arquivo === raiz || arquivo.startsWith(raiz + sep);
}
