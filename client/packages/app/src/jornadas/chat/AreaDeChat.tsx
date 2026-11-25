import { type ReactNode, type RefObject, useEffect, useRef } from "react";

import { Composer } from "./Composer";
import { SeletorDeReacao } from "./emoji/SeletoresDeEmoji";
import css from "./AreaDeChat.module.css";
import { DigitandoDoCanal } from "./DigitandoDoCanal";
import { ListaDeMensagens } from "./ListaDeMensagens";
import { VisualizadorDeImagem } from "./VisualizadorDeImagem";
import { DialogoDeTopico } from "../topicos/DialogoDeTopico";

/**
 * O chat de um canal: a lista virtualizada e, embaixo, quem está digitando e o
 * composer. Lista e composer ocupam a largura toda, alinhados ao início e com o
 * mesmo recuo lateral: o campo de escrever fica sob a coluna de mensagens em
 * qualquer largura, sem centralização.
 *
 * Remontada por canal (`key`): a lista reinicia a âncora e o composer troca de
 * rascunho, que mora fora do React e volta onde estava.
 *
 * `rodape` substitui o composer quando a conversa tem um motivo próprio para não
 * aceitar escrita (a DM com alguém bloqueado): a frase do motivo ocupa o lugar do
 * campo, na mesma coluna de leitura.
 *
 * `topo` vai para o topo do scroller (a mensagem que iniciou um tópico) e
 * `aviso` é uma frase logo acima do composer, sem tirá-lo do lugar (tópico
 * arquivado: responder o reabre, então o campo continua).
 */
/**
 * Os avisos flutuam no canto da janela e o campo de escrever mora no mesmo canto:
 * sem folga, o aviso cobre "Enviar" e os botões do campo. A altura do rodapé vira
 * a variável `--vx-folga-de-avisos`, que a área de avisos soma à própria margem.
 * Escrita só quando muda (ResizeObserver), nunca por render.
 */
function useFolgaDosAvisos(rodape: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = rodape.current;
    if (el === null) return;
    const raiz = document.documentElement;
    const aplicar = () => {
      const topo = el.getBoundingClientRect().top;
      raiz.style.setProperty("--vx-folga-de-avisos", `${String(Math.max(0, window.innerHeight - topo))}px`);
    };
    aplicar();
    const obs = new ResizeObserver(aplicar);
    obs.observe(el);
    window.addEventListener("resize", aplicar);
    return () => {
      obs.disconnect();
      window.removeEventListener("resize", aplicar);
      raiz.style.removeProperty("--vx-folga-de-avisos");
    };
  }, [rodape]);
}

export function AreaDeChat({
  canalId,
  servidorId,
  rodape,
  topo,
  aviso,
}: {
  canalId: string;
  servidorId: string;
  rodape?: ReactNode;
  topo?: ReactNode;
  aviso?: ReactNode;
}) {
  const rodapeRef = useRef<HTMLDivElement | null>(null);
  useFolgaDosAvisos(rodapeRef);
  return (
    <div className={css.chat}>
      <div className={css.lista}>
        <ListaDeMensagens canalId={canalId} servidorId={servidorId} topo={topo} />
      </div>
      {/* Um de cada para o chat inteiro: nada disto é montado por linha. */}
      <SeletorDeReacao />
      <VisualizadorDeImagem servidorId={servidorId} />
      <DialogoDeTopico />
      <div ref={rodapeRef} className={css.rodape}>
        <div className={css.colunaDoRodape}>
          {rodape ?? (
            <>
              {aviso}
              <DigitandoDoCanal canalId={canalId} servidorId={servidorId} />
              <Composer canalId={canalId} servidorId={servidorId} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
