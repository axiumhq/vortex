import { plural } from "nucleo/lib/plural";

/**
 * Textos da jornada de sessão (PRD 4.1): restaurar, entrar, criar conta, confirmar
 * e-mail, recuperar e redefinir senha, segundo fator, conta desativada, escolher
 * nome, convite sem sessão, entrada por código QR e sair.
 *
 * Os erros de entrada são escolhidos por CATEGORIA (`CausaDeErro`, no núcleo): a
 * frase mora aqui, não na camada de rede. Quem digitou a senha precisa saber se
 * errou ou se o servidor não respondeu, porque as duas coisas pedem ações
 * opostas.
 */
export const sessao = {
	sair: "Sair",

	restaurando: {
		rotulo: "Restaurando sua sessão",
		mensagem: "Restaurando sua sessão…",
	},

	entrada: {
		titulo: "Entrar no Vortex",
		subtitulo: "Sua turma está esperando na sala.",
		identificador: "E-mail ou usuário",
		identificadorExemplo: "rafa@exemplo.com ou rafa",
		senha: "Senha",
		senhaExemplo: "Sua senha",
		mostrarSenha: "Mostrar senha",
		manterConectado: "Manter conectado",
		entrar: "Entrar",
		entrando: "Entrando…",
		esqueciASenha: "Esqueci a senha",
		ou: "ou",
		comQr: "Entrar com código QR",
		semConta: "Ainda não tem conta?",
		criarConta: "Criar conta",
		avisoDoQr: "Entre para autorizar o aparelho que mostrou o código QR.",
		// Os dois erros que marcam os campos ficam junto da senha, não acima do formulário.
		erro: {
			credenciais: "E-mail ou senha incorretos.",
			rede: "Sem conexão com o servidor. Confira sua internet e tente de novo.",
			servidor:
				"O servidor não conseguiu responder. Tente de novo em instantes.",
			naoVerificada: "Confirme seu e-mail antes de entrar.",
			soAutenticador:
				"Esta conta exige um aplicativo autenticador, e o Vortex não aceita esse método. Entre por outro aplicativo para desativá-lo.",
			limiteSemTempo:
				"Tentativas demais. Espere um pouco antes de tentar de novo.",
			limite: (segundos: number) =>
				`Tentativas demais. Espere ${plural(segundos, "segundo", "segundos")} antes de tentar de novo.`,
			generico: "Não deu para entrar. Tente de novo em instantes.",
		},
	},

	mfa: {
		titulo: "Confirme que é você",
		subtitulo: "Sua conta tem uma etapa extra de segurança.",
		comoVerificar: "Como verificar",
		senha: {
			aba: "Senha",
			rotulo: "Senha da conta",
			dica: "Digite a senha de novo para continuar.",
			incorreto: "Senha incorreta.",
		},
		recuperacao: {
			aba: "Código de recuperação",
			rotulo: "Código de recuperação",
			dica: "Use um dos códigos que você guardou ao ativar a etapa extra. Cada código vale uma vez.",
			incorreto: "Código incorreto.",
		},
		verificar: "Verificar",
		verificando: "Verificando…",
		outraConta: "Voltar",
	},

	desativada: {
		titulo: "Esta conta está desativada",
		texto:
			"O acesso foi suspenso pela administração do servidor. Nada do que você escreveu foi apagado.",
		quemResolve:
			"Quem administra esta instância pode reverter. Fale com essa pessoa.",
		outraConta: "Entrar com outra conta",
	},

	nome: {
		titulo: "Como o grupo vai te chamar?",
		subtitulo:
			"Escolha seu nome de usuário. É assim que as pessoas te encontram e te mencionam. Você pode trocar depois nas configurações.",
		rotulo: "Nome de usuário",
		exemplo: "seunome",
		regra: "Use de 2 a 32 letras, números, ponto, hífen ou sublinhado.",
		curto: (faltam: number) =>
			`Faltam ${plural(faltam, "caractere", "caracteres")}: o mínimo é 2.`,
		longo: "No máximo 32 caracteres.",
		invalido: "Só letras, números, ponto, hífen e sublinhado.",
		previaRotulo: "Como vai aparecer",
		previaMensagem: "cheguei, qual sala vocês estão?",
		continuar: "Continuar",
		salvando: "Salvando…",
		outraConta: "Usar outra conta",
	},

	senha: {
		mostrar: "Mostrar senha",
		forca: {
			vazia: "Escreva uma senha",
			fraca: "Fraca",
			media: "Média",
			boa: "Boa",
			forte: "Forte",
		},
		dicaVazia: "Use pelo menos 8 caracteres.",
		dicaMinimo: (faltam: number) =>
			`Faltam ${plural(faltam, "caractere", "caracteres")} para o mínimo de 8.`,
		dicaMisturar: "Misture letras maiúsculas, minúsculas e números.",
		dicaAumentar: "Aumente o tamanho ou misture letras e números.",
		dicaQuase: "Quase lá. Um símbolo ou mais caracteres deixam forte.",
		dicaForte: "Senha forte.",
		forcaRotulo: "Força da senha",
	},

	criar: {
		titulo: "Criar conta",
		subtitulo: "Leva menos de um minuto.",
		usuario: "Nome de usuário",
		usuarioDica:
			"Letras, números, ponto, hífen e sublinhado. É assim que a turma acha você.",
		usuarioExemplo: "rafa",
		email: "E-mail",
		emailExemplo: "rafa@exemplo.com",
		senha: "Senha",
		senhaExemplo: "Pelo menos 8 caracteres",
		convite: "Código de convite",
		conviteOpcional: "(opcional)",
		conviteObrigatorio: "Esta instância só aceita cadastro com convite.",
		conviteExemplo: "Se alguém convidou você",
		regras: "Ao criar a conta, você concorda com as regras desta instância.",
		criar: "Criar conta",
		criando: "Criando…",
		jaTemConta: "Já tem conta?",
		entrar: "Entrar",
	},

	conferir: {
		titulo: "Confira seu e-mail",
		paraEndereco: "Enviamos um link de confirmação para",
		semEndereco:
			"Enviamos um link de confirmação para o e-mail que você informou.",
		instrucao:
			"Abra o link para ativar a conta. Se não achar, olhe a caixa de spam.",
		emailDoReenvio: "E-mail para o reenvio",
		reenviar: "Reenviar",
		reenviando: "Reenviando…",
		reenviarEm: (segundos: number) => `Reenviar em ${String(segundos)} s`,
		reenviado: "E-mail reenviado.",
		outroEmail: "Usar outro e-mail",
		voltar: "Voltar para entrar",
	},

	verificar: {
		verificando: "Confirmando seu e-mail",
		verificandoTexto: "Um instante…",
		okTitulo: "E-mail confirmado",
		okTexto: "A conta está pronta. Pode entrar.",
		falhouTitulo: "Não deu para confirmar o e-mail",
		falhouTexto:
			"O link expirou ou já foi usado. Entre e peça outro, se a conta ainda não estiver confirmada.",
		entrar: "Entrar",
		voltar: "Voltar para entrar",
	},

	recuperar: {
		titulo: "Recuperar senha",
		subtitulo:
			"Digite o e-mail da sua conta. Enviamos um link para você escolher uma senha nova.",
		email: "E-mail",
		emailExemplo: "voce@exemplo.com",
		emailInvalido: "Digite um e-mail válido, como voce@exemplo.com.",
		enviar: "Enviar link",
		enviando: "Enviando…",
		voltar: "Voltar para entrar",
		enviadoTitulo: "Link enviado",
		enviadoTexto:
			"Se houver uma conta com esse e-mail, o link chega em alguns minutos.",
		enviadoDica:
			"Não achou? Olhe a caixa de spam. O link vale por pouco tempo.",
		semEmail:
			"Este servidor está com o envio de e-mail desligado, então o link não vai chegar. Peça a redefinição a quem administra a instância.",
		reenviar: "Reenviar link",
		reenviarEm: (segundos: number) => `Reenviar em ${String(segundos)} s`,
		reenviado: "Link reenviado",
		outroEmail: "Usar outro e-mail",
	},

	redefinir: {
		titulo: "Nova senha",
		subtitulo: "Escolha a senha que você vai usar para entrar no Vortex.",
		senha: "Nova senha",
		confirmar: "Confirmar senha",
		confirmarExemplo: "Repita a senha",
		diferentes: "As senhas não são iguais.",
		iguais: "As senhas são iguais.",
		derrubar: "Desconectar os outros aparelhos",
		salvar: "Salvar senha",
		salvando: "Salvando…",
		prontoTitulo: "Senha alterada",
		prontoTexto: "Entre com a senha nova.",
		prontoTextoDerrubou:
			"Os outros aparelhos foram desconectados. Entre com a senha nova.",
		pedirNovo: "Pedir um novo link",
		entrar: "Entrar",
		voltar: "Voltar para entrar",
	},

	convite: {
		titulo: "Você foi convidado",
		procurando: "Procurando o convite…",
		instrucaoSemSessao:
			"Entre ou crie uma conta para aceitar. O convite continua valendo depois.",
		entrarNaConta: "Entrar na conta",
		criarConta: "Criar conta",
		membros: (n: number) => plural(n, "pessoa", "pessoas"),
		convidadoPor: (nome: string) => `Convidado por ${nome}`,
		entrarNoServidor: "Entrar no servidor",
		entrando: "Entrando…",
		abrir: "Abrir o servidor",
		jaEsta: "Você já está neste servidor.",
		pedidoFeito:
			"Pedido enviado. Quem administra o servidor precisa aprovar a sua entrada.",
		banido: "Você não pode entrar neste servidor.",
		restritoPorIdade: "Este convite leva a um canal com conteúdo restrito.",
		naoDeu: "Este convite não vale mais ou não existe.",
		ignorar: "Agora não",
		voltar: "Ir para a entrada",
	},

	download: {
		titulo: "Vortex no seu computador",
		subtitulo:
			"A mesma interface da web, com atalhos globais de voz, áudio por aplicativo e sobreposição enquanto você joga.",
		baixar: "Baixar",
		baixarPara: (sistema: string) => `Baixar para ${sistema}`,
		todasAsVersoes: "Ver todas as versões",
		tituloPacotes: "Escolha o pacote",
		subtituloPacotes: "Windows e Linux",
		sinalSeuSistema: "Seu sistema",
		windows: "Windows",
		instaladorWindows: "Instalador .exe",
		instrucaoWindows:
			"Execute o instalador para começar. Se o SmartScreen avisar na primeira vez, confirme a execução — o Vortex atualiza sozinho depois.",
		debian: "Ubuntu e Debian",
		pacoteDebian: "Pacote .deb",
		arch: "Arch Linux",
		pacoteArch: "Pacote .pkg.tar.zst",
		linux: "Outras distribuições Linux",
		pacoteLinux: "Arquivo .zip",
		instalarNoLinux: "Instalar em um comando",
		instrucaoLinuxUnica:
			"Baixa o pacote certo para sua distribuição com verificação SHA-256, instala e também atualiza depois. Se preferir, baixe o arquivo acima manualmente.",
		comoInstalar: "Como instalar",
		copiar: "Copiar",
		copiado: "Copiado",
		copiarComando: "Copiar comando de instalação",
		recursoAtalhosTitulo: "Atalhos globais de voz",
		recursoAtalhosTexto:
			"Fale ou silencie o microfone mesmo com outra janela em foco.",
		recursoAudioTitulo: "Áudio por aplicativo",
		recursoAudioTexto:
			"Compartilhe o som apenas do jogo ou da janela que você escolher.",
		recursoSobreposicaoTitulo: "Sobreposição em jogo",
		recursoSobreposicaoTexto:
			"Veja quem está falando sem sair da tela cheia.",
		recursoBandejaTitulo: "Sempre à mão",
		recursoBandejaTexto:
			"Fica na bandeja do sistema e pode abrir junto com o computador.",
		fonte: "Arquivos oficiais das versões do Vortex no GitHub.",
		macos: "O aplicativo para macOS ainda não está disponível.",
		voltar: "Voltar ao Vortex",
	},

	qr: {
		titulo: "Aponte um aparelho conectado",
		instrucao:
			"Abra a câmera num celular ou computador onde você já entrou no Vortex e leia o código. Só autorize lá se o número de confirmação for o mesmo que aparece aqui.",
		rotuloDoCodigo: "Código QR para entrar neste aparelho",
		gerando: "Gerando código",
		entrando: "Entrando",
		confirmacao: "Confirmação",
		voltar: "Voltar para entrar",
		outroCodigo: "Gerar outro código",
	},

	autorizar: {
		titulo: "Autorizar outro aparelho",
		descricao: "Entrar nesta conta pelo código QR",
		carregando: "Buscando o pedido",
		instrucao:
			"Confira se este número é o mesmo que aparece na tela do outro aparelho. Se alguém te mandou este link, não autorize.",
		confirmacao: "Confirmação",
		ondeApareceNaLista:
			"A sessão nova aparece na lista de dispositivos das configurações, onde dá para derrubá-la a qualquer momento.",
		autorizar: "Os números batem, autorizar",
		recusar: "Recusar",
		fechar: "Fechar",
		pronto: "Pronto. O outro aparelho já está entrando.",
		vencido:
			"Este código já não vale: ele vence em dois minutos e só pode ser usado uma vez. Gere outro no aparelho que quer entrar.",
	},
} as const;
