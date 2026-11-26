import assert from "node:assert/strict";
import { join, resolve, sep } from "node:path";
import { describe, it } from "node:test";

import { arquivoServido } from "../../scripts/caminhoServido.mjs";

const RAIZ = resolve("/tmp/casca/dist-casca");

describe("arquivoServido", () => {
  it("serve arquivo dentro da pasta, sem a querystring", () => {
    assert.deepEqual(arquivoServido(RAIZ, "/assets/app.js?v=1"), {
      caminho: "/assets/app.js",
      arquivo: join(RAIZ, "assets", "app.js"),
    });
  });

  it("a raiz é a própria pasta", () => {
    assert.equal(arquivoServido(RAIZ, "/")?.arquivo, RAIZ);
    assert.equal(arquivoServido(RAIZ, undefined)?.arquivo, RAIZ);
  });

  it("recusa subir para fora da pasta, inclusive codificado", () => {
    for (const url of [
      "/../segredo.txt",
      "/../../etc/passwd",
      "/assets/../../segredo.txt",
      "/%2e%2e/segredo.txt",
      "/..%2f..%2fsegredo.txt",
    ]) {
      assert.equal(arquivoServido(RAIZ, url), undefined, url);
    }
  });

  it("barra invertida: separador no Windows, caractere de nome no POSIX, nunca fora da pasta", () => {
    const r = arquivoServido(RAIZ, "/..%5c..%5csegredo.txt");
    if (sep === "\\") assert.equal(r, undefined);
    else assert.ok(r?.arquivo.startsWith(RAIZ + sep));
  });

  it("recusa a pasta irmã com o mesmo prefixo", () => {
    assert.equal(arquivoServido(RAIZ, "/../dist-casca-outra/x.js"), undefined);
  });

  it("URL malformada e byte nulo não lançam: viram recusa", () => {
    assert.equal(arquivoServido(RAIZ, "/%E0%A4%A"), undefined);
    assert.equal(arquivoServido(RAIZ, "/index.html%00.js"), undefined);
  });

  it("`..` que não sai da pasta continua servido", () => {
    assert.equal(arquivoServido(RAIZ, "/assets/../index.html")?.arquivo, join(RAIZ, "index.html"));
  });
});
