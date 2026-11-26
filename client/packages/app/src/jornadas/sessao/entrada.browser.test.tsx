import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { Convite, ResultadoDeEntrada } from "nucleo/sdk/servidores";
import type { PedidoDeQr } from "nucleo/sdk/qr";
import {
	limparEntrada,
	definirEntrada,
	lerEntrada,
} from "nucleo/store/entrada";
import { dentro, erro, fora, limparSessao } from "nucleo/store/sessao";

const mocks = vi.hoisted(() => ({
	buscarConvite: vi.fn(),
	entrarPorConvite: vi.fn(),
	verPedidoDeQr: vi.fn(),
	autorizarQr: vi.fn(),
	recusarQr: vi.fn(),
	criarConta: vi.fn(),
	verificarEmail: vi.fn(),
	reenviarVerificacao: vi.fn(),
	pedirRedefinicao: vi.fn(),
	confirmarRedefinicao: vi.fn(),
}));

vi.mock("nucleo/sdk/servidores", async (importOriginal) => ({
	...(await importOriginal<typeof import("nucleo/sdk/servidores")>()),
	buscarConvite: mocks.buscarConvite,
	entrarPorConvite: mocks.entrarPorConvite,
}));

vi.mock("nucleo/sdk/qr", async (importOriginal) => ({
	...(await importOriginal<typeof import("nucleo/sdk/qr")>()),
	verPedidoDeQr: mocks.verPedidoDeQr,
	autorizarQr: mocks.autorizarQr,
	recusarQr: mocks.recusarQr,
}));

vi.mock("nucleo/sdk/conta", async (importOriginal) => ({
	...(await importOriginal<typeof import("nucleo/sdk/conta")>()),
	criarConta: mocks.criarConta,
	verificarEmail: mocks.verificarEmail,
	reenviarVerificacao: mocks.reenviarVerificacao,
	pedirRedefinicao: mocks.pedirRedefinicao,
	confirmarRedefinicao: mocks.confirmarRedefinicao,
}));

import { sessao } from "../../textos";
import { desmontar, montar, pegar } from "../../ui/ds/montar";
import { AutorizarQr } from "./AutorizarQr";
import { Autenticacao, esquecerVerificacoes } from "./Autenticacao";
import { ConviteRecebido } from "./ConviteRecebido";
import { PortaoDeSessao } from "./PortaoDeSessao";
import { TelaDeConferirEmail } from "./TelaDeConferirEmail";
import { TelaDeConvite } from "./TelaDeConvite";
import { TelaDeCriarConta } from "./TelaDeCriarConta";
import { TelaDeQr } from "./TelaDeQr";
import { TelaDeRecuperarSenha } from "./TelaDeRecuperarSenha";
import { TelaDeRedefinirSenha } from "./TelaDeRedefinirSenha";
import { TelaDeVerificarEmail } from "./TelaDeVerificarEmail";
import {
	guardarConvite,
	guardarPedidoDeQr,
	lerDestino,
	limparDestino,
} from "./destinoPendente";
import { desligarRotaDeEntrada, ligarRotaDeEntrada } from "./rotaDeEntrada";
import { emailPlausivel, forcaDaSenha, problemaDoUsuario } from "./regras";

afterEach(() => {
	desmontar();
	limparSessao();
	limparEntrada();
	limparDestino();
	esquecerVerificacoes();
	vi.useRealTimers();
	vi.clearAllMocks();
});

const assentar = () =>
	new Promise<void>((resolve) => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				resolve();
			});
		});
	});
const texto = (alvo: Element | null = document.body) => alvo?.textContent ?? "";
const campo = (rotulo: string) =>
	[...document.querySelectorAll<HTMLInputElement>("input")].find(
		(i) =>
			document
				.querySelector(`label[for="${i.id}"]`)
				?.textContent.startsWith(rotulo) === true,
	);
const alertas = () =>
	[...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
const botao = (nome: string) =>
	[...document.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent === nome,
	);
const titulo = () => pegar("h1")?.textContent;

const conviteDeAmostra: Convite = {
	codigo: "abc123",
	serverId: "01SERVIDOR",
	nomeDoServidor: "Vortex Core",
	sigla: "VC",
	membros: 1204,
	nomeDoCanal: "boas-vindas",
	convidadoPor: "Júlia",
	iconeUrl: undefined,
	bannerUrl: undefined,
	assuntoDoCanal: undefined,
	avatarDeQuemConvidou: undefined,
	jaSouMembro: false,
	restritoPorIdade: false,
};

describe("regras dos formulários", () => {
	it("a força sobe com comprimento e variedade, e abaixo do mínimo nunca passa de uma barra", () => {
		expect(forcaDaSenha("")).toMatchObject({ barras: 0, nivel: "vazia" });
		expect(forcaDaSenha("Ab1!")).toMatchObject({
			barras: 1,
			nivel: "fraca",
			falta: 4,
		});
		expect(forcaDaSenha("abcdefgh")).toMatchObject({
			barras: 1,
			nivel: "fraca",
			falta: 0,
		});
		expect(forcaDaSenha("abcdefg1")).toMatchObject({
			barras: 2,
			nivel: "media",
		});
		expect(forcaDaSenha("Abcdefg1")).toMatchObject({ barras: 3, nivel: "boa" });
		expect(forcaDaSenha("Abcdefg1!x")).toMatchObject({
			barras: 4,
			nivel: "forte",
		});
	});

	it("o nome de usuário segue a regra do servidor, não a do desenho", () => {
		expect(problemaDoUsuario("")).toBeUndefined();
		expect(problemaDoUsuario("a")).toBe("curto");
		expect(problemaDoUsuario("x".repeat(33))).toBe("longo");
		expect(problemaDoUsuario("ra fa")).toBe("invalido");
		expect(problemaDoUsuario("João.Silva_2-x")).toBeUndefined();
	});

	it("e-mail plausível pede arroba e domínio com ponto", () => {
		expect(emailPlausivel("rafa@exemplo.com")).toBe(true);
		expect(emailPlausivel("rafa@exemplo")).toBe(false);
		expect(emailPlausivel("rafa")).toBe(false);
	});
});

describe("criar conta", () => {
	const props = {
		criando: false,
		aoCriar: () => undefined,
		aoEntrar: () => undefined,
	};

	async function preencher() {
		await userEvent.fill(campo(sessao.criar.usuario)!, "rafa");
		await userEvent.fill(campo(sessao.criar.email)!, "rafa@exemplo.com");
		await userEvent.fill(campo(sessao.criar.senha)!, "Senha-forte-1");
	}

	it("mostra os campos do desenho, o medidor e o botão desabilitado até estar tudo certo", async () => {
		montar(<TelaDeCriarConta {...props} />);
		expect(titulo()).toBe(sessao.criar.titulo);
		expect(campo(sessao.criar.usuario)).toBeDefined();
		expect(campo(sessao.criar.email)?.type).toBe("email");
		expect(campo(sessao.criar.senha)?.type).toBe("password");
		expect(campo(sessao.criar.convite)).toBeDefined();
		expect(texto()).toContain(
			`${sessao.senha.forcaRotulo}: ${sessao.senha.forca.vazia}`,
		);
		expect(botao(sessao.criar.criar)?.disabled).toBe(true);
		await preencher();
		expect(botao(sessao.criar.criar)?.disabled).toBe(false);
		expect(texto()).toContain(sessao.senha.forca.forte);
	});

	it("não tem link de termos ou política que não leve a lugar nenhum", () => {
		montar(<TelaDeCriarConta {...props} />);
		const nomes = [...document.querySelectorAll("button, a")].map(
			(e) => e.getAttribute("aria-label") ?? e.textContent,
		);
		expect(nomes.sort()).toEqual(
			[
				sessao.criar.criar,
				sessao.criar.entrar,
				sessao.entrada.mostrarSenha,
			].sort(),
		);
	});

	it("senha curta e nome inválido ficam com o botão desabilitado e a frase do motivo", async () => {
		montar(<TelaDeCriarConta {...props} />);
		await userEvent.fill(campo(sessao.criar.usuario)!, "ra fa");
		expect(alertas()).toContain(sessao.nome.invalido);
		await userEvent.fill(campo(sessao.criar.email)!, "rafa@exemplo.com");
		await userEvent.fill(campo(sessao.criar.senha)!, "curta");
		expect(botao(sessao.criar.criar)?.disabled).toBe(true);
	});

	it("Enter envia os dados sem espaços nas pontas, e o convite vazio vira ausência", async () => {
		const aoCriar = vi.fn();
		montar(<TelaDeCriarConta {...props} aoCriar={aoCriar} />);
		await preencher();
		await userEvent.keyboard("{Enter}");
		expect(aoCriar).toHaveBeenCalledExactlyOnceWith({
			usuario: "rafa",
			email: "rafa@exemplo.com",
			senha: "Senha-forte-1",
			convite: undefined,
		});
	});

	it("criando: botão ocupado, campos só de leitura e sem reenvio", () => {
		const aoCriar = vi.fn();
		montar(<TelaDeCriarConta {...props} criando aoCriar={aoCriar} />);
		const ocupado = document.querySelector('button[aria-busy="true"]');
		expect(ocupado?.textContent).toBe(sessao.criar.criando);
		expect(campo(sessao.criar.email)?.readOnly).toBe(true);
		(ocupado as HTMLButtonElement).click();
		expect(aoCriar).not.toHaveBeenCalled();
	});

	it("erro do servidor aparece no alto, com os campos intactos", () => {
		montar(
			<TelaDeCriarConta
				{...props}
				motivo="Já existe uma conta com esse e-mail."
			/>,
		);
		expect(alertas()).toEqual(["Já existe uma conta com esse e-mail."]);
	});

	it("já tem conta leva de volta à entrada", async () => {
		const aoEntrar = vi.fn();
		montar(<TelaDeCriarConta {...props} aoEntrar={aoEntrar} />);
		await userEvent.click(botao(sessao.criar.entrar)!);
		expect(aoEntrar).toHaveBeenCalledOnce();
	});
});

describe("confira seu e-mail", () => {
	const props = {
		aoReenviar: () => Promise.resolve(true),
		aoUsarOutroEmail: () => undefined,
		aoVoltar: () => undefined,
	};

	it("diz para onde foi e espera 60 s antes de deixar reenviar", () => {
		montar(<TelaDeConferirEmail {...props} email="rafa@exemplo.com" />);
		expect(titulo()).toBe(sessao.conferir.titulo);
		expect(texto()).toContain("rafa@exemplo.com");
		expect(botao(sessao.conferir.reenviarEm(60))?.disabled).toBe(true);
		expect(document.querySelector("input")).toBeNull();
	});

	it("depois da espera reenvia na mesma tela, avisa e volta a esperar", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
		const aoReenviar = vi.fn(() => Promise.resolve(true));
		montar(
			<TelaDeConferirEmail
				{...props}
				email="rafa@exemplo.com"
				aoReenviar={aoReenviar}
			/>,
		);
		await vi.advanceTimersByTimeAsync(60_000);
		await assentar();
		const reenviar = botao(sessao.conferir.reenviar)!;
		expect(reenviar.disabled).toBe(false);
		reenviar.click();
		await expect.poll(() => texto()).toContain(sessao.conferir.reenviado);
		expect(aoReenviar).toHaveBeenCalledExactlyOnceWith("rafa@exemplo.com");
		expect(botao(sessao.conferir.reenviarEm(60))?.disabled).toBe(true);
	});

	it("sem o endereço (a página recarregou) pede o e-mail em vez de reenviar para ninguém", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
		const aoReenviar = vi.fn(() => Promise.resolve(true));
		montar(
			<TelaDeConferirEmail
				{...props}
				email={undefined}
				aoReenviar={aoReenviar}
			/>,
		);
		await vi.advanceTimersByTimeAsync(60_000);
		await assentar();
		expect(botao(sessao.conferir.reenviar)?.disabled).toBe(true);
		await userEvent.fill(
			campo(sessao.conferir.emailDoReenvio)!,
			"outro@exemplo.com",
		);
		expect(botao(sessao.conferir.reenviar)?.disabled).toBe(false);
	});

	it("falha do reenvio aparece como alerta e não reinicia a espera", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
		montar(
			<TelaDeConferirEmail
				{...props}
				email="rafa@exemplo.com"
				aoReenviar={() => Promise.resolve(false)}
				motivo="Tentativas demais."
			/>,
		);
		expect(alertas()).toEqual(["Tentativas demais."]);
		await vi.advanceTimersByTimeAsync(60_000);
		await assentar();
		botao(sessao.conferir.reenviar)!.click();
		await assentar();
		expect(botao(sessao.conferir.reenviar)?.disabled).toBe(false);
	});

	it("usar outro e-mail e voltar chamam os dois caminhos", async () => {
		const aoUsarOutroEmail = vi.fn();
		const aoVoltar = vi.fn();
		montar(
			<TelaDeConferirEmail
				{...props}
				email="a@b.co"
				aoUsarOutroEmail={aoUsarOutroEmail}
				aoVoltar={aoVoltar}
			/>,
		);
		await userEvent.click(botao(sessao.conferir.outroEmail)!);
		await userEvent.click(botao(sessao.conferir.voltar)!);
		expect(aoUsarOutroEmail).toHaveBeenCalledOnce();
		expect(aoVoltar).toHaveBeenCalledOnce();
	});
});

describe("link de confirmação (/verificar/:token)", () => {
	it("verificando, confirmado e falhou têm tela própria", () => {
		montar(
			<TelaDeVerificarEmail estado="verificando" aoEntrar={() => undefined} />,
		);
		expect(titulo()).toBe(sessao.verificar.verificando);
		expect(pegar('[role="status"]')?.getAttribute("aria-busy")).toBe("true");
		desmontar();
		montar(
			<TelaDeVerificarEmail estado="confirmado" aoEntrar={() => undefined} />,
		);
		expect(titulo()).toBe(sessao.verificar.okTitulo);
		expect(botao(sessao.verificar.entrar)).toBeDefined();
		desmontar();
		montar(
			<TelaDeVerificarEmail
				estado="falhou"
				motivo="Link expirado."
				aoEntrar={() => undefined}
			/>,
		);
		expect(titulo()).toBe(sessao.verificar.falhouTitulo);
		expect(alertas()).toEqual(["Link expirado."]);
	});

	it("pela rota, confirma sozinho UMA vez só, mesmo com o StrictMode, e leva à entrada", async () => {
		mocks.verificarEmail.mockResolvedValue(true);
		fora();
		definirEntrada({ tipo: "verificar", token: "tok-1" });
		montar(
			<Autenticacao
				entrando={false}
				causa={undefined}
				motivo={undefined}
				aoEntrar={() => undefined}
			/>,
		);
		await expect.poll(() => titulo()).toBe(sessao.verificar.okTitulo);
		expect(mocks.verificarEmail).toHaveBeenCalledTimes(1);
		expect(mocks.verificarEmail).toHaveBeenCalledWith("tok-1");
		await userEvent.click(botao(sessao.verificar.entrar)!);
		expect(lerEntrada().tipo).toBe("entrar");
		await expect.poll(() => titulo()).toBe(sessao.entrada.titulo);
	});

	it("link vencido mostra a frase do servidor", async () => {
		mocks.verificarEmail.mockImplementation(() => {
			erro("Este link expirou.");
			return Promise.resolve(false);
		});
		definirEntrada({ tipo: "verificar", token: "tok-2" });
		montar(<PortaoDeSessao iniciar={() => undefined}>{null}</PortaoDeSessao>);
		fora();
		await expect.poll(() => titulo()).toBe(sessao.verificar.falhouTitulo);
		await expect.poll(() => alertas()).toEqual(["Este link expirou."]);
	});
});

describe("recuperar senha", () => {
	const props = {
		mandaEmail: true,
		aoPedir: () => Promise.resolve(true),
		aoVoltar: () => undefined,
	};

	it("e-mail inválido não chama o servidor e diz o formato", async () => {
		const aoPedir = vi.fn(() => Promise.resolve(true));
		montar(<TelaDeRecuperarSenha {...props} aoPedir={aoPedir} />);
		expect(titulo()).toBe(sessao.recuperar.titulo);
		await userEvent.fill(campo(sessao.recuperar.email)!, "isso-nao-e-email");
		await userEvent.keyboard("{Enter}");
		expect(aoPedir).not.toHaveBeenCalled();
		expect(alertas()).toEqual([sessao.recuperar.emailInvalido]);
	});

	it("pede o link, mostra o resultado sem confirmar que a conta existe e espera para reenviar", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
		const aoPedir = vi.fn(() => Promise.resolve(true));
		montar(<TelaDeRecuperarSenha {...props} aoPedir={aoPedir} />);
		await userEvent.fill(campo(sessao.recuperar.email)!, "rafa@exemplo.com");
		await userEvent.keyboard("{Enter}");
		await expect.poll(() => titulo()).toBe(sessao.recuperar.enviadoTitulo);
		expect(aoPedir).toHaveBeenCalledExactlyOnceWith("rafa@exemplo.com");
		expect(texto()).toContain(sessao.recuperar.enviadoTexto);
		expect(botao(sessao.recuperar.reenviarEm(60))?.disabled).toBe(true);
		await vi.advanceTimersByTimeAsync(60_000);
		await assentar();
		botao(sessao.recuperar.reenviar)!.click();
		await expect.poll(() => texto()).toContain(sessao.recuperar.reenviado);
		expect(aoPedir).toHaveBeenCalledTimes(2);
	});

	it("instância sem e-mail avisa que o link não vai chegar", () => {
		montar(<TelaDeRecuperarSenha {...props} mandaEmail={false} />);
		expect(alertas()).toEqual([sessao.recuperar.semEmail]);
	});

	it("falha do servidor fica na tela do formulário", () => {
		montar(<TelaDeRecuperarSenha {...props} motivo="Tentativas demais." />);
		expect(alertas()).toEqual(["Tentativas demais."]);
		expect(campo(sessao.recuperar.email)).toBeDefined();
	});

	it("usar outro e-mail volta ao formulário vazio", async () => {
		montar(<TelaDeRecuperarSenha {...props} />);
		await userEvent.fill(campo(sessao.recuperar.email)!, "rafa@exemplo.com");
		await userEvent.keyboard("{Enter}");
		await expect.poll(() => titulo()).toBe(sessao.recuperar.enviadoTitulo);
		await userEvent.click(botao(sessao.recuperar.outroEmail)!);
		expect(titulo()).toBe(sessao.recuperar.titulo);
		expect(campo(sessao.recuperar.email)?.value).toBe("");
	});
});

describe("redefinir senha (/redefinir/:token)", () => {
	const props = {
		concluida: false,
		salvando: false,
		aoSalvar: () => undefined,
		aoPedirNovoLink: () => undefined,
		aoEntrar: () => undefined,
	};

	it("só salva com a senha no mínimo e a confirmação igual; desconectar os outros nasce marcado", async () => {
		const aoSalvar = vi.fn();
		montar(<TelaDeRedefinirSenha {...props} aoSalvar={aoSalvar} />);
		expect(titulo()).toBe(sessao.redefinir.titulo);
		const derrubar = document.querySelector<HTMLInputElement>(
			'input[type="checkbox"]',
		)!;
		expect(derrubar.checked).toBe(true);
		expect(botao(sessao.redefinir.salvar)?.disabled).toBe(true);
		await userEvent.fill(campo(sessao.redefinir.senha)!, "Senha-nova-1");
		await userEvent.fill(campo(sessao.redefinir.confirmar)!, "Senha-nova-2");
		expect(alertas()).toEqual([sessao.redefinir.diferentes]);
		expect(botao(sessao.redefinir.salvar)?.disabled).toBe(true);
		await userEvent.fill(campo(sessao.redefinir.confirmar)!, "Senha-nova-1");
		expect(texto()).toContain(sessao.redefinir.iguais);
		await userEvent.keyboard("{Enter}");
		expect(aoSalvar).toHaveBeenCalledExactlyOnceWith("Senha-nova-1", true);
	});

	it("salvando bloqueia os campos; falha mostra a frase e oferece pedir outro link", async () => {
		const aoPedirNovoLink = vi.fn();
		montar(
			<TelaDeRedefinirSenha
				{...props}
				salvando
				motivo="Este link expirou."
				aoPedirNovoLink={aoPedirNovoLink}
			/>,
		);
		expect(
			document.querySelector('button[aria-busy="true"]')?.textContent,
		).toBe(sessao.redefinir.salvando);
		expect(campo(sessao.redefinir.senha)?.readOnly).toBe(true);
		expect(alertas()).toEqual(["Este link expirou."]);
		desmontar();
		montar(
			<TelaDeRedefinirSenha
				{...props}
				motivo="Este link expirou."
				aoPedirNovoLink={aoPedirNovoLink}
			/>,
		);
		await userEvent.click(botao(sessao.redefinir.pedirNovo)!);
		expect(aoPedirNovoLink).toHaveBeenCalledOnce();
	});

	it("concluída diz que os outros aparelhos foram desconectados e leva à entrada", async () => {
		const aoEntrar = vi.fn();
		montar(<TelaDeRedefinirSenha {...props} concluida aoEntrar={aoEntrar} />);
		expect(titulo()).toBe(sessao.redefinir.prontoTitulo);
		expect(texto()).toContain(sessao.redefinir.prontoTextoDerrubou);
		await userEvent.click(botao(sessao.redefinir.entrar)!);
		expect(aoEntrar).toHaveBeenCalledOnce();
	});

	it("pela rota, redefine com o token do link e o pedido leva a escolha de desconectar", async () => {
		mocks.confirmarRedefinicao.mockResolvedValue(true);
		fora();
		definirEntrada({ tipo: "redefinir", token: "tok-r" });
		montar(
			<Autenticacao
				entrando={false}
				causa={undefined}
				motivo={undefined}
				aoEntrar={() => undefined}
			/>,
		);
		await userEvent.fill(campo(sessao.redefinir.senha)!, "Senha-nova-1");
		await userEvent.fill(campo(sessao.redefinir.confirmar)!, "Senha-nova-1");
		await userEvent.click(document.querySelector('input[type="checkbox"]')!);
		await userEvent.keyboard("{Enter}");
		await expect.poll(() => titulo()).toBe(sessao.redefinir.prontoTitulo);
		expect(mocks.confirmarRedefinicao).toHaveBeenCalledExactlyOnceWith(
			"tok-r",
			"Senha-nova-1",
			false,
		);
		expect(texto()).toContain(sessao.redefinir.prontoTexto);
	});
});

describe("navegação entre as telas de fora", () => {
	it("entrada leva a esqueci a senha, criar conta e código QR, e cada uma volta", async () => {
		mocks.buscarConvite.mockResolvedValue(conviteDeAmostra);
		fora();
		montar(
			<Autenticacao
				entrando={false}
				causa={undefined}
				motivo={undefined}
				aoEntrar={() => undefined}
			/>,
		);

		await userEvent.click(botao(sessao.entrada.esqueciASenha)!);
		expect(titulo()).toBe(sessao.recuperar.titulo);
		await userEvent.click(botao(sessao.recuperar.voltar)!);
		expect(titulo()).toBe(sessao.entrada.titulo);

		await userEvent.click(botao(sessao.entrada.criarConta)!);
		expect(titulo()).toBe(sessao.criar.titulo);
		await userEvent.click(botao(sessao.criar.entrar)!);
		expect(titulo()).toBe(sessao.entrada.titulo);
	});

	it("a falha de uma tela não vaza para a próxima", async () => {
		montar(<PortaoDeSessao iniciar={() => undefined}>{null}</PortaoDeSessao>);
		fora();
		await assentar();
		await userEvent.click(botao(sessao.entrada.criarConta)!);
		erro("Já existe uma conta com esse e-mail.");
		await assentar();
		expect(alertas()).toEqual(["Já existe uma conta com esse e-mail."]);
		await userEvent.click(botao(sessao.criar.entrar)!);
		await assentar();
		expect(titulo()).toBe(sessao.entrada.titulo);
		expect(alertas()).toEqual([]);
	});

	it("criar conta com sucesso guarda o nome escolhido e vai a 'confira seu e-mail' sem pôr o endereço na URL", async () => {
		mocks.criarConta.mockResolvedValue(true);
		desligarRotaDeEntrada();
		ligarRotaDeEntrada();
		fora();
		definirEntrada({ tipo: "criar" });
		montar(
			<Autenticacao
				entrando={false}
				causa={undefined}
				motivo={undefined}
				aoEntrar={() => undefined}
			/>,
		);
		await userEvent.fill(campo(sessao.criar.usuario)!, "rafa");
		await userEvent.fill(campo(sessao.criar.email)!, "rafa@exemplo.com");
		await userEvent.fill(campo(sessao.criar.senha)!, "Senha-forte-1");
		await userEvent.keyboard("{Enter}");
		await expect.poll(() => titulo()).toBe(sessao.conferir.titulo);
		expect(mocks.criarConta).toHaveBeenCalledExactlyOnceWith(
			"rafa@exemplo.com",
			"Senha-forte-1",
			undefined,
		);
		expect(texto()).toContain("rafa@exemplo.com");
		expect(location.pathname).toBe("/entrar/conferir");
		expect(location.href).not.toContain("rafa");
		history.replaceState(null, "", "/");
	});

	it("falha ao criar conta fica na tela com a frase do servidor", async () => {
		mocks.criarConta.mockImplementation(() => {
			erro("Já existe uma conta com esse e-mail.");
			return Promise.resolve(false);
		});
		montar(<PortaoDeSessao iniciar={() => undefined}>{null}</PortaoDeSessao>);
		fora();
		definirEntrada({ tipo: "criar" });
		await assentar();
		await userEvent.fill(campo(sessao.criar.usuario)!, "rafa");
		await userEvent.fill(campo(sessao.criar.email)!, "rafa@exemplo.com");
		await userEvent.fill(campo(sessao.criar.senha)!, "Senha-forte-1");
		await userEvent.keyboard("{Enter}");
		await expect
			.poll(() => alertas())
			.toEqual(["Já existe uma conta com esse e-mail."]);
		expect(titulo()).toBe(sessao.criar.titulo);
		expect(campo(sessao.criar.email)?.value).toBe("rafa@exemplo.com");
	});
});

describe("convite sem sessão (/convite/:codigo)", () => {
	it("mostra o servidor e leva a entrar ou criar conta", async () => {
		mocks.buscarConvite.mockResolvedValue(conviteDeAmostra);
		const aoEntrar = vi.fn();
		const aoCriarConta = vi.fn();
		montar(
			<TelaDeConvite
				codigo="abc123"
				aoEntrar={aoEntrar}
				aoCriarConta={aoCriarConta}
			/>,
		);
		expect(texto()).toContain(sessao.convite.procurando);
		await expect
			.poll(() => pegar('[data-testid="previa-do-convite"]'))
			.not.toBeNull();
		expect(texto()).toContain("Vortex Core");
		expect(texto()).toContain(sessao.convite.membros(1204));
		await userEvent.click(botao(sessao.convite.entrarNaConta)!);
		await userEvent.click(botao(sessao.convite.criarConta)!);
		expect(aoEntrar).toHaveBeenCalledOnce();
		expect(aoCriarConta).toHaveBeenCalledOnce();
	});

	it("convite que não vale diz o motivo e volta à entrada", async () => {
		mocks.buscarConvite.mockResolvedValue({ erro: "Convite não encontrado." });
		montar(
			<TelaDeConvite
				codigo="ruim"
				aoEntrar={() => undefined}
				aoCriarConta={() => undefined}
			/>,
		);
		await expect.poll(() => alertas()).toEqual(["Convite não encontrado."]);
		expect(botao(sessao.convite.voltar)).toBeDefined();
	});

	it("o código sobrevive ao login: cai na entrada, entra, e o convite abre dentro do app", async () => {
		mocks.buscarConvite.mockResolvedValue(conviteDeAmostra);
		history.replaceState(null, "", "/convite/abc123?ref=rastreio");
		desligarRotaDeEntrada();
		ligarRotaDeEntrada();
		expect(lerEntrada()).toEqual({ tipo: "convite", codigo: "abc123" });
		expect(lerDestino().convite).toBe("abc123");

		montar(
			<PortaoDeSessao iniciar={() => undefined}>
				<p data-testid="app">dentro do app</p>
			</PortaoDeSessao>,
		);
		fora();
		await expect.poll(() => botao(sessao.convite.entrarNaConta)).toBeDefined();
		await userEvent.click(botao(sessao.convite.entrarNaConta)!);
		expect(titulo()).toBe(sessao.entrada.titulo);
		// O convite continua guardado depois de sair da tela de convite.
		expect(lerDestino().convite).toBe("abc123");

		dentro("01U");
		await expect
			.poll(() => pegar('[data-testid="convite-recebido"]'))
			.not.toBeNull();
		expect(pegar('[data-testid="app"]')).not.toBeNull();
		expect(location.pathname).toBe("/");
		history.replaceState(null, "", "/");
	});
});

describe("download público (/download)", () => {
	it("mostra a página, aponta para os quatro pacotes e exibe instruções ao selecionar", async () => {
		definirEntrada({ tipo: "download" });
		montar(
			<Autenticacao
				entrando={false}
				causa={undefined}
				motivo={undefined}
				aoEntrar={() => undefined}
			/>,
		);

		expect(titulo()).toBe(sessao.download.titulo);
		const links = [
			...document.querySelectorAll<HTMLAnchorElement>(
				"a[data-pacote][href*='/releases/latest/download/']",
			),
		];
		expect(links.map((link) => link.getAttribute("href"))).toEqual([
			"https://github.com/axiumhq/vortex/releases/latest/download/Vortex-Setup.exe",
			"https://github.com/axiumhq/vortex/releases/latest/download/Vortex.deb",
			"https://github.com/axiumhq/vortex/releases/latest/download/Vortex.pkg.tar.zst",
			"https://github.com/axiumhq/vortex/releases/latest/download/Vortex-linux.zip",
		]);
		expect(links.every((link) => link.target === "_blank")).toBe(true);

		const principal = pegar<HTMLAnchorElement>('[data-testid="download-principal"]');
		expect(principal).not.toBeNull();
		expect(principal?.target).toBe("_blank");

		const seletorArch = [
			...document.querySelectorAll<HTMLButtonElement>("button"),
		].find((b) => b.textContent?.includes(sessao.download.arch));
		expect(seletorArch).toBeDefined();
		seletorArch!.click();
		await assentar();

		expect(texto()).toContain("install.sh | sh");
		expect(principal?.getAttribute("href")).toBe(
			"https://github.com/axiumhq/vortex/releases/latest/download/Vortex.pkg.tar.zst",
		);
	});

	it("aparece sem esperar a restauração da sessão", () => {
		limparSessao();
		definirEntrada({ tipo: "download" });
		montar(<PortaoDeSessao iniciar={() => undefined}>{null}</PortaoDeSessao>);

		expect(titulo()).toBe(sessao.download.titulo);
	});

	it("continua pública quando a pessoa já está conectada", async () => {
		definirEntrada({ tipo: "download" });
		dentro("01U");
		montar(
			<PortaoDeSessao iniciar={() => undefined}>
				<p data-testid="app">dentro do app</p>
			</PortaoDeSessao>,
		);
		await assentar();

		expect(titulo()).toBe(sessao.download.titulo);
		expect(pegar('[data-testid="app"]')).toBeNull();
	});
});

describe("convite aberto dentro do app", () => {
	const props = {
		codigo: "abc123",
		aoDispensar: () => undefined,
		aoAbrir: () => undefined,
	};

	it("entra no servidor do convite e abre", async () => {
		mocks.buscarConvite.mockResolvedValue(conviteDeAmostra);
		mocks.entrarPorConvite.mockResolvedValue({
			tipo: "entrou",
			serverId: "01SERVIDOR",
		} satisfies ResultadoDeEntrada);
		const aoAbrir = vi.fn();
		montar(<ConviteRecebido {...props} aoAbrir={aoAbrir} />);
		await expect
			.poll(() => botao(sessao.convite.entrarNoServidor))
			.toBeDefined();
		await userEvent.click(botao(sessao.convite.entrarNoServidor)!);
		await expect.poll(() => aoAbrir.mock.calls.length).toBe(1);
		expect(aoAbrir).toHaveBeenCalledWith("01SERVIDOR");
		expect(mocks.entrarPorConvite).toHaveBeenCalledWith("abc123");
	});

	it("quem já é membro abre o servidor sem chamar o convite", async () => {
		mocks.buscarConvite.mockResolvedValue({
			...conviteDeAmostra,
			jaSouMembro: true,
		});
		const aoAbrir = vi.fn();
		montar(<ConviteRecebido {...props} aoAbrir={aoAbrir} />);
		await expect.poll(() => botao(sessao.convite.abrir)).toBeDefined();
		await userEvent.click(botao(sessao.convite.abrir)!);
		expect(aoAbrir).toHaveBeenCalledWith("01SERVIDOR");
		expect(mocks.entrarPorConvite).not.toHaveBeenCalled();
	});

	it("pedido registrado e banimento são estados, e o botão de entrar some", async () => {
		mocks.buscarConvite.mockResolvedValue(conviteDeAmostra);
		mocks.entrarPorConvite.mockResolvedValue({
			tipo: "pedido",
		} satisfies ResultadoDeEntrada);
		montar(<ConviteRecebido {...props} />);
		await expect
			.poll(() => botao(sessao.convite.entrarNoServidor))
			.toBeDefined();
		await userEvent.click(botao(sessao.convite.entrarNoServidor)!);
		await expect.poll(() => texto()).toContain(sessao.convite.pedidoFeito);
		expect(botao(sessao.convite.entrarNoServidor)).toBeUndefined();
		desmontar();

		mocks.entrarPorConvite.mockResolvedValue({
			tipo: "banido",
		} satisfies ResultadoDeEntrada);
		montar(<ConviteRecebido {...props} />);
		await expect
			.poll(() => botao(sessao.convite.entrarNoServidor))
			.toBeDefined();
		await userEvent.click(botao(sessao.convite.entrarNoServidor)!);
		await expect.poll(() => alertas()).toEqual([sessao.convite.banido]);
		expect(botao(sessao.convite.entrarNoServidor)).toBeUndefined();
	});

	it("falha mantém o botão para tentar de novo, e dispensar fecha", async () => {
		mocks.buscarConvite.mockResolvedValue(conviteDeAmostra);
		mocks.entrarPorConvite.mockResolvedValue({
			tipo: "falhou",
			motivo: "Sem conexão.",
		} satisfies ResultadoDeEntrada);
		const aoDispensar = vi.fn();
		montar(<ConviteRecebido {...props} aoDispensar={aoDispensar} />);
		await expect
			.poll(() => botao(sessao.convite.entrarNoServidor))
			.toBeDefined();
		await userEvent.click(botao(sessao.convite.entrarNoServidor)!);
		await expect.poll(() => alertas()).toEqual(["Sem conexão."]);
		expect(botao(sessao.convite.entrarNoServidor)).toBeDefined();
		await userEvent.click(botao(sessao.convite.ignorar)!);
		expect(aoDispensar).toHaveBeenCalledOnce();
	});

	it("convite que não vale mostra o motivo", async () => {
		mocks.buscarConvite.mockResolvedValue({ erro: "Convite não encontrado." });
		montar(<ConviteRecebido {...props} />);
		await expect.poll(() => alertas()).toEqual(["Convite não encontrado."]);
		expect(botao(sessao.convite.entrarNoServidor)).toBeUndefined();
	});
});

describe("entrar com código QR", () => {
	const pedido = (expiraEm = Date.now() + 120_000): PedidoDeQr => ({
		id: "01PEDIDO",
		segredo: "segredo",
		codigo: "482913",
		expiraEm,
	});

	it("mostra o código QR e o número de confirmação, e o segredo nunca vai à tela", async () => {
		montar(
			<TelaDeQr
				aoVoltar={() => undefined}
				pedir={() => Promise.resolve(pedido())}
				trocar={() => Promise.resolve("pendente")}
			/>,
		);
		expect(texto()).toContain(sessao.qr.gerando);
		await expect
			.poll(() => pegar(`svg[aria-label="${sessao.qr.rotuloDoCodigo}"]`))
			.not.toBeNull();
		expect(texto()).toContain("482 913");
		expect(texto()).not.toContain("segredo");
		expect(pegar("svg path")?.getAttribute("d")?.length).toBeGreaterThan(100);
	});

	it("pergunta a cada 2 s, renova o código quando ele expira e conclui sem erro", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
		const pedir = vi.fn(() => Promise.resolve(pedido()));
		const trocar = vi
			.fn<(p: PedidoDeQr) => Promise<"pendente" | "concluida" | "expirado">>()
			.mockResolvedValueOnce("pendente")
			.mockResolvedValueOnce("expirado")
			.mockResolvedValue("concluida");
		montar(
			<TelaDeQr aoVoltar={() => undefined} pedir={pedir} trocar={trocar} />,
		);
		await vi.advanceTimersByTimeAsync(0);
		await assentar();
		await vi.advanceTimersByTimeAsync(2000);
		expect(trocar).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(2000);
		await assentar();
		expect(pedir).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(2000);
		await assentar();
		expect(texto()).toContain(sessao.qr.entrando);
	});

	it("falha ao gerar mostra o motivo e oferece gerar outro", async () => {
		montar(
			<TelaDeQr
				aoVoltar={() => undefined}
				pedir={() => Promise.reject(new Error("falhou"))}
				trocar={() => Promise.resolve("pendente")}
			/>,
		);
		await expect.poll(() => alertas().length).toBe(1);
		expect(botao(sessao.qr.outroCodigo)).toBeDefined();
	});

	it("voltar leva à entrada", async () => {
		const aoVoltar = vi.fn();
		montar(
			<TelaDeQr
				aoVoltar={aoVoltar}
				pedir={() => Promise.resolve(pedido())}
				trocar={() => Promise.resolve("pendente")}
			/>,
		);
		await userEvent.click(botao(sessao.qr.voltar)!);
		expect(aoVoltar).toHaveBeenCalledOnce();
	});
});

describe("autorizar outro aparelho (/qr/:id) com sessão", () => {
	const props = { id: "01PEDIDO", aoFechar: () => undefined };
	const pedidoParaAutorizar = {
		nome: "Vortex (web · QR)",
		codigo: "482913",
		expiraEm: Date.now() + 100_000,
	};

	it("mostra o número de confirmação e só autoriza quando a pessoa confirma que bate", async () => {
		mocks.verPedidoDeQr.mockResolvedValue(pedidoParaAutorizar);
		mocks.autorizarQr.mockResolvedValue(undefined);
		montar(<AutorizarQr {...props} />);
		expect(texto()).toContain(sessao.autorizar.carregando);
		await expect.poll(() => botao(sessao.autorizar.autorizar)).toBeDefined();
		expect(texto()).toContain("482 913");
		expect(mocks.autorizarQr).not.toHaveBeenCalled();
		await userEvent.click(botao(sessao.autorizar.autorizar)!);
		await expect.poll(() => texto()).toContain(sessao.autorizar.pronto);
		expect(mocks.autorizarQr).toHaveBeenCalledWith("01PEDIDO");
	});

	it("recusar avisa o servidor e fecha", async () => {
		mocks.verPedidoDeQr.mockResolvedValue(pedidoParaAutorizar);
		mocks.recusarQr.mockResolvedValue(undefined);
		const aoFechar = vi.fn();
		montar(<AutorizarQr {...props} aoFechar={aoFechar} />);
		await expect.poll(() => botao(sessao.autorizar.recusar)).toBeDefined();
		await userEvent.click(botao(sessao.autorizar.recusar)!);
		expect(mocks.recusarQr).toHaveBeenCalledWith("01PEDIDO");
		expect(aoFechar).toHaveBeenCalledOnce();
	});

	it("pedido vencido e falha de rede têm frase própria", async () => {
		mocks.verPedidoDeQr.mockResolvedValue(undefined);
		montar(<AutorizarQr {...props} />);
		await expect.poll(() => alertas()).toEqual([sessao.autorizar.vencido]);
		expect(botao(sessao.autorizar.autorizar)).toBeUndefined();
		desmontar();
		mocks.verPedidoDeQr.mockRejectedValue(new Error("x"));
		montar(<AutorizarQr {...props} />);
		await expect.poll(() => alertas().length).toBe(1);
	});

	it("sem sessão o link do QR cai na entrada com o motivo, e o pedido espera o login", async () => {
		mocks.verPedidoDeQr.mockResolvedValue(pedidoParaAutorizar);
		history.replaceState(null, "", "/qr/01PEDIDO");
		desligarRotaDeEntrada();
		ligarRotaDeEntrada();
		montar(
			<PortaoDeSessao iniciar={() => undefined}>
				{<p data-testid="app" />}
			</PortaoDeSessao>,
		);
		fora();
		await expect.poll(() => titulo()).toBe(sessao.entrada.titulo);
		expect(texto()).toContain(sessao.entrada.avisoDoQr);
		expect(lerDestino().qr).toBe("01PEDIDO");
		dentro("01U");
		await expect
			.poll(() => pegar('[data-testid="autorizar-qr"]'))
			.not.toBeNull();
		history.replaceState(null, "", "/");
	});
});

describe("links de e-mail dentro de uma aba com sessão", () => {
	beforeEach(() => {
		mocks.confirmarRedefinicao.mockResolvedValue(true);
	});

	it("o link de redefinição vale mais que o app: o token de uso único não se perde", async () => {
		definirEntrada({ tipo: "redefinir", token: "tok" });
		montar(
			<PortaoDeSessao iniciar={() => undefined}>
				<p data-testid="app" />
			</PortaoDeSessao>,
		);
		dentro("01U");
		await assentar();
		expect(titulo()).toBe(sessao.redefinir.titulo);
		expect(pegar('[data-testid="app"]')).toBeNull();
	});
});

describe("destino pendente", () => {
	it("convite e QR são guardados à parte e esquecidos um de cada vez", () => {
		guardarConvite("abc");
		guardarPedidoDeQr("01Q");
		expect(lerDestino()).toEqual({ convite: "abc", qr: "01Q" });
		limparDestino();
		expect(lerDestino()).toEqual({});
	});
});

describe("escolher nome, conforme o desenho", () => {
	const props = {
		motivo: undefined,
		salvando: false,
		aoEscolher: () => undefined,
		aoCancelar: () => undefined,
	};

	it("valida o formato antes de enviar e mostra como o nome vai aparecer", async () => {
		const { TelaDeNome } = await import("./TelaDeNome");
		const aoEscolher = vi.fn();
		montar(<TelaDeNome {...props} aoEscolher={aoEscolher} />);
		expect(texto()).toContain(sessao.nome.regra);
		expect(botao(sessao.nome.continuar)?.disabled).toBe(true);

		await userEvent.fill(campo(sessao.nome.rotulo)!, "r");
		expect(alertas()).toEqual([sessao.nome.curto(1)]);
		expect(botao(sessao.nome.continuar)?.disabled).toBe(true);

		await userEvent.fill(campo(sessao.nome.rotulo)!, "ra!fa");
		expect(alertas()).toEqual([sessao.nome.invalido]);

		await userEvent.fill(campo(sessao.nome.rotulo)!, "rafa");
		expect(alertas()).toEqual([]);
		expect(texto(pegar('[role="group"]'))).toContain("rafa");
		await userEvent.keyboard("{Enter}");
		expect(aoEscolher).toHaveBeenCalledExactlyOnceWith("rafa");
	});
});

describe("segundo fator, conforme o desenho", () => {
	it("só código de recuperação (conta com aplicativo autenticador): mostra o campo do código e a volta", async () => {
		const { TelaDeMfa } = await import("./TelaDeMfa");
		const aoCancelar = vi.fn();
		montar(
			<TelaDeMfa
				metodos={["recuperacao"]}
				verificando={false}
				incorreto={false}
				aoVerificar={() => undefined}
				aoCancelar={aoCancelar}
			/>,
		);
		expect(titulo()).toBe(sessao.mfa.titulo);
		expect(texto()).toContain(sessao.mfa.subtitulo);
		expect(campo(sessao.mfa.recuperacao.rotulo)).toBeDefined();
		await userEvent.click(botao(sessao.mfa.outraConta)!);
		expect(aoCancelar).toHaveBeenCalledOnce();
	});
});

describe("escala da tela de entrada e botão principal", () => {
	it("título na escala de display e cartão de 440px", () => {
		montar(
			<TelaDeRecuperarSenha
				mandaEmail
				aoPedir={() => Promise.resolve(true)}
				aoVoltar={() => undefined}
			/>,
		);
		expect(parseFloat(getComputedStyle(pegar("h1")!).fontSize)).toBe(22);
		const cartao = pegar("main")!;
		expect(getComputedStyle(cartao).maxWidth).toBe("440px");
	});

	it("os dois fatores cabem em uma linha cada, no cartão", async () => {
		const { TelaDeMfa } = await import("./TelaDeMfa");
		montar(
			<TelaDeMfa
				metodos={["senha", "recuperacao"]}
				verificando={false}
				incorreto={false}
				aoVerificar={() => undefined}
				aoCancelar={() => undefined}
			/>,
		);
		const abas = [
			...document.querySelectorAll<HTMLElement>('[role="group"] button'),
		];
		expect(abas).toHaveLength(2);
		for (const aba of abas)
			expect(aba.getBoundingClientRect().height).toBeLessThanOrEqual(40);
		const longa = abas.find(
			(a) => a.textContent === sessao.mfa.recuperacao.aba,
		)!;
		expect(longa.scrollWidth).toBeLessThanOrEqual(longa.clientWidth);
	});

	it("campo vazio: o botão principal fica apagado na recuperação, como na entrada", () => {
		montar(
			<TelaDeRecuperarSenha
				mandaEmail
				aoPedir={() => Promise.resolve(true)}
				aoVoltar={() => undefined}
			/>,
		);
		expect(botao(sessao.recuperar.enviar)?.disabled).toBe(true);
	});
});
