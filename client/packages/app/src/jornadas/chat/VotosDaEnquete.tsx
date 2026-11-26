import { chaveDeMembro } from "nucleo/sdk/domain";
import {
  assinarEnquetes,
  lerEnquete,
  lerEnqueteBruta,
  MARCAS,
  resultadoVisivel,
} from "nucleo/store/enquetes";
import { useAvatarDoMembro, useNomeDoMembro } from "nucleo/store/hooks";
import { assinarMinutoAtual, lerMinutoAtual } from "nucleo/store/relogioDeEnquetes";
import { useSyncExternalStore } from "react";

import { chat } from "../../textos";
import { Avatar } from "../../ui/ds";
import { ConteudoDoDialogo, Dialogo } from "../../ui/primitivos/Dialogo";
import css from "./VotosDaEnquete.module.css";

const t = chat.enquete.votos;

/**
 * "Ver votos" — quem votou em cada resposta.
 *
 * ⚠ **O dado é o BRUTO.** `Enquete` carrega só as contagens, porque é o que a
 * linha desenha; copiar os IDs de quem votou para o snapshot da mensagem seria
 * alocação proporcional à contagem no componente mais quente do app.
 * `EnqueteBruta.votos` é `resposta → quem votou`, e quem precisa dela é esta
 * tela, que abre uma vez. `lerEnqueteBruta` devolve a referência guardada e o
 * store troca o objeto a cada voto: o getter é estável entre votos e acorda
 * exatamente quando um chega.
 *
 * ⚠ **A guarda do resultado escondido é repetida aqui.** O rodapé só oferece o
 * gatilho com a contagem à vista, mas o modal pode estar aberto quando ela
 * deixa de estar (o meu voto revertido pelo servidor), e uma lista de nomes
 * por resposta diz o mesmo que a porcentagem, com mais detalhe. A regra é a
 * mesma função da linha (`resultadoVisivel`), para as duas portas não
 * discordarem.
 */
export function VotosDaEnquete({
  messageId,
  servidorId,
  aoFechar,
}: {
  messageId: string;
  servidorId: string;
  aoFechar: () => void;
}) {
  const bruta = useSyncExternalStore(assinarEnquetes, () => lerEnqueteBruta(messageId));
  const enquete = useSyncExternalStore(assinarEnquetes, () => lerEnquete(messageId));
  const agora = useSyncExternalStore(assinarMinutoAtual, lerMinutoAtual);

  if (!bruta || !enquete) return null;
  const visivel = resultadoVisivel(enquete, agora);

  return (
    <Dialogo
      open
      onOpenChange={(aberto) => {
        if (!aberto) aoFechar();
      }}
    >
      <ConteudoDoDialogo titulo={t.titulo} descricao={bruta.pergunta} className={css.painel}>
        {visivel ? (
          <div className={css.respostas} data-votos-da-enquete>
            {bruta.respostas.map((r, i) => (
              <Resposta
                key={r.id}
                marca={MARCAS[i] ?? "•"}
                texto={r.texto}
                quem={bruta.votos.get(r.id)}
                servidorId={servidorId}
              />
            ))}
          </div>
        ) : (
          <div className={css.escondido} data-votos-escondidos>
            <p className={css.escondidoTitulo}>{t.escondidoTitulo}</p>
            <p className={css.escondidoTexto}>{t.escondidoTexto}</p>
          </div>
        )}
      </ConteudoDoDialogo>
    </Dialogo>
  );
}

function Resposta({
  marca,
  texto,
  quem,
  servidorId,
}: {
  marca: string;
  texto: string;
  quem: ReadonlySet<string> | undefined;
  servidorId: string;
}) {
  /* `Set` preserva a ordem de chegada dos votos. Ordenar por nome exigiria ler
     o perfil de cada pessoa aqui, e um nome que chega depois reordenaria a
     lista debaixo do ponteiro. */
  const ids = quem === undefined ? [] : [...quem];
  return (
    <section className={css.resposta} aria-label={texto}>
      <h3 className={css.cabecalho}>
        <span className={css.marca} aria-hidden="true">
          {marca}
        </span>
        <span className={css.texto}>{texto}</span>
        <span className={css.contagem}>{t.contagem(ids.length)}</span>
      </h3>
      {ids.length === 0 ? (
        /* Dizer "ninguém" e não esconder a seção: a pergunta aqui é justamente
           qual resposta ficou sem voto. */
        <p className={css.ninguem}>{t.ninguem}</p>
      ) : (
        <ul className={css.lista}>
          {ids.map((id) => (
            <Votante key={id} servidorId={servidorId} userId={id} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Cada votante assina SÓ a si mesmo (lei nº 1): trocar de apelido acorda uma linha. */
function Votante({ servidorId, userId }: { servidorId: string; userId: string }) {
  const chave = chaveDeMembro(servidorId, userId);
  const nome = useNomeDoMembro(chave) ?? chat.autorDesconhecido;
  const imagem = useAvatarDoMembro(chave);
  return (
    <li className={css.votante} data-votante={userId}>
      <Avatar nome={nome} id={userId} tamanho={20} imagem={imagem} />
      <span className={css.nome}>{nome}</span>
    </li>
  );
}
