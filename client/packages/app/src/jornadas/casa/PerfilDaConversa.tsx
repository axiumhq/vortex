import { usuarioLocalId } from "nucleo/sdk/adapter";
import { bloquear, buscarEmComum, denunciarPessoa, desbloquear, lerGrupo, type EmComum } from "nucleo/sdk/social";
import { abrirCartaoDeUsuario } from "nucleo/store/cartaoDeUsuario";
import { toast } from "nucleo/ui-logica/toastStore";
import { useChannel, usePessoa, useServer } from "nucleo/store/hooks";
import { useEffect, useState } from "react";

import { casa, comum } from "../../textos";
import { Avatar, Botao } from "../../ui/ds";
import { Proibido } from "../../ui/icones";
import { ConteudoDoDialogo, Dialogo } from "../../ui/primitivos/Dialogo";
import css from "./Conversa.module.css";
import form from "./Formulario.module.css";

function ServidorEmComum({ id }: { id: string }) {
  const servidor = useServer(id);
  if (!servidor) return null;
  return (
    <li className={css.item}>
      <Avatar nome={servidor.name} id={id} tamanho={28} />
      <span className={css.itemNome}>{servidor.name}</span>
    </li>
  );
}

/** O resultado é de uma pessoa específica: guardar para quem foi evita um "carregando" zerado em efeito. */
type Busca = { readonly para: string; readonly dados: EmComum | undefined };

function EmComumDaPessoa({ userId }: { userId: string }) {
  const [busca, setBusca] = useState<Busca | undefined>();
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    void buscarEmComum(userId).then((dados) => {
      if (vivo) setBusca({ para: userId, dados });
    });
    return () => {
      vivo = false;
    };
  }, [userId, tentativa]);

  const carregando = busca?.para !== userId;
  return (
    <section className={css.secaoDoPerfil} aria-label={casa.conversa.emComum}>
      <h3 className={css.rotuloDaSecao}>{casa.conversa.emComum}</h3>
      {carregando ? (
        <p className={css.nota} role="status">
          {casa.conversa.emComumCarregando}
        </p>
      ) : busca.dados === undefined ? (
        <p className={css.erroDoPerfil} role="alert">
          {casa.conversa.emComumFalhou}
          <Botao
            variante="secundario"
            tamanho="sm"
            onClick={() => {
              setBusca(undefined);
              setTentativa((n) => n + 1);
            }}
          >
            {comum.tentarDeNovo}
          </Botao>
        </p>
      ) : busca.dados.servidores.length === 0 ? (
        <p className={css.nota}>{casa.conversa.emComumNenhum}</p>
      ) : (
        <ul className={css.itens}>
          {busca.dados.servidores.map((id) => (
            <ServidorEmComum key={id} id={id} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Denunciar({ userId, nome, aberto, aoMudar }: { userId: string; nome: string; aberto: boolean; aoMudar: (a: boolean) => void }) {
  const [enviando, setEnviando] = useState(false);
  return (
    <Dialogo open={aberto} onOpenChange={aoMudar}>
      <ConteudoDoDialogo titulo={casa.conversa.denunciarTitulo(nome)} descricao={casa.conversa.denunciarTexto}>
        <div className={form.rodape}>
          <Botao
            variante="fantasma"
            onClick={() => {
              aoMudar(false);
            }}
          >
            {comum.cancelar}
          </Botao>
          <Botao
            variante="perigo"
            carregando={enviando}
            onClick={() => {
              setEnviando(true);
              void denunciarPessoa(userId, undefined).then((ok) => {
                setEnviando(false);
                if (!ok) return;
                aoMudar(false);
                toast({ tipo: "info", titulo: casa.conversa.denunciada });
              });
            }}
          >
            {casa.conversa.denunciarConfirmar}
          </Botao>
        </div>
      </ConteudoDoDialogo>
    </Dialogo>
  );
}

function PerfilDaPessoa({ userId }: { userId: string }) {
  const pessoa = usePessoa(userId);
  const [denunciando, setDenunciando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  if (!pessoa) return null;
  const nome = pessoa.displayName;
  const euBloqueei = pessoa.relacao === "bloqueado";
  return (
    <>
      <div className={css.perfilRosto}>
        <Avatar nome={nome} id={userId} tamanho={120} status={pessoa.status} />
        <h3 className={css.perfilNome}>{nome}</h3>
        <span className={css.perfilUsuario}>
          @{pessoa.username} · {casa.amigos.status[pessoa.status]}
        </span>
      </div>
      <EmComumDaPessoa userId={userId} />
      <div className={css.acoesDoPerfil}>
        <Botao
          variante="secundario"
          icone={<Proibido />}
          carregando={ocupado}
          onClick={() => {
            setOcupado(true);
            void (euBloqueei ? desbloquear(userId) : bloquear(userId)).finally(() => {
              setOcupado(false);
            });
          }}
        >
          {euBloqueei ? casa.conversa.desbloquear : casa.conversa.bloquear}
        </Botao>
        <Botao
          variante="fantasma"
          onClick={() => {
            setDenunciando(true);
          }}
        >
          {casa.conversa.denunciar}
        </Botao>
      </div>
      <Denunciar userId={userId} nome={nome} aberto={denunciando} aoMudar={setDenunciando} />
    </>
  );
}

function PessoaDoGrupo({ id }: { id: string }) {
  const pessoa = usePessoa(id);
  const nome = pessoa?.displayName ?? casa.grupo.voce;
  return (
    <li className={css.item}>
      <button
        type="button"
        className={css.itemBotao}
        onClick={(e) => {
          abrirCartaoDeUsuario(id, e.currentTarget, { lado: "left" });
        }}
      >
        <Avatar nome={nome} id={id} tamanho={28} status={pessoa?.status} />
        <span className={css.itemNome}>{id === usuarioLocalId() ? `${nome} (${casa.grupo.voce})` : nome}</span>
      </button>
    </li>
  );
}

function PerfilDoGrupo({ canalId }: { canalId: string }) {
  // Relê quando o canal muda (alguém entrou ou saiu): `lerGrupo` é leitura direta, não store.
  useChannel(canalId);
  const grupo = lerGrupo(canalId);
  if (!grupo) return null;
  return (
    <section className={css.secaoDoPerfil} aria-label={casa.grupo.pessoasDoGrupo}>
      <h3 className={css.rotuloDaSecao}>{casa.grupo.pessoasDoGrupo}</h3>
      <ul className={css.itens}>
        {grupo.membrosIds.map((id) => (
          <PessoaDoGrupo key={id} id={id} />
        ))}
      </ul>
    </section>
  );
}

/**
 * O que se vê ao lado da conversa: o perfil de quem está do outro lado (e os
 * servidores em comum), ou as pessoas do grupo. Nunca a lista de membros de
 * servidor — este painel não faz parte dela, e por isso tem rótulo próprio.
 */
export function PerfilDaConversa({
  canalId,
  tipo,
  destinatarioId,
  nome,
}: {
  canalId: string;
  tipo: "dm" | "grupo";
  destinatarioId: string | undefined;
  nome: string;
}) {
  return (
    <aside className={css.perfil} aria-label={tipo === "dm" ? casa.conversa.perfil(nome) : casa.grupo.pessoasDoGrupo}>
      {tipo === "dm" && destinatarioId !== undefined ? (
        <PerfilDaPessoa userId={destinatarioId} />
      ) : (
        <PerfilDoGrupo canalId={canalId} />
      )}
    </aside>
  );
}
