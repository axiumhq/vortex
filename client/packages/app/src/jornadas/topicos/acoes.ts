import { topicoDaMensagem } from "nucleo/sdk/topicos";
import { selecionarCanal } from "nucleo/store/navegacao";

import { pedirRetorno } from "../chat/saltos";

/**
 * O que abre e fecha um tópico, fora de qualquer componente.
 *
 * Um tópico é um canal (de texto, com `thread`): abrir é selecionar o canal
 * dele, e a área principal troca a conversa do pai pela do tópico. A URL vem
 * junto (`/servidor/S/canal/<tópico>`), então o tópico já tem endereço sem
 * rota nova.
 */

/** A mensagem cujo tópico está sendo criado — o diálogo de nome lê isto. */
export type AlvoDoDialogo = { readonly canalId: string; readonly mensagemId: string };

let alvo: AlvoDoDialogo | null = null;
const ouvintes = new Set<() => void>();

function definir(novo: AlvoDoDialogo | null): void {
  if (novo === alvo) return;
  alvo = novo;
  for (const ouvinte of ouvintes) ouvinte();
}

export function assinarDialogoDeTopico(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function lerDialogoDeTopico(): AlvoDoDialogo | null {
  return alvo;
}

export function fecharDialogoDeTopico(): void {
  definir(null);
}

/** Abre o tópico na área principal, no lugar do canal. */
export function abrirTopico(topicoId: string): void {
  selecionarCanal(topicoId);
}

/**
 * O gesto da mensagem: se ela já tem tópico, abre; senão, pergunta o nome.
 *
 * A decisão é lida NO clique (índice O(1)), e não confiada ao rótulo que a
 * barra mostrava: alguém pode ter aberto o tópico entre o render e o clique.
 */
export function abrirOuCriarTopico(canalId: string, mensagemId: string): void {
  const existente = topicoDaMensagem(canalId, mensagemId);
  if (existente !== undefined) {
    abrirTopico(existente);
    return;
  }
  definir({ canalId, mensagemId });
}

/** Volta ao canal pai na posição em que a pessoa o deixou. */
export function voltarAoPai(paiId: string): void {
  pedirRetorno(paiId);
  selecionarCanal(paiId);
}
