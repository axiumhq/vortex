import { abrirBusca, assinarBusca, fecharBusca, lerBusca, type EstadoDeBusca } from "nucleo/store/busca";
import { fecharFixados, lerFixados } from "nucleo/store/fixados";
import { fecharPainelDeTopicos, lerPainelDeTopicos } from "nucleo/store/painelDeTopicos";
import { useEffect, useSyncExternalStore } from "react";

import { devolverFoco, ehMac, lembrarOrigemDoFoco, pedirFocoNoCampo } from "./foco";

/** O estado da busca. Referência cacheada no store (nunca montada no getter). */
export function useBusca(): EstadoDeBusca {
  return useSyncExternalStore(assinarBusca, lerBusca);
}

/**
 * Abre a busca neste canal, lembrando de onde o foco veio. Busca e fixados dividem
 * a gaveta: abrir uma fecha a outra (e então a origem do foco já está guardada).
 */
export function abrirBuscaDoCanal(canalId: string, servidorId: string): void {
  if (!lerFixados().aberto && !lerBusca().aberta && !lerPainelDeTopicos().aberto) lembrarOrigemDoFoco();
  fecharFixados();
  fecharPainelDeTopicos();
  abrirBusca(canalId, servidorId === "" ? undefined : servidorId);
}

/** Fecha e devolve o foco. */
export function fecharBuscaDevolvendoFoco(): void {
  fecharBusca();
  devolverFoco();
}

/**
 * Ctrl+F (Cmd+F no Mac) com o canal aberto: abre a busca, ou traz o foco ao campo
 * se ela já está aberta. Substitui a busca do navegador, que não enxerga as mensagens
 * que a lista virtualizada não montou — a do app enxerga o canal inteiro.
 */
export function useAtalhoDeBusca(canalId: string, servidorId: string): void {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f" || e.shiftKey || e.altKey) return;
      if (ehMac() ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      if (lerBusca().aberta && lerBusca().channelId === canalId) {
        pedirFocoNoCampo();
        return;
      }
      abrirBuscaDoCanal(canalId, servidorId);
    };
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [canalId, servidorId]);
}
