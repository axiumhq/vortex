import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cancelarMfa, entrar, responderMfa } from "nucleo/sdk/autenticacao";
import { escolherNome } from "nucleo/sdk/conta";
import { assinarEntrada, lerEntrada } from "nucleo/store/entrada";
import { assinarSessao, lerSessao, type EstadoDaSessao } from "nucleo/store/sessao";
import { abrirServidor } from "nucleo/store/ultimoLugar";

import { Autenticacao } from "./Autenticacao";
import { AutorizarQr } from "./AutorizarQr";
import { ConviteRecebido } from "./ConviteRecebido";
import { assinarDestino, esquecerConvite, esquecerPedidoDeQr, lerDestino } from "./destinoPendente";
import { encerrarSessao, estaEncerrando, iniciarSessao, recarregarPagina } from "./encerrar";
import { irParaOApp } from "./rotaDeEntrada";
import { TelaDeContaDesativada } from "./TelaDeContaDesativada";
import { TelaDeMfa } from "./TelaDeMfa";
import { TelaDeNome } from "./TelaDeNome";
import { TelaDeRestauracao } from "./TelaDeRestauracao";

export interface PortaoDeSessaoProps {
  children: ReactNode;
  /** O que roda uma vez ao abrir. Os testes trocam por nada e dirigem o estado à mão. */
  iniciar?: () => void;
  /** Chamado quando o servidor derruba a sessão que estava dentro. */
  aoSerDerrubada?: () => void;
}

function TelaDeNomeDoPortao({ motivo }: { motivo: string | undefined }) {
  const [salvando, setSalvando] = useState(false);
  return (
    <TelaDeNome
      motivo={motivo}
      salvando={salvando}
      aoEscolher={(nome) => {
        setSalvando(true);
        void escolherNome(nome).finally(() => {
          setSalvando(false);
        });
      }}
      aoCancelar={() => void encerrarSessao()}
    />
  );
}

/**
 * O app, mais o que esperou pela sessão: o convite ou a autorização por QR que
 * chegaram por link enquanto a pessoa ainda estava fora. Um diálogo por vez, e a
 * autorização vem primeiro porque é do outro aparelho, que está esperando agora.
 */
function DentroDoApp({ children }: { children: ReactNode }) {
  const destino = useSyncExternalStore(assinarDestino, lerDestino);

  useEffect(() => {
    // O endereço de uma tela de fora não pode ficar na barra de um app aberto.
    irParaOApp();
  }, []);

  return (
    <>
      {children}
      {destino.qr !== undefined ? (
        <AutorizarQr key={destino.qr} id={destino.qr} aoFechar={esquecerPedidoDeQr} />
      ) : destino.convite !== undefined ? (
        <ConviteRecebido
          key={destino.convite}
          codigo={destino.convite}
          aoDispensar={esquecerConvite}
          aoAbrir={(serverId) => {
            esquecerConvite();
            abrirServidor(serverId);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * O portão: sem sessão não há canal, autor nem permissão.
 *
 * Vem antes do shell de propósito. Montar o app e esconder o conteúdo faria cada
 * painel assinar entidades que não existem.
 *
 * ⚠ O `Record` é EXAUSTIVO sobre `EstadoDaSessao`: estado novo no núcleo não compila
 * até ter tela aqui. Um `if`/`else` mandaria todo estado esquecido para a tela de
 * senha, e quem tem segundo fator veria o formulário de novo, sem explicação.
 *
 * `desconhecida` (a primeira pergunta ao armazenamento ainda não terminou) mostra o
 * esqueleto do shell, nunca a tela de entrada: abrir o app com sessão guardada não
 * pode piscar um login.
 *
 * Fora do app, QUAL tela aparece (entrar, criar conta, recuperar senha, QR, convite,
 * links de e-mail) é pergunta de outro store e outra tela: `Autenticacao`.
 */
export function PortaoDeSessao({
  children,
  iniciar = iniciarSessao,
  aoSerDerrubada = recarregarPagina,
}: PortaoDeSessaoProps) {
  const sessao = useSyncExternalStore(assinarSessao, lerSessao);
  const tela = useSyncExternalStore(assinarEntrada, lerEntrada);
  const jaIniciou = useRef(false);
  const anterior = useRef<EstadoDaSessao>(sessao.estado);

  useEffect(() => {
    // O StrictMode roda o efeito duas vezes; restaurar abre socket e abrir dois é o defeito.
    if (jaIniciou.current) return;
    jaIniciou.current = true;
    iniciar();
  }, [iniciar]);

  useEffect(() => {
    const antes = anterior.current;
    anterior.current = sessao.estado;
    // Dentro e, de repente, fora, sem ter sido a pessoa: o servidor derrubou a sessão.
    // Recarrega para a página nascer sem dado nem ouvinte da conta que caiu.
    if (antes === "dentro" && sessao.estado === "fora" && !estaEncerrando()) aoSerDerrubada();
  }, [sessao.estado, aoSerDerrubada]);

  const entrada = (entrando: boolean) => (
    <Autenticacao
      entrando={entrando}
      causa={sessao.causa}
      motivo={sessao.motivo}
      aoEntrar={(identificador, senha, manter) => void entrar(identificador, senha, manter)}
    />
  );

  // A página pública não espera a restauração da sessão nem depende de estar desconectado.
  if (tela.tipo === "download") return entrada(false);

  // O link do e-mail abre onde o e-mail está, e isso pode ser uma aba já com sessão: a tela do
  // link vale mais que o app, senão o token de uso único se perderia em silêncio.
  if (sessao.estado === "dentro" && (tela.tipo === "verificar" || tela.tipo === "redefinir")) {
    return entrada(false);
  }

  const TELA: Record<EstadoDaSessao, () => ReactNode> = {
    desconhecida: () => <TelaDeRestauracao />,
    // Entrar e errar são a MESMA tela em outro momento: o mesmo lugar na árvore mantém o que foi digitado.
    fora: () => entrada(false),
    entrando: () => entrada(true),
    erro: () => entrada(false),
    mfa: () => (
      <TelaDeMfa
        metodos={sessao.metodos}
        verificando={sessao.ocupada}
        incorreto={sessao.motivo !== undefined}
        aoVerificar={(metodo, valor) => void responderMfa(metodo, valor)}
        aoCancelar={cancelarMfa}
      />
    ),
    nome: () => <TelaDeNomeDoPortao motivo={sessao.motivo} />,
    desativada: () => <TelaDeContaDesativada aoTrocarDeConta={() => void encerrarSessao()} />,
    dentro: () => <DentroDoApp>{children}</DentroDoApp>,
  };

  return TELA[sessao.estado]();
}
