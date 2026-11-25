import { describe, expect, it } from "vitest";

import { catalogo } from "./index";
/* Fora do índice de propósito (não disputa a linha de export com outra jornada): entra na varredura aqui. */
import { topico } from "./topico";

type Entrada = { caminho: string; chave: string; texto: string };

/** Valores de amostra para chamar as funções de interpolação e plural. */
const AMOSTRAS: readonly (number | string)[] = [1, 2, 150, "Ana"];

function coletar(no: unknown, caminho: string, chave: string, saida: Entrada[]) {
  if (typeof no === "string") {
    saida.push({ caminho, chave, texto: no });
  } else if (typeof no === "function") {
    for (const amostra of AMOSTRAS) {
      const texto: unknown = (no as (a: number | string) => unknown)(amostra);
      if (typeof texto === "string") saida.push({ caminho, chave, texto });
    }
  } else if (no !== null && typeof no === "object") {
    for (const [k, v] of Object.entries(no)) coletar(v, `${caminho}.${k}`, k, saida);
  }
}

const entradas: Entrada[] = [];
coletar({ ...catalogo, topico }, "textos", "", entradas);

/** Termos internos que nunca devem chegar a quem usa o produto. */
const TERMOS_PROIBIDOS = [
  "protocolo",
  "token",
  "store",
  "adapter",
  "snapshot",
  "payload",
  "slot",
  "preset",
  "fork",
  "bug",
  "api",
  "design",
  "em breve",
  "#undefined",
  "undefined",
  "null",
];

function escapar(t: string): string {
  return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function achaJargao(texto: string): string | undefined {
  const minusculo = texto.toLowerCase();
  return TERMOS_PROIBIDOS.find((t) =>
    new RegExp(`(^|[^\\p{L}\\p{N}_])${escapar(t)}($|[^\\p{L}\\p{N}_])`, "u").test(minusculo),
  );
}

/** Nomes próprios e teclas que podem aparecer com maiúscula no meio da frase. */
const PERMITIDAS = new Set(["Vortex", "Enter", "Esc", "Shift", "Ctrl", "Alt", "Tab", "Ana", "E-mail"]);

/** Devolve a primeira palavra que quebra a caixa de frase, se houver. */
function quebraCaixaDeFrase(texto: string): string | undefined {
  let inicioDeFrase = true;
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    const limpa = palavra.replace(/^[^\p{L}]+/u, "");
    const primeira = limpa[0];
    if (primeira !== undefined && !inicioDeFrase) {
      const ehMaiuscula = primeira !== primeira.toLowerCase();
      const ehSigla = limpa.length > 1 && limpa === limpa.toUpperCase();
      const semPontuacao = limpa.replace(/[.,!?…]+$/u, "");
      if (ehMaiuscula && !ehSigla && !PERMITIDAS.has(semPontuacao)) return palavra;
    }
    inicioDeFrase = /[.!?…]$/u.test(palavra);
  }
  return undefined;
}

describe("catálogo de textos", () => {
  it("não está vazio", () => {
    expect(entradas.length).toBeGreaterThan(40);
  });

  it("não tem jargão interno nem lixo de interpolação", () => {
    const achados = entradas
      .map((e) => ({ ...e, termo: achaJargao(e.texto) }))
      .filter((e) => e.termo !== undefined)
      .map((e) => `${e.caminho}: "${e.texto}" contém "${e.termo}"`);
    expect(achados).toEqual([]);
  });

  it("usa caixa de frase, salvo chaves marcadas como sinal", () => {
    const achados = entradas
      .filter((e) => !e.chave.startsWith("sinal"))
      .map((e) => ({ ...e, palavra: quebraCaixaDeFrase(e.texto) }))
      .filter((e) => e.palavra !== undefined)
      .map((e) => `${e.caminho}: "${e.texto}" quebra em "${e.palavra}"`);
    expect(achados).toEqual([]);
  });

  it("os detectores pegam o que dizem pegar (controle do próprio teste)", () => {
    expect(achaJargao("Erro de protocolo")).toBe("protocolo");
    expect(achaJargao("O valor é undefined")).toBe("undefined");
    expect(achaJargao("Sua senha")).toBeUndefined();
    expect(quebraCaixaDeFrase("Criar Conta")).toBe("Conta");
    expect(quebraCaixaDeFrase("Criar conta. Depois entrar")).toBeUndefined();
  });
});
