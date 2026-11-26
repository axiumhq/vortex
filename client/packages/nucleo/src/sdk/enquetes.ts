import { batch } from "solid-js";
import type { Message } from "stoat.js";

import { toast } from "../ui-logica/toastStore";
import { ARNES_ATIVO } from "../arnes/arnesAtivo";
import {
  aplicarVoto,
  definirEnqueteBruta,
  lerEnquete,
  lerEnqueteBruta,
  lerEuDasEnquetes,
  marcarEncerrada,
  proximoVoto,
  removerEnquete,
  type EnqueteBruta,
} from "../store/enquetes";
import { client, conectado } from "./client";

/**
 * Enquete no protocolo — a camada anticorrupção do campo `Message.poll`.
 *
 * ⚠ **O `stoat.js` não conhece o campo e o descarta na hidratação** (o log
 * "Skipping key poll" é ele). Nenhum getter de `Message` o alcança, então a
 * enquete vem de dois lugares crus, os mesmos que a voz por canal e o
 * `can_publish` já usam:
 *
 * - os EVENTOS do socket (`Message`, `MessagePollVote`, `MessagePollEnd`,
 *   `MessageDelete`), lidos antes da hidratação;
 * - o HISTÓRICO, que `buscarMensagensComEnquetes` pede cru e hidrata do mesmo
 *   jeito que `Channel.fetchMessagesWithUsers` faria.
 *
 * O que NÃO carrega enquete: mensagem buscada uma a uma (citação, fixadas,
 * busca). Nessas superfícies a pergunta aparece como texto, porque o autor a
 * manda também no `content` — que é também o que um cliente Stoat antigo vê.
 */

type PollBruto = {
  question?: unknown;
  answers?: unknown;
  max_answers?: unknown;
  expires_at?: unknown;
  hide_results?: unknown;
  ended_at?: unknown;
  votes?: unknown;
};

function instante(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Traduz o `poll` cru. Forma inválida vira ausência, nunca meia enquete. */
export function traduzirEnquete(poll: unknown): EnqueteBruta | undefined {
  if (typeof poll !== "object" || poll === null) return undefined;
  const p = poll as PollBruto;
  if (typeof p.question !== "string" || !Array.isArray(p.answers)) return undefined;

  const respostas: { id: string; texto: string }[] = [];
  for (const a of p.answers as unknown[]) {
    const r = a as { id?: unknown; text?: unknown };
    if (typeof r.id !== "string" || typeof r.text !== "string") return undefined;
    respostas.push({ id: r.id, texto: r.text });
  }
  if (respostas.length < 2) return undefined;

  const votos = new Map<string, ReadonlySet<string>>();
  if (typeof p.votes === "object" && p.votes !== null) {
    for (const [resposta, quem] of Object.entries(p.votes as Record<string, unknown>)) {
      if (!Array.isArray(quem)) continue;
      votos.set(
        resposta,
        new Set(quem.filter((q): q is string => typeof q === "string")),
      );
    }
  }

  return {
    pergunta: p.question,
    respostas,
    maximo:
      typeof p.max_answers === "number" && p.max_answers >= 1
        ? Math.min(p.max_answers, respostas.length)
        : 1,
    expiraEm: instante(p.expires_at),
    encerradaEm: instante(p.ended_at),
    esconder: p.hide_results === true,
    votos,
  };
}

type EventoBruto = {
  type?: string;
  v?: readonly unknown[];
  _id?: string;
  id?: string;
  poll?: unknown;
  user_id?: string;
  answers?: unknown;
  ids?: unknown;
};

/**
 * Anota o que um evento cru diz sobre enquetes.
 *
 * Devolve os IDs de mensagem que mudaram — quem republica a linha é o
 * adapter, que é quem tem o store de mensagens. Importar o adapter daqui
 * fecharia um ciclo com ele.
 */
export function anotarEventoDeEnquete(evento: unknown): readonly string[] {
  const e = evento as EventoBruto;
  switch (e.type) {
    case "Bulk": {
      const ids: string[] = [];
      for (const item of e.v ?? []) ids.push(...anotarEventoDeEnquete(item));
      return ids;
    }
    case "Message": {
      const enquete = traduzirEnquete(e.poll);
      if (!e._id || !enquete) return [];
      definirEnqueteBruta(e._id, enquete);
      return [e._id];
    }
    case "MessagePollVote": {
      if (!e.id || !e.user_id || !Array.isArray(e.answers)) return [];
      const respostas = e.answers.filter((a): a is string => typeof a === "string");
      return aplicarVoto(e.id, e.user_id, respostas) ? [e.id] : [];
    }
    case "MessagePollEnd": {
      const final = traduzirEnquete(e.poll);
      if (!e.id || !final) return [];
      definirEnqueteBruta(e.id, final);
      return [e.id];
    }
    case "MessageDelete":
      return e.id && removerEnquete(e.id) ? [e.id] : [];
    case "BulkMessageDelete": {
      if (!Array.isArray(e.ids)) return [];
      const ids: string[] = [];
      for (const id of e.ids) {
        if (typeof id === "string" && removerEnquete(id)) ids.push(id);
      }
      return ids;
    }
    default:
      return [];
  }
}

/* --------------------------------------------------------------- histórico */

type RespostaDeHistorico = {
  messages: ({ _id: string; poll?: unknown } & Record<string, unknown>)[];
  users: ({ _id: string } & Record<string, unknown>)[];
  members?: ({ _id: { server: string; user: string } } & Record<string, unknown>)[];
};

/**
 * `Channel.fetchMessagesWithUsers`, com as enquetes preservadas.
 *
 * Mesma rota, mesmos parâmetros e a mesma hidratação em lote — a única
 * diferença é ler `poll` do corpo cru antes de o SDK descartá-lo. Pedir a
 * página duas vezes (uma pelo SDK, outra crua) dobraria o tráfego de toda
 * abertura de canal por um campo que a maioria das mensagens nem tem.
 */
export async function buscarMensagensComEnquetes(
  channelId: string,
  params: { limit: number; before?: string },
): Promise<Message[]> {
  const bruto = (await client.api.get(
    `/channels/${channelId}/messages` as never,
    { ...params, include_users: true } as never,
  )) as unknown as RespostaDeHistorico;

  for (const m of bruto.messages) {
    const enquete = traduzirEnquete(m.poll);
    if (enquete) definirEnqueteBruta(m._id, enquete);
  }

  return batch(() => {
    for (const u of bruto.users) client.users.getOrCreate(u._id, u as never);
    for (const m of bruto.members ?? []) {
      client.serverMembers.getOrCreate(m._id, m as never);
    }
    return bruto.messages.map((m) => client.messages.getOrCreate(m._id, m as never));
  });
}

/* ------------------------------------------------------------------ escrita */

export type NovaEnquete = {
  readonly pergunta: string;
  readonly respostas: readonly string[];
  readonly duracaoHoras: number;
  readonly multipla: boolean;
  readonly resultadoNoFim: boolean;
};

/**
 * O corpo do `POST` de mensagem com enquete.
 *
 * ⚠ **A pergunta vai TAMBÉM no `content`.** É o que um cliente Stoat sem
 * enquete mostra, e o que a citação e a busca mostram aqui — sem isto a
 * mensagem chegaria vazia em todo lugar que não lê o campo. A linha deste app
 * esconde o texto quando ele é igual à pergunta (ver `map.ts`).
 *
 * `max_answers` é o número de respostas quando múltipla: o design oferece
 * "uma" ou "múltiplas", não um teto numérico.
 */
export function corpoDaEnquete(n: NovaEnquete): Record<string, unknown> {
  const respostas = n.respostas.map((r) => r.trim()).filter((r) => r !== "");
  return {
    content: n.pergunta.trim(),
    poll: {
      question: n.pergunta.trim(),
      answers: respostas,
      max_answers: n.multipla ? respostas.length : 1,
      duration_hours: n.duracaoHoras,
      hide_results: n.resultadoNoFim,
    },
  };
}

export async function criarEnquete(channelId: string, n: NovaEnquete): Promise<boolean> {
  if (!conectado()) {
    toast({ tipo: "erro", titulo: "Sem conexão.", descricao: "A enquete não foi criada." });
    return false;
  }
  try {
    await client.api.post(
      `/channels/${channelId}/messages` as never,
      corpoDaEnquete(n) as never,
    );
    return true;
  } catch {
    toast({
      tipo: "erro",
      titulo: "Não deu para criar a enquete.",
      descricao: "O servidor recusou. Confira se ele já tem enquetes.",
    });
    return false;
  }
}

/**
 * Vota — otimista, e o design diz por quê.
 *
 * *"Voto é otimista: preenche na hora e reverte com toast em caso de erro."*
 * O eco que chega pelo socket (`MessagePollVote`) é o mesmo voto e não muda
 * nada; a reversão devolve o voto ANTERIOR inteiro, e não "tira o que eu pus",
 * porque numa enquete de uma resposta votar em outra também tirou uma.
 */
export async function votarNaEnquete(
  channelId: string,
  messageId: string,
  opcaoId: string,
  aoMudar: () => void,
): Promise<void> {
  const eu = lerEuDasEnquetes();
  const enquete = lerEnquete(messageId);
  if (!enquete || !eu) return;

  const antes = enquete.meusVotos;
  const depois = proximoVoto(antes, opcaoId, enquete.maximo);
  if (depois === antes) return;
  if (aplicarVoto(messageId, eu, depois)) aoMudar();

  /* O arnês não tem servidor: o voto fica só no store, pelo mesmo arranjo da
     simulação de envio. Fora dele, a rede decide. */
  if (ARNES_ATIVO) return;

  try {
    if (!conectado()) throw new Error("sem conexão");
    await client.api.put(
      `/channels/${channelId}/messages/${messageId}/poll/votes` as never,
      { answers: depois } as never,
    );
  } catch {
    if (aplicarVoto(messageId, eu, antes)) aoMudar();
    toast({
      tipo: "erro",
      titulo: "O voto não foi registrado.",
      descricao: "A enquete pode ter fechado, ou a conexão caiu.",
    });
  }
}

/**
 * Encerra antes do prazo. Só autor ou quem gerencia mensagens — o servidor
 * decide, e a interface só oferece a quem pode (`encerrarEnquete` em
 * `permissoes.ts`). Devolve se deu certo: a confirmação só fecha quando deu.
 */
export async function encerrarEnquete(
  channelId: string,
  messageId: string,
  aoMudar: () => void,
): Promise<boolean> {
  if (!lerEnqueteBruta(messageId)) return false;
  /* O arnês não tem servidor: encerra só no store, como o voto. */
  if (ARNES_ATIVO) {
    if (marcarEncerrada(messageId, Date.now())) aoMudar();
    return true;
  }
  try {
    if (!conectado()) throw new Error("sem conexão");
    await client.api.post(
      `/channels/${channelId}/messages/${messageId}/poll/end` as never,
    );
    /* O `MessagePollEnd` traz a enquete final; marcar aqui só adianta o
       selo para quem clicou, e o evento substitui por cima. */
    if (marcarEncerrada(messageId, Date.now())) aoMudar();
    return true;
  } catch {
    toast({ tipo: "erro", titulo: "Não deu para encerrar a enquete." });
    return false;
  }
}
