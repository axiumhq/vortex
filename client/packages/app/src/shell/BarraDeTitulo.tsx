import type { ReactNode } from "react";

import { comum, shell } from "../textos";
import { Botao } from "../ui/ds";
import { Marca } from "../ui/Marca";
import { AvisoDeConexao } from "./AvisoDeConexao";
import { Fechar, Maximizar, Minimizar } from "../ui/icones";
import css from "./Regioes.module.css";

export interface BarraDeTituloProps {
  /** Cada botão da janela só existe se o tratador existe (na web não há janela para controlar). */
  aoMinimizar?: () => void;
  aoMaximizar?: () => void;
  aoFechar?: () => void;
  /** Avisos do lugar atual (a emergência do servidor), ao lado do de conexão. */
  avisos?: ReactNode;
}

/** Só o símbolo (20px) e o nome do app e os botões da janela. Nada mais mora aqui. */
export function BarraDeTitulo({ aoMinimizar, aoMaximizar, aoFechar, avisos }: BarraDeTituloProps) {
  const temJanela = aoMinimizar ?? aoMaximizar ?? aoFechar;
  return (
    <div
      role="banner"
      className={css.barraDeTitulo}
      aria-label={shell.barraDeTitulo.rotulo}
      data-testid="barra-de-titulo"
    >
      <span className={css.nomeDoApp}>
        <Marca tamanho={20} />
        {comum.nomeDoApp}
      </span>
      <div className={css.avisos}>
        {avisos}
        <AvisoDeConexao />
      </div>
      {temJanela && (
        <div className={css.janela}>
          {aoMinimizar && (
            <Botao
              variante="fantasma"
              tamanho="sm"
              icone={<Minimizar />}
              aria-label={shell.barraDeTitulo.minimizar}
              onClick={aoMinimizar}
            />
          )}
          {aoMaximizar && (
            <Botao
              variante="fantasma"
              tamanho="sm"
              icone={<Maximizar />}
              aria-label={shell.barraDeTitulo.maximizar}
              onClick={aoMaximizar}
            />
          )}
          {aoFechar && (
            <Botao
              variante="fantasma"
              tamanho="sm"
              icone={<Fechar />}
              aria-label={shell.barraDeTitulo.fechar}
              onClick={aoFechar}
            />
          )}
        </div>
      )}
    </div>
  );
}
