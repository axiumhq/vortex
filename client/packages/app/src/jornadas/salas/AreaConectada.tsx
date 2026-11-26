import { useLocal, useProntidao } from "nucleo/store/hooks";

import { AreaPrincipal } from "../../shell";
import { shell } from "../../textos";
import { PalcoDaSala } from "../voz/Palco";
import { useSalaDoPalco } from "../voz/hooks";
import { AreaDoCanalOuTopico } from "../topicos/AreaDoTopico";
import { AreaDaDm } from "../casa/AreaDaDm";
import { TelaDeAmigos } from "../casa/TelaDeAmigos";
import css from "./Salas.module.css";
import { WidgetConectado } from "./WidgetConectado";
import { EsqueletoDeSalas } from "./ColunaConectada";

/**
 * A área principal: o canal de texto aberto ocupa tudo e a sala vira o widget
 * flutuante. Sem servidor ou sem canal, o estado vazio do catálogo.
 */
export function AreaConectada() {
  const local = useLocal();
  const pronto = useProntidao();
  const serverId = local.tipo === "servidor" ? local.serverId : undefined;
  const palco = useSalaDoPalco(serverId);

  if (!pronto) {
    return (
      <AreaPrincipal>
        <EsqueletoDeSalas />
      </AreaPrincipal>
    );
  }
  if (local.tipo === "dm") return <AreaDaDm key={local.channelId} canalId={local.channelId} />;
  if (local.tipo === "casa" || local.tipo === "amigos") return <TelaDeAmigos />;
  if (local.tipo !== "servidor") return <AreaPrincipal />;

  // Em voz o palco ocupa a área inteira: sem chat, sem widget. O chat volta pelo cabeçalho do palco.
  if (palco.aberto) {
    return (
      <main aria-label={shell.principal.rotulo} className={css.areaDoPalco}>
        <PalcoDaSala serverId={local.serverId} canalId={palco.canalId} />
      </main>
    );
  }

  return (
    <AreaPrincipal camada={<WidgetConectado serverId={local.serverId} />}>
      {local.channelId !== undefined ? (
        <AreaDoCanalOuTopico key={local.channelId} canalId={local.channelId} servidorId={local.serverId} />
      ) : undefined}
    </AreaPrincipal>
  );
}

