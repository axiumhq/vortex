import { usuarioLocalId } from "nucleo/sdk/adapter";
import { pode } from "nucleo/sdk/permissoes";
import { arquivarTopico, seguirTopico } from "nucleo/sdk/topicos";
import { useChannel, useTopico } from "nucleo/store/hooks";

import { topico as textos } from "../../textos";
import { Botao } from "../../ui/ds";
import { Arquivar, Desarquivar, SetaEsquerda, Topico } from "../../ui/icones";
import { voltarAoPai } from "./acoes";
import css from "./Topico.module.css";

/**
 * O cabeçalho de um tópico aberto: `‹` (volta ao pai, na posição em que a
 * pessoa o deixou), o nome, "em #pai", seguir e arquivar.
 *
 * Mesma caixa do cabeçalho de canal (altura, recuo, fio de baixo): os dois se
 * sucedem ao entrar e sair do tópico, e um degrau ali faria a lista saltar.
 *
 * Arquivar só aparece para quem o servidor deixa: quem abriu o tópico, ou quem
 * gerencia o canal. Sem permissão o botão não existe — não fica cinza.
 */
export function CabecalhoDeTopico({ topicoId }: { topicoId: string }) {
  const t = useTopico(topicoId);
  const pai = useChannel(t?.paiId ?? "");
  if (!t) return null;

  const nomeDoPai = pai?.name;
  const podeArquivar = t.donoId === usuarioLocalId() || pode(topicoId, "gerenciarCanais");

  return (
    <header className={css.cabeca} aria-label={textos.cabecalho.rotulo}>
      <Botao
        variante="fantasma"
        tamanho="sm"
        icone={<SetaEsquerda />}
        aria-label={nomeDoPai === undefined ? textos.cabecalho.voltarSemNome : textos.cabecalho.voltar(nomeDoPai)}
        onClick={() => {
          voltarAoPai(t.paiId);
        }}
      />
      <h2 className={css.nome}>
        <Topico className={css.icone} aria-hidden="true" />
        <span className={css.texto}>{t.nome}</span>
      </h2>
      {nomeDoPai !== undefined && <p className={css.pai}>{textos.cabecalho.em(nomeDoPai)}</p>}
      <div className={css.acoes}>
        {t.arquivado && <span className={css.selo}>{textos.cabecalho.arquivado}</span>}
        {/* Nome estável e estado no `aria-pressed`; o texto visível diz o estado. */}
        <Botao
          variante={t.seguindo ? "secundario" : "fantasma"}
          tamanho="sm"
          aria-pressed={t.seguindo}
          aria-label={textos.cabecalho.seguir}
          onClick={() => {
            void seguirTopico(topicoId, !t.seguindo);
          }}
        >
          {t.seguindo ? textos.cabecalho.seguindoVisivel : textos.cabecalho.seguirVisivel}
        </Botao>
        {podeArquivar && (
          <Botao
            variante="fantasma"
            tamanho="sm"
            icone={t.arquivado ? <Desarquivar /> : <Arquivar />}
            aria-label={t.arquivado ? textos.cabecalho.reabrir : textos.cabecalho.arquivar}
            title={t.arquivado ? textos.cabecalho.reabrir : textos.cabecalho.arquivar}
            onClick={() => {
              void arquivarTopico(topicoId, !t.arquivado);
            }}
          />
        )}
      </div>
    </header>
  );
}
