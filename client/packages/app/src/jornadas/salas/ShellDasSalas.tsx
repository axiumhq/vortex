import { fecharBusca } from "nucleo/store/busca";
import { fecharFixados } from "nucleo/store/fixados";
import { lerUltimoServidor, abrirServidor } from "nucleo/store/ultimoLugar";
import { useColunaDeSalas, useLocal, useProntidao, useServerIds } from "nucleo/store/hooks";
import { useEffect, useRef, type ReactNode } from "react";

import { ShellDoApp } from "../../shell";
import { AvisoDeEmergencia } from "../admin/AvisoDeEmergencia";
import { useBusca } from "../busca/hooks";
import { PainelDeBusca } from "../busca/PainelDeBusca";
import { useFixados } from "../fixados/hooks";
import { PainelDeFixados } from "../fixados/PainelDeFixados";
import { AreaConectada } from "./AreaConectada";
import { ColunaConectada } from "./ColunaConectada";
import { ConteudoDaDock } from "./DockConectada";
import { FaixaDeSalas } from "./FaixaDeSalas";
import { EsqueletoDeMembros, ListaDeMembros } from "./GavetaConectada";
import { DialogoDeTransmissao } from "../voz/DialogoDeTransmissao";
import { useSalaDoPalco } from "../voz/hooks";

/**
 * Chegada (PRD §8 nº 2): depois do primeiro `Ready`, e só se a pessoa ainda não
 * foi a nenhum lugar, abre o último servidor onde esteve — no último canal de
 * texto, com a última sala no widget. Nunca conecta à voz: entrar é um clique.
 */
function useChegada(): void {
  const pronto = useProntidao();
  const ids = useServerIds();
  const local = useLocal();
  const feito = useRef(false);

  useEffect(() => {
    if (!pronto || feito.current) return;
    feito.current = true;
    if (local.tipo !== "casa") return;
    const ultimo = lerUltimoServidor();
    if (ultimo !== undefined && ids.includes(ultimo)) abrirServidor(ultimo);
  }, [pronto, ids, local]);
}

/** O shell fixo ligado à jornada 4.2: dock, salas, área principal e membros. */
export function ShellDasSalas({ rodapeDasSalas }: { rodapeDasSalas?: ReactNode }) {
  useChegada();
  const pronto = useProntidao();
  const local = useLocal();
  const serverId = local.tipo === "servidor" ? local.serverId : undefined;
  // O palco ocupa a área principal inteira, sem a gaveta de membros.
  const palcoAberto = useSalaDoPalco(serverId).aberto;
  // A faixa é preferência, não consequência de entrar na chamada.
  const salasEmFaixa = useColunaDeSalas() === "faixa";
  const busca = useBusca();
  const canalAtual = local.tipo === "servidor" || local.tipo === "dm" ? local.channelId : undefined;
  // A busca é do canal em que foi aberta: trocar de canal a fecha (os resultados são dele).
  useEffect(() => {
    if (busca.aberta && busca.channelId !== canalAtual) fecharBusca();
  }, [busca.aberta, busca.channelId, canalAtual]);
  const buscaVisivel = busca.aberta && canalAtual !== undefined && busca.channelId === canalAtual && !palcoAberto;
  const fixados = useFixados();
  // Idem: as fixadas são do canal em que foram abertas.
  useEffect(() => {
    if (fixados.aberto && fixados.channelId !== canalAtual) fecharFixados();
  }, [fixados.aberto, fixados.channelId, canalAtual]);
  const fixadosVisiveis =
    fixados.aberto && canalAtual !== undefined && fixados.channelId === canalAtual && !palcoAberto;
  const painelAberto = buscaVisivel || fixadosVisiveis;

  return (
    <>
    <ShellDoApp
      chaveDoLugar={JSON.stringify(local)}
      avisos={serverId !== undefined ? <AvisoDeEmergencia key={serverId} serverId={serverId} /> : undefined}
      dock={<ConteudoDaDock />}
      salas={<ColunaConectada rodape={rodapeDasSalas} />}
      area={<AreaConectada />}
      membros={
        !pronto ? <EsqueletoDeMembros /> : serverId !== undefined ? <ListaDeMembros serverId={serverId} /> : undefined
      }
      salasEmFaixa={salasEmFaixa}
      faixaDeSalas={serverId !== undefined ? <FaixaDeSalas serverId={serverId} /> : undefined}
      painel={
        canalAtual === undefined ? undefined : buscaVisivel ? (
          <PainelDeBusca key={canalAtual} canalId={canalAtual} servidorId={serverId ?? ""} />
        ) : fixadosVisiveis ? (
          <PainelDeFixados key={canalAtual} canalId={canalAtual} servidorId={serverId ?? ""} />
        ) : undefined
      }
      gavetaOculta={(pronto && serverId === undefined && !painelAberto) || palcoAberto}
    />
    <DialogoDeTransmissao />
    </>
  );
}