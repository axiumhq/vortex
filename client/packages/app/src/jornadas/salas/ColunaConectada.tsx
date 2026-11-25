import { podeNoServidor, pode } from "nucleo/sdk/permissoes";
import { definirColunaDeSalas } from "nucleo/store/preferenciasDaSala";
import { fecharPalco } from "nucleo/store/palcoDeVoz";
import { abrirTexto } from "nucleo/store/ultimoLugar";
import {
	useCanaisDeTexto,
	useCanaisDeVoz,
	useCanalAtivo,
	useCategorias,
	useChannel,
	useColunaDeSalas,
	useConexao,
	useFalantes,
	useLocal,
	usePessoasDaSala,
	useProntidao,
	useServer,
	useServidorAtivo,
	useTemTopicos,
	useTopicosSeguidosPorPai,
	type PessoaNaSala,
} from "nucleo/store/hooks";
import type { CategoriaDeCanais } from "nucleo/sdk/domain";
import { useEffect, useState, type ReactNode } from "react";

import { ColunaDeSalas } from "../../shell";
import { ColunaDaCasa } from "../casa/ColunaDaCasa";
import { salas, shell, voz } from "../../textos";
import { Avatar, Botao, ItemDeSala } from "../../ui/ds";
import { SetaParaEsquerda } from "../../ui/icones";
import { MenuDoServidor } from "../admin/MenuDoServidor";
import { PainelDaChamadaConectado } from "../voz/PainelDaChamadaConectado";
import { aquecerVoz, aquecerVozQuandoOcioso } from "../voz/acoes";
import { useSalaDoPalco } from "../voz/hooks";
import { ConvidarPessoas } from "./ConvidarPessoas";
import { CriarSala } from "./CriarSala";
import { TopicosSeguidos } from "./TopicosSeguidos";
import { useEntradaNaSala } from "./useEntradaNaSala";
import css from "./Salas.module.css";

function PessoaNaColuna({ pessoa }: { pessoa: PessoaNaSala }) {
	const falando = useFalantes([pessoa.id]).includes(pessoa.id);
	const nome = pessoa.nome || salas.alguem;
	return (
		<li className={css.pessoa} data-falando={falando || undefined}>
			<Avatar
				nome={nome}
				id={pessoa.id}
				tamanho={22}
				imagem={pessoa.avatarUrl}
			/>
			<span className={css.nomeDaPessoa}>{nome}</span>
			{falando && <span className={css.soLeitor}>{voz.estado.falando}</span>}
		</li>
	);
}

function SalaDaColuna({
	serverId,
	canalId,
}: {
	serverId: string;
	canalId: string;
}) {
	const canal = useChannel(canalId);
	const pessoas = usePessoasDaSala(serverId, canalId);
	const { aqui, motivo, clicar } = useEntradaNaSala(serverId, canalId);
	const desatualizada = useConexao() !== "conectado";
	if (!canal) return null;
	return (
		<li onPointerEnter={aquecerVoz} onFocus={aquecerVoz}>
			<ItemDeSala
				nome={canal.name}
				semPilha
				pessoas={pessoas.map((p) => ({
					id: p.id,
					nome: p.nome || salas.alguem,
					imagem: p.avatarUrl,
				}))}
				aoVivo={pessoas.some((p) => p.estado === "tela")}
				conectado={aqui}
				desatualizada={desatualizada}
				indisponivel={motivo}
				onClick={clicar}
			/>
			{pessoas.length > 0 && (
				<ul className={css.gente} aria-label={salas.naSala(pessoas.length)}>
					{pessoas.map((p) => (
						<PessoaNaColuna key={p.id} pessoa={p} />
					))}
				</ul>
			)}
		</li>
	);
}

function LinhaDaColuna({
	serverId,
	canalId,
	seguidos,
}: {
	serverId: string;
	canalId: string;
	seguidos: readonly string[] | undefined;
}) {
	const canal = useChannel(canalId);
	if (!canal) return null;
	return canal.tipo === "voz" ? (
		<SalaDaColuna serverId={serverId} canalId={canalId} />
	) : (
		<CanalDaColuna serverId={serverId} canalId={canalId} seguidos={seguidos} />
	);
}

/**
 * Categorias do servidor. Sem publicação ainda (arnês), uma cesta só com a
 * ordem voz+texto — produção sempre publica `orderedChannels`.
 */
function useColuna(serverId: string): readonly CategoriaDeCanais[] {
	const cats = useCategorias(serverId);
	const voz = useCanaisDeVoz(serverId);
	const texto = useCanaisDeTexto(serverId);
	if (cats.length > 0) return cats;
	if (voz.length === 0 && texto.length === 0) return cats;
	return [{ id: "default", titulo: undefined, canais: [...voz, ...texto] }];
}

function CanalDaColuna({
	serverId,
	canalId,
	seguidos,
}: {
	serverId: string;
	canalId: string;
	seguidos: readonly string[] | undefined;
}) {
	const canal = useChannel(canalId);
	const ativo = useCanalAtivo() === canalId;
	if (!canal) return null;
	return (
		<li>
			<ItemDeSala
				tipo="canal"
				nome={canal.name}
				selecionado={ativo}
				naoLida={canal.naoLidas > 0 && !canal.silenciado}
				mencoes={canal.silenciado ? 0 : canal.mencoes}
				restrito={canal.privado}
				modoLentoSegundos={canal.modoLentoSegundos}
				onClick={() => {
					// Ler outro canal fecha o palco; a chamada segue no widget.
					fecharPalco();
					abrirTexto(serverId, canalId);
				}}
			/>
			{seguidos !== undefined && (
				<TopicosSeguidos
					serverId={serverId}
					nomeDoCanal={canal.name}
					ids={seguidos}
				/>
			)}
		</li>
	);
}

/** Esqueleto até o `Ready`: a coluna existe, as linhas ainda não. */
export function EsqueletoDeSalas() {
	return (
		<div
			className={css.esqueleto}
			role="status"
			aria-label={salas.carregandoServidor}
		>
			<span className={css.bloco} />
			<span className={css.bloco} />
			<span className={css.bloco} />
			<span className={`${css.bloco} ${css.blocoCurto}`} />
		</div>
	);
}

/**
 * Servidor sem nenhuma sala de voz. As ações só existem para quem pode: criar
 * sala exige gerenciar canais; convidar exige poder criar convite em algum
 * canal. Quem não pode vê o aviso, sem botão.
 */
function ServidorSemSalas({
	serverId,
	canalParaConvite,
}: {
	serverId: string;
	canalParaConvite: string | undefined;
}) {
	const [criando, setCriando] = useState(false);
	const [convidando, setConvidando] = useState(false);
	const podeCriar = podeNoServidor(serverId, "gerenciarCanais");
	const podeConvidar =
		canalParaConvite !== undefined && pode(canalParaConvite, "criarConvite");
	return (
		<div className={css.vazio}>
			<h3 className={css.vazioTitulo}>{salas.servidorVazio.titulo}</h3>
			<p className={css.vazioTexto}>
				{podeCriar
					? salas.servidorVazio.comPermissao
					: salas.servidorVazio.semPermissao}
			</p>
			{(podeCriar || podeConvidar) && (
				<div className={css.vazioAcoes}>
					{podeCriar && (
						<Botao
							onClick={() => {
								setCriando(true);
							}}
						>
							{salas.criarSala}
						</Botao>
					)}
					{podeConvidar && (
						<Botao
							variante="secundario"
							onClick={() => {
								setConvidando(true);
							}}
						>
							{salas.servidorVazio.convidar}
						</Botao>
					)}
				</div>
			)}
			{podeCriar && (
				<CriarSala serverId={serverId} aberto={criando} aoMudar={setCriando} />
			)}
			{canalParaConvite !== undefined && podeConvidar && (
				<ConvidarPessoas
					canalId={canalParaConvite}
					aberto={convidando}
					aoMudar={setConvidando}
				/>
			)}
		</div>
	);
}

function ListaDoServidor({ serverId }: { serverId: string }) {
	const coluna = useColuna(serverId);
	const emVoz = useCanaisDeVoz(serverId);
	const emTexto = useCanaisDeTexto(serverId);
	const semSala = emVoz.length === 0;
	// Só com a função anunciada: sem ela o mapa nem é consultado.
	const temTopicos = useTemTopicos();
	const seguidosPorPai = useTopicosSeguidosPorPai();
	if (semSala && emTexto.length === 0) {
		return (
			<ServidorSemSalas serverId={serverId} canalParaConvite={emTexto[0]} />
		);
	}
	const voz = new Set(emVoz);
	return (
		<>
			{semSala ? (
				<ServidorSemSalas serverId={serverId} canalParaConvite={emTexto[0]} />
			) : null}
			{coluna.map((cat) => {
				const canais = semSala
					? cat.canais.filter((id) => !voz.has(id))
					: cat.canais;
				if (canais.length === 0) return null;
				return (
					<section
						key={cat.id}
						className={css.secao}
						aria-label={cat.titulo ?? salas.secaoDeSalas}
					>
						{cat.titulo !== undefined && (
							<h3 className={css.rotuloDaSecao}>{cat.titulo}</h3>
						)}
						<ul className={css.lista}>
							{canais.map((id) => (
								<LinhaDaColuna
									key={id}
									serverId={serverId}
									canalId={id}
									seguidos={temTopicos ? seguidosPorPai.get(id) : undefined}
								/>
							))}
						</ul>
					</section>
				);
			})}
		</>
	);
}

/**
 * A coluna de salas e canais ligada aos stores. Sem servidor aberto, a coluna
 * vazia do catálogo; antes do `Ready`, esqueleto; com a conexão caída, a faixa
 * que diz que a presença pode estar desatualizada (e as salas, esmaecidas).
 */
/** Recolhe a coluna numa faixa. Some quando ela já está recolhida: o botão de mostrar fica na faixa. */
function BotaoDeRecolher() {
	return (
		<Botao
			variante="fantasma"
			tamanho="sm"
			icone={<SetaParaEsquerda />}
			aria-label={shell.faixa.recolher}
			onClick={() => definirColunaDeSalas("faixa")}
		/>
	);
}

export function ColunaConectada({ rodape }: { rodape?: ReactNode }) {
	const pronto = useProntidao();
	const local = useLocal();
	const serverId = useServidorAtivo();
	const servidor = useServer(serverId);
	const colunaRecolhida = useColunaDeSalas() === "faixa";
	// A cápsula do palco assume os controles. A faixa, sozinha, não: o painel
	// continua na coluna (e no overlay que ela abre) enquanto o palco está fechado.
	const palcoAberto = useSalaDoPalco(
		local.tipo === "servidor" ? local.serverId : undefined,
	).aberto;
	const chamada = palcoAberto ? undefined : <PainelDaChamadaConectado />;
	// Sessão de pé: baixa o chunk do motor de voz quando o navegador estiver ocioso.
	useEffect(() => {
		if (pronto) aquecerVozQuandoOcioso();
	}, [pronto]);

	if (!pronto) {
		return (
			<ColunaDeSalas
				titulo={salas.carregandoServidor}
				rodape={rodape}
				chamada={chamada}
			>
				<EsqueletoDeSalas />
			</ColunaDeSalas>
		);
	}
	// Depois do Ready, a casa (amigos e conversas) tem a própria coluna; o resto do shell não sabe disso.
	if (local.tipo === "casa" || local.tipo === "amigos" || local.tipo === "dm") {
		return <ColunaDaCasa rodape={rodape} chamada={chamada} />;
	}
	if (local.tipo !== "servidor" || !servidor) {
		return (
			<ColunaDeSalas rodape={rodape} chamada={chamada}>
				{<p className={css.nota}>{shell.salas.vazio}</p>}
			</ColunaDeSalas>
		);
	}
	return (
		<ColunaDeSalas
			titulo={servidor.name}
			acoes={
				<span className={css.acoes}>
					{!colunaRecolhida && <BotaoDeRecolher />}
					<MenuDoServidor serverId={serverId} />
				</span>
			}
			rodape={rodape}
			chamada={chamada}
		>
			<ListaDoServidor serverId={serverId} />
		</ColunaDeSalas>
	);
}
