import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tocar } from "../som/sons";
import { definirNivelDoCanal, definirNivelDoServidor, limparSilencio } from "../store/silencio";
import type { MensagemRecebida } from "./decidir";
import { notificarMensagem } from "./notificador";

vi.mock("../som/sons", () => ({ tocar: vi.fn() }));

/**
 * A cadeia de nível de um TÓPICO: o dele, senão o do canal pai, senão o do
 * servidor. Resolver só pelo servidor ignorava a exceção do pai.
 */

const menção = (): MensagemRecebida => ({
  mensagemId: "m",
  channelId: "topico",
  serverId: "srv",
  tipoDoCanal: "servidor",
  autorNome: "Marina",
  canalNome: "t",
  servidorNome: "s",
  texto: "oi",
  minha: false,
  mencionaVoce: true,
  mencionaTodos: false,
  mencionaCargo: false,
  ehTopico: true,
  paiId: "pai",
});

beforeEach(() => {
  limparSilencio();
  vi.mocked(tocar).mockClear();
});
afterEach(limparSilencio);

describe("nível herdado do canal pai", () => {
  it("servidor 'nada' + pai 'mencoes': a menção em tópico notifica", () => {
    definirNivelDoServidor("srv", "nada");
    definirNivelDoCanal("pai", "mencoes");
    notificarMensagem(menção());
    expect(tocar).toHaveBeenCalledTimes(1);
  });

  it("servidor 'mencoes' + pai 'nada': a menção em tópico não notifica", () => {
    definirNivelDoServidor("srv", "mencoes");
    definirNivelDoCanal("pai", "nada");
    notificarMensagem(menção());
    expect(tocar).not.toHaveBeenCalled();
  });

  it("o nível do próprio tópico vence o do servidor", () => {
    definirNivelDoServidor("srv", "nada");
    definirNivelDoCanal("topico", "mencoes");
    notificarMensagem(menção());
    expect(tocar).toHaveBeenCalledTimes(1);
  });
});
