import { beforeEach, describe, expect, it } from "vitest";

import {
  aplicarVoto,
  definirEuDasEnquetes,
  estaEncerrada,
  lerEnquete,
  limparEnquetes,
  proximoVoto,
} from "../store/enquetes";
import { anotarEventoDeEnquete, corpoDaEnquete, traduzirEnquete } from "./enquetes";

const POLL = {
  question: "Qual densidade?",
  answers: [
    { id: "r0", text: "Confortável" },
    { id: "r1", text: "Compacto" },
  ],
  max_answers: 1,
  expires_at: "2026-09-20T12:00:00Z",
  votes: { r0: ["U1", "U2"], r1: ["EU"] },
};

describe("traduzirEnquete", () => {
  it("lê pergunta, respostas, prazo e votos", () => {
    const b = traduzirEnquete(POLL);
    expect(b?.pergunta).toBe("Qual densidade?");
    expect(b?.respostas.map((r) => r.id)).toEqual(["r0", "r1"]);
    expect(b?.expiraEm).toBe(Date.parse("2026-09-20T12:00:00Z"));
    expect(b?.encerradaEm).toBeUndefined();
    expect(b?.votos.get("r0")?.size).toBe(2);
  });

  it("forma inválida vira ausência, nunca meia enquete", () => {
    expect(traduzirEnquete(undefined)).toBeUndefined();
    expect(traduzirEnquete({ question: "x", answers: [{ id: "r0", text: "a" }] })).toBeUndefined();
    expect(
      traduzirEnquete({ ...POLL, answers: [{ id: "r0" }, { id: "r1", text: "b" }] }),
    ).toBeUndefined();
  });

  it("teto de respostas acima do número de respostas é aparado", () => {
    expect(traduzirEnquete({ ...POLL, max_answers: 9 })?.maximo).toBe(2);
    expect(traduzirEnquete({ ...POLL, max_answers: 0 })?.maximo).toBe(1);
  });
});

describe("store de enquetes", () => {
  beforeEach(() => {
    limparEnquetes();
    definirEuDasEnquetes("EU");
    anotarEventoDeEnquete({ type: "Message", _id: "M1", poll: POLL });
  });

  it("deriva contagens e em quais EU votei", () => {
    const e = lerEnquete("M1");
    expect(e?.opcoes.map((o) => o.votos)).toEqual([2, 1]);
    expect(e?.opcoes.map((o) => o.marca)).toEqual(["🅰", "🅱"]);
    expect(e?.meusVotos).toEqual(["r1"]);
  });

  it("devolve a MESMA referência até o bruto ou o eu mudar", () => {
    const a = lerEnquete("M1");
    expect(lerEnquete("M1")).toBe(a);
    definirEuDasEnquetes("U1");
    const b = lerEnquete("M1");
    expect(b).not.toBe(a);
    expect(b?.meusVotos).toEqual(["r0"]);
  });

  it("o voto SUBSTITUI o anterior, e o eco não muda nada", () => {
    expect(aplicarVoto("M1", "EU", ["r0"])).toBe(true);
    expect(lerEnquete("M1")?.opcoes.map((o) => o.votos)).toEqual([3, 0]);
    const depois = lerEnquete("M1");
    expect(aplicarVoto("M1", "EU", ["r0"])).toBe(false);
    expect(lerEnquete("M1")).toBe(depois);
  });

  it("evento de voto de outra pessoa entra; lista vazia retira", () => {
    expect(
      anotarEventoDeEnquete({
        type: "MessagePollVote",
        id: "M1",
        user_id: "U9",
        answers: ["r1"],
      }),
    ).toEqual(["M1"]);
    expect(lerEnquete("M1")?.opcoes[1]?.votos).toBe(2);
    anotarEventoDeEnquete({ type: "MessagePollVote", id: "M1", user_id: "U1", answers: [] });
    expect(lerEnquete("M1")?.opcoes[0]?.votos).toBe(1);
  });

  it("MessagePollEnd substitui pela enquete final e fecha", () => {
    anotarEventoDeEnquete({
      type: "Bulk",
      v: [
        {
          type: "MessagePollEnd",
          id: "M1",
          poll: { ...POLL, ended_at: "2026-09-14T10:00:00Z" },
        },
      ],
    });
    const e = lerEnquete("M1");
    expect(e?.fechaEm).toBeUndefined();
    expect(e && estaEncerrada(e, 0)).toBe(true);
  });

  it("apagar a mensagem esquece a enquete", () => {
    expect(anotarEventoDeEnquete({ type: "MessageDelete", id: "M1" })).toEqual(["M1"]);
    expect(lerEnquete("M1")).toBeUndefined();
  });

  it("mensagem sem enquete não toca o store", () => {
    expect(anotarEventoDeEnquete({ type: "Message", _id: "M2", content: "oi" })).toEqual([]);
  });
});

describe("proximoVoto", () => {
  it("uma resposta: clicar em outra MOVE, clicar na minha retira", () => {
    expect(proximoVoto(["r0"], "r1", 1)).toEqual(["r1"]);
    expect(proximoVoto(["r0"], "r0", 1)).toEqual([]);
  });

  it("múltiplas: alterna, e no teto uma nova não derruba uma antiga", () => {
    expect(proximoVoto(["r0"], "r1", 2)).toEqual(["r0", "r1"]);
    const noTeto = ["r0", "r1"];
    expect(proximoVoto(noTeto, "r2", 2)).toBe(noTeto);
    expect(proximoVoto(noTeto, "r0", 2)).toEqual(["r1"]);
  });
});

describe("estaEncerrada", () => {
  it("fecha pelo relógio mesmo sem ninguém encerrar", () => {
    const e = { fechaEm: 1000 } as Parameters<typeof estaEncerrada>[0];
    expect(estaEncerrada(e, 999)).toBe(false);
    expect(estaEncerrada(e, 1000)).toBe(true);
  });
});

describe("corpoDaEnquete", () => {
  it("manda a pergunta também como texto, e respostas vazias ficam de fora", () => {
    expect(
      corpoDaEnquete({
        pergunta: " Qual? ",
        respostas: ["a", " ", "b"],
        duracaoHoras: 24,
        multipla: true,
        resultadoNoFim: false,
      }),
    ).toEqual({
      content: "Qual?",
      poll: {
        question: "Qual?",
        answers: ["a", "b"],
        max_answers: 2,
        duration_hours: 24,
        hide_results: false,
      },
    });
  });

  it("uma resposta manda teto 1", () => {
    const corpo = corpoDaEnquete({
      pergunta: "Q",
      respostas: ["a", "b", "c"],
      duracaoHoras: 8,
      multipla: false,
      resultadoNoFim: true,
    });
    expect((corpo["poll"] as { max_answers: number }).max_answers).toBe(1);
  });
});

describe("BulkMessageDelete", () => {
  it("remove as enquetes das mensagens apagadas em lote", () => {
    anotarEventoDeEnquete({ type: "Message", _id: "B1", poll: POLL });
    anotarEventoDeEnquete({ type: "Message", _id: "B2", poll: POLL });
    anotarEventoDeEnquete({ type: "Message", _id: "B3", poll: POLL });
    const mudadas = anotarEventoDeEnquete({
      type: "BulkMessageDelete",
      channel: "C",
      ids: ["B1", "B2", "SEM_ENQUETE", 7],
    });
    expect([...mudadas].sort()).toEqual(["B1", "B2"]);
    expect(lerEnquete("B1")).toBeUndefined();
    expect(lerEnquete("B2")).toBeUndefined();
    expect(lerEnquete("B3")).toBeDefined();
  });

  it("forma invalida nao quebra", () => {
    expect(anotarEventoDeEnquete({ type: "BulkMessageDelete" })).toEqual([]);
  });
});
