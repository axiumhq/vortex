import { republicarEnquete } from "nucleo/sdk/adapter";
import { votarNaEnquete } from "nucleo/sdk/enquetes";
import {
  estaEncerrada,
  porcentagem,
  rodapeDaEnquete,
  totalDeVotos,
  type Enquete,
  type OpcaoDeEnquete,
} from "nucleo/store/enquetes";
import { assinarMinutoAtual, lerMinutoAtual } from "nucleo/store/relogioDeEnquetes";
import { useSyncExternalStore, type CSSProperties } from "react";

import { chat } from "../../textos";
import { Trofeu } from "../../ui/icones";
import css from "./EnqueteDaMensagem.module.css";

const t = chat.enquete;

/** Assinatura que não assina: lê o minuto sem acordar a linha. */
const semAssinar = () => () => {};

/**
 * O minuto atual, assinado SÓ enquanto a enquete está aberta.
 *
 * Duas leituras do mesmo `getSnapshot` estável: a primeira só olha (sem
 * assinar) para decidir se a enquete ainda corre; a segunda assina o relógio
 * compartilhado apenas nesse caso. Encerrada pelo autor ou pelo prazo, a linha
 * solta o relógio — numa janela cheia de enquetes antigas, nenhuma acorda a
 * cada minuto. Sem timer por linha: o `setInterval` é um só, com refcount.
 */
function useMinutoEnquantoAberta(fechaEm: number | undefined): number {
  const visto = useSyncExternalStore(semAssinar, lerMinutoAtual);
  const aberta = fechaEm !== undefined && fechaEm > visto;
  return useSyncExternalStore(aberta ? assinarMinutoAtual : semAssinar, lerMinutoAtual);
}

/**
 * "fecha em 22 h", a partir do minuto do relógio.
 *
 * Para baixo na hora e para cima no minuto: "fecha em 1 h" quando restam 59
 * minutos é uma promessa que o relógio quebra; "fecha em 59 min" é verdade.
 */
function prazo(fechaEm: number, agora: number): string {
  const restante = fechaEm - agora;
  if (restante <= 0) return t.fechando;
  const horas = Math.floor(restante / 3_600_000);
  if (horas >= 24) return t.fechaEmDias(Math.floor(horas / 24));
  if (horas >= 1) return t.fechaEmHoras(horas);
  return t.fechaEmMinutos(Math.ceil(restante / 60_000));
}

/**
 * A enquete dentro da linha de mensagem — aberta e encerrada.
 *
 * ⚠ **A barra de resultado é o FUNDO da própria opção, nunca um irmão.** O
 * `::before` do botão, fora de fluxo, com a fração numa custom property e
 * desenhado por `transform: scaleX`. Uma barra empilhada sob o rótulo
 * cresceria a linha no instante do voto, e a lista está ancorada: a linha que
 * cresce acima da âncora empurra o que está sendo lido. O teste de navegador
 * mede a altura antes e depois do voto.
 *
 * A linha assina a mensagem (lei nº 1); a enquete vem dentro do snapshot dela,
 * e votar republica SÓ esta linha (`republicarEnquete`).
 */
export function EnqueteDaMensagem({
  messageId,
  channelId,
  enquete,
}: {
  messageId: string;
  channelId: string;
  enquete: Enquete;
}) {
  const agora = useMinutoEnquantoAberta(enquete.fechaEm);
  const encerrada = estaEncerrada(enquete, agora);
  const total = totalDeVotos(enquete);
  const votou = enquete.meusVotos.length > 0;
  /* "Resultado no fim" esconde a porcentagem por resposta enquanto ela pode
     enviesar: aberta e sem o meu voto. O total aparece sempre. */
  const escondido = enquete.resultadoNoFim && !encerrada && !votou;
  /* Vencedora: a mais votada; empate fica com a primeira, na ordem do autor. */
  const vencedora = encerrada
    ? enquete.opcoes.reduce((a, b) => (b.votos > a.votos ? b : a))
    : undefined;

  return (
    <div className={css.caixa} data-enquete={encerrada ? "encerrada" : "aberta"}>
      <div className={css.tipo}>
        {encerrada ? (
          <>
            <span>{t.encerrada}</span>
            <span className={css.selo}>{t.sinalResultado}</span>
          </>
        ) : (
          <span>{t.tipo(enquete.maximo)}</span>
        )}
      </div>

      <p className={css.pergunta}>{enquete.pergunta}</p>

      {/* `group` e não `radiogroup`: há enquete de múltiplas respostas, e o
          estado real de cada opção está no `aria-pressed` dela. */}
      <div className={css.opcoes} role="group" aria-label={enquete.pergunta}>
        {enquete.opcoes.map((o) => (
          <Opcao
            key={o.id}
            opcao={o}
            pct={porcentagem(enquete, o)}
            minha={enquete.meusVotos.includes(o.id)}
            escondido={escondido}
            encerrada={encerrada}
            venceu={vencedora?.id === o.id}
            aoVotar={() => {
              void votarNaEnquete(channelId, messageId, o.id, () => {
                republicarEnquete(messageId);
              });
            }}
          />
        ))}
      </div>

      <div className={css.rodape}>
        <span>{encerrada ? t.rodapeEncerrada(total) : rodapeDaEnquete(total, escondido, votou)}</span>
        {!encerrada && enquete.fechaEm !== undefined && <span>{prazo(enquete.fechaEm, agora)}</span>}
      </div>
    </div>
  );
}

function Opcao({
  opcao,
  pct,
  minha,
  escondido,
  encerrada,
  venceu,
  aoVotar,
}: {
  opcao: OpcaoDeEnquete;
  pct: number;
  minha: boolean;
  escondido: boolean;
  encerrada: boolean;
  venceu: boolean;
  aoVotar: () => void;
}) {
  /* A fração vai para o `::before` por custom property: nenhum elemento a
     mais no fluxo, e a mudança anima só `transform`. */
  const estilo = { "--fracao": escondido ? 0 : pct / 100 } as CSSProperties;
  return (
    <button
      type="button"
      className={css.opcao}
      style={estilo}
      data-venceu={venceu || undefined}
      data-escondido={escondido || undefined}
      aria-pressed={minha}
      disabled={encerrada}
      onClick={aoVotar}
    >
      <span className={css.marca} aria-hidden={venceu ? undefined : true}>
        {venceu ? <Trofeu tamanho={16} aria-label={t.vencedora} /> : opcao.marca}
      </span>
      <span className={css.texto}>{opcao.texto}</span>
      {!escondido && <span className={css.pct}>{pct}%</span>}
    </button>
  );
}
