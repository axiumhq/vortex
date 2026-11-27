/**
 * O próprio perfil e a própria conta.
 *
 * Separado de `conta.ts`, que cuida do que acontece ANTES de haver sessão —
 * criar, verificar, recuperar. Aqui é o que só existe depois: editar quem você
 * é e derrubar dispositivos.
 */
import { client } from "./client";
import type { PresencaEscolhida } from "./domain";
import {
  definirMeuStatusLocal,
  definirMeuTextoLocal,
  semearMeuStatus,
} from "../store/meuStatus";
import { toast } from "../ui-logica/toastStore";
import { esperaDoLimite, motivoDoErro, tipoDoErro } from "./erros";

export type MeuPerfil = {
  readonly displayName: string;
  readonly username: string;
  readonly pronomes: string;
  readonly bio: string;
  /**
   * O próprio avatar, quando existe.
   *
   * `undefined` sem anexo, e não a URL do avatar padrão que o SDK gera: a
   * mesma disciplina de `urlDeAvatar` em `map.ts` — a silhueta genérica
   * cobriria o gradiente por ID, que é o fallback que identifica.
   */
  readonly avatarUrl: string | undefined;
};

export type Dispositivo = {
  readonly id: string;
  readonly nome: string;
  /** É a sessão desta aba. Não pode ser derrubada por engano. */
  readonly atual: boolean;
  /** Quando a sessão foi aberta, em ms. Vem do próprio ID (ULID). */
  readonly desde?: number;
};

/* Delega para o tradutor unico — ver `sdk/erros.ts`. O corpo que
   estava aqui lia `e.response.status`, que o `stoat-api` nunca
   produz, entao TODA falha virava "Sem resposta do servidor". */
function motivo(e: unknown): string {
  return motivoDoErro(e);
}

function falhou(oQue: string, e: unknown): void {
  toast({ tipo: "erro", titulo: oQue, descricao: motivo(e) });
}

/** O que os campos do perfil mostram hoje. Lido do cache do SDK. */
export function lerMeuPerfil(): MeuPerfil | undefined {
  const eu = client.user;
  if (!eu) return undefined;
  return {
    displayName: eu.displayName || eu.username,
    username: eu.username,
    pronomes: eu.pronouns ?? "",
    avatarUrl: eu.avatar ? eu.avatarURL : undefined,
    /*
      A bio NÃO está no cache do usuário.

      `profile.content` vem de `fetchProfile()`, que é uma chamada própria — o
      `Ready` não a manda. Começar vazia e deixar a pessoa escrever é honesto;
      o que seria errado é mostrar vazio E salvar por cima do que existe, e por
      isso `salvarPerfil` só envia a bio quando ela tem conteúdo.
    */
    bio: "",
  };
}

/**
 * Salva nome de exibição, pronomes e bio.
 *
 * Os três num `edit` só porque o protocolo aceita — e porque um formulário com
 * três botões "salvar" faz a pessoa salvar um e perder os outros dois.
 *
 * ⚠ **Campo vazio vira REMOÇÃO, não string vazia.** O protocolo tem
 * `remove: ["Pronouns"]` justamente porque `""` e "não declarado" são coisas
 * diferentes: a segunda esconde a linha do cartão de perfil, a primeira
 * mostraria uma linha em branco.
 */
export async function salvarPerfil(
  displayName: string,
  pronomes: string,
  bio: string,
): Promise<boolean> {
  try {
    const remover: string[] = [];
    if (!displayName) remover.push("DisplayName");
    if (!pronomes) remover.push("Pronouns");
    if (!bio) remover.push("ProfileContent");

    await client.user?.edit({
      ...(displayName ? { display_name: displayName } : {}),
      ...(pronomes ? { pronouns: pronomes } : {}),
      ...(bio ? { profile: { content: bio } } : {}),
      ...(remover.length ? { remove: remover as never } : {}),
    });
    return true;
  } catch (e) {
    falhou("Não deu para salvar o perfil.", e);
    return false;
  }
}

/**
 * Troca o nome de usuário. Pede a senha — é mudança de identidade.
 *
 * O protocolo exige a senha aqui e não no resto do perfil, e a razão é boa:
 * nome de exibição é como você se apresenta, nome de usuário é como as pessoas
 * te ACHAM. Trocá-lo por trás de uma sessão esquecida em outro computador
 * sequestraria a identidade sem tocar na senha.
 */
export async function trocarNomeDeUsuario(
  novo: string,
  senha: string,
): Promise<boolean> {
  try {
    await client.user?.changeUsername(novo, senha);
    return true;
  } catch (e) {
    falhou("Não deu para trocar o nome.", e);
    return false;
  }
}

export async function trocarSenha(nova: string, atual: string): Promise<boolean> {
  try {
    await client.account.changePassword(nova, atual);
    toast({ tipo: "info", titulo: "Senha alterada." });
    return true;
  } catch (e) {
    falhou("Não deu para trocar a senha.", e);
    return false;
  }
}

export async function trocarEmail(novo: string, senha: string): Promise<boolean> {
  try {
    await client.account.changeEmail(novo, senha);
    toast({
      tipo: "info",
      titulo: "E-mail alterado.",
      descricao: "Confirme pelo link que mandamos para o endereço novo.",
    });
    return true;
  } catch (e) {
    falhou("Não deu para trocar o e-mail.", e);
    return false;
  }
}

/* ------------------------------------------------- avatar e banner (meus) */

/** Qual das duas imagens do perfil. Domínio, e não o nome do campo. */
export type ImagemDoPerfil = "avatar" | "banner";

/**
 * A tag do `autumn` de cada uma.
 *
 * ⚠ **Tag errada não falha no ENVIO — falha no `PATCH`.** O `autumn` aceita o
 * PNG e é o `User.edit` que recusa um ID subido na tag errada. E as duas são
 * diferentes: `avatars` tem teto de 4 MB, `backgrounds` de 6 MB. Mapear aqui,
 * ao lado do campo, é o que impede a tela de escolher uma e o protocolo
 * esperar outra — a mesma decisão de `TAG_DA_IMAGEM` no servidor.
 */
export const TAG_DA_IMAGEM_DO_PERFIL = {
  avatar: "avatars",
  banner: "backgrounds",
} as const satisfies Record<ImagemDoPerfil, "avatars" | "backgrounds">;

/**
 * O banner do próprio perfil, que NÃO está no cache do usuário.
 *
 * ⚠ **`profile.background` vem de `fetchProfile()`, uma chamada própria** — o
 * `Ready` não o manda, pela mesma razão que não manda a bio. Por isso ele não
 * entra em `lerMeuPerfil`, que é síncrono e lê o cache: um campo que só existe
 * depois da rede misturado a campos que existem sempre daria uma tela que
 * pisca de vazio para cheio sem nada dizer que estava carregando.
 *
 * `undefined` é "não tem banner" e também "não deu para saber" — e aqui as
 * duas podem colapsar sem mentir, porque a única consequência é a área de
 * soltar aparecer vazia, que é o estado em que se ENVIA um.
 */
export async function lerMeuBanner(): Promise<string | undefined> {
  try {
    const perfil = await client.user?.fetchProfile();
    return perfil?.bannerURL;
  } catch {
    return undefined;
  }
}

/**
 * Veste ou tira o avatar ou o banner do próprio perfil (D-AUTH-38/39).
 *
 * `anexoId` ausente = remover, pelo `remove` do protocolo (`Avatar`/
 * `ProfileBackground`). `avatar: null` não é o caminho: quem apaga o campo é o
 * `remove`, e é a mesma regra já escrita em `salvarPerfil` para pronomes e bio.
 *
 * ⚠ **O banner mora dentro de `profile`, que é aplicado como PARCIAL.** Mandar
 * `profile: { background: id }` não apaga a bio — o servidor mescla. Montar o
 * objeto inteiro aqui é que apagaria, e seria o defeito silencioso clássico:
 * trocar a foto de capa e perder o texto de "sobre mim".
 */
export async function trocarImagemDoPerfil(
  qual: ImagemDoPerfil,
  anexoId: string | undefined,
): Promise<boolean> {
  const nome = qual === "avatar" ? "avatar" : "banner";
  try {
    if (anexoId === undefined) {
      await client.user?.edit({
        remove: [qual === "avatar" ? "Avatar" : "ProfileBackground"] as never,
      });
    } else if (qual === "avatar") {
      await client.user?.edit({ avatar: anexoId });
    } else {
      await client.user?.edit({ profile: { background: anexoId } });
    }
    return true;
  } catch (e) {
    falhou(
      anexoId === undefined
        ? `Não deu para remover o ${nome}.`
        : `Não deu para trocar o ${nome}.`,
      e,
    );
    return false;
  }
}

/* --------------------------------------------------------------- status */

/**
 * User.edit hydrates the SDK object but does not emit `userUpdate`.
 * The adapter's one handler is what writes the ephemeral map — reuse it.
 */
function avisarPresencaLocal(): void {
  const eu = client.user;
  if (eu) client.emit("userUpdate", eu, {} as never);
}

/**
 * A grafia do protocolo para cada escolha. Não sai daqui.
 *
 * `Focus` existe no protocolo e NÃO é oferecido: ele é um quinto estado que o
 * upstream desenha como "não perturbe mas diferente", sem nada na interface
 * que explique a diferença. Quatro opções que alguém consegue escolher com
 * confiança valem mais que cinco em que uma é adivinhação.
 */
const GRAFIA: Record<PresencaEscolhida, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Busy",
  invisivel: "Invisible",
};

/**
 * Escolhe a presença.
 *
 * ⚠ **Isto não existia, e a ausência era um dos buracos da varredura de
 * escopo:** `PresenceStatus` era lido, mapeado, pintado no pontinho de todo
 * mundo — e não havia como mudar o próprio. O status era uma coisa que o app
 * observava nas outras pessoas e que a pessoa dona da sessão não controlava.
 *
 * Escreve no store ANTES da rede, e a ordem é a decisão: o pontinho acende no
 * clique. Quem escolhe "não perturbe" quer a certeza imediata de ter parado de
 * aparecer disponível, e um quadro de latência dizendo "online" é exatamente a
 * dúvida que a ação existe para tirar.
 */
export async function definirPresenca(p: PresencaEscolhida): Promise<boolean> {
  definirMeuStatusLocal(p);
  try {
    await client.user?.edit({ status: { presence: GRAFIA[p] as never } });
    avisarPresencaLocal();
    return true;
  } catch (e) {
    falhou("Não deu para mudar seu status.", e);
    return false;
  }
}

/**
 * Escreve o status personalizado.
 *
 * Vazio REMOVE, não vira string vazia — a mesma regra dos pronomes e pelo
 * mesmo motivo: `""` mostraria uma linha em branco embaixo do nome, e "não
 * declarado" some. O protocolo tem `remove: ["StatusText"]` justamente porque
 * as duas coisas são diferentes.
 */
export async function definirStatusTexto(texto: string): Promise<boolean> {
  const limpo = texto.trim();
  definirMeuTextoLocal(limpo || undefined);
  try {
    await client.user?.edit(
      limpo
        ? { status: { text: limpo } }
        : ({ remove: ["StatusText"] } as never),
    );
    avisarPresencaLocal();
    return true;
  } catch (e) {
    falhou("Não deu para salvar o recado.", e);
    return false;
  }
}

/**
 * Semeia o status do que o servidor já mandou.
 *
 * Chamado na abertura. Sem isto o painel abre sempre dizendo "Online" — o
 * default do store —, e quem tinha escolhido invisível na sessão anterior
 * veria a interface afirmar o contrário do que o servidor sabe. É a mesma
 * família da semeadura de não-lidas no `Ready`.
 */
export function semearStatusDoServidor(): void {
  const eu = client.user;
  if (!eu) return;
  const bruto = eu.status?.presence;
  const escolha = (Object.keys(GRAFIA) as PresencaEscolhida[]).find(
    (k) => GRAFIA[k] === bruto,
  );
  semearMeuStatus({
    presenca: escolha ?? "online",
    texto: eu.status?.text || undefined,
  });
}

/* ----------------------------------------------------------- dispositivos */

/**
 * Os dispositivos com sessão aberta.
 *
 * ⚠ Estava adiada desde a etapa 2 por não haver onde morar. Agora mora aqui, e
 * é a superfície que transforma "meu token está em `localStorage`" de risco
 * abstrato em algo com que dá para fazer alguma coisa: quem desconfia de um
 * acesso derruba aquele acesso.
 */
export async function listarDispositivos(): Promise<readonly Dispositivo[]> {
  try {
    const sessoes = await client.sessions.fetch();
    const atual = client.sessionId;
    return sessoes.map((s) => ({
      id: s.id,
      nome: s.name,
      atual: s.id === atual,
    }));
  } catch (e) {
    falhou("Não deu para listar os dispositivos.", e);
    return [];
  }
}

export async function renomearDispositivo(
  id: string,
  nome: string,
): Promise<boolean> {
  try {
    await client.sessions.get(id)?.rename(nome);
    return true;
  } catch (e) {
    falhou("Não deu para renomear.", e);
    return false;
  }
}

/**
 * Derruba um dispositivo. Pede a senha.
 *
 * ⚠ **O protocolo exige um TICKET de MFA, não a senha crua** — e é por isso
 * que esta função é mais longa que as outras: `mfa.createTicket({password})`
 * troca a senha por um bilhete de uso único, e é o bilhete que autoriza.
 *
 * A senha é pedida porque derrubar sessão é justamente o que alguém faria com
 * uma sessão roubada para trancar o dono do lado de fora.
 */
export async function derrubarDispositivo(
  id: string,
  senha: string,
): Promise<boolean> {
  try {
    const mfa = await client.account.mfa();
    const bilhete = await mfa.createTicket({ password: senha });
    await client.sessions.get(id)?.delete(bilhete);
    return true;
  } catch (e) {
    falhou("Não deu para derrubar o dispositivo.", e);
    return false;
  }
}

/**
 * Derruba TODOS os outros.
 *
 * `revokeSelf: false` — a sessão desta aba fica. Derrubar a própria junto
 * deslogaria quem acabou de tomar a decisão de segurança, no exato momento em
 * que ela quer conferir se deu certo.
 */
export async function derrubarOutros(senha: string): Promise<boolean> {
  try {
    const mfa = await client.account.mfa();
    const bilhete = await mfa.createTicket({ password: senha });
    await client.sessions.deleteAll(bilhete, false);
    toast({ tipo: "info", titulo: "Os outros dispositivos foram desconectados." });
    return true;
  } catch (e) {
    falhou("Não deu para desconectar.", e);
    return false;
  }
}

/** Administra algum servidor? A exclusão da conta apagaria esses servidores. */
export function administraServidor(): boolean {
  const eu = client.user?.id;
  if (!eu) return false;
  return client.servers.toList().some((s) => s.ownerId === eu);
}

/**
 * Os servidores de que sou DONA, com nome (D-AUTH-33).
 *
 * ⚠ **A lista, e não o booleano, e a diferença é acionável.** `administraServidor`
 * responde "está bloqueada"; ela não responde "por causa de quais" nem dá o
 * que fazer a respeito. O bloqueio ficava numa frase — "transfira ou exclua os
 * servidores que você administra" — que obrigava a pessoa a sair do modal,
 * descobrir sozinha quais são, e voltar. Com a lista, cada linha carrega o
 * botão que resolve aquela linha.
 *
 * Nome e ID, nunca o objeto do SDK: é a camada anticorrupção de sempre.
 */
export type ServidorQueEuDono = {
  readonly id: string;
  readonly nome: string;
};

export function servidoresQueEuDono(): readonly ServidorQueEuDono[] {
  const eu = client.user?.id;
  if (!eu) return [];
  return client.servers
    .toList()
    .filter((s) => s.ownerId === eu)
    .map((s) => ({ id: s.id, nome: s.name }));
}

export type FatorDaConta = "senha" | "recuperacao";

/**
 * Desativa a conta (D-AUTH-31).
 *
 * ⚠ **Não é a exclusão, e a diferença é o produto inteiro:** desativar some do
 * app e volta ao entrar de novo; excluir manda um e-mail e apaga. Foram
 * separadas no protocolo (`/auth/account/disable` contra `/delete`) justamente
 * porque a segunda não tem volta — e é por isso que a primeira não pede
 * confirmação por e-mail nem digitação de nada além do fator.
 *
 * ⚠ **O protocolo exige um TICKET de MFA**, como derrubar dispositivo:
 * `mfa.createTicket` troca a senha por um bilhete de uso único, e é o bilhete
 * que autoriza. Desativar é o que alguém faria com uma sessão roubada para
 * tirar o dono do ar sem tocar na senha.
 *
 * ⚠ **O servidor DERRUBA todas as sessões** (`EventV1::DeleteAllSessions`), e
 * é por isso que quem chama sai em seguida: sem sair, o app ficaria numa tela
 * viva com um socket morto — o mesmo defeito que `ligarLogoutDoServidor`
 * existe para evitar.
 */
export async function desativarConta(
  fator: FatorDaConta,
  valor: string,
): Promise<boolean> {
  try {
    const mfa = await client.account.mfa();
    const bilhete = await mfa.createTicket(
      fator === "recuperacao" ? { recovery_code: valor } : { password: valor },
    );
    await bilhete.disableAccount();
    return true;
  } catch (e) {
    falhou("Não deu para desativar a conta.", e);
    return false;
  }
}

/**
 * Pede o e-mail de confirmação da exclusão.
 *
 * Não desloga. A conta só é desativada depois do clique no e-mail.
 */
export async function pedirExclusao(
  fator: FatorDaConta,
  valor: string,
): Promise<boolean> {
  try {
    const mfa = await client.account.mfa();
    const bilhete = (await mfa.createTicket(
      fator === "recuperacao" ? { recovery_code: valor } : { password: valor },
    )) as { deleteAccount?: () => Promise<unknown>; token?: string };

    if (typeof bilhete.deleteAccount === "function") {
      await bilhete.deleteAccount();
    } else if (bilhete.token) {
      await client.api.post(
        "/auth/account/delete" as never,
        {} as never,
        { headers: { "x-mfa-ticket": bilhete.token } } as never,
      );
    } else {
      throw new Error("sem ticket");
    }

    toast({
      tipo: "info",
      titulo: "Enviamos uma confirmação para seu e-mail.",
    });
    return true;
  } catch (e) {
    falhou("Não deu para pedir a exclusão.", e);
    return false;
  }
}

/* ------------------------------------------- configurações: com motivo */

/*
  As funções acima falam por TOAST: servem a quem não tem onde escrever o erro.
  As configurações têm — "senha atual errada" aparece no campo da senha, e
  "e-mail em uso" no do e-mail —, então precisam saber QUAL foi a falha, não só
  que houve uma. O que segue devolve a causa classificada; a frase é do app.
*/

/** Por que uma ação de conta não passou. Só as causas que a tela trata à parte. */
export type CausaDeConta =
  | "senhaIncorreta"
  | "senhaFraca"
  | "emailEmUso"
  | "nomeEmUso"
  | "limite"
  | "outra";

export type ResultadoDeConta =
  | { readonly ok: true }
  | { readonly ok: false; readonly causa: CausaDeConta; readonly motivo: string };

function classificar(e: unknown, quandoOperacaoFalha: CausaDeConta): CausaDeConta {
  switch (tipoDoErro(e)) {
    case "InvalidCredentials":
    case "InvalidToken":
      return "senhaIncorreta";
    case "ShortPassword":
    case "CompromisedPassword":
      return "senhaFraca";
    case "UsernameTaken":
      return "nomeEmUso";
    case "EmailInUse":
      return "emailEmUso";
    /*
      `OperationFailed` é o que o servidor devolve para e-mail já cadastrado; o
      contexto decide o que ele quer dizer, e quem chama o diz.
    */
    case "OperationFailed":
      return quandoOperacaoFalha;
    default:
      return esperaDoLimite(e) !== undefined ? "limite" : "outra";
  }
}

async function comMotivo(
  acao: () => Promise<unknown>,
  quandoOperacaoFalha: CausaDeConta = "outra",
): Promise<ResultadoDeConta> {
  try {
    await acao();
    return { ok: true };
  } catch (e) {
    return { ok: false, causa: classificar(e, quandoOperacaoFalha), motivo: motivo(e) };
  }
}

/**
 * A bio e o banner, que não vêm no `Ready`.
 *
 * `undefined` é "não deu para saber" — e a tela NÃO libera o salvar nesse caso:
 * salvar com a bio vazia por não ter conseguido lê-la apagaria a que existe.
 */
export async function lerMeuPerfilCompleto(): Promise<
  { readonly bio: string; readonly bannerUrl: string | undefined } | undefined
> {
  try {
    const perfil = await client.user?.fetchProfile();
    if (!perfil) return undefined;
    return { bio: perfil.content ?? "", bannerUrl: perfil.bannerURL };
  } catch {
    return undefined;
  }
}

/**
 * Bio e banner públicos de uma pessoa, consultados sob demanda ao abrir o cartão.
 * Retorna `undefined` quando o servidor não respondeu ou o usuário não existe.
 */
export async function lerPerfilPublico(
  userId: string,
): Promise<{ readonly bio: string; readonly bannerUrl: string | undefined } | undefined> {
  try {
    const usuario = client.users.get(userId) ?? (await client.users.fetch(userId));
    const perfil = await usuario.fetchProfile();
    return { bio: perfil.content ?? "", bannerUrl: perfil.bannerURL };
  } catch {
    return undefined;
  }
}

/** O e-mail da conta, ou `undefined` se não deu para consultar. */
export async function lerMeuEmail(): Promise<string | undefined> {
  try {
    return await client.account.fetchEmail();
  } catch {
    return undefined;
  }
}

export function trocarSenhaComMotivo(nova: string, atual: string): Promise<ResultadoDeConta> {
  return comMotivo(() => client.account.changePassword(nova, atual));
}

export function trocarEmailComMotivo(novo: string, senha: string): Promise<ResultadoDeConta> {
  return comMotivo(() => client.account.changeEmail(novo, senha), "emailEmUso");
}

export function trocarNomeDeUsuarioComMotivo(
  novo: string,
  senha: string,
): Promise<ResultadoDeConta> {
  return comMotivo(async () => {
    if (!client.user) throw new Error("sem sessão");
    await client.user.changeUsername(novo, senha);
  });
}

/**
 * Confere a senha trocando-a por um bilhete que ninguém usa.
 *
 * É o que permite pedir a senha UMA vez ao abrir Dispositivos: o bilhete vale
 * pouco e some sozinho, e o que importa é o servidor ter dito que a senha é
 * esta. As ações seguintes pedem o próprio bilhete.
 */
export function confirmarSenha(senha: string): Promise<ResultadoDeConta> {
  return comMotivo(async () => {
    const mfa = await client.account.mfa();
    await mfa.createTicket({ password: senha });
  });
}

export function derrubarDispositivoComMotivo(id: string, senha: string): Promise<ResultadoDeConta> {
  return comMotivo(async () => {
    const mfa = await client.account.mfa();
    const bilhete = await mfa.createTicket({ password: senha });
    await client.sessions.get(id)?.delete(bilhete);
  });
}

export function derrubarOutrosComMotivo(senha: string): Promise<ResultadoDeConta> {
  return comMotivo(async () => {
    const mfa = await client.account.mfa();
    const bilhete = await mfa.createTicket({ password: senha });
    await client.sessions.deleteAll(bilhete, false);
  });
}

/** Como `listarDispositivos`, mas sem toast e distinguindo falha de lista vazia. */
export async function buscarDispositivos(): Promise<readonly Dispositivo[] | undefined> {
  try {
    const sessoes = await client.sessions.fetch();
    const atual = client.sessionId;
    return sessoes.map((s) => ({
      id: s.id,
      nome: s.name,
      atual: s.id === atual,
      desde: s.createdAt.getTime(),
    }));
  } catch {
    return undefined;
  }
}

export function renomearDispositivoComMotivo(id: string, nome: string): Promise<ResultadoDeConta> {
  return comMotivo(async () => {
    await client.sessions.get(id)?.rename(nome);
  });
}

export function pedirExclusaoComMotivo(
  fator: FatorDaConta,
  valor: string,
): Promise<ResultadoDeConta> {
  return comMotivo(async () => {
    const mfa = await client.account.mfa();
    const bilhete = (await mfa.createTicket(
      fator === "recuperacao" ? { recovery_code: valor } : { password: valor },
    )) as { deleteAccount?: () => Promise<unknown>; token?: string };
    if (typeof bilhete.deleteAccount === "function") {
      await bilhete.deleteAccount();
    } else if (bilhete.token) {
      await client.api.post(
        "/auth/account/delete" as never,
        {} as never,
        { headers: { "x-mfa-ticket": bilhete.token } } as never,
      );
    } else {
      throw new Error("sem ticket");
    }
  });
}

/**
 * Salva só o que as configurações mostram: nome de exibição e bio.
 *
 * Diferente de `salvarPerfil`, NÃO mexe nos pronomes e distingue "bio vazia" de
 * "bio que não deu para carregar": com `bio` indefinida o campo não é tocado.
 * Salvar o nome com a bio em branco por não tê-la lido apagaria a que existe.
 */
export async function salvarNomeEBio(
  displayName: string,
  bio: string | undefined,
): Promise<boolean> {
  try {
    const remover: string[] = [];
    if (!displayName) remover.push("DisplayName");
    if (bio !== undefined && !bio) remover.push("ProfileContent");
    await client.user?.edit({
      ...(displayName ? { display_name: displayName } : {}),
      ...(bio ? { profile: { content: bio } } : {}),
      ...(remover.length ? { remove: remover as never } : {}),
    });
    return true;
  } catch (e) {
    falhou("Não deu para salvar o perfil.", e);
    return false;
  }
}
