import { beforeEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";

import {
  assinarQualidadeDaTela,
  codificacaoDe,
  constraintsDe,
  definirQualidadeEscolhida,
  esquecerQualidadeDaTela,
  pedeMovimento,
  QUALIDADE_PADRAO,
  qualidadeEscolhida,
  RESOLUCOES,
  TAXAS,
  type QualidadeDaTela,
} from "./qualidadeDaTela";

/**
 * A qualidade da transmissão.
 *
 * ⚠ **O caminho de sucesso é INVERIFICÁVEL aqui.** Trocar a qualidade de
 * verdade exige uma sala LiveKit de pé mais captura de tela real. O que dá
 * para segurar são as decisões que decidem se a feature funciona, e elas são
 * puras. Que `applyConstraints` e `setParameters` de fato mudam a faixa é
 * contrato do navegador, não deste código.
 */

const TODAS: QualidadeDaTela[] = RESOLUCOES.flatMap((resolucao) =>
  TAXAS.map((taxa) => ({ resolucao, taxa })),
);

beforeEach(() => {
  esquecerQualidadeDaTela();
});

describe("as opções", () => {
  /* Doze combinações: o HUD tinha quatro, sem 1440p, sem a fonte e sem 720p
     a 60 fps. */
  it("toda resolução combina com toda taxa", () => {
    expect(TODAS).toHaveLength(12);
    expect(TODAS).toContainEqual({ resolucao: "720p", taxa: 60 });
    expect(TODAS).toContainEqual({ resolucao: "1440p", taxa: 60 });
    expect(TODAS).toContainEqual({ resolucao: "Fonte", taxa: 60 });
  });

  /* O padrão anterior era o do LiveKit, 15 fps. */
  it("o padrão é 1080p a 30 fps", () => {
    expect(QUALIDADE_PADRAO).toEqual({ resolucao: "1080p", taxa: 30 });
  });
});

describe("constraints de captura", () => {
  it("pede `ideal` e NUNCA `exact`", () => {
    for (const q of TODAS) {
      expect(JSON.stringify(constraintsDe(q))).not.toContain("exact");
    }
  });

  it("cada escolha leva a própria altura e a própria taxa", () => {
    expect(constraintsDe({ resolucao: "1440p", taxa: 60 })).toEqual({
      height: { ideal: 1440 },
      frameRate: { ideal: 60 },
    });
    expect(constraintsDe({ resolucao: "720p", taxa: 15 })).toEqual({
      height: { ideal: 720 },
      frameRate: { ideal: 15 },
    });
  });

  /* `applyConstraints` substitui o conjunto: sem altura é o que TIRA o teto
     posto por uma escolha anterior. */
  it("resolução da fonte não põe teto de altura", () => {
    expect(constraintsDe({ resolucao: "Fonte", taxa: 60 })).toEqual({
      frameRate: { ideal: 60 },
    });
  });
});

describe("codificação", () => {
  /*
    ⚠ **O teste da trava de 15 fps.** Sem codificação explícita o LiveKit
    publica tela com `maxFramerate: 15`; a captura a 60 chegava a quem assiste
    a 15. O teto do codificador tem de ser a taxa escolhida.
  */
  it("o teto de quadros do codificador é a taxa escolhida", () => {
    for (const q of TODAS) {
      expect(codificacaoDe(q).maxFramerate).toBe(q.taxa);
    }
  });

  it("mais resolução ou mais quadros nunca pedem menos banda", () => {
    for (const r of RESOLUCOES) {
      const kbps = TAXAS.map((t) => codificacaoDe({ resolucao: r, taxa: t }).maxBitrate);
      expect([...kbps].sort((a, b) => a - b)).toEqual(kbps);
    }
    for (const t of TAXAS) {
      const kbps = RESOLUCOES.map(
        (r) => codificacaoDe({ resolucao: r, taxa: t }).maxBitrate,
      );
      expect([...kbps].sort((a, b) => a - b)).toEqual(kbps);
    }
  });

  /* O padrão não pode cair abaixo do preset `h1080fps30` do próprio LiveKit. */
  it("1080p a 30 fps tem pelo menos 5 Mbps", () => {
    expect(codificacaoDe(QUALIDADE_PADRAO).maxBitrate).toBeGreaterThanOrEqual(
      5_000_000,
    );
  });

  it("30 fps já pede movimento; 15 fica em detalhe", () => {
    expect(pedeMovimento({ resolucao: "1080p", taxa: 30 })).toBe(true);
    expect(pedeMovimento({ resolucao: "720p", taxa: 60 })).toBe(true);
    expect(pedeMovimento({ resolucao: "1080p", taxa: 15 })).toBe(false);
  });
});

describe("a escolha", () => {
  it("nasce ausente", async () => {
    vi.resetModules();
    const fresco = await import("./qualidadeDaTela");
    expect(fresco.qualidadeEscolhida()).toBeUndefined();
  });

  it("guarda o que foi escolhido", () => {
    definirQualidadeEscolhida({ resolucao: "720p", taxa: 60 });
    expect(qualidadeEscolhida()).toEqual({ resolucao: "720p", taxa: 60 });
  });

  /* Por campo: o menu monta um objeto novo a cada clique. */
  it("avisa quem assina, e SÓ quando muda", () => {
    const ouvinte = vi.fn();
    assinarQualidadeDaTela(ouvinte);

    definirQualidadeEscolhida({ resolucao: "720p", taxa: 30 });
    definirQualidadeEscolhida({ resolucao: "720p", taxa: 30 });
    expect(ouvinte).toHaveBeenCalledTimes(1);

    definirQualidadeEscolhida({ resolucao: "720p", taxa: 60 });
    expect(ouvinte).toHaveBeenCalledTimes(2);
  });

  it("parar de assinar solta o ouvinte", () => {
    const ouvinte = vi.fn();
    assinarQualidadeDaTela(ouvinte)();
    definirQualidadeEscolhida(QUALIDADE_PADRAO);
    expect(ouvinte).not.toHaveBeenCalled();
  });

  it("esquecer duas vezes avisa uma vez", () => {
    const ouvinte = vi.fn();
    definirQualidadeEscolhida(QUALIDADE_PADRAO);
    assinarQualidadeDaTela(ouvinte);
    esquecerQualidadeDaTela();
    esquecerQualidadeDaTela();
    expect(qualidadeEscolhida()).toBeUndefined();
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });
});

/**
 * O motor usa estas decisões. Não é prova de comportamento — o motor carrega
 * `livekit-client` e não abre no jsdom —, é prova de que as ligações que abrem
 * as duas travas continuam lá.
 */
describe("o motor abre as duas travas", () => {
  const motor = readFileSync(
    new URL("../sdk/motorDeVoz.ts", import.meta.url),
    "utf8",
  );

  it("publica com a codificação da escolha", () => {
    expect(motor).toContain("screenShareEncoding: codificacaoDe(q)");
    expect(motor).toContain("publicacaoDe(escolha.qualidade)");
    expect(motor).toContain("simulcast: false");
    expect(motor).toContain('videoCodec: "vp8"');
  });

  it("não reaplica constraints no começo, só em Fonte", () => {
    expect(motor).toContain(
      "if (ALTURA_DE[escolha.qualidade.resolucao] === undefined)",
    );
  });

  it("trocar ao vivo mexe na captura E no codificador", () => {
    expect(motor).toContain("await faixa.applyConstraints(constraintsDe(q));");
    expect(motor).toContain("await aplicarCodificacao(local.sender, q);");
  });
});
