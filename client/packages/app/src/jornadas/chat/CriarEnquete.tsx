import { criarEnquete } from "nucleo/sdk/enquetes";
import { MARCAS } from "nucleo/store/enquetes";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { chat, comum } from "../../textos";
import { Botao } from "../../ui/ds";
import { Alca, Fechar, Mais, SetaParaBaixo } from "../../ui/icones";
import { ConteudoDoDialogo, Dialogo } from "../../ui/primitivos/Dialogo";
import {
  ConteudoDoMenu,
  GatilhoDoMenu,
  GrupoDeEscolha,
  ItemDeEscolha,
  MenuSuspenso,
} from "../../ui/primitivos/Menus";
import css from "./CriarEnquete.module.css";

const t = chat.criarEnquete;

/*
  Os limites são os do servidor (`DataPoll` e `POLL_ANSWER_MAX_LENGTH`): validar
  aqui com os mesmos números é o que faz o erro aparecer no campo, e não como um
  "o servidor recusou" depois do clique.
*/
export const MAXIMO_DA_PERGUNTA = 300;
export const MAXIMO_DA_RESPOSTA = 100;
export const MINIMO_DE_RESPOSTAS = 2;
/** A partir de quantos caracteres restantes o contador da pergunta aparece. */
const AVISO_DE_TETO = 50;
export const MAXIMO_DE_RESPOSTAS = 10;

/** As durações oferecidas, em horas (o que `duration_hours` recebe). */
export const DURACOES = [
  { horas: 8, rotulo: t.duracoes.oitoHoras },
  { horas: 24, rotulo: t.duracoes.umDia },
  { horas: 72, rotulo: t.duracoes.tresDias },
  { horas: 168, rotulo: t.duracoes.umaSemana },
] as const;
const DURACAO_PADRAO = 24;

/** Conta caracteres como o servidor conta (`chars()`), não unidades UTF-16. */
const tamanho = (texto: string) => Array.from(texto.trim()).length;

type Resposta = { readonly id: string; readonly texto: string };

export type ErrosDaEnquete = {
  pergunta?: string;
  respostas?: string;
};

/** A validação do servidor, espelhada. Vazio = pode enviar. */
export function validarEnquete(pergunta: string, respostas: readonly string[]): ErrosDaEnquete {
  const erros: ErrosDaEnquete = {};
  if (pergunta.trim() === "") erros.pergunta = t.erros.perguntaVazia;
  else if (tamanho(pergunta) > MAXIMO_DA_PERGUNTA) erros.pergunta = t.erros.perguntaLonga(MAXIMO_DA_PERGUNTA);

  const preenchidas = respostas.filter((r) => r.trim() !== "");
  if (preenchidas.some((r) => tamanho(r) > MAXIMO_DA_RESPOSTA)) {
    erros.respostas = t.erros.respostaLonga(MAXIMO_DA_RESPOSTA);
  } else if (preenchidas.length < MINIMO_DE_RESPOSTAS) {
    erros.respostas = t.erros.poucasRespostas;
  }
  return erros;
}

export interface CriarEnqueteProps {
  /** O canal onde o botão foi clicado. `undefined` = fechado. */
  canalId: string | undefined;
  aoFechar: () => void;
}

/**
 * Criar enquete. O canal chega pela prop e é o do CLIQUE no botão do campo: o
 * diálogo prende o foco, então não há como trocar de canal com ele aberto.
 *
 * Erro do servidor mantém o formulário como estava (o toast vem de
 * `criarEnquete`); só o sucesso fecha e limpa.
 */
export function CriarEnquete({ canalId, aoFechar }: CriarEnqueteProps) {
  return (
    <Dialogo
      open={canalId !== undefined}
      onOpenChange={(aberto) => {
        if (!aberto) aoFechar();
      }}
    >
      {canalId !== undefined && (
        <ConteudoDoDialogo titulo={t.titulo} descricao={t.descricao}>
          <Formulario canalId={canalId} aoFechar={aoFechar} />
        </ConteudoDoDialogo>
      )}
    </Dialogo>
  );
}

function Formulario({ canalId, aoFechar }: { canalId: string; aoFechar: () => void }) {
  const [pergunta, setPergunta] = useState("");
  /*
    Cada resposta tem ID próprio: com o índice como chave, remover a do meio faria o
    React reaproveitar os campos pela posição e o texto pularia de linha.
  */
  const proximo = useRef(MINIMO_DE_RESPOSTAS);
  const [respostas, setRespostas] = useState<readonly Resposta[]>([
    { id: "r0", texto: "" },
    { id: "r1", texto: "" },
  ]);
  const [multipla, setMultipla] = useState(false);
  const [duracao, setDuracao] = useState<number>(DURACAO_PADRAO);
  const [resultadoNoFim, setResultadoNoFim] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState<string | undefined>();

  const erros = validarEnquete(
    pergunta,
    respostas.map((r) => r.texto),
  );
  const mostrar = tentou ? erros : {};

  const mudarResposta = (id: string, texto: string) => {
    setRespostas((atual) => atual.map((r) => (r.id === id ? { ...r, texto } : r)));
  };

  /** Uma função para o arraste e para o teclado: os dois chegam ao mesmo lugar. */
  const mover = (id: string, destino: number) => {
    setRespostas((atual) => {
      const de = atual.findIndex((r) => r.id === id);
      if (de < 0 || destino < 0 || destino >= atual.length || destino === de) return atual;
      const copia = [...atual];
      const [movida] = copia.splice(de, 1);
      copia.splice(destino, 0, movida!);
      return copia;
    });
  };

  // Alt + setas em qualquer ponto da linha (alça ou campo): sem Alt as setas são do campo.
  const teclaDaLinha = (e: KeyboardEvent<HTMLLIElement>, id: string, i: number) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    mover(id, i + (e.key === "ArrowUp" ? -1 : 1));
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    setTentou(true);
    if (erros.pergunta !== undefined || erros.respostas !== undefined) return;
    setEnviando(true);
    const ok = await criarEnquete(canalId, {
      pergunta,
      respostas: respostas.map((r) => r.texto),
      duracaoHoras: duracao,
      multipla,
      resultadoNoFim,
    });
    setEnviando(false);
    if (ok) aoFechar();
  };

  const rotuloDaDuracao = DURACOES.find((d) => d.horas === duracao)?.rotulo ?? t.duracoes.umDia;
  const restam = MAXIMO_DA_PERGUNTA - Array.from(pergunta).length;

  return (
    <form
      className={css.formulario}
      noValidate
      aria-busy={enviando}
      onSubmit={(e) => {
        void enviar(e);
      }}
    >
      <div className={css.grupo}>
        <div className={css.cabecalhoDoCampo}>
          <label className={css.rotulo} htmlFor="enquete-pergunta">
            {t.pergunta}
          </label>
          {/* Só perto do teto: um contador sempre à vista é ruído num campo que quase nunca chega lá. */}
          {restam <= AVISO_DE_TETO && (
            <span className={css.contador} aria-live="polite">
              {t.restam(Math.max(0, restam))}
            </span>
          )}
        </div>
        <input
          id="enquete-pergunta"
          className={css.campo}
          value={pergunta}
          maxLength={MAXIMO_DA_PERGUNTA}
          placeholder={t.perguntaDica}
          autoFocus
          disabled={enviando}
          aria-invalid={mostrar.pergunta !== undefined}
          aria-errormessage={mostrar.pergunta !== undefined ? "enquete-erro-pergunta" : undefined}
          onChange={(e) => {
            setPergunta(e.target.value);
          }}
        />
        {mostrar.pergunta !== undefined && (
          <p id="enquete-erro-pergunta" className={css.erro} role="alert">
            {mostrar.pergunta}
          </p>
        )}
      </div>

      <fieldset className={css.grupo}>
        <legend className={css.rotulo}>{t.respostas}</legend>
        <ol className={css.respostas}>
          {respostas.map((r, i) => (
            <li
              key={r.id}
              className={css.resposta}
              data-resposta={r.id}
              data-arrastando={arrastando === r.id || undefined}
              draggable={arrastando === r.id}
              onKeyDown={(e) => {
                teclaDaLinha(e, r.id, i);
              }}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                // Sem carga o Firefox não inicia o arraste.
                e.dataTransfer.setData("text/plain", r.id);
              }}
              onDragOver={(e) => {
                if (arrastando === undefined) return;
                e.preventDefault();
                mover(arrastando, i);
              }}
              onDragEnd={() => {
                setArrastando(undefined);
              }}
            >
              <button
                type="button"
                className={css.alca}
                aria-label={t.moverResposta(i + 1)}
                title={t.moverDica}
                disabled={enviando}
                // A alça ARMA o arraste: sem isto a linha inteira arrastaria e selecionar texto viraria arraste.
                onPointerDown={() => {
                  setArrastando(r.id);
                }}
                onPointerUp={() => {
                  setArrastando(undefined);
                }}
              >
                <Alca />
              </button>
              <span className={css.marca} aria-hidden="true">
                {MARCAS[i]}
              </span>
              <input
                className={css.campo}
                value={r.texto}
                maxLength={MAXIMO_DA_RESPOSTA}
                aria-label={t.resposta(i + 1)}
                placeholder={t.resposta(i + 1)}
                disabled={enviando}
                aria-invalid={mostrar.respostas !== undefined && (r.texto.trim() === "" || tamanho(r.texto) > MAXIMO_DA_RESPOSTA)}
                onChange={(e) => {
                  mudarResposta(r.id, e.target.value);
                }}
              />
              {/* Remover só existe acima do mínimo: um botão que a pessoa clica para descobrir que não pode é pior que nenhum. */}
              {respostas.length > MINIMO_DE_RESPOSTAS && (
                <button
                  type="button"
                  className={css.remover}
                  aria-label={t.removerResposta(i + 1)}
                  disabled={enviando}
                  onClick={() => {
                    setRespostas((atual) => atual.filter((v) => v.id !== r.id));
                  }}
                >
                  <Fechar />
                </button>
              )}
            </li>
          ))}
        </ol>
        {respostas.length < MAXIMO_DE_RESPOSTAS && (
          <button
            type="button"
            className={css.adicionar}
            disabled={enviando}
            onClick={() => {
              setRespostas((atual) => [...atual, { id: `r${proximo.current++}`, texto: "" }]);
            }}
          >
            <Mais />
            {t.adicionarResposta(MAXIMO_DE_RESPOSTAS)}
          </button>
        )}
        {mostrar.respostas !== undefined && (
          <p className={css.erro} role="alert">
            {mostrar.respostas}
          </p>
        )}
      </fieldset>

      <div className={css.duas}>
        <Escolha
          rotulo={t.tipo}
          valor={multipla ? "multipla" : "uma"}
          texto={multipla ? t.multiplasRespostas : t.umaResposta}
          opcoes={[
            { valor: "uma", texto: t.umaResposta },
            { valor: "multipla", texto: t.multiplasRespostas },
          ]}
          desabilitado={enviando}
          aoEscolher={(v) => {
            setMultipla(v === "multipla");
          }}
        />
        <Escolha
          rotulo={t.duracao}
          valor={String(duracao)}
          texto={rotuloDaDuracao}
          opcoes={DURACOES.map((d) => ({ valor: String(d.horas), texto: d.rotulo }))}
          desabilitado={enviando}
          aoEscolher={(v) => {
            setDuracao(Number(v));
          }}
        />
      </div>

      <div className={css.linhaDeAjuste}>
        <span className={css.ajusteTextos}>
          <span className={css.ajusteNome} id="enquete-resultado-no-fim">
            {t.resultadoNoFim}
          </span>
          <span className={css.dica}>{t.resultadoNoFimDica}</span>
        </span>
        <button
          type="button"
          role="switch"
          className={css.interruptor}
          aria-checked={resultadoNoFim}
          aria-labelledby="enquete-resultado-no-fim"
          disabled={enviando}
          onClick={() => {
            setResultadoNoFim((v) => !v);
          }}
        />
      </div>

      <div className={css.rodape}>
        <Botao variante="fantasma" onClick={aoFechar}>
          {comum.cancelar}
        </Botao>
        <Botao type="submit" carregando={enviando}>
          {t.criar}
        </Botao>
      </div>
    </form>
  );
}

/**
 * Campo com cara de seleção e a lista do app (o `<select>` nativo é desenhado pelo
 * sistema e abre com cromo claro). Fica aqui até aparecer o segundo consumidor.
 */
function Escolha({
  rotulo,
  valor,
  texto,
  opcoes,
  desabilitado,
  aoEscolher,
}: {
  rotulo: string;
  valor: string;
  texto: string;
  opcoes: readonly { valor: string; texto: string }[];
  desabilitado: boolean;
  aoEscolher: (valor: string) => void;
}) {
  return (
    <div className={css.grupo}>
      <span className={css.rotulo}>{rotulo}</span>
      <MenuSuspenso>
        <GatilhoDoMenu asChild disabled={desabilitado}>
          <button type="button" className={css.escolha} aria-label={`${rotulo}: ${texto}`}>
            <span>{texto}</span>
            <SetaParaBaixo />
          </button>
        </GatilhoDoMenu>
        <ConteudoDoMenu align="start">
          <GrupoDeEscolha value={valor} onValueChange={aoEscolher}>
            {opcoes.map((o) => (
              <ItemDeEscolha key={o.valor} value={o.valor}>
                {o.texto}
              </ItemDeEscolha>
            ))}
          </GrupoDeEscolha>
        </ConteudoDoMenu>
      </MenuSuspenso>
    </div>
  );
}
