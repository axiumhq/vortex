import { useTopico, useTopicoDaMensagem } from "nucleo/store/hooks";
import { selecionarCanal } from "nucleo/store/navegacao";

import { chat } from "../../textos";
import css from "./ResumoDoTopico.module.css";

/**
 * A linha "N respostas" sob a mensagem que abriu um tópico.
 *
 * Assina SÓ o próprio tópico (lei nº 1): uma resposta nova acorda este
 * componente e nenhuma outra linha. A altura é FIXA (`ALTURA_DO_RESUMO_DE_TOPICO`
 * em `alturas.ts`) e não depende da contagem, do nome nem de a contagem já ter
 * chegado: sem a contagem a linha diz "Tópico · nome" na mesma caixa.
 *
 * Mensagem sem tópico não renderiza nada, e a estimativa de altura da lista
 * lê o mesmo índice, de forma síncrona.
 */
export function ResumoDoTopico({ messageId }: { messageId: string }) {
  const topicoId = useTopicoDaMensagem(messageId);
  if (topicoId === undefined) return null;
  return <Resumo topicoId={topicoId} />;
}

function Resumo({ topicoId }: { topicoId: string }) {
  const t = useTopico(topicoId);
  const nome = t?.nome ?? "";
  const respostas = t?.respostas;
  const destaque = respostas === undefined ? chat.topico.semContagem : chat.topico.respostas(respostas);
  return (
    <button
      type="button"
      className={css.resumo}
      data-topico-resumo
      aria-label={chat.topico.abrir(nome === "" ? destaque : `${destaque} · ${nome}`)}
      onClick={() => {
        selecionarCanal(topicoId);
      }}
    >
      <span className={css.destaque}>{destaque}</span>
      {nome !== "" && <span className={css.nome}>{`· ${nome}`}</span>}
    </button>
  );
}
