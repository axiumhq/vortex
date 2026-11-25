import { useVirtualizer } from "@tanstack/react-virtual";
import { quando } from "nucleo/lib/quando";
import { carregarTopicosDoCanal } from "nucleo/sdk/topicos";
import { useMinutoAtual, useTopico, useTopicosDoCanal, useTopicosDoServidor } from "nucleo/store/hooks";
import { abrirTexto } from "nucleo/store/ultimoLugar";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { topicos as t } from "../../textos";
import { Botao, PainelVidro } from "../../ui/ds";
import { Fechar } from "../../ui/icones";
import { fecharTopicosDevolvendoFoco } from "./hooks";
import css from "./PainelDeTopicos.module.css";

type Recorte = "ativos" | "arquivados";
type Carga = "carregando" | "pronta" | "erro";

/** Altura fixa de um item: nome numa linha e metadado na outra. Sem medir. */
const ALTURA_DO_ITEM = 60;

function Esqueleto() {
  return (
    <div className={css.esqueleto} role="status" aria-busy="true" aria-label={t.estados.carregando}>
      {["a", "b", "c"].map((id) => (
        <div key={id} className={css.esqueletoLinha} aria-hidden="true">
          <span className={css.esqueletoNome} />
          <span className={css.esqueletoMeta} />
        </div>
      ))}
    </div>
  );
}

/** Um item: assina SÓ o próprio tópico. Uma resposta nova toca uma linha, não o painel. */
function Item({ id, aoAbrir }: { id: string; aoAbrir: (id: string) => void }) {
  const topico = useTopico(id);
  const agora = useMinutoAtual();
  if (!topico) return null;
  return (
    <button
      type="button"
      className={css.ir}
      data-topico-ir=""
      data-arquivado={topico.arquivado || undefined}
      aria-label={t.lista.abrir(topico.nome)}
      onClick={() => {
        aoAbrir(id);
      }}
    >
      <span className={css.nome} aria-hidden="true">
        {topico.nome}
      </span>
      <span className={css.meta} aria-hidden="true">
        <span>{t.lista.respostas(topico.respostas)}</span>
        <span className={css.hora}>{quando(topico.ultimaEm, agora, "curto")}</span>
      </span>
    </button>
  );
}

/**
 * O painel de tópicos do canal, na área da gaveta (a mesma da busca e das
 * fixadas, que ele substitui enquanto aberto).
 *
 * A lista é o recorte `canal:<id>` do store de tópicos — por ID, ordenada por
 * última atividade — e `carregarTopicosDoCanal` traz o que o `Ready` não traz
 * (os arquivados). Ativos e arquivados saem dos recortes do SERVIDOR, que já
 * separam por estado: filtrar lendo cada snapshot exigiria um hook por item
 * antes de saber quantos itens há.
 *
 * Virtualizado (lei nº 2): um canal movimentado acumula tópicos por anos e a
 * lista cresce sem teto.
 */
export function PainelDeTopicos({ canalId, servidorId }: { canalId: string; servidorId: string }) {
  const raiz = useRef<HTMLDivElement | null>(null);
  const rolagem = useRef<HTMLDivElement | null>(null);
  const [recorte, setRecorte] = useState<Recorte>("ativos");
  const [carga, setCarga] = useState<Carga>("carregando");
  const [tentativa, setTentativa] = useState(0);

  const doCanal = useTopicosDoCanal(canalId);
  const ativosDoServidor = useTopicosDoServidor(servidorId, "ativos");
  const arquivadosDoServidor = useTopicosDoServidor(servidorId, "arquivados");
  const ids = useMemo(() => {
    const dele = new Set(recorte === "ativos" ? ativosDoServidor : arquivadosDoServidor);
    return doCanal.filter((id) => dele.has(id));
  }, [doCanal, ativosDoServidor, arquivadosDoServidor, recorte]);

  useEffect(() => {
    raiz.current?.focus();
  }, []);

  // Busca os arquivados ao abrir (e de novo no "tentar de novo"). Resposta de painel já fechado não escreve.
  useEffect(() => {
    let vivo = true;
    void carregarTopicosDoCanal(canalId).then((ok) => {
      if (vivo) setCarga(ok ? "pronta" : "erro");
    });
    return () => {
      vivo = false;
    };
  }, [canalId, tentativa]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual: o compiler pula este componente
  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => rolagem.current,
    estimateSize: () => ALTURA_DO_ITEM,
    getItemKey: (i) => ids[i] ?? i,
    overscan: 6,
  });

  const abrir = (id: string) => {
    abrirTexto(servidorId, id);
  };

  const aoTeclar = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      fecharTopicosDevolvendoFoco();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const alvos = [...(raiz.current?.querySelectorAll<HTMLElement>("[data-topico-ir]") ?? [])];
    if (alvos.length === 0) return;
    e.preventDefault();
    const atual = alvos.indexOf(document.activeElement as HTMLElement);
    const proximo = e.key === "ArrowDown" ? Math.min(atual + 1, alvos.length - 1) : Math.max(atual - 1, 0);
    alvos[proximo]?.focus();
  };

  let corpo: ReactNode;
  if (ids.length > 0) {
    corpo = (
      <div
        ref={rolagem}
        className={css.rolagem}
        data-testid="lista-de-topicos"
        role="list"
        aria-label={t.lista.rotulo(t.recortes[recorte].toLowerCase())}
      >
        <div className={css.trilho} style={{ blockSize: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const id = ids[item.index];
            if (id === undefined) return null;
            return (
              <div
                key={id}
                role="listitem"
                className={css.linha}
                style={{ blockSize: item.size, transform: `translateY(${item.start}px)` }}
              >
                <Item id={id} aoAbrir={abrir} />
              </div>
            );
          })}
        </div>
      </div>
    );
  } else if (carga === "carregando") {
    corpo = <Esqueleto />;
  } else if (carga === "erro") {
    corpo = (
      <div className={css.estado} role="alert">
        <p className={css.estadoTitulo}>{t.estados.erro}</p>
        <Botao
          variante="secundario"
          tamanho="sm"
          onClick={() => {
            setCarga("carregando");
            setTentativa((n) => n + 1);
          }}
        >
          {t.estados.tentarDeNovo}
        </Botao>
      </div>
    );
  } else {
    corpo = (
      <div className={css.estado} role="status">
        <p className={css.estadoTitulo}>
          {recorte === "ativos" ? t.estados.vazioAtivos : t.estados.vazioArquivados}
        </p>
        {recorte === "ativos" && <p className={css.estadoDica}>{t.estados.vazioAtivosDica}</p>}
      </div>
    );
  }

  return (
    <PainelVidro
      como="aside"
      raio="xl"
      aria-label={t.painel}
      className={css.painel}
      onKeyDown={aoTeclar}
      data-testid="painel-de-topicos"
    >
      <div ref={raiz} tabIndex={-1} className={css.miolo}>
        <div className={css.cabeca}>
          <h2 className={css.titulo}>{t.titulo}</h2>
          <Botao
            variante="fantasma"
            tamanho="sm"
            icone={<Fechar />}
            aria-label={t.fechar}
            title={t.fecharComAtalho}
            onClick={fecharTopicosDevolvendoFoco}
          />
        </div>
        <div className={css.recortes} role="tablist" aria-label={t.recortes.rotulo}>
          {(["ativos", "arquivados"] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              className={css.recorte}
              aria-selected={recorte === r}
              onClick={() => {
                setRecorte(r);
              }}
            >
              {t.recortes[r]}
            </button>
          ))}
        </div>
        <div className={css.corpo}>{corpo}</div>
      </div>
    </PainelVidro>
  );
}
