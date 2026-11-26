import {
	useEffect,
	useState,
	useSyncExternalStore,
	type ReactNode,
} from "react";
import {
	confirmarRedefinicao,
	criarConta,
	pedirRedefinicao,
	reenviarVerificacao,
	verificarEmail,
} from "nucleo/sdk/conta";
import { instanciaMandaEmail } from "nucleo/sdk/config";
import {
	assinarEntrada,
	definirEntrada,
	guardarEscolhaDeIdentidade,
	lerEntrada,
	type TelaDeEntrada as TelaDeFora,
} from "nucleo/store/entrada";
import { fora, lerSessao, type CausaDeErro } from "nucleo/store/sessao";

import { sessao as textos } from "../../textos";
import { TelaDeConferirEmail } from "./TelaDeConferirEmail";
import { TelaDeConvite } from "./TelaDeConvite";
import { TelaDeCriarConta } from "./TelaDeCriarConta";
import { TelaDeDownload } from "./TelaDeDownload";
import { TelaDeEntrada } from "./TelaDeEntrada";
import { TelaDeQr } from "./TelaDeQr";
import { TelaDeRecuperarSenha } from "./TelaDeRecuperarSenha";
import { TelaDeRedefinirSenha } from "./TelaDeRedefinirSenha";
import {
	TelaDeVerificarEmail,
	type EstadoDaVerificacao,
} from "./TelaDeVerificarEmail";

/**
 * Vai para outra tela de fora, limpando a falha da anterior.
 *
 * A falha mora na sessão (`erro`), que é compartilhada: sem limpar, o aviso de "senha
 * incorreta" da entrada apareceria sobre a tela de criar conta que a pessoa acabou de
 * abrir.
 */
export function navegar(tela: TelaDeFora): void {
	limparFalha();
	definirEntrada(tela);
}

function limparFalha(): void {
	if (lerSessao().estado === "erro") fora();
}

/**
 * Cada token de verificação é consumido UMA vez no servidor. O StrictMode roda o
 * efeito duas vezes, e a segunda chamada falharia ("link já usado") sobre um e-mail
 * que acabou de ser confirmado: o resultado fica guardado por token.
 */
const verificacoes = new Map<string, Promise<boolean>>();

function verificarUmaVez(token: string): Promise<boolean> {
	let pedido = verificacoes.get(token);
	if (!pedido) {
		pedido = verificarEmail(token);
		verificacoes.set(token, pedido);
	}
	return pedido;
}

/** Só para teste: esquece o que já foi verificado. */
export function esquecerVerificacoes(): void {
	verificacoes.clear();
}

function CriarContaDoPortao({ motivo }: { motivo: string | undefined }) {
	const [criando, setCriando] = useState(false);
	return (
		<TelaDeCriarConta
			motivo={motivo}
			criando={criando}
			aoCriar={(dados) => {
				limparFalha();
				setCriando(true);
				// Guardado ANTES da chamada: quem cria a conta cai direto no primeiro acesso, e um
				// `then` que gravasse isto correria com a troca de tela. O nome de exibição é
				// opcional no desenho e fica para o perfil.
				guardarEscolhaDeIdentidade({ usuario: dados.usuario, exibicao: "" });
				void criarConta(dados.email, dados.senha, dados.convite)
					.then((ok) => {
						if (ok)
							definirEntrada({ tipo: "conferirEmail", email: dados.email });
					})
					.finally(() => {
						setCriando(false);
					});
			}}
			aoEntrar={() => {
				navegar({ tipo: "entrar" });
			}}
		/>
	);
}

function ConferirEmailDoPortao({
	email,
	motivo,
}: {
	email: string | undefined;
	motivo: string | undefined;
}) {
	return (
		<TelaDeConferirEmail
			email={email}
			motivo={motivo}
			aoReenviar={(endereco) => {
				limparFalha();
				return reenviarVerificacao(endereco);
			}}
			aoUsarOutroEmail={() => {
				navegar({ tipo: "criar" });
			}}
			aoVoltar={() => {
				navegar({ tipo: "entrar" });
			}}
		/>
	);
}

function VerificarEmailDoPortao({
	token,
	motivo,
}: {
	token: string;
	motivo: string | undefined;
}) {
	const [resultado, setResultado] = useState<
		{ token: string; ok: boolean } | undefined
	>();

	useEffect(() => {
		let vivo = true;
		void verificarUmaVez(token).then((ok) => {
			if (vivo) setResultado({ token, ok });
		});
		return () => {
			vivo = false;
		};
	}, [token]);

	const estado: EstadoDaVerificacao =
		resultado?.token !== token
			? "verificando"
			: resultado.ok
				? "confirmado"
				: "falhou";

	return (
		<TelaDeVerificarEmail
			estado={estado}
			{...(motivo === undefined ? {} : { motivo })}
			aoEntrar={() => {
				navegar({ tipo: "entrar" });
			}}
		/>
	);
}

function RecuperarSenhaDoPortao({ motivo }: { motivo: string | undefined }) {
	return (
		<TelaDeRecuperarSenha
			mandaEmail={instanciaMandaEmail()}
			{...(motivo === undefined ? {} : { motivo })}
			aoPedir={(email) => {
				limparFalha();
				return pedirRedefinicao(email);
			}}
			aoVoltar={() => {
				navegar({ tipo: "entrar" });
			}}
		/>
	);
}

function RedefinirSenhaDoPortao({
	token,
	motivo,
}: {
	token: string;
	motivo: string | undefined;
}) {
	const [salvando, setSalvando] = useState(false);
	const [concluida, setConcluida] = useState(false);
	return (
		<TelaDeRedefinirSenha
			concluida={concluida}
			salvando={salvando}
			{...(motivo === undefined ? {} : { motivo })}
			aoSalvar={(senha, derrubar) => {
				limparFalha();
				setSalvando(true);
				void confirmarRedefinicao(token, senha, derrubar)
					.then((ok) => {
						if (ok) setConcluida(true);
					})
					.finally(() => {
						setSalvando(false);
					});
			}}
			aoPedirNovoLink={() => {
				navegar({ tipo: "recuperar" });
			}}
			aoEntrar={() => {
				navegar({ tipo: "entrar" });
			}}
		/>
	);
}

export interface AutenticacaoProps {
	entrando: boolean;
	causa: CausaDeErro | undefined;
	motivo: string | undefined;
	aoEntrar: (identificador: string, senha: string, manter: boolean) => void;
}

/**
 * Qual das telas de fora aparece.
 *
 * Separado do portão porque as perguntas são outras: o portão responde "quem é você" e
 * este "o que você está tentando fazer". Assina a loja de entrada aqui e não no portão,
 * para trocar de tela não acordar a árvore que contém o app.
 *
 * O `Record` é exaustivo sobre o tipo da tela: tela nova na união do núcleo não compila
 * até ter lugar aqui, o mesmo mecanismo que o portão usa para o estado da sessão.
 */
export function Autenticacao({
	entrando,
	causa,
	motivo,
	aoEntrar,
}: AutenticacaoProps) {
	const tela = useSyncExternalStore(assinarEntrada, lerEntrada);

	const entrar = (aviso?: string): ReactNode => (
		<TelaDeEntrada
			entrando={entrando}
			{...(causa === undefined ? {} : { causa })}
			{...(motivo === undefined ? {} : { motivo })}
			{...(aviso === undefined ? {} : { aviso })}
			aoEntrar={aoEntrar}
			aoRecuperarSenha={() => {
				navegar({ tipo: "recuperar" });
			}}
			aoCriarConta={() => {
				navegar({ tipo: "criar" });
			}}
			aoEntrarComQr={() => {
				navegar({ tipo: "qr" });
			}}
		/>
	);

	const TELA: Record<TelaDeFora["tipo"], () => ReactNode> = {
		entrar: () => entrar(),
		criar: () => <CriarContaDoPortao motivo={motivo} />,
		recuperar: () => <RecuperarSenhaDoPortao motivo={motivo} />,
		qr: () => (
			<TelaDeQr
				aoVoltar={() => {
					navegar({ tipo: "entrar" });
				}}
			/>
		),
		// Sem sessão, o link do QR cai na entrada com o motivo dito; o pedido espera do outro lado.
		autorizarQr: () => entrar(textos.entrada.avisoDoQr),
		conferirEmail: () => (
			<ConferirEmailDoPortao
				email={tela.tipo === "conferirEmail" ? tela.email : undefined}
				motivo={motivo}
			/>
		),
		verificar: () => (
			<VerificarEmailDoPortao
				token={tela.tipo === "verificar" ? tela.token : ""}
				motivo={motivo}
			/>
		),
		redefinir: () => (
			<RedefinirSenhaDoPortao
				token={tela.tipo === "redefinir" ? tela.token : ""}
				motivo={motivo}
			/>
		),
		convite: () => (
			<TelaDeConvite
				codigo={tela.tipo === "convite" ? tela.codigo : ""}
				aoEntrar={() => {
					navegar({ tipo: "entrar" });
				}}
				aoCriarConta={() => {
					navegar({ tipo: "criar" });
				}}
			/>
		),
		// Fora da v1: exclusão de conta por link.
		excluir: () => entrar(),
		download: () => <TelaDeDownload />,
	};

	return TELA[tela.tipo]();
}
