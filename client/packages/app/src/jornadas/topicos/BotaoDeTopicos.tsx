import { useTemTopicos } from "nucleo/store/hooks";

import { topicos } from "../../textos";
import { Botao } from "../../ui/ds";
import { Topicos } from "../../ui/icones";
import { abrirTopicosDoCanal, fecharTopicosDevolvendoFoco, usePainelDeTopicos } from "./hooks";

/**
 * O botão de tópicos do cabeçalho do canal. Só existe com a função anunciada
 * pelo servidor: um servidor Stoat puro não sabe listar tópicos, e botão que
 * ele não sabe atender é o defeito que o app evita.
 */
export function BotaoDeTopicos({ canalId }: { canalId: string }) {
  const temTopicos = useTemTopicos();
  const estado = usePainelDeTopicos();
  if (!temTopicos) return null;
  const aberto = estado.aberto && estado.channelId === canalId;
  return (
    <Botao
      variante="fantasma"
      tamanho="sm"
      icone={<Topicos />}
      aria-label={topicos.botao}
      aria-pressed={aberto}
      title={topicos.botao}
      data-topicos-gatilho=""
      onClick={() => {
        if (aberto) fecharTopicosDevolvendoFoco();
        else abrirTopicosDoCanal(canalId);
      }}
    />
  );
}
