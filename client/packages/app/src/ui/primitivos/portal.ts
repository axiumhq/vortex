import { useSyncExternalStore } from "react";

/**
 * Onde um portal do Radix deve nascer.
 *
 * O padrão é o `body`. Em tela cheia o que fica no `body` sai da árvore
 * visível: o menu de quem assiste abria e ninguém via. O container é o
 * elemento que está em tela cheia agora. Fora dela, `undefined` devolve o
 * portal ao `body`.
 *
 * ⚠ A leitura é assinada. O menu pode montar antes da tela cheia, e o Radix
 * não troca o container sozinho.
 */
const XHTML = "http://www.w3.org/1999/xhtml";

export function recipienteDoPortal(): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;
  const el = document.fullscreenElement;
  /*
    Namespace e não `instanceof HTMLElement`: o `document` do teste é o do
    jsdom e o construtor global não é o mesmo realm. SVG em tela cheia fica
    de fora: o portal do Radix pede um elemento HTML.
  */
  if (el === null || el === undefined || el.namespaceURI !== XHTML) return undefined;
  return el as HTMLElement;
}

function assinarTelaCheia(ouvinte: () => void): () => void {
  document.addEventListener("fullscreenchange", ouvinte);
  return () => document.removeEventListener("fullscreenchange", ouvinte);
}

export function useRecipienteDePortal(): HTMLElement | undefined {
  return useSyncExternalStore(assinarTelaCheia, recipienteDoPortal, () => undefined);
}
