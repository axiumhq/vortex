import { criarTopico, nomeDeTopicoDe } from "nucleo/sdk/topicos";
import { useMessage } from "nucleo/store/hooks";
import { useState, useSyncExternalStore, type FormEvent } from "react";

import { comum, topico } from "../../textos";
import { Botao } from "../../ui/ds";
import { ConteudoDoDialogo, Dialogo } from "../../ui/primitivos/Dialogo";
import {
  abrirTopico,
  assinarDialogoDeTopico,
  fecharDialogoDeTopico,
  lerDialogoDeTopico,
  type AlvoDoDialogo,
} from "./acoes";
import css from "./Topico.module.css";

/** O servidor aceita de 1 a 100 caracteres no nome de um tópico. */
const MAXIMO_DO_NOME = 100;

/**
 * O diálogo de nome ao criar um tópico a partir de uma mensagem. Um para o chat
 * inteiro, como o seletor de reação: o alvo mora em `acoes.ts`.
 */
export function DialogoDeTopico() {
  const alvo = useSyncExternalStore(assinarDialogoDeTopico, lerDialogoDeTopico);
  return (
    <Dialogo
      open={alvo !== null}
      onOpenChange={(aberto) => {
        if (!aberto) fecharDialogoDeTopico();
      }}
    >
      {alvo !== null && <Formulario key={alvo.mensagemId} alvo={alvo} />}
    </Dialogo>
  );
}

function Formulario({ alvo }: { alvo: AlvoDoDialogo }) {
  const mensagem = useMessage(alvo.mensagemId);
  // O nome nasce do texto da mensagem: é o assunto que a pessoa já escreveu.
  const [nome, setNome] = useState(() => nomeDeTopicoDe(mensagem?.content ?? ""));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | undefined>();

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    const limpo = nome.trim();
    if (limpo === "") {
      setErro(topico.dialogo.nomeObrigatorio);
      return;
    }
    setEnviando(true);
    setErro(undefined);
    // A falha já vira aviso dentro de `criarTopico`; o diálogo fica aberto com o nome.
    const id = await criarTopico(alvo.canalId, limpo.slice(0, MAXIMO_DO_NOME), { mensagemId: alvo.mensagemId });
    setEnviando(false);
    if (id === undefined) return;
    fecharDialogoDeTopico();
    abrirTopico(id);
  };

  return (
    <ConteudoDoDialogo titulo={topico.dialogo.titulo} descricao={topico.dialogo.descricao}>
      <form
        className={css.formulario}
        noValidate
        onSubmit={(e) => {
          void enviar(e);
        }}
      >
        <label className={css.rotulo}>
          {topico.dialogo.rotuloDoNome}
          <input
            className={css.campo}
            value={nome}
            maxLength={MAXIMO_DO_NOME}
            autoFocus
            aria-invalid={erro !== undefined}
            onChange={(e) => {
              setNome(e.target.value);
              if (erro !== undefined) setErro(undefined);
            }}
          />
        </label>
        {erro !== undefined && (
          <p className={css.erro} role="alert">
            {erro}
          </p>
        )}
        <div className={css.rodapeDoDialogo}>
          <Botao variante="fantasma" onClick={fecharDialogoDeTopico}>
            {comum.cancelar}
          </Botao>
          <Botao type="submit" carregando={enviando}>
            {topico.dialogo.confirmar}
          </Botao>
        </div>
      </form>
    </ConteudoDoDialogo>
  );
}
