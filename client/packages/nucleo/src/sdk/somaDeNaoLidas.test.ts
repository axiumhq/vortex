import { describe, expect, it } from "vitest";

import { naoLidasQueSobem, somarConversas, somarPorServidor } from "./somaDeNaoLidas";

const SERVIDOR = { a: "S1", b: "S1", c: "S2", dm: undefined } as Record<string, string | undefined>;

const somar = (
  contagens: [string, { naoLidas: number; mencoes: number }][],
  mudos: string[] = [],
) =>
  Object.fromEntries(
    somarPorServidor(
      contagens,
      (id) => SERVIDOR[id],
      (canal, servidor) => mudos.includes(canal) || mudos.includes(servidor),
    ),
  );

describe("rollup de não-lidas por servidor", () => {
  it("soma os canais de cada servidor, e conversa não entra", () => {
    expect(
      somar([
        ["a", { naoLidas: 2, mencoes: 1 }],
        ["b", { naoLidas: 1, mencoes: 0 }],
        ["c", { naoLidas: 3, mencoes: 0 }],
        ["dm", { naoLidas: 5, mencoes: 5 }],
      ]),
    ).toEqual({ S1: { naoLidas: 3, mencoes: 1 }, S2: { naoLidas: 3, mencoes: 0 } });
  });

  it("canal mudo tira a não-lida e mantém a menção", () => {
    expect(
      somar(
        [
          ["a", { naoLidas: 2, mencoes: 1 }],
          ["b", { naoLidas: 1, mencoes: 0 }],
        ],
        ["a"],
      ),
    ).toEqual({ S1: { naoLidas: 1, mencoes: 1 } });
  });

  it("servidor mudo apaga o realce inteiro, e a menção atravessa", () => {
    expect(
      somar(
        [
          ["a", { naoLidas: 2, mencoes: 1 }],
          ["b", { naoLidas: 1, mencoes: 0 }],
          ["c", { naoLidas: 3, mencoes: 0 }],
        ],
        ["S1"],
      ),
    ).toEqual({ S1: { naoLidas: 0, mencoes: 1 }, S2: { naoLidas: 3, mencoes: 0 } });
  });

  /* Sem entrada zerada: o rail compara ausência, e `{0,0}` acenderia nada
     mas custaria uma republicação. */
  it("servidor que só tinha não-lida muda some do mapa", () => {
    expect(somar([["b", { naoLidas: 1, mencoes: 0 }]], ["S1"])).toEqual({});
  });
});

describe("número da entrada Conversas (D-NOTIF-17)", () => {
  const CONVERSA = new Set(["dm1", "dm2", "grupo"]);
  const contar = (
    contagens: [string, { naoLidas: number; mencoes: number }][],
    mudos: string[] = [],
  ) =>
    somarConversas(
      contagens,
      (id) => CONVERSA.has(id),
      (id) => mudos.includes(id),
    );

  it("soma as não-lidas de DM e grupo, e canal de servidor não entra", () => {
    expect(
      contar([
        ["dm1", { naoLidas: 2, mencoes: 0 }],
        ["grupo", { naoLidas: 3, mencoes: 1 }],
        ["a", { naoLidas: 9, mencoes: 9 }],
      ]),
    ).toBe(5);
  });

  it("menção numa conversa não conta a mesma mensagem duas vezes", () => {
    expect(contar([["dm1", { naoLidas: 1, mencoes: 1 }]])).toBe(1);
  });

  it("conversa muda conta só a menção", () => {
    expect(
      contar(
        [
          ["dm1", { naoLidas: 4, mencoes: 0 }],
          ["grupo", { naoLidas: 3, mencoes: 1 }],
        ],
        ["dm1", "grupo"],
      ),
    ).toBe(1);
  });
});

describe("tópicos no rollup do servidor", () => {
  /* S1: canal pai "pai" e três tópicos dele. */
  const TOPICOS: Record<string, { paiId: string; seguindo: boolean }> = {
    seguido: { paiId: "pai", seguindo: true },
    solto: { paiId: "pai", seguindo: false },
    outro: { paiId: "pai", seguindo: true },
  };
  const servidor = (id: string) => (id === "pai" || id in TOPICOS ? "S1" : undefined);
  const somarT = (
    contagens: [string, { naoLidas: number; mencoes: number }][],
    mudos: string[] = [],
  ) =>
    Object.fromEntries(
      somarPorServidor(
        contagens,
        servidor,
        (canal, srv) => mudos.includes(canal) || mudos.includes(srv),
        (id) => TOPICOS[id],
      ),
    );

  it("tópico seguido soma a não-lida no servidor", () => {
    expect(somarT([["seguido", { naoLidas: 3, mencoes: 0 }]])).toEqual({
      S1: { naoLidas: 3, mencoes: 0 },
    });
  });

  it("tópico NÃO seguido e sem menção não soma nada", () => {
    expect(somarT([["solto", { naoLidas: 5, mencoes: 0 }]])).toEqual({});
  });

  it("menção em tópico não seguido soma a menção, e só ela", () => {
    expect(somarT([["solto", { naoLidas: 5, mencoes: 1 }]])).toEqual({
      S1: { naoLidas: 0, mencoes: 1 },
    });
  });

  it("silêncio do pai zera a não-lida do tópico seguido e deixa a menção", () => {
    expect(somarT([["outro", { naoLidas: 2, mencoes: 1 }]], ["pai"])).toEqual({
      S1: { naoLidas: 0, mencoes: 1 },
    });
  });

  it("silêncio do próprio tópico zera a não-lida", () => {
    expect(somarT([["seguido", { naoLidas: 2, mencoes: 0 }]], ["seguido"])).toEqual({});
  });

  it("canal comum e tópico somam juntos, cada um pela sua regra", () => {
    expect(
      somarT([
        ["pai", { naoLidas: 1, mencoes: 0 }],
        ["seguido", { naoLidas: 2, mencoes: 0 }],
        ["solto", { naoLidas: 9, mencoes: 0 }],
      ]),
    ).toEqual({ S1: { naoLidas: 3, mencoes: 0 } });
  });

  it("o caminho incremental concorda com a recontagem", () => {
    const mudo = (c: string) => c === "pai";
    expect(naoLidasQueSobem(1, "seguido", "S1", mudo, TOPICOS.seguido)).toBe(0);
    expect(naoLidasQueSobem(1, "solto", "S1", () => false, TOPICOS.solto)).toBe(0);
    expect(naoLidasQueSobem(1, "seguido", "S1", () => false, TOPICOS.seguido)).toBe(1);
    expect(naoLidasQueSobem(1, "pai", "S1", () => false)).toBe(1);
  });
});
