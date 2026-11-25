import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SERVER_ID, seed } from "../arnes/firehose";
import { definirCanalAberto, servers, usuarioLocalId } from "./adapter";
import { client } from "./client";
import { anotarCanais, escreverTopico, lerTopico } from "./vortexCanal";
import { limparSilencio } from "../store/silencio";

/**
 * O rollup de tópicos pelo adapter de verdade: `messageCreate` entra pelo
 * caminho incremental (`contabilizarNaoLida`) e seguir/deixar de seguir passa
 * pelo ouvinte de meta que recalcula o servidor.
 */

const pendentes: FrameRequestCallback[] = [];
const OUTRA = "01JQ0000000000000009000001";
const PAI = "01JQ0000000000000000000000";

let n = 0;
let cancelar: () => void;

const cru = (id: string, seguidores: string[]) => ({
  _id: id,
  channel_type: "TextChannel",
  server: SERVER_ID,
  name: "topico",
  thread: { parent: PAI, owner: OUTRA, followers: seguidores },
});

function novoTopico(seguindo: boolean): string {
  n += 1;
  const id = `01JQ00000000000000000T${String(n).padStart(4, "0")}`;
  const c = cru(id, seguindo ? [usuarioLocalId()!] : []);
  client.channels.getOrCreate(id, c as never);
  anotarCanais([c]);
  return id;
}

function mensagem(canal: string, conteudo = "oi") {
  n += 1;
  const id = `01JQ00000000000000000M${String(n).padStart(4, "0")}`;
  client.messages.getOrCreate(
    id,
    { _id: id, channel: canal, author: OUTRA, content: conteudo },
    true,
  );
}

const servidor = () => servers.getSnapshot(SERVER_ID)!;

function definirSeguindo(id: string, seguindo: boolean) {
  const meta = lerTopico(id)!;
  const sem = meta.seguidores.filter((s) => s !== usuarioLocalId());
  escreverTopico(id, {
    ...meta,
    seguidores: seguindo ? [...sem, usuarioLocalId()!] : sem,
  });
}

beforeEach(async () => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    pendentes.push(cb);
    return pendentes.length;
  });
  await seed(4);
  definirCanalAberto(undefined);
  limparSilencio();
  cancelar = servers.subscriber(SERVER_ID)(() => {});
});

afterEach(() => {
  cancelar();
  vi.unstubAllGlobals();
});

describe("tópicos no rollup do servidor, pelo adapter", () => {
  it("mensagem em tópico SEGUIDO soma a não lida no servidor", () => {
    const antes = servidor().naoLidas;
    mensagem(novoTopico(true));
    expect(servidor().naoLidas).toBe(antes + 1);
  });

  it("mensagem em tópico NÃO seguido não soma", () => {
    const antes = servidor();
    mensagem(novoTopico(false));
    expect(servidor().naoLidas).toBe(antes.naoLidas);
    expect(servidor().mencoes).toBe(antes.mencoes);
  });

  it("menção em tópico não seguido soma a menção, e só ela", () => {
    const antes = servidor();
    mensagem(novoTopico(false), `oi <@${usuarioLocalId()}>`);
    expect(servidor().mencoes).toBe(antes.mencoes + 1);
    expect(servidor().naoLidas).toBe(antes.naoLidas);
  });

  it("seguir um tópico com não lidas recalcula o servidor, e deixar de seguir também", () => {
    const base = servidor().naoLidas;
    const t = novoTopico(false);
    mensagem(t);
    mensagem(t);
    expect(servidor().naoLidas).toBe(base);

    definirSeguindo(t, true);
    expect(servidor().naoLidas).toBe(base + 2);

    definirSeguindo(t, false);
    expect(servidor().naoLidas).toBe(base);
  });
});
