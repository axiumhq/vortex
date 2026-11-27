import { instanteDoUlid } from "nucleo/lib/ulid";
import { usuarioLocalId } from "nucleo/sdk/adapter";
import { cargosDoServidor } from "nucleo/sdk/cargos";
import { chaveDeMembro } from "nucleo/sdk/domain";
import { lerMeuPerfil, lerPerfilPublico } from "nucleo/sdk/perfil";
import {
  abrirConversaCom,
  aceitarAmizade,
  bloquear,
  buscarEmComum,
  desbloquear,
  pedirAmizade,
  type EmComum,
} from "nucleo/sdk/social";
import {
  abrirPerfilCompleto,
  assinarPerfilCompleto,
  fecharPerfilCompleto,
  lerPerfilCompleto,
  type AlvoDoPerfilCompleto,
} from "nucleo/store/cartaoDeUsuario";
import { useMembro, usePessoa, usePresence, useServer } from "nucleo/store/hooks";
import { abrirConversa } from "nucleo/store/navegacao";
import { fecharPalco } from "nucleo/store/palcoDeVoz";
import { useEffect, useState, useSyncExternalStore } from "react";

import { casa, salas } from "../../textos";
import { Avatar, Botao } from "../../ui/ds";
import { Copiar, Marcar, Mensagem as IconeMensagem, Proibido } from "../../ui/icones";
import { ConteudoDoDialogo, Dialogo } from "../../ui/primitivos/Dialogo";
import css from "./ModalDePerfil.module.css";

const formatoDeData = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" });

function formatarData(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  return formatoDeData.format(new Date(ms));
}

function ServidorEmComum({ id }: { id: string }) {
  const servidor = useServer(id);
  if (!servidor) return null;
  return (
    <li className={css.item}>
      <Avatar nome={servidor.name} id={id} tamanho={24} />
      <span className={css.itemNome}>{servidor.name}</span>
    </li>
  );
}

function AmigoEmComum({ id, serverId }: { id: string; serverId: string | undefined }) {
  const pessoa = usePessoa(id);
  if (!pessoa) return null;
  return (
    <li className={css.item}>
      <button
        type="button"
        className={css.itemBotao}
        onClick={() => {
          abrirPerfilCompleto(id, serverId);
        }}
      >
        <Avatar nome={pessoa.displayName} id={id} tamanho={24} status={pessoa.status} />
        <span className={css.itemNome}>{pessoa.displayName}</span>
      </button>
    </li>
  );
}

type PerfilCarregado = {
  readonly para: string;
  readonly bio: string;
  readonly bannerUrl: string | undefined;
};

type EmComumCarregado = {
  readonly para: string;
  readonly dados: EmComum | undefined;
};

function ConteudoDoModal({ alvo }: { alvo: AlvoDoPerfilCompleto }) {
  const membro = useMembro(chaveDeMembro(alvo.serverId ?? "", alvo.userId));
  const pessoa = usePessoa(alvo.userId);
  const presenca = usePresence(alvo.userId);
  const ehEu = alvo.userId === usuarioLocalId();
  const meuPerfil = ehEu ? lerMeuPerfil() : undefined;

  const [perfil, setPerfil] = useState<PerfilCarregado | undefined>();
  const [emComum, setEmComum] = useState<EmComumCarregado | undefined>();
  const [copiado, setCopiado] = useState(false);
  const [ocupado, setOcupado] = useState<"dm" | "amizade" | "bloqueio" | undefined>();

  useEffect(() => {
    let vivo = true;
    void lerPerfilPublico(alvo.userId).then((dados) => {
      if (!vivo || !dados) return;
      setPerfil({ para: alvo.userId, bio: dados.bio, bannerUrl: dados.bannerUrl });
    });
    if (!ehEu) {
      void buscarEmComum(alvo.userId).then((dados) => {
        if (!vivo) return;
        setEmComum({ para: alvo.userId, dados });
      });
    }
    return () => {
      vivo = false;
    };
  }, [alvo.userId, ehEu]);

  useEffect(() => {
    if (!copiado) return;
    const id = window.setTimeout(() => setCopiado(false), 2000);
    return () => window.clearTimeout(id);
  }, [copiado]);

  const t = salas.cartaoDeUsuario;
  const nome = membro?.displayName ?? pessoa?.displayName ?? meuPerfil?.displayName ?? salas.alguem;
  const username = membro?.username ?? pessoa?.username ?? meuPerfil?.username;
  const pronomes = membro?.pronomes ?? (meuPerfil?.pronomes || undefined);
  const statusTexto = membro?.statusTexto;
  const cor = membro?.cor;
  const avatarUrl = membro?.avatarUrl ?? meuPerfil?.avatarUrl;
  const dadosPublicos = perfil?.para === alvo.userId ? perfil : undefined;
  const bio = dadosPublicos?.bio.trim() || undefined;
  const bannerUrl = dadosPublicos?.bannerUrl;
  const contaCriadaEm = formatarData(instanteDoUlid(alvo.userId));
  const entrouNoServidorEm = membro?.entrouEm;

  const cargosDoMembro =
    alvo.serverId !== undefined && membro && membro.cargosIds.length > 0
      ? (() => {
          const mapa = new Map(cargosDoServidor(alvo.serverId).map((c) => [c.id, c]));
          return membro.cargosIds
            .map((id) => mapa.get(id))
            .filter((c): c is NonNullable<typeof c> => c !== undefined);
        })()
      : [];

  const relacao = pessoa?.relacao ?? "nenhuma";
  const euBloqueei = relacao === "bloqueado";
  const emComumDados = emComum?.para === alvo.userId ? emComum.dados : undefined;
  const carregandoEmComum = !ehEu && emComum?.para !== alvo.userId;

  const copiarUsername = () => {
    if (!username || typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(`@${username}`).then(
      () => setCopiado(true),
      () => undefined,
    );
  };

  return (
    <ConteudoDoDialogo titulo={t.rotulo(nome)} tituloOculto className={css.dialogo}>
      <div data-testid="modal-de-perfil">
        <div className={css.banner}>
          {bannerUrl !== undefined && <img className={css.bannerImagem} src={bannerUrl} alt="" />}
        </div>

        <div className={css.corpo}>
          <div className={css.topo}>
            <div className={css.avatarMoldura}>
              <Avatar nome={nome} id={alvo.userId} tamanho={80} imagem={avatarUrl} status={presenca} />
            </div>

            <div className={css.acoes}>
              {ehEu ? (
                <span className={css.seloVoce}>{t.voce}</span>
              ) : (
                <>
                  <Botao
                    variante="primario"
                    tamanho="sm"
                    icone={<IconeMensagem tamanho={14} />}
                    carregando={ocupado === "dm"}
                    disabled={ocupado !== undefined && ocupado !== "dm"}
                    onClick={() => {
                      const abertura = alvo;
                      setOcupado("dm");
                      void abrirConversaCom(abertura.userId).then((canalId) => {
                        setOcupado(undefined);
                        if (!canalId) return;
                        fecharPalco();
                        abrirConversa(canalId);
                        if (lerPerfilCompleto() === abertura) fecharPerfilCompleto();
                      });
                    }}
                  >
                    {t.enviarMensagem}
                  </Botao>

                  {relacao === "recebido" ? (
                    <Botao
                      variante="secundario"
                      tamanho="sm"
                      carregando={ocupado === "amizade"}
                      disabled={ocupado !== undefined && ocupado !== "amizade"}
                      onClick={() => {
                        setOcupado("amizade");
                        void aceitarAmizade(alvo.userId).finally(() => setOcupado(undefined));
                      }}
                    >
                      {t.aceitarAmizade}
                    </Botao>
                  ) : relacao === "nenhuma" && username !== undefined ? (
                    <Botao
                      variante="secundario"
                      tamanho="sm"
                      carregando={ocupado === "amizade"}
                      disabled={ocupado !== undefined && ocupado !== "amizade"}
                      onClick={() => {
                        setOcupado("amizade");
                        void pedirAmizade(username).finally(() => setOcupado(undefined));
                      }}
                    >
                      {t.pedirAmizade}
                    </Botao>
                  ) : relacao === "enviado" ? (
                    <Botao variante="secundario" tamanho="sm" disabled>
                      {t.pedidoEnviado}
                    </Botao>
                  ) : relacao === "amigo" ? (
                    <Botao variante="fantasma" tamanho="sm" disabled>
                      {t.amigos}
                    </Botao>
                  ) : null}

                  <Botao
                    variante="fantasma"
                    tamanho="sm"
                    icone={<Proibido tamanho={14} />}
                    carregando={ocupado === "bloqueio"}
                    disabled={ocupado !== undefined && ocupado !== "bloqueio"}
                    onClick={() => {
                      setOcupado("bloqueio");
                      void (euBloqueei ? desbloquear(alvo.userId) : bloquear(alvo.userId)).finally(() =>
                        setOcupado(undefined),
                      );
                    }}
                  >
                    {euBloqueei ? t.desbloquear : t.bloquear}
                  </Botao>
                </>
              )}
            </div>
          </div>

          <div className={css.identidade}>
            <h2 className={css.nome} style={cor ? { color: cor } : undefined}>
              {nome}
            </h2>
            <div className={css.meta}>
              {username !== undefined && (
                <button
                  type="button"
                  className={css.usuarioBotao}
                  aria-label={copiado ? t.usuarioCopiado : t.copiarUsuario}
                  onClick={copiarUsername}
                >
                  <span>@{username}</span>
                  {copiado ? <Marcar tamanho={14} /> : <Copiar tamanho={14} />}
                </button>
              )}
              {pronomes !== undefined && <span>{pronomes}</span>}
              <span>{casa.amigos.status[presenca]}</span>
            </div>
          </div>

          {statusTexto !== undefined && <p className={css.recado}>{statusTexto}</p>}

          <section className={css.secao} aria-label={t.sobre}>
            <h3 className={css.rotulo}>{t.sobre}</h3>
            {bio !== undefined ? (
              <p className={css.bio}>{bio}</p>
            ) : (
              <p className={css.nota}>{t.semBio}</p>
            )}
          </section>

          {(contaCriadaEm !== undefined || entrouNoServidorEm !== undefined) && (
            <section className={css.secao}>
              <div className={css.datas}>
                {contaCriadaEm !== undefined && (
                  <div className={css.dado}>
                    <span className={css.rotulo}>{t.membroDesde}</span>
                    <span className={css.dadoValor}>{contaCriadaEm}</span>
                  </div>
                )}
                {entrouNoServidorEm !== undefined && (
                  <div className={css.dado}>
                    <span className={css.rotulo}>{t.entrouNoServidor}</span>
                    <span className={css.dadoValor}>{entrouNoServidorEm}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {cargosDoMembro.length > 0 && (
            <section className={css.secao} aria-label={t.cargos}>
              <h3 className={css.rotulo}>{t.cargos}</h3>
              <ul className={css.cargos}>
                {cargosDoMembro.map((cargo) => (
                  <li key={cargo.id} className={css.cargo}>
                    <span
                      className={css.cargoPonto}
                      style={cargo.cor ? { backgroundColor: cargo.cor } : undefined}
                      aria-hidden="true"
                    />
                    <span>{cargo.nome}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!ehEu && (
            <section className={css.secao}>
              {carregandoEmComum ? (
                <p className={css.nota} role="status">
                  {t.carregando}
                </p>
              ) : emComumDados !== undefined ? (
                <div className={css.emComumGrade}>
                  <div>
                    <h3 className={css.rotulo}>
                      {t.servidoresEmComum} ({emComumDados.servidores.length})
                    </h3>
                    {emComumDados.servidores.length === 0 ? (
                      <p className={css.nota}>{t.nadaEmComum}</p>
                    ) : (
                      <ul className={css.lista}>
                        {emComumDados.servidores.map((id) => (
                          <ServidorEmComum key={id} id={id} />
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h3 className={css.rotulo}>
                      {t.amigosEmComum} ({emComumDados.amigos.length})
                    </h3>
                    {emComumDados.amigos.length === 0 ? (
                      <p className={css.nota}>{t.nadaEmComum}</p>
                    ) : (
                      <ul className={css.lista}>
                        {emComumDados.amigos.map((id) => (
                          <AmigoEmComum key={id} id={id} serverId={alvo.serverId} />
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : null}
            </section>
          )}
        </div>
      </div>
    </ConteudoDoDialogo>
  );
}

/** Modal de perfil completo do usuário, aberto a partir do cartão flutuante. */
export function ModalDePerfil() {
  const alvo = useSyncExternalStore(assinarPerfilCompleto, lerPerfilCompleto);

  return (
    <Dialogo
      open={alvo !== null}
      onOpenChange={(aberto) => {
        if (!aberto) fecharPerfilCompleto();
      }}
    >
      {alvo !== null && <ConteudoDoModal key={`${alvo.serverId ?? ""}:${alvo.userId}`} alvo={alvo} />}
    </Dialogo>
  );
}
