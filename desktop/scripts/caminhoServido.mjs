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
 * `arquivo` (já passado por `resolve`) está ABAIXO de `raiz`. A própria raiz
 * não conta: ela é uma pasta, e quem chama a troca pelo `index.html` antes.
 *
 * ⚠ **Prefixo COM separador.** `startsWith(raiz)` sozinho aceitaria
 * `dist-outra/` como se fosse `dist/`. E a guarda é UMA comparação, sem
 * `||`: com um segundo ramo o CodeQL deixa de reconhecê-la como guarda.
 *
 * @param {string} raiz absoluta e resolvida
 * @param {string} arquivo absoluto e resolvido
 */
export function dentroDe(raiz, arquivo) {
  return arquivo.startsWith(raiz + sep);
}
