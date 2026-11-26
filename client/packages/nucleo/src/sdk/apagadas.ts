/**
 * Mensagens apagadas DURANTE a sessão, por ID.
 *
 * O snapshot de `messages` FICA depois do `messageDelete` (é a regra de toda
 * entity store: quem assinava não pode ficar com `undefined` de repente no
 * meio de um render), e a lista do canal só tira o ID do índice. Quem mostra
 * uma mensagem FORA da lista — o card de origem de um tópico — continuaria
 * exibindo o texto apagado. Este store diz "esta sumiu", e só isso.
 *
 * Uma entidade por ID (lei nº 1): apagar uma mensagem acorda só quem a
 * assina. Ausente = nunca soube que foi apagada; `true` = foi.
 *
 * Os ouvintes entram no primeiro import, como `assinarMetaDeCanal`: o card
 * pode montar antes de o adapter ligar, e a exclusão não espera ninguém.
 */
import { client } from "./client";
import { createEntityStore } from "../store/entities";

export const mensagensApagadas = createEntityStore<true>();

/** Marca como apagada. Exposto para o adapter de testes e para a exclusão otimista. */
export function marcarApagada(id: string): void {
  if (mensagensApagadas.peek(id) === undefined) mensagensApagadas.set(id, true);
}

export function foiApagada(id: string): boolean {
  return mensagensApagadas.peek(id) === true;
}

client.on("messageDelete", (message) => {
  marcarApagada(message.id);
});

client.on("messageDeleteBulk", (lista) => {
  for (const message of lista) marcarApagada(message.id);
});
