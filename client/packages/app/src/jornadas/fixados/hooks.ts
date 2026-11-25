import { fecharBusca, lerBusca } from "nucleo/store/busca";
import {
  abrirFixados,
  assinarFixados,
  fecharFixados,
  lerFixados,
  type EstadoDeFixados,
} from "nucleo/store/fixados";
import { fecharPainelDeTopicos, lerPainelDeTopicos } from "nucleo/store/painelDeTopicos";
import { useSyncExternalStore } from "react";

import { devolverFoco, lembrarOrigemDoFoco } from "../busca/foco";

/** O estado do painel de fixados. Referência cacheada no store (nunca montada no getter). */
export function useFixados(): EstadoDeFixados {
  return useSyncExternalStore(assinarFixados, lerFixados);
}

/**
 * Abre as fixadas deste canal. Busca e fixados dividem a gaveta: abrir um fecha
 * o outro. A origem do foco só é lembrada quando nenhum dos dois estava aberto —
 * senão ela seria o botão de dentro do painel que está saindo, e fechar não
 * devolveria o foco a quem o tinha de fato.
 */
export function abrirFixadosDoCanal(canalId: string): void {
  if (!lerBusca().aberta && !lerFixados().aberto && !lerPainelDeTopicos().aberto) lembrarOrigemDoFoco();
  fecharBusca();
  fecharPainelDeTopicos();
  abrirFixados(canalId);
}

/** Fecha e devolve o foco (ao que o tinha, ou ao botão de fixados do cabeçalho). */
export function fecharFixadosDevolvendoFoco(): void {
  fecharFixados();
  devolverFoco("[data-fixados-gatilho]");
}
