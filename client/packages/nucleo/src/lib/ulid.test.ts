import { decodeTime, ulid } from "ulid";
import { describe, expect, it } from "vitest";

import { ehUlid, instanteDoUlid, ulidAnterior, ulidDoInstante } from "./ulid";

/**
 * As duas contas de cursor. O que elas guardam é a ORDEM: marcar como não lida
 * precisa de um ID que caia exatamente antes da mensagem, e o filtro de data
 * precisa de uma fronteira que não perca a primeira mensagem do dia.
 */
describe("ulidAnterior", () => {
  it("é menor que o original e maior que qualquer ULID mais antigo", () => {
    const id = "01J0000000000000000000000B";
    const anterior = ulidAnterior(id);
    expect(anterior).toBe("01J0000000000000000000000A");
    expect(anterior! < id).toBe(true);
  });

  /* O empréstimo é onde a conta de papel erra: `…10` vira `…0Z`, não `…0/`. */
  it("empresta da casa de cima", () => {
    expect(ulidAnterior("01J0000000000000000000000G")).toBe(
      "01J0000000000000000000000F",
    );
    expect(ulidAnterior("01J00000000000000000000010")).toBe(
      "01J0000000000000000000000Z",
    );
  });

  it("não existe anterior ao menor ULID, nem a lixo", () => {
    expect(ulidAnterior("0".repeat(26))).toBeUndefined();
    expect(ulidAnterior("nao-e-ulid")).toBeUndefined();
    expect(ulidAnterior("01J0000000000000000000000I")).toBeUndefined();
  });

  it("vale para ULID gerado de verdade", () => {
    for (let i = 0; i < 50; i++) {
      const id = ulid();
      const anterior = ulidAnterior(id)!;
      expect(anterior < id).toBe(true);
      expect(anterior.length).toBe(26);
    }
  });
});

describe("ulidDoInstante", () => {
  it("codifica o tempo com o mesmo alfabeto do protocolo", () => {
    const agora = Date.UTC(2026, 8, 13, 12, 0, 0);
    const id = ulidDoInstante(agora)!;
    expect(ehUlid(id)).toBe(true);
    expect(decodeTime(id)).toBe(agora);
    expect(id.endsWith("0".repeat(16))).toBe(true);
  });

  /* A fronteira precisa pegar a PRIMEIRA mensagem do instante, não perdê-la. */
  it("é <= toda mensagem daquele milissegundo e > toda anterior", () => {
    const t = Date.UTC(2026, 0, 1);
    const fronteira = ulidDoInstante(t)!;
    expect(ulid(t) >= fronteira).toBe(true);
    expect(ulid(t - 1) < fronteira).toBe(true);
  });

  it("recusa instante fora do ULID", () => {
    expect(ulidDoInstante(-1)).toBeUndefined();
    expect(ulidDoInstante(Number.NaN)).toBeUndefined();
    expect(ulidDoInstante(2 ** 48)).toBeUndefined();
  });
});

describe("instanteDoUlid", () => {
  it("decodifica o mesmo milissegundo que a biblioteca ulid", () => {
    const t = Date.UTC(2026, 8, 13, 12, 0, 0);
    const id = ulid(t);
    expect(instanteDoUlid(id)).toBe(t);
    expect(instanteDoUlid(id)).toBe(decodeTime(id));
  });

  it("retorna undefined para strings que não são ULID", () => {
    expect(instanteDoUlid("nao-e-ulid")).toBeUndefined();
    expect(instanteDoUlid("")).toBeUndefined();
  });
});
