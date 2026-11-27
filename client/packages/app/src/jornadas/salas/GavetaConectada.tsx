import { useVirtualizer } from "@tanstack/react-virtual";
import { chaveDeMembro, SEM_CARGO } from "nucleo/sdk/domain";
import { abrirCartaoDeUsuario } from "nucleo/store/cartaoDeUsuario";
import {
  useConexao,
  useMembro,
  useMembrosOffline,
  useModoDaGaveta,
  usePresence,
  useProntidao,
  useSecoesOnline,
} from "nucleo/store/hooks";
import { useMemo, useRef } from "react";

import { salas, shell } from "../../textos";
import { Avatar } from "../../ui/ds";
import css from "./Membros.module.css";

type Linha =
  | { tipo: "cabecalho"; chave: string; rotulo: string; total: number }
  | { tipo: "membro"; chave: string; id: string };

const ALTURA = {
  lista: { cabecalho: 32, membro: 44 },
  icones: { cabecalho: 16, membro: 52 },
} as const;

function Membro({
  serverId,
  id,
  modo,
  desatualizada,
}: {
  serverId: string;
  id: string;
  modo: "lista" | "icones";
  desatualizada: boolean;
}) {
  const membro = useMembro(chaveDeMembro(serverId, id));
  const presenca = usePresence(id);
  const nome = membro?.displayName ?? salas.alguem;
  // Sem conexão a presença não é afirmada: o avatar fica sem o indicador.
  const avatar = (
    <Avatar
      nome={nome}
      id={id}
      tamanho={modo === "icones" ? 36 : 32}
      imagem={membro?.avatarUrl}
      status={desatualizada ? undefined : presenca}
    />
  );
  if (modo === "icones") {
    return (
      <button
        type="button"
        className={css.soIcone}
        title={nome}
        aria-label={salas.cartaoDeUsuario.verPerfil(nome)}
        onClick={(e) => {
          abrirCartaoDeUsuario(id, e.currentTarget, { serverId, lado: "left" });
        }}
      >
        {avatar}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={css.membro}
      data-offline={presenca === "offline" || undefined}
      onClick={(e) => {
        abrirCartaoDeUsuario(id, e.currentTarget, { serverId, lado: "left" });
      }}
    >
      {avatar}
      <span className={css.textos}>
        <span className={css.nome}>{nome}</span>
        {membro?.statusTexto !== undefined && (
          <span className={css.recado} data-testid="recado-do-membro">
            {membro.statusTexto}
          </span>
        )}
      </span>
    </button>
  );
}

/** Esqueleto da gaveta até o `Ready`. */
export function EsqueletoDeMembros() {
  return (
    <div className={css.esqueleto} role="status" aria-label={shell.gaveta.carregando}>
      <span className={css.bloco} />
      <span className={css.bloco} />
      <span className={css.bloco} />
    </div>
  );
}

/**
 * Membros do servidor, agrupados por cargo (online) e depois o balde offline.
 * Virtualizada: a lista de um servidor grande tem dezenas de milhares de linhas.
 * Cada linha assina o próprio membro e a própria presença; a lista assina só os
 * IDs, então uma piscada de presença toca um ponto, nunca a gaveta.
 */
export function ListaDeMembros({ serverId }: { serverId: string }) {
  const pronto = useProntidao();
  const secoes = useSecoesOnline(serverId);
  const offline = useMembrosOffline(serverId);
  const modo = useModoDaGaveta();
  const desatualizada = useConexao() !== "conectado";
  const rolagem = useRef<HTMLDivElement | null>(null);

  const linhas = useMemo(() => {
    const saida: Linha[] = [];
    for (const s of secoes) {
      if (s.ids.length === 0) continue;
      saida.push({
        tipo: "cabecalho",
        chave: `cargo:${s.id}`,
        rotulo: s.id === SEM_CARGO ? shell.gaveta.titulo : s.rotulo,
        total: s.ids.length,
      });
      for (const id of s.ids) saida.push({ tipo: "membro", chave: `on:${id}`, id });
    }
    if (offline.length > 0) {
      saida.push({
        tipo: "cabecalho",
        chave: "offline",
        rotulo: shell.gaveta.offline,
        total: offline.length,
      });
      for (const id of offline) saida.push({ tipo: "membro", chave: `off:${id}`, id });
    }
    return saida;
  }, [secoes, offline]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual: o compiler pula este componente
  const virtualizer = useVirtualizer({
    count: linhas.length,
    getScrollElement: () => rolagem.current,
    estimateSize: (i) => ALTURA[modo][linhas[i]?.tipo ?? "membro"],
    getItemKey: (i) => linhas[i]?.chave ?? i,
    overscan: 8,
  });

  if (!pronto) return <EsqueletoDeMembros />;
  if (linhas.length === 0) return <p className={css.vazio}>{shell.gaveta.vazio}</p>;

  return (
    <div
      ref={rolagem}
      className={css.rolagem}
      data-testid="lista-de-membros"
      tabIndex={0}
      role="list"
      aria-label={shell.gaveta.rotulo}
    >
      {desatualizada && modo === "lista" && (
        <p className={css.desatualizada} role="status">
          {shell.gaveta.desatualizada}
        </p>
      )}
      <div className={css.trilho} style={{ blockSize: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const linha = linhas[item.index];
          if (!linha) return null;
          return (
            <div
              key={linha.chave}
              data-index={item.index}
              role="listitem"
              className={css.item}
              style={{ blockSize: item.size, transform: `translateY(${item.start}px)` }}
            >
              {linha.tipo === "cabecalho" ? (
                modo === "icones" ? (
                  <div className={css.divisoria} role="separator" aria-label={linha.rotulo} />
                ) : (
                  <h3 className={css.cabecalho}>
                    {linha.rotulo} <span className={css.total}>— {linha.total}</span>
                  </h3>
                )
              ) : (
                <Membro
                  serverId={serverId}
                  id={linha.id}
                  modo={modo}
                  desatualizada={desatualizada}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
