import { memo, type MouseEvent, type ReactNode } from "react";

import { chat, ds } from "../../textos";
import { topico as textosDeTopico } from "../../textos/topico";
import { Imagem, MaisHorizontal, Responder, Sorriso, Topico } from "../icones";
import { juntar } from "../juntar";
import { Avatar } from "./Avatar";
import { Botao } from "./Botao";
import css from "./Mensagem.module.css";
import { PainelVidro } from "./PainelVidro";

export interface MensagemProps {
  autor: { nome: string; id?: string; tom?: number };
  /**
   * O avatar já pronto. Quem sabe a foto da pessoa passa um componente que
   * assina só ela, para trocar a foto não re-renderizar a linha. Sem ele, o
   * avatar de iniciais.
   */
  avatar?: ReactNode;
  /** Horário já formatado, ex. "14:32". */
  hora: string;
  /** A hora completa (com segundos), para o `title` da hora curta. */
  horaCompleta?: string;
  /** O instante em ISO 8601, para o `datetime` de quem lê a página sem a tela. */
  dataHora?: string;
  /** Corpo da mensagem. Links (`<a>`) saem em `accent` com sublinhado. */
  children?: ReactNode;
  /** Mensagem seguinte do mesmo autor: sem avatar nem nome; a hora aparece no hover. */
  continuacao?: boolean;
  /** Citação de outra mensagem. */
  resposta?: { autor: string; trecho: string };
  /** Reserva o espaço da imagem pela proporção, ex. "16 / 9", antes dela carregar. */
  anexo?: { proporcao?: string; rotulo?: string };
  /**
   * Barra flutuante no hover e no foco. Cada botão só existe se o consumidor
   * passou o tratador dele (controle sem ação não aparece).
   */
  acoes?: boolean;
  /** O evento vai junto: quem abre um menu ancorado precisa do ponto do clique. */
  onReagir?: (e: MouseEvent<HTMLButtonElement>) => void;
  onResponder?: () => void;
  /** Criar um tópico a partir da mensagem — ou abrir o que já existe (`topicoAberto`). */
  onTopico?: () => void;
  topicoAberto?: boolean;
  onMaisAcoes?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Depois do corpo e dos anexos: reações, estado de envio, "editada". */
  rodape?: ReactNode;
  /**
   * Densidade compacta: sem avatar, hora em mono na calha, linhas mais juntas.
   * Muda a ESTRUTURA, não só o espaçamento (ver `nucleo/store/densidade`).
   */
  compacta?: boolean;
  /** Menciona a pessoa: a linha ganha um realce e uma barra de acento. */
  destacada?: boolean;
  /** Ainda não confirmada pelo servidor (pendente ou falha): fica mais apagada. */
  esmaecida?: boolean;
  tabIndex?: number;
  className?: string;
}

/**
 * Linha de mensagem. PURA: props entram, JSX sai; nenhuma leitura de store.
 *
 * Como ela vai se ligar ao estado (parte seguinte do M1, TRD §4): a lista
 * virtualizada renderiza `LinhaDeMensagem({ id })`, um wrapper `memo` keyed
 * pelo ID da mensagem que assina SÓ a própria entidade
 * (`useSyncExternalStore` sobre o hook do `nucleo`, `getSnapshot` devolvendo a
 * referência cacheada) e repassa o snapshot para este componente. Editar uma
 * mensagem acorda uma linha, não a lista. Por isso aqui:
 *  - nada de Context de entidade e nada de estado de hover em JS (hover e foco
 *    são CSS puro, então passar o ponteiro não re-renderiza 10k linhas);
 *  - `memo` raso: `autor` e `resposta` precisam vir do snapshot com referência
 *    estável (o hook do `nucleo` cacheia), e `children` é criado pelo wrapper,
 *    que é quem decide quando o corpo muda;
 *  - o tamanho da linha depende só das props (anexo reserva a caixa por
 *    `aspect-ratio`), o que mantém o virtualizador estável.
 */
function MensagemBase({
  autor,
  avatar,
  hora,
  horaCompleta,
  dataHora,
  children,
  continuacao = false,
  resposta,
  anexo,
  acoes = true,
  onReagir,
  onResponder,
  onTopico,
  topicoAberto = false,
  onMaisAcoes,
  rodape,
  compacta = false,
  destacada = false,
  esmaecida = false,
  tabIndex,
  className,
}: MensagemProps) {
  const temAcoes = acoes && (onReagir || onResponder || onTopico || onMaisAcoes);

  return (
    <article
      tabIndex={tabIndex}
      aria-label={ds.mensagem.de(autor.nome)}
      data-destacada={destacada || undefined}
      className={juntar(
        css.mensagem,
        continuacao && css.continuacao,
        compacta && css.compacta,
        destacada && css.destacada,
        esmaecida && css.esmaecida,
        className,
      )}
    >
      <div className={css.calha}>
        {compacta ? (
          <time className={css.horaCompacta} title={horaCompleta} dateTime={dataHora}>{hora}</time>
        ) : continuacao ? (
          <time className={css.horaNoHover} title={horaCompleta} dateTime={dataHora}>{hora}</time>
        ) : (
          (avatar ?? <Avatar nome={autor.nome} id={autor.id} tom={autor.tom} tamanho={36} />)
        )}
      </div>

      <div className={css.conteudo}>
        {resposta && (
          <div className={css.resposta} aria-label={ds.mensagem.respostaA(resposta.autor)}>
            <span className={css.respostaAutor}>{resposta.autor}</span>
            <span className={css.respostaTrecho}>{resposta.trecho}</span>
          </div>
        )}
        {!continuacao && (
          <div className={css.cabecalho}>
            <span className={css.nome}>{autor.nome}</span>
            {!compacta && <time className={css.hora} title={horaCompleta} dateTime={dataHora}>{hora}</time>}
          </div>
        )}
        <div className={css.corpo}>{children}</div>
        {anexo && (
          <div
            role="img"
            aria-label={anexo.rotulo ?? ds.mensagem.imagem}
            className={css.anexo}
            style={{ aspectRatio: anexo.proporcao ?? "16 / 9" }}
          >
            <Imagem tamanho={20} />
            {anexo.rotulo && <span className={css.anexoRotulo}>{anexo.rotulo}</span>}
          </div>
        )}
        {rodape}
      </div>

      {temAcoes && (
        <PainelVidro
          variante="sobreposto"
          raio="pill"
          elevacao={1}
          role="toolbar"
          aria-label={ds.mensagem.acoes}
          className={css.acoes}
        >
          {onReagir && (
            <Botao
              variante="fantasma"
              tamanho="sm"
              icone={<Sorriso />}
              aria-label={ds.mensagem.reagir}
              onClick={onReagir}
            />
          )}
          {onResponder && (
            <Botao
              variante="fantasma"
              tamanho="sm"
              icone={<Responder />}
              aria-label={chat.responder}
              onClick={onResponder}
            />
          )}
          {onTopico && (
            <Botao
              variante="fantasma"
              tamanho="sm"
              icone={<Topico />}
              aria-label={topicoAberto ? textosDeTopico.abrir : textosDeTopico.criar}
              onClick={onTopico}
            />
          )}
          {onMaisAcoes && (
            <Botao
              variante="fantasma"
              tamanho="sm"
              icone={<MaisHorizontal />}
              aria-label={ds.mensagem.maisAcoes}
              onClick={onMaisAcoes}
            />
          )}
        </PainelVidro>
      )}
    </article>
  );
}

export const Mensagem = memo(MensagemBase);
