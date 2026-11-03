import { createEffect, createRoot } from "solid-js";

import { client } from "./client";

/**
 * Com qual servidor este app fala.
 *
 * ⚠ **Isto faltava, e era o bloqueio raiz de tudo que depende de rede.** O
 * `new Client()` era construído sem `baseURL`, e o default do SDK é
 * `https://stoat.chat/api` — a instância PÚBLICA do Stoat. Ou seja: login,
 * criar conta, recuperar senha e todo `fetch` do adapter iam para o servidor
 * de outra gente. Não dava erro nenhum; o app simplesmente falava com o lugar
 * errado, e uma senha digitada na tela de entrada teria saído daqui.
 *
 * O caminho vem do compose (`pi-infra/compose/compose.vortex.yml`), que serve o
 * cliente e a API no MESMO domínio:
 *
 *     REVOLT__HOSTS__APP    https://${VORTEX_DOMAIN}
 *     REVOLT__HOSTS__API    https://${VORTEX_DOMAIN}/api
 *
 * Por isso o default é `/api` na MESMA ORIGEM, resolvido em runtime: ele
 * acompanha o domínio sozinho, funciona em produção, em túnel e em preview sem
 * ninguém reconstruir, e não deixa um domínio de terceiro compilado no bundle
 * esperando alguém esquecer de sobrescrevê-lo.
 *
 * ⚠ **Resolvido contra `location.origin`, e NÃO o `/api` relativo que o
 * cliente Solid usa.** O `stoat-api` monta a requisição com `new URL(path)`
 * SEM base — então um caminho relativo lança `Invalid URL` antes de qualquer
 * `fetch`, no navegador tanto quanto no Node. O default do upstream funciona
 * lá porque o `Controller` dele nunca chega a esse caminho com valor relativo;
 * aqui a suíte de testes acusou na primeira corrida, com 18 rejeições não
 * tratadas vindas do `#fetchConfiguration`.
 *
 * ⚠ **Só o `baseURL` é configurado aqui, de propósito.** O SDK busca o resto
 * do servidor no `GET {baseURL}/` assim que é construído — WebSocket
 * (`configuration.ws`), servidor de mídia (`features.autumn.url`) e proxy
 * (`features.january.url`) chegam de lá. O cliente Solid os declara à mão e
 * paga com quatro constantes que precisam concordar com o backend; aqui a
 * fonte é o próprio backend, e um serviço que mude de endereço não exige
 * rebuild do front.
 */

/**
 * A API.
 *
 * `VITE_DEV_API_URL` vale só em desenvolvimento e `VITE_API_URL` em qualquer
 * build — a mesma separação do cliente Solid. Ela existe porque o dev server
 * roda em `localhost:5173` e a API não: sem override, `/api` bateria no Vite.
 */
export const API_URL: string = primeiroNaoVazio(
  import.meta.env.DEV
    ? (import.meta.env.VITE_DEV_API_URL as string | undefined)
    : undefined,
  import.meta.env.VITE_API_URL as string | undefined,
  mesmaOrigem(),
);

/**
 * O primeiro valor que não é vazio.
 *
 * ⚠ **`??` é o operador ERRADO para variável de ambiente, e isso derrubou o
 * app inteiro sem um erro sequer.** `??` só cai para o próximo em `null` e
 * `undefined`; string VAZIA passa. E variável de ambiente vazia é o estado
 * normal no Docker — o `Dockerfile` declarava `ARG VITE_API_URL=""`, o Vite
 * substituiu `import.meta.env.VITE_API_URL` por `""`, e o `baseURL` do cliente
 * virou string vazia.
 *
 * O SDK então caiu no default DELE (`https://api.stoat.chat`), e o app passou
 * a mandar login e criação de conta para a instância PÚBLICA do Stoat — com a
 * senha digitada junto. O sintoma na tela era "E-mail ou senha incorretos",
 * porque a conta de fato não existe lá.
 *
 * ⚠ Nem `||` puro: ele também cairia em `0` e `false`, que não são casos aqui,
 * mas a intenção é "descarte o vazio", e escrever a intenção é o que impede a
 * próxima pessoa de trocar de volta.
 */
function primeiroNaoVazio(...valores: (string | undefined)[]): string {
  for (const v of valores) {
    if (v !== undefined && v.trim() !== "") return v;
  }
  /* Inalcançável: o último valor é sempre a mesma origem. O `throw` existe
     porque o tipo de retorno é `string` e um `?? ""` aqui reintroduziria
     exatamente o vazio que esta função existe para barrar. */
  throw new Error("API_URL sem valor");
}

/**
 * `{origem}/api`, ou um placeholder fora do navegador.
 *
 * ⚠ O placeholder existe para o AMBIENTE DE TESTE, onde não há `location` e o
 * SDK é construído no `import` de qualquer módulo que o toque. Sem ele, as
 * suítes que nada têm com rede quebram no `#fetchConfiguration`, que o
 * construtor dispara sozinho. Ele nunca é alcançado no app: em toda origem
 * real `location.origin` existe.
 */
function mesmaOrigem(): string {
  return typeof location === "undefined"
    ? "http://localhost/api"
    : `${location.origin}/api`;
}

/**
 * Esta instância exige convite para criar conta?
 *
 * ⚠ **Lido da configuração que o SDK busca no arranque, e isso só passou a ser
 * possível agora.** O comentário da tela de cadastro dizia que o cliente "não
 * fala com servidor nenhum na abertura" e por isso mostrava o campo de convite
 * SEMPRE, como opcional. Deixou de ser verdade quando o `baseURL` passou a ser
 * configurado: `GET {baseURL}/` roda no construtor do `Client` e devolve
 * `features.invite_only`.
 *
 * O default é `false` — sem configuração, o campo some. É o lado certo para
 * errar: com o campo escondido numa instância fechada, quem se cadastra recebe
 * a frase "esta instância exige um convite" do tradutor de erro e sabe o que
 * fazer; com ele visível numa instância aberta, todo mundo para para pensar
 * num código que não existe.
 */
export function exigeConvite(): boolean {
  return (
    (client.configuration as { features?: { invite_only?: boolean } } | undefined)
      ?.features?.invite_only === true
  );
}

/**
 * Esta instância consegue mandar e-mail?
 *
 * ⚠ **`features.email` desligado torna a recuperação de senha INERTE**, e o
 * servidor não avisa: `POST /auth/account/reset_password` responde 204 e o
 * e-mail nunca sai. Sem ler isto, a tela promete um link que não existe e a
 * pessoa espera indefinidamente.
 *
 * Medido nesta instância: `email: false`. É o estado padrão de quem sobe a
 * stack sem configurar SMTP, ou seja, o caso comum — não a exceção.
 *
 * O default é `true` — sem configuração, a tela não acusa. É o lado certo para
 * errar: um aviso falso de "não vai chegar" faria alguém desistir de um e-mail
 * que estava a caminho.
 */
export function instanciaMandaEmail(): boolean {
  return (
    (client.configuration as { features?: { email?: boolean } } | undefined)
      ?.features?.email !== false
  );
}

/** Quanto esperar pela configuração antes de desistir. */
const TETO_DA_CONFIGURACAO_MS = 15_000;

/**
 * Espera o `GET {baseURL}/` que o construtor do `Client` dispara.
 *
 * Sem sondagem: o SDK expõe `client.configured`, um signal que vira `true`
 * logo depois de preencher `configuration`, e a promessa resolve no instante
 * em que ele acorda. O teto de 15 s continua: devolve `false` se a
 * configuração não chegar a tempo. O efeito sai (`dispose`) ao resolver, nos
 * dois caminhos — nada fica assinado ao signal depois da espera.
 */
export function esperarConfiguracao(): Promise<boolean> {
  if (client.configuration?.ws !== undefined) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    createRoot((dispose) => {
      let resolvida = false;
      const terminar = (ok: boolean) => {
        if (resolvida) return;
        resolvida = true;
        clearTimeout(temporizador);
        dispose();
        resolve(ok);
      };
      const temporizador = setTimeout(
        () => terminar(false),
        TETO_DA_CONFIGURACAO_MS,
      );
      createEffect(() => {
        if (client.configured() && client.configuration?.ws !== undefined) {
          terminar(true);
        }
      });
    });
  });
}

/**
 * A versão mínima da casca desktop que este servidor aceita.
 *
 * ⚠ **Campo do fork, não do Stoat**: o `delta` do Vortex o expõe em
 * `features.desktop_min_version`, e o tipo do SDK (upstream) não o conhece —
 * daí a leitura estreita, como `exigeConvite`. Ausente quando o servidor não
 * exige versão, ou quando é um servidor Stoat sem o campo.
 */
export function versaoMinimaDoDesktop(): string | undefined {
  const v = (
    client.configuration as
      | { features?: { desktop_min_version?: unknown } }
      | undefined
  )?.features?.desktop_min_version;
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}
