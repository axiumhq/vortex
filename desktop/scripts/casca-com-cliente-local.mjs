/**
 * Sobe a casca contra o CÓDIGO ATUAL da árvore, num comando só.
 *
 * Constrói o cliente numa pasta própria, serve numa porta própria, abre o
 * Electron apontado para lá, e derruba o servidor quando a janela fecha.
 *
 *   npm run dev        (a partir de desktop/)
 *
 * ⚠ **Pasta e porta PRÓPRIAS, e as duas foram aprendidas quebrando.** A
 * primeira montagem apontava a casca para o `dist` e o `vite preview` de 4173,
 * os dois compartilhados. Bastou outra sessão rodar `pnpm build` — e o
 * `pnpm check` roda — para o `VITE_API_URL` sumir do bundle: o cliente voltou a
 * resolver a API contra a própria origem, toda chamada caiu no fallback da SPA,
 * e a tela de entrada disse "Sem resposta do servidor" sobre uma instância que
 * estava de pé o tempo todo.
 *
 * ⚠ **A API é ABSOLUTA aqui, e é a razão de a pasta precisar ser separada.** O
 * cliente servido nesta porta fala com `localhost:8880/api`, que é outra
 * origem — diferente do contêiner, onde cliente e API dividem a mesma. Esse
 * endereço é assado no build, então um build feito para outro fim não serve.
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { caminhoDoPedido, dentroDe } from "./caminhoServido.mjs";

const AQUI = fileURLToPath(new URL(".", import.meta.url));
const CASCA = resolve(AQUI, "..");
const CLIENTE = resolve(AQUI, "../../../client/packages/app");

/*
  ⚠ **O Node executa os binários, e não o `npx`.**

  `spawn("npx.cmd", …)` falha com `EINVAL` desde o Node 18.20: a mitigação da
  CVE-2024-27980 recusa lançar `.cmd` sem `shell: true`. E `shell: true` seria
  pior aqui — o caminho deste repositório tem espaços (`OneDrive/Documents`), e
  aí a citação passa a ser problema de quem chama.

  Chamar `process.execPath` com o entrypoint JS resolve os dois: sem shell, sem
  citação, e igual em Windows, macOS e Linux.

  ⚠ O sintoma foi MUDO — `stdio: "inherit"` não imprimiu nada, porque o
  processo nunca existiu. Quem contou foi `resultado.error.code`, não a saída.
*/
const VITE = join(CLIENTE, "node_modules/vite/bin/vite.js");
const FORGE = join(CASCA, "node_modules/@electron-forge/cli/dist/electron-forge.js");
const SAIDA = "dist-casca";
const RAIZ = join(CLIENTE, SAIDA);

/** A instância local do Docker: `make vortex-local-up` no `pi-infra`. */
const API = process.env.VORTEX_API_LOCAL ?? "http://localhost:8880/api";

/** ⚠ 4173 e 4174 já são usadas por `vite preview`. Esta é só da casca. */
const PORTA = Number(process.env.VORTEX_PORTA_CASCA ?? 4175);

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

console.log(`\n[casca] construindo o cliente em ${SAIDA}/ com API ${API}`);

for (const caminho of [VITE, FORGE]) {
  if (existsSync(caminho)) continue;
  console.error(`[casca] faltando: ${caminho}`);
  console.error("[casca] rode `pnpm install` nas duas ilhas primeiro.");
  process.exit(1);
}

const build = spawnSync(
  process.execPath,
  [VITE, "build", "--outDir", SAIDA, "--emptyOutDir"],
  {
    cwd: CLIENTE,
    stdio: "inherit",
    env: { ...process.env, VITE_API_URL: API },
  },
);

if (build.error ?? build.status !== 0) {
  console.error(
    `[casca] o build falhou (${build.error?.code ?? `saida ${build.status}`}) — a casca nao sobe sem cliente.`,
  );
  process.exit(1);
}

/*
  ⚠ **O fallback da SPA NÃO cobre `/assets` nem `/api`, e essa exceção é o
  ponto.** Um fallback cego devolve `index.html` com status 200 para qualquer
  caminho — foi assim que `GET /api/` respondeu "200 OK" servindo HTML, e o
  defeito passou por uma verificação minha porque o código de status parecia
  saudável. Aqui um asset que não existe dá 404, que é o que ele é.
*/
function ehRotaDaSpa(caminho) {
  return !caminho.startsWith("/assets/") && !caminho.startsWith("/api");
}

const servidor = createServer((req, res) => {
  /* Fora da pasta servida, ou URL malformada: 403, e o servidor segue de pé. */
  const caminho = caminhoDoPedido(req.url);
  if (caminho === undefined) {
    res.writeHead(403).end();
    return;
  }
  /* `resolve` e a guarda AQUI, junto do `readFileSync`: é o ponto que precisa dela. */
  let arquivo = resolve(RAIZ, `.${sep}${caminho}`);
  if (arquivo === RAIZ) arquivo = join(RAIZ, "index.html");
  if (!dentroDe(RAIZ, arquivo)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(arquivo) || statSync(arquivo).isDirectory()) {
    if (!ehRotaDaSpa(caminho)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end(`nao existe em ${SAIDA}: ${caminho}\n`);
      return;
    }
    arquivo = join(RAIZ, "index.html");
  }

  try {
    res.writeHead(200, {
      "Content-Type": TIPOS[extname(arquivo)] ?? "application/octet-stream",
      /* Sem cache: a casca é reaberta a cada mudança, e um asset velho aqui
         seria o mesmo tipo de mentira que este script existe para evitar. */
      "Cache-Control": "no-store",
    });
    res.end(readFileSync(arquivo));
  } catch {
    res.writeHead(500).end();
  }
});

servidor.listen(PORTA, "127.0.0.1", () => {
  const url = `http://localhost:${PORTA}`;
  console.log(`[casca] servindo ${SAIDA}/ em ${url}`);
  console.log(`[casca] abrindo o Electron\n`);

  const electron = spawn(
    process.execPath,
    [FORGE, "start", "--", "--no-sandbox"],
    {
      cwd: CASCA,
      stdio: "inherit",
      /*
        ⚠ Passado por AMBIENTE e não pelo `.env`: o arquivo é a preferência de
        quem usa, e um script que o reescrevesse trocaria a escolha da pessoa
        sem avisar. `loadEnv` do Vite lê os dois, e o ambiente vence.
      */
      env: { ...process.env, VORTEX_APP_URL: url },
    },
  );

  /* Sem isto o servidor fica de pé depois de a janela fechar, e a porta
     aparece ocupada na próxima vez sem nada visível a segurando. */
  const encerrar = () => {
    servidor.close();
    process.exit(0);
  };

  /*
    ⚠ **Saída imediata quase sempre é a trava de instância única, e sem esta
    mensagem ela é indecifrável.** `main.ts` chama
    `app.requestSingleInstanceLock()`: com uma janela do Vortex já aberta, a
    segunda instância FOCA a primeira e encerra na hora — o script então
    derruba o servidor e sai com código 0, tendo construído o cliente para
    nada. Aconteceu na primeira corrida deste script, e o log não dizia nada:
    só o build, "abrindo o Electron", e silêncio.

    Dois segundos separa isso de alguém que abriu e fechou a janela de
    propósito. Não é limite exato e não precisa ser: no pior caso a mensagem
    aparece indevidamente para quem fechou muito rápido, e ela é uma pergunta,
    não uma afirmação.
  */
  const abertoEm = Date.now();
  electron.on("exit", (codigo) => {
    if (Date.now() - abertoEm < 2000) {
      console.log(
        `
[casca] o Electron saiu em ${String(Date.now() - abertoEm)}ms (codigo ${String(codigo)}).`,
      );
      console.log(
        "[casca] ja havia uma janela do Vortex aberta? A trava de instancia",
      );
      console.log(
        "[casca] unica foca a existente e encerra esta. Feche a outra e rode de novo.",
      );
    }
    encerrar();
  });
  process.on("SIGINT", encerrar);
  process.on("SIGTERM", encerrar);
});
