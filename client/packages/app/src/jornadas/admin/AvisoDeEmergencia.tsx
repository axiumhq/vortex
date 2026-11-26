import { encerrarEmergencia, emergenciaVigente, podeGerenciarSeguranca } from "nucleo/sdk/seguranca";
import { usePolitica } from "nucleo/store/seguranca";
import { useEffect, useState } from "react";

import { admin } from "../../textos";
import { Botao } from "../../ui/ds";
import { Escudo } from "../../ui/icones";
import { Confirmacao } from "./Confirmacao";
import css from "./AvisoDeEmergencia.module.css";

const t = admin.avisoDeEmergencia;

const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * O aviso de que o servidor aberto está em emergência. Mora na barra de título
 * (como o aviso de conexão): ali não tira altura de nenhuma área de conteúdo,
 * então a lista de mensagens não mexe a âncora quando ele aparece ou some.
 *
 * Sem emergência vigente não monta nada. Some sozinho no prazo (o relógio é
 * estado, não `Date.now()` no render) e quando o evento do servidor limpa a
 * política.
 */
export function AvisoDeEmergencia({ serverId }: { serverId: string }) {
  const politica = usePolitica(serverId);
  const [agora, setAgora] = useState(() => Date.now());
  const [confirmando, setConfirmando] = useState(false);
  const vigente = emergenciaVigente(politica, agora);
  const ate = vigente?.ateMs;

  useEffect(() => {
    if (ate === undefined) return;
    const timer = setTimeout(
      () => {
        setAgora(Date.now());
      },
      Math.max(0, ate - Date.now()) + 50,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [ate]);

  if (ate === undefined) return null;
  const podeEncerrar = podeGerenciarSeguranca(serverId);

  return (
    <div className={css.aviso} role="status" aria-label={t.rotulo} data-testid="aviso-de-emergencia">
      <Escudo tamanho={14} />
      <span>{t.texto(HORA.format(ate))}</span>
      {podeEncerrar && (
        <>
          <Botao
            variante="fantasma"
            tamanho="sm"
            className={css.encerrar}
            onClick={() => {
              setConfirmando(true);
            }}
          >
            {t.encerrar}
          </Botao>
          <Confirmacao
            aberto={confirmando}
            aoMudar={setConfirmando}
            titulo={t.confirmarTitulo}
            texto={t.confirmarTexto}
            confirmar={t.confirmarAcao}
            aoConfirmar={async () => {
              const ok = await encerrarEmergencia(serverId);
              setAgora(Date.now());
              return ok;
            }}
          />
        </>
      )}
    </div>
  );
}
