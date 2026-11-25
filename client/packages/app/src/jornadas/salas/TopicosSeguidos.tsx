import { useCanalAtivo, useChannel, useTopico } from "nucleo/store/hooks";
import { abrirTexto } from "nucleo/store/ultimoLugar";
import { memo } from "react";

import { topicos } from "../../textos";
import { ItemDeSala } from "../../ui/ds";
import css from "./TopicosSeguidos.module.css";

/**
 * Um tópico seguido, sob o canal pai: o mesmo item de canal da coluna, só que
 * recuado. Tópico É canal no protocolo — por isso o contador de não-lidas vem do
 * snapshot de canal, e o nome do snapshot de tópico. Assina os dois por ID e nada
 * mais: alguém responder num tópico acorda esta linha, não a coluna.
 */
const TopicoSeguido = memo(function TopicoSeguido({ serverId, id }: { serverId: string; id: string }) {
  const topico = useTopico(id);
  const canal = useChannel(id);
  const ativo = useCanalAtivo() === id;
  if (!topico) return null;
  const silenciado = canal?.silenciado ?? false;
  return (
    <li>
      <ItemDeSala
        tipo="canal"
        nome={topico.nome}
        selecionado={ativo}
        naoLida={(canal?.naoLidas ?? 0) > 0 && !silenciado}
        mencoes={silenciado ? 0 : (canal?.mencoes ?? 0)}
        onClick={() => {
          abrirTexto(serverId, id);
        }}
      />
    </li>
  );
});

/** Os tópicos seguidos (e ativos) de um canal, aninhados logo abaixo dele. */
export function TopicosSeguidos({
  serverId,
  nomeDoCanal,
  ids,
}: {
  serverId: string;
  nomeDoCanal: string;
  ids: readonly string[];
}) {
  if (ids.length === 0) return null;
  return (
    <ul className={css.aninhados} aria-label={topicos.seguidos.rotulo(nomeDoCanal)} data-testid="topicos-seguidos">
      {ids.map((id) => (
        <TopicoSeguido key={id} serverId={serverId} id={id} />
      ))}
    </ul>
  );
}
