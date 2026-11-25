/**
 * O rollup de não-lidas por servidor, como regra pura.
 *
 * ⚠ **Canal mudo não soma NÃO-LIDA ao servidor, e continua somando MENÇÃO.**
 * É a mesma regra que a coluna já aplica ao canal ("silenciado apaga o realce
 * e mantém a contagem") levada um degrau acima: silenciar um canal — ou o
 * servidor inteiro — existe para o rail parar de acender por conversa que a
 * pessoa decidiu ignorar. Uma menção, por outro lado, é alguém chamando pelo
 * nome; escondê-la porque o canal está mudo seria perder justamente o que
 * atravessa o silêncio em todo cliente da categoria.
 *
 * Pura e fora do adapter para ter teste sem SDK: o adapter só entrega as
 * contagens por canal, quem é o servidor de cada um e quem está mudo.
 */

export type ContagemDeCanal = { readonly naoLidas: number; readonly mencoes: number };

/** O que o rollup precisa saber de um tópico — `undefined` é canal comum. */
export type InfoDeTopico = { readonly paiId: string; readonly seguindo: boolean };

/**
 * Quantas não-lidas de UM canal sobem para o servidor.
 *
 * Regra única, usada pela recontagem e pelo caminho incremental de
 * `messageCreate` — os dois concordam porque perguntam a mesma coisa.
 *
 * ⚠ **Tópico só acende o servidor se a pessoa o SEGUE**, e o silêncio do canal
 * PAI vale para ele: silenciar #produto silencia os tópicos de #produto. A
 * menção não passa por aqui — atravessa o silêncio e o "não sigo", como no
 * canal comum.
 */
export function naoLidasQueSobem(
  naoLidas: number,
  channelId: string,
  serverId: string,
  mudo: (channelId: string, serverId: string) => boolean,
  topico?: InfoDeTopico,
): number {
  if (mudo(channelId, serverId)) return 0;
  if (topico && (!topico.seguindo || mudo(topico.paiId, serverId))) return 0;
  return naoLidas;
}

export function somarPorServidor(
  contagens: Iterable<readonly [string, ContagemDeCanal]>,
  servidorDe: (channelId: string) => string | undefined,
  mudo: (channelId: string, serverId: string) => boolean,
  topico?: (channelId: string) => InfoDeTopico | undefined,
): Map<string, { naoLidas: number; mencoes: number }> {
  const soma = new Map<string, { naoLidas: number; mencoes: number }>();
  for (const [channelId, c] of contagens) {
    const serverId = servidorDe(channelId);
    if (!serverId) continue;
    const naoLidas = naoLidasQueSobem(
      c.naoLidas,
      channelId,
      serverId,
      mudo,
      topico?.(channelId),
    );
    if (naoLidas === 0 && c.mencoes === 0) continue;
    const atual = soma.get(serverId);
    if (atual) {
      atual.naoLidas += naoLidas;
      atual.mencoes += c.mencoes;
    } else {
      soma.set(serverId, { naoLidas, mencoes: c.mencoes });
    }
  }
  return soma;
}

/**
 * O número da entrada Conversas no rail — D-NOTIF-17.
 *
 * O design diz *"Pill numérico = menções diretas, DMs e chamadas. Sempre em
 * danger."* Numa DM ou num grupo TODA mensagem é dirigida a você, então a
 * não-lida já é o número — somar a menção por cima contaria a mesma mensagem
 * duas vezes.
 *
 * ⚠ **Conversa muda conta só a MENÇÃO**, a mesma regra de `somarPorServidor`
 * um degrau ao lado: silenciar uma DM é pedir para ela parar de acender, e o
 * que atravessa o silêncio em todo cliente da categoria é alguém chamando pelo
 * nome.
 *
 * Só `dm` e `grupo`: canal de servidor sobe pelo rollup do servidor, e as
 * notas são suas — mensagem sua não é aviso.
 */
export function somarConversas(
  contagens: Iterable<readonly [string, ContagemDeCanal]>,
  ehConversa: (channelId: string) => boolean,
  mudo: (channelId: string) => boolean,
): number {
  let soma = 0;
  for (const [channelId, c] of contagens) {
    if (!ehConversa(channelId)) continue;
    soma += mudo(channelId) ? c.mencoes : c.naoLidas;
  }
  return soma;
}
