import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { chat, ds } from "../../textos";
import { Enquete, Enviar, Mais, Sorriso } from "../icones";
import { juntar } from "../juntar";
import { Botao } from "./Botao";
import css from "./CampoDeMensagem.module.css";
import { PainelVidro } from "./PainelVidro";

export interface CampoDeMensagemProps {
  /** Controlado. Sem ele, o campo guarda o texto sozinho (`valorInicial`). */
  valor?: string;
  valorInicial?: string;
  onChange?: (valor: string) => void;
  /** Enter (Shift+Enter quebra linha) ou o botão. Chega sem espaço nas pontas. */
  onEnviar?: (valor: string) => void;
  /** Também é o nome acessível do campo. Padrão: "Escrever mensagem". */
  placeholder?: string;
  desabilitado?: boolean;
  /** Dito em texto quando desabilitado ("Você não pode escrever aqui"). */
  motivo?: string;
  enviando?: boolean;
  /** Os botões de anexar e emoji só existem com tratador (controle sem ação não aparece). */
  onAnexar?: () => void;
  onEmoji?: () => void;
  /** Criar enquete. Sem tratador o botão não existe (nunca fica cinza). */
  onEnquete?: () => void;
  /** Acima da linha de escrita, dentro da mesma caixa: prévia de resposta, anexos. */
  topo?: ReactNode;
  /** Há algo além do texto a enviar (anexos): enviar vazio passa a valer. */
  permitirVazio?: boolean;
  /** O `textarea`, para quem precisa devolver o foco (responder, anexar). */
  areaRef?: (el: HTMLTextAreaElement | null) => void;
  /** Antes do tratador de Enter do campo; `preventDefault()` assume a tecla. */
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  className?: string;
}

export function CampoDeMensagem({
  valor,
  valorInicial = "",
  onChange,
  onEnviar,
  placeholder = chat.campoDeMensagem,
  desabilitado = false,
  motivo,
  enviando = false,
  onAnexar,
  onEmoji,
  onEnquete,
  topo,
  permitirVazio = false,
  areaRef,
  onKeyDown,
  className,
}: CampoDeMensagemProps) {
  const [interno, setInterno] = useState(valorInicial);
  const texto = valor ?? interno;
  const area = useRef<HTMLTextAreaElement>(null);
  const idDoMotivo = useId();
  const vazio = texto.trim() === "" && !permitirVazio;

  // Cresce com o conteúdo; o teto e a rolagem são do CSS.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.blockSize = "auto";
    el.style.blockSize = `${el.scrollHeight}px`;
  }, [texto]);

  const mudar = (novo: string) => {
    if (valor === undefined) setInterno(novo);
    onChange?.(novo);
  };

  const enviar = () => {
    if (vazio || desabilitado || enviando) return;
    onEnviar?.(texto.trim());
    if (valor === undefined) setInterno("");
  };

  const aoTeclar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      enviar();
    }
  };

  return (
    <div className={className}>
      <PainelVidro
        variante="leitura"
        raio="xl"
        className={juntar(css.campo, desabilitado && css.desabilitado, enviando && css.enviando)}
      >
        {topo}
        <div className={css.linha}>
          {onAnexar && (
            <Botao
              variante="fantasma"
              tamanho="sm"
              icone={<Mais />}
              aria-label={chat.anexar}
              disabled={desabilitado}
              onClick={onAnexar}
            />
          )}
          {onEnquete && (
            <Botao
              variante="fantasma"
              tamanho="sm"
              icone={<Enquete />}
              aria-label={chat.criarEnquete.botao}
              title={chat.criarEnquete.botao}
              data-gatilho-de-enquete=""
              disabled={desabilitado}
              onClick={onEnquete}
            />
          )}
          <textarea
            ref={(el) => {
              area.current = el;
              areaRef?.(el);
            }}
            rows={1}
            className={css.texto}
            value={texto}
            placeholder={placeholder}
            aria-label={placeholder}
            aria-describedby={desabilitado && motivo ? idDoMotivo : undefined}
            disabled={desabilitado}
            onChange={(e) => {
              mudar(e.target.value);
            }}
            onKeyDown={aoTeclar}
          />
          {onEmoji && (
            <Botao
              variante="fantasma"
              tamanho="sm"
              icone={<Sorriso />}
              aria-label={ds.campo.emoji}
              data-gatilho-de-emoji=""
              disabled={desabilitado}
              onClick={onEmoji}
            />
          )}
          <Botao
            tamanho="sm"
            icone={<Enviar />}
            aria-label={chat.enviar}
            carregando={enviando}
            disabled={(vazio && !enviando) || desabilitado}
            onClick={enviar}
          />
        </div>
      </PainelVidro>
      {desabilitado && motivo && (
        <p id={idDoMotivo} className={css.motivo}>
          {motivo}
        </p>
      )}
    </div>
  );
}
