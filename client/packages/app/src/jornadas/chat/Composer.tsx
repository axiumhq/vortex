import { digitacao, enviarMensagem } from "nucleo/sdk/adapter";
import { temServidorDeMidia, tetoDeUploadBytes, tetoDeUploadTexto } from "nucleo/sdk/anexos";
import { chaveDeMembro } from "nucleo/sdk/domain";
import { pode } from "nucleo/sdk/permissoes";
import { useChannel, useConexao, useMembro, useMessage, usePessoa, useRascunho, useTemEnquetes } from "nucleo/store/hooks";
import { limparRascunho, escreverRascunho } from "nucleo/store/rascunhos";
import { registrarEmojiRecente } from "nucleo/store/emojisRecentes";
import { cancelarResposta, responderA } from "nucleo/store/resposta";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";

import { chat } from "../../textos";
import { nomeDaConversa } from "../useNomeDaConversa";
import { CampoDeMensagem, PainelVidro } from "../../ui/ds";
import { Alerta, Arquivo, Arroba, Cadeado, Fechar, Imagem } from "../../ui/icones";
import { trechoDe } from "./CitacaoDeResposta";
import css from "./Composer.module.css";
import { CriarEnquete } from "./CriarEnquete";
import { SeletorNoComposer } from "./emoji/SeletoresDeEmoji";
import { useAlvoDeResposta, useFalhadasDoCanal } from "./hooks";
import { pedirFimDaLista } from "./saltos";

/** O protocolo aceita até cinco anexos por mensagem. */
const MAXIMO_DE_ANEXOS = 5;

function PreviaDeResposta({
  alvoId,
  mencionar,
  canalId,
  servidorId,
}: {
  alvoId: string;
  mencionar: boolean;
  canalId: string;
  servidorId: string;
}) {
  const alvo = useMessage(alvoId);
  const autor = useMembro(chaveDeMembro(servidorId, alvo?.authorId ?? ""));
  const nome = autor?.displayName ?? chat.autorDesconhecido;
  return (
    <div className={css.previa}>
      <span className={css.previaTexto}>
        <span className={css.previaTitulo}>{chat.respondendoA(nome)}</span>
        <span className={css.previaTrecho}>
          {alvo === undefined ? chat.respostaIndisponivel : trechoDe(alvo.content, servidorId)}
        </span>
      </span>
      {/* O nome do recurso é fixo e o estado vai no aria-pressed: um rótulo que alterna faz o leitor de tela anunciar o inverso. */}
      <button
        type="button"
        className={css.mencionar}
        aria-label={chat.mencionarResposta}
        aria-pressed={mencionar}
        title={chat.mencionarRespostaDica(mencionar)}
        onClick={() => {
          responderA(canalId, alvoId, !mencionar);
        }}
      >
        <Arroba tamanho={14} />
        {mencionar ? chat.respostaAvisa : chat.respostaSemAviso}
      </button>
      <button
        type="button"
        className={css.fechar}
        aria-label={chat.cancelarResposta}
        onClick={() => {
          cancelarResposta(canalId);
        }}
      >
        <Fechar tamanho={14} />
      </button>
    </div>
  );
}

function FichaDeAnexo({ arquivo, aoRemover }: { arquivo: File; aoRemover: () => void }) {
  const ehImagem = arquivo.type.startsWith("image/");
  return (
    <li className={css.ficha}>
      {ehImagem ? <Imagem tamanho={16} /> : <Arquivo tamanho={16} />}
      <span className={css.fichaNome}>{arquivo.name}</span>
      <button type="button" className={css.fechar} aria-label={chat.removerAnexo(arquivo.name)} onClick={aoRemover}>
        <Fechar tamanho={14} />
      </button>
    </li>
  );
}

/**
 * O campo ainda sem canal resolvido: a mesma caixa, vazia. Quando o canal chega o
 * campo de verdade entra no lugar dela, sem a tela pular.
 */
function EsqueletoDoCampo() {
  return (
    <PainelVidro variante="leitura" raio="xl" className={css.esqueletoDoCampo} aria-hidden="true" data-esqueleto-do-campo="">
      <span className={css.esqueletoBotao} />
      <span className={css.esqueletoBarra} />
      <span className={css.esqueletoBotao} />
    </PainelVidro>
  );
}

/** Envolve a seleção do campo numa marca de markdown (Ctrl+B, Ctrl+I). */
function envolver(el: HTMLTextAreaElement, marca: string, escrever: (texto: string) => void) {
  const { selectionStart: de, selectionEnd: ate, value } = el;
  const novo = `${value.slice(0, de)}${marca}${value.slice(de, ate)}${marca}${value.slice(ate)}`;
  escrever(novo);
  // O campo é controlado: a seleção só pode ser restaurada depois do render.
  requestAnimationFrame(() => {
    el.setSelectionRange(de + marca.length, ate + marca.length);
  });
}

/**
 * O composer do canal: rascunho por canal, markdown digitado, responder, anexar,
 * "digitando" e envio otimista. Tudo o que é lógica mora no núcleo
 * (`enviarMensagem` cria a linha com nonce, reconcilia e reenvia); aqui só se
 * liga o campo a ele.
 *
 * Sem permissão de escrever o campo SAI e entra uma frase: um campo
 * desabilitado ensina a tentar de novo, e a frase diz por que não há o que
 * tentar. O rascunho mora fora do React, então trocar de canal e voltar devolve
 * o texto onde estava.
 */
export function Composer({ canalId, servidorId }: { canalId: string; servidorId: string }) {
  const canal = useChannel(canalId);
  const pessoaDaDm = usePessoa(canal?.tipo === "dm" ? (canal.destinatarioId ?? "") : "");
  const rascunho = useRascunho(canalId);
  const alvo = useAlvoDeResposta(canalId);
  const conectado = useConexao() === "conectado";
  const falhadas = useFalhadasDoCanal(canalId);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [aviso, setAviso] = useState<string | undefined>(undefined);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const seletor = useRef<HTMLInputElement | null>(null);
  const [emojiAberto, setEmojiAberto] = useState(false);
  const temEnquetes = useTemEnquetes();
  /** O canal da enquete, lido no clique do botão; `undefined` = diálogo fechado. */
  const [enqueteEm, setEnqueteEm] = useState<string | undefined>(undefined);

  // Armar uma resposta leva o foco ao campo: quem clicou em responder vai escrever.
  const alvoId = alvo?.messageId;
  useEffect(() => {
    if (alvoId !== undefined) area.current?.focus();
  }, [alvoId]);

  if (!canal) return <EsqueletoDoCampo />;

  if (!pode(canalId, "enviar")) {
    return (
      <p className={css.semPermissao} role="note">
        <Cadeado tamanho={16} />
        {canal.tipo === "voz" ? chat.semPermissaoNaSala : chat.semPermissaoParaEscrever}
      </p>
    );
  }

  const mudar = (texto: string) => {
    escreverRascunho(canalId, texto);
    if (texto.trim() === "") digitacao.aoParar(canalId);
    else digitacao.aoDigitar(canalId);
  };

  const adicionar = (novos: readonly File[]) => {
    const teto = tetoDeUploadBytes("attachments");
    const aceitos: File[] = [];
    let recusa: string | undefined;
    for (const arquivo of novos) {
      if (arquivo.size === 0) continue;
      if (teto !== undefined && arquivo.size > teto) {
        const limite = tetoDeUploadTexto("attachments");
        recusa = `${chat.arquivoGrande(arquivo.name)}${limite === undefined ? "" : ` ${chat.limiteDeEnvio(limite)}`}`;
        continue;
      }
      aceitos.push(arquivo);
    }
    const cabem = Math.max(0, MAXIMO_DE_ANEXOS - arquivos.length);
    setArquivos((atuais) => [...atuais, ...aceitos.slice(0, cabem)]);
    setAviso(recusa);
  };

  const enviar = (texto: string) => {
    const id = enviarMensagem(
      canalId,
      texto,
      alvo === undefined ? undefined : { id: alvo.messageId, mencionar: alvo.mencionar },
      arquivos.length > 0 ? arquivos : undefined,
    );
    // `undefined`: o núcleo recusou (canal ainda não carregado). O rascunho fica.
    if (id === undefined) return;
    limparRascunho(canalId);
    cancelarResposta(canalId);
    setArquivos([]);
    setAviso(undefined);
    // Quem acabou de falar quer ver a própria fala, mesmo lendo o histórico.
    pedirFimDaLista(canalId);
  };

  const aoTeclar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && alvo !== undefined) {
      e.preventDefault();
      cancelarResposta(canalId);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        envolver(e.currentTarget, "**", mudar);
      } else if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        envolver(e.currentTarget, "*", mudar);
      }
    }
  };

  const inserirEmoji = (glifo: string) => {
    registrarEmojiRecente(glifo);
    const el = area.current;
    // Na posição do cursor; concatenar no fim faria o glifo saltar para depois de uma frase já escrita.
    const de = el?.selectionStart ?? rascunho.length;
    const ate = el?.selectionEnd ?? rascunho.length;
    mudar(`${rascunho.slice(0, de)}${glifo}${rascunho.slice(ate)}`);
    setEmojiAberto(false);
    requestAnimationFrame(() => {
      el?.setSelectionRange(de + glifo.length, de + glifo.length);
    });
  };

  const aoColar = (e: ClipboardEvent<HTMLDivElement>) => {
    if (e.clipboardData.files.length === 0) return;
    // Imagem colada vira anexo; texto colado segue o caminho normal do campo.
    e.preventDefault();
    adicionar(Array.from(e.clipboardData.files));
  };
  const aoSoltar = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    adicionar(Array.from(e.dataTransfer.files));
  };

  const podeAnexar = temServidorDeMidia();
  const nome = nomeDaConversa(canal, pessoaDaDm);
  const topo =
    alvo !== undefined || arquivos.length > 0 || aviso !== undefined ? (
      <div className={css.topo}>
        {alvo !== undefined && <PreviaDeResposta alvoId={alvo.messageId} mencionar={alvo.mencionar} canalId={canalId} servidorId={servidorId} />}
        {arquivos.length > 0 && (
          <ul className={css.fichas} aria-label={chat.anexosSelecionados}>
            {arquivos.map((arquivo, i) => (
              <FichaDeAnexo
                key={`${arquivo.name}:${arquivo.size}:${arquivo.lastModified}:${i}`}
                arquivo={arquivo}
                aoRemover={() => {
                  setArquivos((atuais) => atuais.filter((outro) => outro !== arquivo));
                }}
              />
            ))}
          </ul>
        )}
        {aviso !== undefined && (
          <p className={css.aviso} role="alert">
            {aviso}
          </p>
        )}
      </div>
    ) : undefined;

  return (
    <>
    <SeletorNoComposer
      aberto={emojiAberto}
      aoMudar={setEmojiAberto}
      aoEscolher={inserirEmoji}
      aoFechar={() => {
        area.current?.focus();
      }}
    >
    <div
      className={css.composer}
      onPaste={aoColar}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={aoSoltar}
    >
      <CampoDeMensagem
        valor={rascunho}
        onChange={mudar}
        onEnviar={enviar}
        placeholder={
          canal.tipo === "notas"
            ? chat.placeholderDasNotas
            : canal.tipo === "dm" || canal.tipo === "grupo"
              ? chat.placeholderDaConversa(nome)
              : chat.placeholderDoCampo(nome)
        }
        permitirVazio={arquivos.length > 0}
        topo={topo}
        areaRef={(el) => {
          area.current = el;
        }}
        onKeyDown={aoTeclar}
        onEmoji={() => {
          setEmojiAberto((a) => !a);
        }}
        onEnquete={
          // Some (não fica cinza) sem a função no servidor ou sem permissão de enviar.
          temEnquetes && pode(canalId, "enviar")
            ? () => {
                setEnqueteEm(canalId);
              }
            : undefined
        }
        onAnexar={
          podeAnexar
            ? () => {
                seletor.current?.click();
              }
            : undefined
        }
      />
      <input
        ref={seletor}
        type="file"
        multiple
        hidden
        data-testid="seletor-de-arquivos"
        onChange={(e) => {
          adicionar(Array.from(e.target.files ?? []));
          // Limpa para permitir escolher o mesmo arquivo de novo depois de removê-lo.
          e.target.value = "";
        }}
      />
      {falhadas > 0 && (
        <p className={`${css.conexao} ${css.conexaoFalha}`} role="status">
          <Alerta tamanho={14} />
          {chat.falhadasNoCanal(falhadas, conectado)}
        </p>
      )}
    </div>
    </SeletorNoComposer>
    {/* Fora do campo: eventos de portal sobem pela árvore React, e colar ou soltar arquivo no diálogo viraria anexo. */}
    <CriarEnquete
      canalId={enqueteEm}
      aoFechar={() => {
        setEnqueteEm(undefined);
      }}
    />
    </>
  );
}
