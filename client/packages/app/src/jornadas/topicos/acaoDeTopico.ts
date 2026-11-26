import { pode } from "nucleo/sdk/permissoes";
import { podeAbrirTopico } from "nucleo/sdk/topicos";
import { useTemTopicos, useTopicoDaMensagem } from "nucleo/store/hooks";

import { abrirOuCriarTopico } from "./acoes";

export type AcaoDeTopico = { readonly aberto: boolean; readonly executar: () => void };

/**
 * A ação de tópico de uma mensagem, ou `undefined` quando ela não existe.
 *
 * Três portões: o servidor anuncia tópicos, o canal aceita tópico (texto de
 * servidor, que não é tópico nem fórum) e, para CRIAR, a pessoa pode escrever
 * no canal. Abrir um tópico que já existe é leitura, e não pede o terceiro.
 *
 * Assina só o índice desta mensagem (por ID) e a função do servidor: abrir um
 * tópico noutra mensagem não acorda esta linha.
 */
export function useAcaoDeTopico(
  mensagemId: string,
  canalId: string | undefined,
  elegivel: boolean,
): AcaoDeTopico | undefined {
  const temTopicos = useTemTopicos();
  const indexado = useTopicoDaMensagem(mensagemId);
  if (!temTopicos || !elegivel || canalId === undefined || !podeAbrirTopico(canalId)) return undefined;
  const aberto = indexado !== undefined;
  if (!aberto && !pode(canalId, "enviar")) return undefined;
  return {
    aberto,
    executar: () => {
      abrirOuCriarTopico(canalId, mensagemId);
    },
  };
}
