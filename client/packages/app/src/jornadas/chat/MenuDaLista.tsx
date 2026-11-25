import { alternarFixada, alternarReacao, apagarMensagem, marcarNaoLidaA, usuarioLocalId } from "nucleo/sdk/adapter";
import { pode } from "nucleo/sdk/permissoes";
import { copiarTexto } from "nucleo/lib/copiar";
import { editar } from "nucleo/store/edicaoDeMensagem";
import { useMessage } from "nucleo/store/hooks";
import { abrirSeletorDeReacao } from "nucleo/store/seletorDeReacao";
import { assinarMenuDeMensagem, lerAlvoDoMenu, mirarAlvoDoMenu } from "nucleo/store/menuDeMensagem";
import { responderA } from "nucleo/store/resposta";
import { toast } from "nucleo/ui-logica/toastStore";
import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { chat, comum } from "../../textos";
import { topico as textosDeTopico } from "../../textos/topico";
import { useAcaoDeTopico } from "../topicos/acaoDeTopico";
import { Botao } from "../../ui/ds";
import { Arroba, Copiar, Desafixar, Editar, Fixar, Lixeira, NaoLida, Responder, Sorriso, Topico } from "../../ui/icones";
import { ConteudoDoDialogo, Dialogo, DialogoFechar } from "../../ui/primitivos/Dialogo";
import {
  ConteudoDoMenuDeContexto,
  GatilhoDoMenuDeContexto,
  ItemDeMenuDeContexto,
  MenuDeContexto,
  SeparadorDeMenuDeContexto,
} from "../../ui/primitivos/Menus";
import css from "./MenuDaLista.module.css";

/** Reações do atalho rápido, no topo do menu. */
const REACOES_RAPIDAS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

/**
 * Abre o menu da mensagem ancorado num elemento (os botões da barra de ações).
 *
 * Despacha o MESMO `contextmenu` que o gatilho da lista já escuta: o alvo se
 * resolve pelo mesmo caminho do clique direito, e não existe um segundo menu
 * com os mesmos itens para divergir do primeiro.
 */
export function abrirMenuDaMensagem(ancora: HTMLElement): void {
  const r = ancora.getBoundingClientRect();
  ancora.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: Math.round(r.left),
      clientY: Math.round(r.bottom),
    }),
  );
}

function ConteudoDoMenu({ aoApagar }: { aoApagar: (id: string) => void }) {
  // Ação que espera o menu terminar de fechar (e devolver o foco) para rodar.
  const depoisDeFechar = useRef<(() => void) | null>(null);
  const alvo = useSyncExternalStore(assinarMenuDeMensagem, lerAlvoDoMenu);
  const id = alvo?.tipo === "mensagem" ? alvo.id : "";
  const m = useMessage(id);
  const topico = useAcaoDeTopico(id, m?.channelId, m !== undefined && m.sendState === "sent" && !m.sistema);
  if (!m) return null;

  const enviada = m.sendState === "sent";
  const minha = m.authorId !== undefined && m.authorId === usuarioLocalId();
  const podeResponder = enviada && pode(m.channelId, "responder");
  const podeReagir = enviada && pode(m.channelId, "reagir");
  const podeFixar = enviada && pode(m.channelId, "fixar");

  return (
    <ConteudoDoMenuDeContexto
      aria-label={chat.menuDaMensagem}
      className={css.menu}
      onCloseAutoFocus={(e) => {
        const acao = depoisDeFechar.current;
        if (acao === null) return;
        // O foco não volta ao gatilho: quem abre em seguida (o seletor) fica com ele.
        e.preventDefault();
        depoisDeFechar.current = null;
        acao();
      }}
    >
      {podeReagir && (
        <>
          <div role="group" aria-label={chat.reagirRotulo} className={css.reacoes}>
            {REACOES_RAPIDAS.map((emoji) => (
              <ItemDeMenuDeContexto
                key={emoji}
                className={css.reacao}
                aria-label={chat.reagirComEmoji(emoji)}
                onSelect={() => {
                  alternarReacao(id, emoji);
                }}
              >
                {emoji}
              </ItemDeMenuDeContexto>
            ))}
          </div>
          <ItemDeMenuDeContexto
            onSelect={() => {
              const linha = document.querySelector(`[data-menu-mensagem="${CSS.escape(id)}"]`);
              depoisDeFechar.current = () => {
                abrirSeletorDeReacao(id, linha);
              };
            }}
          >
            <Sorriso /> {chat.emoji.maisReacoes}
          </ItemDeMenuDeContexto>
          <SeparadorDeMenuDeContexto />
        </>
      )}
      {podeResponder && (
        <>
          <ItemDeMenuDeContexto
            onSelect={() => {
              depoisDeFechar.current = () => {
                responderA(m.channelId, id);
              };
            }}
          >
            <Responder /> {chat.responder}
          </ItemDeMenuDeContexto>
          <ItemDeMenuDeContexto
            onSelect={() => {
              depoisDeFechar.current = () => {
                responderA(m.channelId, id, false);
              };
            }}
          >
            <Arroba /> {chat.responderSemMencionar}
          </ItemDeMenuDeContexto>
        </>
      )}
      {topico !== undefined && (
        <ItemDeMenuDeContexto
          onSelect={() => {
            // Depois de fechar: o diálogo de nome fica com o foco, não o gatilho do menu.
            depoisDeFechar.current = topico.executar;
          }}
        >
          <Topico /> {topico.aberto ? textosDeTopico.abrir : textosDeTopico.criar}
        </ItemDeMenuDeContexto>
      )}
      <ItemDeMenuDeContexto
        onSelect={() => {
          void copiarTexto(m.content, "Texto");
        }}
      >
        <Copiar /> {chat.copiarTexto}
      </ItemDeMenuDeContexto>
      {enviada && minha && (
        <ItemDeMenuDeContexto
          onSelect={() => {
            editar(id);
          }}
        >
          <Editar /> {chat.editar}
        </ItemDeMenuDeContexto>
      )}
      {podeFixar && (
        <ItemDeMenuDeContexto
          onSelect={() => {
            alternarFixada(id);
          }}
        >
          {m.fixada ? <Desafixar /> : <Fixar />} {m.fixada ? chat.desafixar : chat.fixar}
        </ItemDeMenuDeContexto>
      )}
      {enviada && (
        <ItemDeMenuDeContexto
          onSelect={() => {
            marcarNaoLidaA(id);
          }}
        >
          <NaoLida /> {chat.marcarNaoLida}
        </ItemDeMenuDeContexto>
      )}
      {enviada && minha && (
        <>
          <SeparadorDeMenuDeContexto />
          <ItemDeMenuDeContexto
            variante="perigo"
            onSelect={() => {
              aoApagar(id);
            }}
          >
            <Lixeira /> {chat.apagar}
          </ItemDeMenuDeContexto>
        </>
      )}
    </ConteudoDoMenuDeContexto>
  );
}

/**
 * O ÚNICO menu de contexto da lista de mensagens.
 *
 * Um `ContextMenu` do Radix por linha montaria Root, Trigger, Portal e Content
 * na velocidade do scroll, para menus que ninguém abriu. Aqui há um Root para a
 * lista inteira: o alvo vive em `store/menuDeMensagem` (lei nº 1) e é lido do
 * DOM a partir do nó que recebeu o gesto — o mesmo código atende o clique
 * direito, o toque longo e o botão "mais ações" da barra de ações.
 *
 * Apagar é otimista: pede confirmação e a linha some na hora; se o `DELETE`
 * falhar ela volta ao lugar e o aviso de erro aparece.
 */
export function MenuDaLista({ children }: { children: ReactNode }) {
  const [apagando, setApagando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const confirmarApagar = () => {
    if (apagando === null) return;
    setOcupado(true);
    void apagarMensagem(apagando).then((ok) => {
      setOcupado(false);
      setApagando(null);
      if (!ok) toast({ tipo: "erro", titulo: chat.falhaAoApagar });
    });
  };

  return (
    <>
      <MenuDeContexto>
        <GatilhoDoMenuDeContexto
          asChild
          // Captura: o alvo é resolvido ANTES de o Radix abrir. Sem mensagem sob o
          // gesto (vão entre linhas, divisor), o menu não abre.
          onContextMenuCapture={(e) => {
            if (!mirarAlvoDoMenu(e.target)) e.preventDefault();
          }}
          // O toque longo do Radix não passa por `contextmenu`.
          onPointerDownCapture={(e) => {
            if (e.pointerType !== "mouse") mirarAlvoDoMenu(e.target);
          }}
        >
          {children}
        </GatilhoDoMenuDeContexto>
        <ConteudoDoMenu aoApagar={setApagando} />
      </MenuDeContexto>

      <Dialogo
        open={apagando !== null}
        onOpenChange={(aberto) => {
          if (!aberto && !ocupado) setApagando(null);
        }}
      >
        <ConteudoDoDialogo titulo={chat.confirmarApagarTitulo} descricao={chat.confirmarApagarTexto}>
          <div className={css.rodapeDoDialogo}>
            <DialogoFechar asChild>
              <Botao variante="secundario" disabled={ocupado}>
                {comum.cancelar}
              </Botao>
            </DialogoFechar>
            <Botao variante="perigo" carregando={ocupado} onClick={confirmarApagar}>
              {chat.apagar}
            </Botao>
          </div>
        </ConteudoDoDialogo>
      </Dialogo>
    </>
  );
}
