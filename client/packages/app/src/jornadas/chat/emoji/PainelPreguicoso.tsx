import type { ComponentType } from "react";

import { chat, comum } from "../../../textos";
import { Botao } from "../../../ui/ds";
import { juntar } from "../../../ui/juntar";
import { lazyComNovaTentativa } from "../../../ui/lazyComNovaTentativa";
import css from "./Emoji.module.css";

interface PropsDoPainel {
  aoEscolher: (glifo: string) => void;
}

/**
 * Monta o painel sob demanda em cima de um carregador. Separado de
 * `PainelPreguicoso` para o teste injetar um `import()` que falha.
 *
 * A lista curada pesa alguns kB e a maioria das sessões nunca abre o seletor
 * (as reações rápidas do menu cobrem o resto): fica fora do bundle inicial. O
 * estado de carregando e o de erro têm a MESMA caixa do painel, para o popover
 * não mudar de tamanho quando o módulo chega — ou quando não chega.
 */
export function criarPainelPreguicoso(
  carregar: () => Promise<{ default: ComponentType<PropsDoPainel> }>,
) {
  return lazyComNovaTentativa(carregar, {
    carregando: (
      <div className={juntar(css.painel, css.carregando)} role="status">
        {chat.emoji.carregando}
      </div>
    ),
    erro: (tentar) => (
      <div className={juntar(css.painel, css.carregando)} role="alert">
        <p>{chat.emoji.falhaAoCarregar}</p>
        <Botao variante="fantasma" tamanho="sm" onClick={tentar}>
          {comum.tentarDeNovo}
        </Botao>
      </div>
    ),
  });
}

export const PainelPreguicoso = criarPainelPreguicoso(() => import("./PainelDeEmoji"));
