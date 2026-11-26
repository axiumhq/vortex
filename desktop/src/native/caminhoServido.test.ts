import assert from "node:assert/strict";
import { join, resolve, sep } from "node:path";
import { describe, it } from "node:test";

import { caminhoDoPedido, dentroDe } from "../../scripts/caminhoServido.mjs";

const RAIZ = resolve("/tmp/casca/dist-casca");

/** A mesma composição de `casca-com-cliente-local.mjs`. */
function servido(url: string | undefined): string | undefined {
  const caminho = caminhoDoPedido(url);
  if (caminho === undefined) return undefined;
  const arquivo = resolve(RAIZ, `.${sep}${caminho}`);
  return dentroDe(RAIZ, arquivo) ? arquivo : undefined;
}

describe("caminho servido pela casca", () => {
  it("serve arquivo dentro da pasta, sem a querystring", () => {
    assert.equal(caminhoDoPedido("/assets/app.js?v=1"), "/assets/app.js");
    assert.equal(servido("/assets/app.js?v=1"), join(RAIZ, "assets", "app.js"));
  });

  it("a raiz é a própria pasta", () => {
    assert.equal(servido("/"), RAIZ);
    assert.equal(servido(undefined), RAIZ);
  });

  it("recusa subir para fora da pasta, inclusive codificado", () => {
    for (const url of [
      "/../segredo.txt",
      "/../../etc/passwd",
      "/assets/../../segredo.txt",
      "/%2e%2e/segredo.txt",
      "/..%2f..%2fsegredo.txt",
    ]) {
      assert.equal(servido(url), undefined, url);
    }
  });

  it("barra invertida: separador no Windows, caractere de nome no POSIX, nunca fora da pasta", () => {
    const r = servido("/..%5c..%5csegredo.txt");
    if (sep === "\\") assert.equal(r, undefined);
    else assert.ok(r?.startsWith(RAIZ + sep));
  });

  it("recusa a pasta irmã com o mesmo prefixo", () => {
    assert.equal(servido("/../dist-casca-outra/x.js"), undefined);
    assert.equal(dentroDe(RAIZ, `${RAIZ}-outra`), false);
  });

  it("URL malformada e byte nulo não lançam: viram recusa", () => {
    assert.equal(caminhoDoPedido("/%E0%A4%A"), undefined);
    assert.equal(caminhoDoPedido("/index.html%00.js"), undefined);
  });

  it("`..` que não sai da pasta continua servido", () => {
    assert.equal(servido("/assets/../index.html"), join(RAIZ, "index.html"));
  });
});
