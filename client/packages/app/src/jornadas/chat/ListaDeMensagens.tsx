import { useVirtualizer } from "@tanstack/react-virtual";
import { count } from "nucleo/arnes/stats";
import { criarAgrupadorDeSistema } from "nucleo/sdk/agrupamentoDeSistema";
import { remedir } from "nucleo/lib/remedir";
import {
  carregarHistorico,
  carregarPaginaAnterior,
  marcarCanalLido,
  messages,
  primeiraNaoLida,
  proximaMencao,
  idsDeMencao,
} from "nucleo/sdk/adapter";
import { assinarAparencia, lerAparencia } from "nucleo/store/aparencia";
import { assinarDensidade, lerDensidade } from "nucleo/store/densidade";
import { useChannelMessageIds } from "nucleo/store/hooks";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { chat } from "../../textos";
import { Botao } from "../../ui/ds";
import { Arroba, SetaParaBaixo, SetaParaCima } from "../../ui/icones";
import {
  ALTURA_DA_CITACAO,
  ALTURA_DAS_REACOES,
  ALTURA_DO_DIVISOR,
  ALTURA_DO_DIVISOR_DE_NOVAS,
  ALTURA_DO_ESTADO_DE_ENVIO,
  ALTURA_ESTIMADA,
  LIMIAR_DE_FIM,
  LIMIAR_DE_LONGE,
  LIMIAR_DE_PAGINACAO,
  alturaDaEnquete,
  alturaDoTipo,
  amostrarAltura,
  amostrarAlturaDeEmbeds,
  type TipoDeLinha,
} from "./alturas";
import { alturaDeAnexos } from "./caixaDoAnexo";
import { alturaDeEmbeds, RESPIRO_DO_EMBED } from "./caixaDoEmbed";
import { CarregandoHistorico, ComecoDoCanal, FalhaNoHistorico } from "./EstadosDaLista";
import { useEstadoDoHistorico } from "./hooks";
import { LinhaDeMensagem } from "./LinhaDeMensagem";
import css from "./ListaDeMensagens.module.css";
import { MenuDaLista } from "./MenuDaLista";
import { aoPedirFim, aoPedirSalto } from "./saltos";

export interface ListaDeMensagensProps {
  canalId: string;
  servidorId: string;
}

/** Quanto tempo um salto espera a mensagem de destino aparecer na lista. */
const PRAZO_DO_SALTO_PENDENTE_MS = 8000;

/** Quanto tempo a linha de destino fica realçada. */
const DURACAO_DO_REALCE_MS = 2200;

/**
 * Realça a linha de uma mensagem por um instante. A linha pode ainda não estar
 * montada (o virtualizador acabou de rolar até ela), então procura por alguns
 * quadros. Devolve quem desfaz.
 */
function realcarLinha(raiz: HTMLElement, chave: string, reapontar?: () => void): () => void {
  let quadro = 0;
  let fim = 0;
  let tentativas = 0;
  let alvo: HTMLElement | null = null;
  const tentar = () => {
    alvo = raiz.querySelector<HTMLElement>(`[data-menu-mensagem="${CSS.escape(chave)}"]`);
    if (alvo === null) {
      tentativas += 1;
      // Defesa, não conserto: a causa do salto que parava fora da janela (o fim de rolagem
      // relatando posição velha) era do TanStack, corrigida na `virtual-core@3.19` e guardada por
      // `fimDeRolagem.test.ts`. Fica porque a reconciliação do
      // TanStack só reescreve quando o ALVO muda: qualquer outro deslocamento depois do salto
      // ficaria parado ali, e o realce desistiria calado. Custa um `indexOf` a cada 10
      // quadros, e só enquanto a linha não aparece.
      if (tentativas % 10 === 0) reapontar?.();
      if (tentativas < 90) quadro = requestAnimationFrame(tentar);
      return;
    }
    alvo.dataset.realcada = "true";
    fim = window.setTimeout(() => {
      alvo?.removeAttribute("data-realcada");
    }, DURACAO_DO_REALCE_MS);
  };
  tentar();
  return () => {
    cancelAnimationFrame(quadro);
    clearTimeout(fim);
    alvo?.removeAttribute("data-realcada");
  };
}

/** Rolagem iniciada por gente: só ela pode DESCOLAR a lista do fim. */
const TECLAS_DE_ROLAGEM = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/** Um booleano observável fora do React: a rolagem muda dezenas de vezes por segundo. */
function criarSinal() {
  let valor = false;
  const ouvintes = new Set<() => void>();
  return {
    ler: () => valor,
    escrever: (novo: boolean) => {
      if (novo === valor) return;
      valor = novo;
      for (const ouvinte of ouvintes) ouvinte();
    },
    assinar: (ouvinte: () => void) => {
      ouvintes.add(ouvinte);
      return () => {
        ouvintes.delete(ouvinte);
      };
    },
  };
}

/**
 * Lista de mensagens virtualizada, em modo chat (lei nº 2: virtualização desde a
 * primeira linha). Ordem normal e container de scroll normal: nada de
 * `column-reverse`, transform invertido ou compensação manual de `scrollTop`.
 *
 * Mecânica herdada do spike (ver o `MessageList` do `client`, que tem as
 * medições):
 *  - `anchorTo: "end"` + `followOnAppend` com o MESMO limiar que a nossa noção
 *    de "colado" (se divergirem, a lista acha que segue enquanto o virtualizador
 *    já desistiu, e o gate mede uma lista parada);
 *  - `getItemKey` por ID de entidade, nunca índice — é o que faz o prepend do
 *    histórico não saltar: o virtualizador reancora pela chave do item sob o
 *    scroll;
 *  - `useFlushSync` no default: sem o flush a compensação estimativa-real não
 *    segura a âncora (os avisos de flushSync no console de dev são o preço);
 *  - rede de segurança por `ResizeObserver` do medidor: se o conteúdo cresce e a
 *    pessoa estava no fim, volta ao fim, mesmo que o virtualizador já tenha
 *    desistido (o desengate dele é irreversível);
 *  - largura do container mudou = remedir (`remedir`, nunca `measure()` cru);
 *    altura mudou = reancorar.
 *
 * Leitura como posição: primeira não lida, divisor de novas mensagens e próxima
 * menção. O menu de contexto é UM, no nível da lista.
 */
export function ListaDeMensagens({ canalId, servidorId }: ListaDeMensagensProps) {
  count("listRenders");
  const bruto = useChannelMessageIds(canalId);
  // Linhas de sistema seguidas do mesmo tipo viram UMA ("Ana e mais 4 entraram"). As absorvidas
  // saem da lista que o virtualizador enxerga: linha com altura zero realimentaria a medição.
  // Incremental: só o trecho que mudou é reavaliado (append reavalia o fim, não as 10k).
  const agrupador = useMemo(() => criarAgrupadorDeSistema((id) => messages.getSnapshot(id)), []);
  const { visiveis: ids, grupos } = useMemo(() => agrupador(bruto), [agrupador, bruto]);
  const historico = useEstadoDoHistorico(canalId);
  const rolagem = useRef<HTMLDivElement | null>(null);
  const medidor = useRef<HTMLDivElement | null>(null);
  const temLista = ids.length > 0;

  // O histórico, uma vez por canal: montar a lista é o sinal exato de "alguém vai ler agora".
  useEffect(() => {
    void carregarHistorico(canalId);
  }, [canalId]);

  // Os IDs mais recentes para os pedidos que chegam de fora (salto, fim): lidos em
  // evento, nunca no render.
  const idsAtuais = useRef(ids);
  useEffect(() => {
    idsAtuais.current = ids;
  });

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual: o compiler pula este componente; o memo da linha cobre os filhos
  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => rolagem.current,
    // Lê do store direto: `getSnapshot` é leitura de Map, e o virtualizador pergunta
    // por linhas que ainda nem estão na tela (não há componente para perguntar).
    estimateSize: (i) => {
      const previasLigadas = lerAparencia().previasDeLink;
      const m = messages.getSnapshot(ids[i] ?? "");
      if (!m) return ALTURA_ESTIMADA;
      const tipo: TipoDeLinha = m.sistema ? "sistema" : m.iniciaGrupo ? "abreGrupo" : "continua";
      return (
        alturaDoTipo(tipo, lerDensidade(), lerAparencia().texto) +
        (m.dia === undefined ? 0 : ALTURA_DO_DIVISOR) +
        (m.primeiraNaoLida ? ALTURA_DO_DIVISOR_DE_NOVAS : 0) +
        (m.respostas.length > 0 ? ALTURA_DA_CITACAO : 0) +
        (m.reactions.length > 0 ? ALTURA_DAS_REACOES : 0) +
        (m.sendState !== "sent" ? ALTURA_DO_ESTADO_DE_ENVIO : 0) +
        (m.enquete ? alturaDaEnquete(m.enquete.opcoes.length) : 0) +
        alturaDeAnexos(m.anexos) +
        (previasLigadas ? alturaDeEmbeds(m.embeds) : 0)
      );
    },
    getItemKey: (i) => ids[i] ?? i,
    measureElement: (el) => (el as HTMLElement).offsetHeight,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: LIMIAR_DE_FIM,
    overscan: 6,
  });

  // Estava colado no fim ANTES da mudança? Guardado no scroll, não perguntado
  // depois: quando o observador dispara, o layout novo já valeu.
  const colado = useRef(true);
  const dirigindo = useRef(false);
  const [longe] = useState(criarSinal);
  const estaLonge = useSyncExternalStore(longe.assinar, longe.ler);

  useEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    let limpeza = 0;
    let quadro = 0;
    let segurando = false;
    const aoDirigir = () => {
      dirigindo.current = true;
      if (limpeza !== 0) clearTimeout(limpeza);
      // 150ms: uma roda de mouse emite uma rajada com o `scroll` vindo atrás.
      limpeza = window.setTimeout(() => {
        dirigindo.current = segurando;
      }, 150);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (TECLAS_DE_ROLAGEM.has(e.key)) aoDirigir();
    };
    // Ponteiro pressionado sobre o PRÓPRIO container: arrastar a barra de rolagem (ou
    // clicar na calha dela) é rolagem de gente tanto quanto a roda, mas não emite
    // `wheel` nem tecla. Clique dentro de uma linha tem a linha como alvo e não conta,
    // então selecionar texto não descola. O gesto vale enquanto o botão estiver
    // pressionado, sem prazo: um arraste da barra pode durar segundos.
    const soltar = () => {
      if (!segurando) return;
      segurando = false;
      // O `scroll` do último movimento chega depois do `pointerup`: a janela de
      // sempre cobre a cauda.
      aoDirigir();
    };
    const aoPressionar = (e: PointerEvent) => {
      if (e.target !== el) return;
      segurando = true;
      dirigindo.current = true;
    };
    // Rede de segurança: se o `pointerup` se perder (soltar fora da janela), o próximo
    // movimento sem botão encerra o gesto — senão a ancoragem programática passaria a
    // descolar a lista para sempre.
    const aoMover = (e: PointerEvent) => {
      if (segurando && e.buttons === 0) soltar();
    };
    // Descolar exige gesto; colar não. Posição sozinha mente: a lista também se
    // afasta do fim quando o conteúdo cresce embaixo.
    const aoRolar = () => {
      // A página anterior quando o topo se aproxima. Sem coalescer aqui: o cadeado
      // por canal está em `carregarPaginaAnterior`, e rolar rápido dispara isto
      // dezenas de vezes.
      if (el.scrollTop <= LIMIAR_DE_PAGINACAO) void carregarPaginaAnterior(canalId);

      const distancia = el.scrollHeight - el.clientHeight - el.scrollTop;
      if (distancia <= LIMIAR_DE_FIM) colado.current = true;
      else if (dirigindo.current) colado.current = false;

      // "Ir para as mensagens recentes": coalescido por quadro. Publicar no meio do
      // `flushSync` do virtualizador travou a aba no cliente anterior.
      if (quadro === 0) {
        quadro = requestAnimationFrame(() => {
          quadro = 0;
          longe.escrever(el.scrollHeight - el.clientHeight - el.scrollTop > LIMIAR_DE_LONGE);
        });
      }
    };
    el.addEventListener("scroll", aoRolar, { passive: true });
    el.addEventListener("wheel", aoDirigir, { passive: true });
    el.addEventListener("touchstart", aoDirigir, { passive: true });
    el.addEventListener("keydown", aoTeclar);
    el.addEventListener("pointerdown", aoPressionar, { passive: true });
    // Na janela, não no container: o botão pode ser solto fora dele.
    window.addEventListener("pointerup", soltar, { passive: true });
    window.addEventListener("pointercancel", soltar, { passive: true });
    window.addEventListener("pointermove", aoMover, { passive: true });
    window.addEventListener("blur", soltar);
    return () => {
      el.removeEventListener("pointerdown", aoPressionar);
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointercancel", soltar);
      window.removeEventListener("pointermove", aoMover);
      window.removeEventListener("blur", soltar);
      el.removeEventListener("scroll", aoRolar);
      el.removeEventListener("wheel", aoDirigir);
      el.removeEventListener("touchstart", aoDirigir);
      el.removeEventListener("keydown", aoTeclar);
      if (limpeza !== 0) clearTimeout(limpeza);
      if (quadro !== 0) cancelAnimationFrame(quadro);
    };
    // `temLista`: sem lista não há container, e o efeito não ligaria na primeira
    // abertura de um canal que nasce vazio.
  }, [canalId, temLista, longe]);

  // O CONTEÚDO cresceu: reancora quem queria estar no fim. Observa o medidor (cuja
  // altura é `getTotalSize()`), não o container: são eventos diferentes.
  useEffect(() => {
    const m = medidor.current;
    if (!m) return;
    let ultima = m.getBoundingClientRect().height;
    const obs = new ResizeObserver(() => {
      const altura = m.getBoundingClientRect().height;
      const cresceu = altura > ultima;
      ultima = altura;
      // Encolher é mensagem apagada: a posição de leitura vale mais que a âncora.
      if (cresceu && colado.current) virtualizer.scrollToEnd();
    });
    obs.observe(m);
    return () => {
      obs.disconnect();
    };
  }, [virtualizer, temLista]);

  // Largura mudou = remedir; altura mudou = reancorar. Assertions em dev para o
  // dia em que alguém mexer aqui e esquecer uma das duas.
  const ultimaLargura = useRef(0);
  const ultimaAltura = useRef(0);
  useEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    const obs = new ResizeObserver(([entrada]) => {
      const largura = entrada?.contentRect.width ?? 0;
      const altura = entrada?.contentRect.height ?? 0;
      if (largura !== ultimaLargura.current) {
        ultimaLargura.current = largura;
        remedir(virtualizer);
        if (import.meta.env.DEV && virtualizer.getVirtualItems().length > 0) {
          const medidas = virtualizer.measurementsCache.length;
          const total = virtualizer.options.count;
          if (medidas !== total) {
            console.warn(
              `[vortex] largura do container mudou e a remedição não cobriu todas as linhas (${medidas}/${total}). A âncora vai saltar.`,
            );
          }
        }
      }
      if (altura !== ultimaAltura.current) {
        ultimaAltura.current = altura;
        if (colado.current) virtualizer.scrollToEnd();
      }
    });
    obs.observe(el);
    return () => {
      obs.disconnect();
    };
    // `ids.length` fora de propósito: reconectar o observador a cada frame do firehose.
  }, [virtualizer, temLista]);

  // Densidade ou tamanho do texto mudou: as linhas mudam de altura sem a largura do
  // container mudar, então o observador acima não dispara. Remede o que está montado
  // (a estimativa do resto já lê o ajuste novo) e reancora quem estava no fim.
  const ajuste = useSyncExternalStore(
    (ouvir) => {
      const a = assinarDensidade(ouvir);
      const b = assinarAparencia(ouvir);
      return () => {
        a();
        b();
      };
    },
    () => `${lerDensidade()}|${String(lerAparencia().texto)}|${String(lerAparencia().previasDeLink)}`,
  );
  const ajusteAnterior = useRef(ajuste);
  useEffect(() => {
    if (ajusteAnterior.current === ajuste) return;
    ajusteAnterior.current = ajuste;
    remedir(virtualizer);
    if (colado.current) virtualizer.scrollToEnd();
  }, [ajuste, virtualizer]);

  // `scrollToEnd` depois da carga inicial: o drift entre altura estimada e real
  // soma ~1000px em 10k linhas, a lista passa do limiar e `followOnAppend`
  // desliga em silêncio. O sintoma não é visual: é o firehose medindo uma lista parada.
  const ancorou = useRef(false);
  useEffect(() => {
    if (ancorou.current || ids.length === 0) return;
    ancorou.current = true;
    virtualizer.scrollToEnd();
  }, [ids.length, virtualizer]);

  // O realce da linha de destino: imperativo, sem estado nem assinatura por linha.
  // Uma subscrição a mais em cada uma das milhares de linhas custaria o gate para
  // acender UMA por vez; o atributo no DOM custa nada e some sozinho.
  const saltoPendente = useRef<{ alvo: string; ate: number } | undefined>(undefined);
  const desfazerRealce = useRef<(() => void) | undefined>(undefined);
  const realcarDepois = useCallback((alvo: string) => {
    desfazerRealce.current?.();
    const raiz = rolagem.current;
    desfazerRealce.current = raiz
      ? realcarLinha(raiz, alvo, () => {
          const i = idsAtuais.current.indexOf(alvo);
          if (i !== -1) virtualizer.scrollToIndex(i, { align: "center" });
        })
      : undefined;
  }, [virtualizer]);
  useEffect(
    () => () => {
      desfazerRealce.current?.();
    },
    [],
  );

  // Pedidos de fora: ir ao fim (depois de enviar) e saltar para uma mensagem
  // (citação de resposta, próxima menção, resultado de busca).
  useEffect(() => {
    const desfazFim = aoPedirFim(canalId, () => {
      colado.current = true;
      virtualizer.scrollToEnd();
    });
    const desfazSalto = aoPedirSalto(canalId, (alvo) => {
      const i = idsAtuais.current.indexOf(alvo);
      if (i === -1) {
        // A mensagem acabou de ser carregada (resultado de busca antigo): a lista
        // só a enxerga no próximo render. Guarda o pedido por alguns segundos.
        saltoPendente.current = { alvo, ate: Date.now() + PRAZO_DO_SALTO_PENDENTE_MS };
        return;
      }
      saltoPendente.current = undefined;
      colado.current = false;
      virtualizer.scrollToIndex(i, { align: "center" });
      realcarDepois(alvo);
    });
    return () => {
      desfazFim();
      desfazSalto();
    };
  }, [canalId, virtualizer, realcarDepois]);

  // O salto que esperava a mensagem existir na lista.
  useEffect(() => {
    const pendente = saltoPendente.current;
    if (pendente === undefined) return;
    if (Date.now() > pendente.ate) {
      saltoPendente.current = undefined;
      return;
    }
    const i = ids.indexOf(pendente.alvo);
    if (i === -1) return;
    saltoPendente.current = undefined;
    colado.current = false;
    virtualizer.scrollToIndex(i, { align: "center" });
    realcarDepois(pendente.alvo);
  }, [ids, virtualizer, realcarDepois]);

  // Ack ao ler: quem está no fim, com a janela à vista, leu. O cursor do divisor só
  // anda ao SAIR do canal; isto avisa o servidor e zera as contagens. Reiniciado a
  // cada mudança da lista, então sob rajada só confirma quando ela assenta.
  useEffect(() => {
    if (!temLista) return;
    const t = window.setTimeout(() => {
      if (colado.current && document.visibilityState === "visible") marcarCanalLido(canalId);
    }, 1200);
    return () => {
      clearTimeout(t);
    };
  }, [canalId, ids.length, temLista]);

  // A primeira menção ainda não visitada, para "próxima" significar próxima.
  const ultimaMencao = useRef<string | undefined>(undefined);

  const saltarParaMencao = () => {
    const alvo = proximaMencao(canalId, ultimaMencao.current);
    if (alvo === undefined) return;
    ultimaMencao.current = alvo;
    const i = ids.indexOf(alvo);
    if (i === -1) return;
    colado.current = false;
    virtualizer.scrollToIndex(i, { align: "center" });
  };

  if (!temLista) {
    if (historico.inicial === "carregando") return <CarregandoHistorico />;
    if (historico.inicial === "falhou") return <FalhaNoHistorico canalId={canalId} />;
    return <ComecoDoCanal canalId={canalId} />;
  }

  const itens = virtualizer.getVirtualItems();

  // Altura real por tipo para o relatório do arnês: chutar e não conferir é como
  // os 44px sobreviveram. Mede no render, depois do virtualizador ter medido. Linha
  // com extra estimado (divisor, resposta, anexo, reação, estado) fica fora: a
  // constante descreve a linha sem eles.
  const previasLigadas = lerAparencia().previasDeLink;
  for (const item of itens) {
    const m = messages.getSnapshot(String(item.key));
    if (!m) continue;
    // O bloco de embeds é conferido à parte (altura MEDIDA do bloco contra `alturaDeEmbeds`).
    // Só em dev: lê o DOM da linha, e a assertion some do bundle de produção.
    if (import.meta.env.DEV && previasLigadas && m.embeds.length > 0) {
      const bloco = rolagem.current?.querySelector<HTMLElement>(`[data-index="${String(item.index)}"] [data-embeds]`);
      if (bloco) amostrarAlturaDeEmbeds(bloco.offsetHeight + RESPIRO_DO_EMBED, alturaDeEmbeds(m.embeds));
    }
    const comExtra =
      m.dia !== undefined ||
      m.primeiraNaoLida ||
      m.respostas.length > 0 ||
      m.reactions.length > 0 ||
      m.enquete !== undefined ||
      m.anexos.length > 0 ||
      (previasLigadas && m.embeds.length > 0) ||
      m.sendState !== "sent";
    amostrarAltura(m.sistema ? "sistema" : m.iniciaGrupo ? "abreGrupo" : "continua", item.size, comExtra);
  }

  // Linha medindo 0px é bug, não estado: realimenta o virtualizador e trava a aba.
  // `offsetParent` distingue NÃO RENDERIZADO (display: none, painel colapsado) de
  // renderizado com zero, e só o segundo é bug.
  if (import.meta.env.DEV && rolagem.current?.offsetParent) {
    const zero = itens.find((item) => item.size === 0);
    if (zero) {
      console.error(
        `[vortex] linha ${String(zero.key)} mediu 0px. Linha não resolvida deve renderizar placeholder com altura, nunca null.`,
      );
    }
  }

  // Leitura como posição: a primeira não lida está ACIMA do que se vê? Então o atalho.
  const naoLida = primeiraNaoLida(canalId);
  const indiceDaNaoLida = naoLida === undefined ? -1 : ids.indexOf(naoLida);
  const primeiraVisivel = itens[0]?.index ?? 0;
  const naoLidaAcima = indiceDaNaoLida !== -1 && indiceDaNaoLida < primeiraVisivel;
  // Só vale o atalho quando há menção que a pessoa NÃO está vendo: com todas à tela, ele
  // seria um botão cobrindo texto para ir a lugar nenhum.
  const faixa = virtualizer.range;
  const mencoes = idsDeMencao(canalId);
  const haMencao =
    mencoes.length > 0 &&
    (faixa === null ||
      mencoes.some((id) => {
        const i = ids.indexOf(id);
        return i !== -1 && (i < faixa.startIndex || i > faixa.endIndex);
      }));

  return (
    <div className={css.raiz}>
      <MenuDaLista>
        <div
          ref={rolagem}
          role="log"
          aria-label={chat.listaDeMensagens}
          aria-live="polite"
          aria-relevant="additions"
          // Região que rola e não recebe foco é inoperável por teclado.
          tabIndex={0}
          className={css.rolagem}
        >
          <div className={css.coluna}>
            <div ref={medidor} className={css.medidor} style={{ blockSize: `${virtualizer.getTotalSize()}px` }}>
              {itens.map((item) => (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className={css.linha}
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <LinhaDeMensagem id={String(item.key)} servidorId={servidorId} grupo={grupos.get(String(item.key))} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </MenuDaLista>

      {historico.pagina && (
        <p className={css.paginando} role="status">
          {chat.carregandoAnteriores}
        </p>
      )}

      {naoLidaAcima && (
        <div className={css.barraDeNaoLida}>
          <Botao
            variante="secundario"
            tamanho="sm"
            icone={<SetaParaCima />}
            onClick={() => {
              colado.current = false;
              virtualizer.scrollToIndex(indiceDaNaoLida, { align: "start" });
            }}
          >
            {chat.irParaNaoLida}
          </Botao>
        </div>
      )}

      {haMencao && (
        <div className={css.saltoDeMencao}>
          <Botao variante="secundario" tamanho="sm" icone={<Arroba />} onClick={saltarParaMencao}>
            {chat.proximaMencao}
          </Botao>
        </div>
      )}

      <div className={css.saltos}>
        {estaLonge && (
          <Botao
            variante="secundario"
            tamanho="sm"
            icone={<SetaParaBaixo />}
            onClick={() => {
              colado.current = true;
              virtualizer.scrollToEnd();
            }}
          >
            {chat.irParaOFim}
          </Botao>
        )}
      </div>
    </div>
  );
}
