import { carregarTopicosDoCanal, podeAbrirTopico } from "nucleo/sdk/topicos";
import { useTemTopicos, useTopico } from "nucleo/store/hooks";
import { useEffect } from "react";

import { topico as textos } from "../../textos/topico";
import { useAtalhoDeBusca } from "../busca/hooks";
import { AreaDeChat } from "../chat/AreaDeChat";
import { AreaDoCanal } from "../chat/CabecalhoDoCanal";
import { CabecalhoDeTopico } from "./CabecalhoDeTopico";
import { RaizDoTopico } from "./RaizDoTopico";
import css from "./Topico.module.css";

/**
 * Um tópico aberto na área principal, no lugar do canal: cabeçalho próprio, a
 * mensagem de origem no topo da lista e a conversa de sempre embaixo — tópico
 * é canal, então lista, digitação e composer são os mesmos do canal.
 *
 * ⚠ **Arquivado não tira o composer.** O servidor REABRE o tópico quando
 * alguém responde (`message_send.rs`), então trocar o campo por uma frase
 * esconderia uma ação que funciona. A frase vai acima do campo e diz o que
 * responder faz.
 */
export function AreaDoTopico({ topicoId, servidorId }: { topicoId: string; servidorId: string }) {
  useAtalhoDeBusca(topicoId, servidorId);
  const arquivado = useTopico(topicoId)?.arquivado === true;
  return (
    <div className={css.area} data-topico-aberto={topicoId}>
      <CabecalhoDeTopico topicoId={topicoId} />
      <div className={css.chat}>
        <AreaDeChat
          canalId={topicoId}
          servidorId={servidorId}
          topo={<RaizDoTopico topicoId={topicoId} servidorId={servidorId} />}
          aviso={
            arquivado ? (
              <p className={css.avisoDeArquivado} role="status">
                {textos.arquivado}
              </p>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}

/**
 * O canal aberto, ou o tópico se o canal for um. A rota é a mesma
 * (`/servidor/S/canal/<id>`): o que decide a tela é o canal ter `thread`.
 */
export function AreaDoCanalOuTopico({ canalId, servidorId }: { canalId: string; servidorId: string }) {
  const ehTopico = useTopico(canalId) !== undefined;
  const temTopicos = useTemTopicos();
  /*
    Abrir um canal de texto busca os tópicos dele, ativos E arquivados. O
    `Ready` só traz os ativos: sem isto a mensagem que abriu um tópico
    arquivado não sabe que tem um, e a linha não mostra as respostas dele.
    Cache por canal no núcleo, então reabrir o canal não volta à rede.
  */
  useEffect(() => {
    if (!temTopicos || ehTopico || !podeAbrirTopico(canalId)) return;
    void carregarTopicosDoCanal(canalId);
  }, [canalId, temTopicos, ehTopico]);
  return ehTopico ? (
    <AreaDoTopico topicoId={canalId} servidorId={servidorId} />
  ) : (
    <AreaDoCanal canalId={canalId} servidorId={servidorId} />
  );
}
