import { chaveDeMembro } from "nucleo/sdk/domain";
import { carregarTopicosDoCanal } from "nucleo/sdk/topicos";
import { useForum, useMessage, useNomeDoMembro, useTopico } from "nucleo/store/hooks";
import { useEffect, useState } from "react";

import { chat, topico as textos } from "../../textos";
import { AvatarDoAutor } from "../chat/AvatarDoAutor";
import { CorpoDaMensagem } from "../chat/CorpoDaMensagem";
import css from "./Topico.module.css";

/**
 * A mensagem que iniciou o tópico, como card no TOPO da lista do tópico.
 *
 * Rola junto, não gruda: entra como `topo` da `ListaDeMensagens`, no fluxo do
 * scroller. Subir na conversa mostra o contexto em vez de travá-lo no alto.
 *
 * A origem mora no canal PAI. Vem do store de mensagens quando já foi
 * carregada (formatada como na linha) e, senão, da listagem de tópicos do pai,
 * que traz o texto cru. "Apagada" só é dito quando a listagem RESPONDEU e não
 * a trouxe: sem rede, não saber não vira afirmação.
 *
 * Só tópico de MENSAGEM tem card. Num post de fórum a abertura é a primeira
 * mensagem de dentro, e o card a repetiria logo acima dela.
 */
export function RaizDoTopico({ topicoId, servidorId }: { topicoId: string; servidorId: string }) {
  const t = useTopico(topicoId);
  const forum = useForum(t?.paiId ?? "");
  const origem = useMessage(t?.aberturaId ?? "");
  const autorId = origem?.authorId ?? t?.abertura?.autorId ?? t?.donoId;
  const nome = useNomeDoMembro(chaveDeMembro(servidorId, autorId ?? "")) ?? chat.autorDesconhecido;
  const paiId = t?.paiId;
  const [listagem, setListagem] = useState<{ paiId: string; ok: boolean } | undefined>();

  // A listagem do pai (ativos e arquivados) traz a abertura que o histórico ainda não trouxe.
  useEffect(() => {
    if (paiId === undefined) return;
    let vivo = true;
    void carregarTopicosDoCanal(paiId).then((ok) => {
      if (vivo) setListagem({ paiId, ok });
    });
    return () => {
      vivo = false;
    };
  }, [paiId]);

  if (!t || forum !== null) return null;

  const listou = listagem?.paiId === t.paiId && listagem.ok;
  const apagada = t.aberturaId === undefined || (origem === undefined && t.abertura === undefined && listou);

  return (
    <article className={css.raiz} aria-label={textos.origem.rotulo} data-raiz-do-topico="">
      {apagada ? (
        <p className={css.apagada}>{textos.origem.apagada}</p>
      ) : (
        <div className={css.origem}>
          <AvatarDoAutor servidorId={servidorId} autorId={autorId} nome={nome} />
          <div className={css.conteudoDaOrigem}>
            <p className={css.autoria}>
              <span className={css.autor}>{nome}</span>
              <span className={css.iniciou}>{textos.origem.iniciou}</span>
            </p>
            {origem !== undefined ? (
              <CorpoDaMensagem blocos={origem.blocos} servidorId={servidorId} />
            ) : (
              t.abertura !== undefined && <p className={css.textoCru}>{t.abertura.texto}</p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
