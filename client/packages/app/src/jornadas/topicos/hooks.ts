import { fecharBusca, lerBusca } from "nucleo/store/busca";
import { fecharFixados, lerFixados } from "nucleo/store/fixados";
import {
  abrirPainelDeTopicos,
  assinarPainelDeTopicos,
  fecharPainelDeTopicos,
  lerPainelDeTopicos,
  type EstadoDoPainelDeTopicos,
} from "nucleo/store/painelDeTopicos";
import { useSyncExternalStore } from "react";

import { devolverFoco, lembrarOrigemDoFoco } from "../busca/foco";

/** O estado do painel de tópicos. Referência cacheada no store (nunca montada no getter). */
export function usePainelDeTopicos(): EstadoDoPainelDeTopicos {
  return useSyncExternalStore(assinarPainelDeTopicos, lerPainelDeTopicos);
}

/**
 * Abre os tópicos deste canal. Busca, fixados e tópicos dividem a gaveta: abrir
 * um fecha os outros. A origem do foco só é lembrada quando nenhum dos três
 * estava aberto — senão ela seria um botão de dentro do painel que está saindo.
 */
export function abrirTopicosDoCanal(canalId: string): void {
  if (!lerBusca().aberta && !lerFixados().aberto && !lerPainelDeTopicos().aberto) lembrarOrigemDoFoco();
  fecharBusca();
  fecharFixados();
  abrirPainelDeTopicos(canalId);
}

/** Fecha e devolve o foco (ao que o tinha, ou ao botão de tópicos do cabeçalho). */
export function fecharTopicosDevolvendoFoco(): void {
  fecharPainelDeTopicos();
  devolverFoco("[data-topicos-gatilho]");
}
