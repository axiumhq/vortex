import { usuarioLocalId } from "nucleo/sdk/adapter";
import { chaveDeMembro } from "nucleo/sdk/domain";
import { lerMeuPerfil, lerPerfilPublico } from "nucleo/sdk/perfil";
import { abrirConversaCom } from "nucleo/sdk/social";
import {
  abrirPerfilCompleto,
  assinarCartaoDeUsuario,
  consumirOrigemDoCartao,
  fecharCartaoDeUsuario,
  fecharCartaoSeAinda,
  lerAlvoDoCartao,
  type AlvoDoCartao,
} from "nucleo/store/cartaoDeUsuario";
import { useMembro, usePessoa, usePresence } from "nucleo/store/hooks";
import { abrirConversa } from "nucleo/store/navegacao";
import { fecharPalco } from "nucleo/store/palcoDeVoz";
import { useEffect, useState, useSyncExternalStore } from "react";

import { casa, salas } from "../../textos";
import { Avatar, Botao } from "../../ui/ds";
import { Mensagem as IconeMensagem } from "../../ui/icones";
import { AncoraDoPopover, ConteudoDoPopover, Popover } from "../../ui/primitivos/Flutuantes";
import css from "./CartaoDeUsuario.module.css";
import { ModalDePerfil } from "./ModalDePerfil";

const TITULO_DO_CARTAO = "cartao-de-usuario-titulo";

type PerfilCarregado = {
  readonly para: string;
  readonly bio: string;
  readonly bannerUrl: string | undefined;
};

function Conteudo({ alvo }: { alvo: AlvoDoCartao }) {
  const membro = useMembro(chaveDeMembro(alvo.serverId ?? "", alvo.userId));
  const pessoa = usePessoa(alvo.userId);
  const presenca = usePresence(alvo.userId);
  const ehEu = alvo.userId === usuarioLocalId();
  const meuPerfil = ehEu ? lerMeuPerfil() : undefined;
  const [perfil, setPerfil] = useState<PerfilCarregado | undefined>();
  const [abrindoDm, setAbrindoDm] = useState(false);

  useEffect(() => {
    let vivo = true;
    void lerPerfilPublico(alvo.userId).then((dados) => {
      if (!vivo || !dados) return;
      setPerfil({ para: alvo.userId, bio: dados.bio, bannerUrl: dados.bannerUrl });
    });
    return () => {
      vivo = false;
    };
  }, [alvo.userId]);

  const nome = membro?.displayName ?? pessoa?.displayName ?? meuPerfil?.displayName ?? salas.alguem;
  const username = membro?.username ?? pessoa?.username ?? meuPerfil?.username;
  const pronomes = membro?.pronomes ?? (meuPerfil?.pronomes || undefined);
  const statusTexto = membro?.statusTexto;
  const cargo = membro?.cargo;
  const cor = membro?.cor;
  const avatarUrl = membro?.avatarUrl ?? meuPerfil?.avatarUrl;
  const dadosPublicos = perfil?.para === alvo.userId ? perfil : undefined;
  const bio = dadosPublicos?.bio.trim() || undefined;
  const bannerUrl = dadosPublicos?.bannerUrl;

  const abrirCompleto = () => {
    abrirPerfilCompleto(alvo.userId, alvo.serverId);
  };

  return (
    <div data-testid="cartao-de-usuario">
      <div className={css.banner}>
        {bannerUrl !== undefined && <img className={css.bannerImagem} src={bannerUrl} alt="" />}
      </div>

      <div className={css.corpo}>
        <div className={css.topo}>
          <button
            type="button"
            className={css.avatarMoldura}
            aria-label={salas.cartaoDeUsuario.abrirPerfilCompleto(nome)}
            title={salas.cartaoDeUsuario.verPerfilCompleto}
            onClick={abrirCompleto}
          >
            <Avatar nome={nome} id={alvo.userId} tamanho={64} imagem={avatarUrl} status={presenca} />
          </button>
          {ehEu && <span className={css.seloVoce}>{salas.cartaoDeUsuario.voce}</span>}
        </div>

        <div className={css.identidade}>
          <div className={css.nomeLinha}>
            <h3 id={TITULO_DO_CARTAO} className={css.nome} style={cor ? { color: cor } : undefined}>
              <button
                type="button"
                className={css.nomeBotao}
                title={salas.cartaoDeUsuario.verPerfilCompleto}
                onClick={abrirCompleto}
              >
                {nome}
              </button>
            </h3>
            {cargo !== undefined && <span className={css.cargo}>{cargo}</span>}
          </div>
          <div className={css.meta}>
            {username !== undefined && <span className={css.usuario}>@{username}</span>}
            {pronomes !== undefined && (
              <>
                <span aria-hidden="true">·</span>
                <span>{pronomes}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{casa.amigos.status[presenca]}</span>
          </div>
        </div>

        {statusTexto !== undefined && <p className={css.recado}>{statusTexto}</p>}

        {bio !== undefined && (
          <section className={css.secao} aria-label={salas.cartaoDeUsuario.sobre}>
            <h4 className={css.rotulo}>{salas.cartaoDeUsuario.sobre}</h4>
            <p className={css.bio}>{bio}</p>
          </section>
        )}

        <div className={css.acoes}>
          {!ehEu && (
            <Botao
              variante="secundario"
              tamanho="sm"
              icone={<IconeMensagem tamanho={14} />}
              className={css.acaoPrincipal}
              carregando={abrindoDm}
              onClick={() => {
                const abertura = alvo;
                setAbrindoDm(true);
                void abrirConversaCom(abertura.userId).then((canalId) => {
                  setAbrindoDm(false);
                  if (!canalId) return;
                  fecharPalco();
                  abrirConversa(canalId);
                  fecharCartaoSeAinda(abertura);
                });
              }}
            >
              {salas.cartaoDeUsuario.enviarMensagem}
            </Botao>
          )}
          <Botao
            variante="fantasma"
            tamanho="sm"
            className={ehEu ? css.acaoPrincipal : undefined}
            onClick={abrirCompleto}
          >
            {salas.cartaoDeUsuario.verPerfilCompleto}
          </Botao>
        </div>
      </div>
    </div>
  );
}

/**
 * Cartão flutuante de perfil do usuário: um só para o app inteiro, aberto pelo
 * store `cartaoDeUsuario` a partir de mensagens, menções, lista de membros e grupos.
 */
export function CartaoDeUsuario() {
  const alvo = useSyncExternalStore(assinarCartaoDeUsuario, lerAlvoDoCartao);

  return (
    <>
      <Popover
        open={alvo !== null}
        onOpenChange={(aberto) => {
          if (!aberto) fecharCartaoDeUsuario();
        }}
      >
        {alvo !== null && (
          <AncoraDoPopover asChild>
            <span
              aria-hidden="true"
              className={css.ancora}
              style={{
                insetInlineStart: alvo.x,
                insetBlockStart: alvo.y,
                inlineSize: alvo.largura,
                blockSize: alvo.altura,
              }}
            />
          </AncoraDoPopover>
        )}
        <ConteudoDoPopover
          aria-labelledby={TITULO_DO_CARTAO}
          className={css.caixa}
          side={alvo?.lado ?? "right"}
          align="start"
          collisionPadding={12}
          onCloseAutoFocus={(e) => {
            const origem = consumirOrigemDoCartao();
            if (origem?.isConnected) {
              e.preventDefault();
              origem.focus();
            }
          }}
        >
          {alvo !== null && <Conteudo key={`${alvo.serverId ?? ""}:${alvo.userId}`} alvo={alvo} />}
        </ConteudoDoPopover>
      </Popover>
      <ModalDePerfil />
    </>
  );
}
