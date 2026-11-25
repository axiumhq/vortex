/**
 * Pedidos à lista de mensagens vindos de fora dela.
 *
 * O composer não conhece o virtualizador, mas depois de enviar a lista tem de
 * ir ao fim mesmo que a pessoa estivesse lendo o histórico: quem acabou de
 * falar quer ver a própria fala. Um canal de comunicação mínimo, por canal e
 * sem estado — pedido sem lista montada se perde, e é o certo (ninguém espera).
 */
type Ouvinte = () => void;

const ouvintes = new Map<string, Set<Ouvinte>>();

export function aoPedirFim(canalId: string, ouvinte: Ouvinte): () => void {
  let set = ouvintes.get(canalId);
  if (!set) {
    set = new Set();
    ouvintes.set(canalId, set);
  }
  set.add(ouvinte);
  return () => {
    const atual = ouvintes.get(canalId);
    if (!atual) return;
    atual.delete(ouvinte);
    if (atual.size === 0) ouvintes.delete(canalId);
  };
}

export function pedirFimDaLista(canalId: string): void {
  for (const ouvinte of ouvintes.get(canalId) ?? []) ouvinte();
}

/* ------------------------------------------------------------------- salto */
/**
 * "Pular para a mensagem" (a citação de uma resposta, um permalink): a lista do
 * canal rola até o ID. Mesmo desenho do pedido de fim: sem lista montada, o
 * pedido se perde.
 */
type OuvinteDeSalto = (messageId: string) => void;

const saltos = new Map<string, Set<OuvinteDeSalto>>();

export function aoPedirSalto(canalId: string, ouvinte: OuvinteDeSalto): () => void {
  let set = saltos.get(canalId);
  if (!set) {
    set = new Set();
    saltos.set(canalId, set);
  }
  set.add(ouvinte);
  return () => {
    const atual = saltos.get(canalId);
    if (!atual) return;
    atual.delete(ouvinte);
    if (atual.size === 0) saltos.delete(canalId);
  };
}

export function pedirSalto(canalId: string, messageId: string): void {
  for (const ouvinte of saltos.get(canalId) ?? []) ouvinte(messageId);
}

/* ----------------------------------------------------------------- retorno */
/**
 * Voltar a um canal ONDE se estava (sair de um tópico para o canal pai).
 *
 * A lista é remontada por canal, e remontar reancora no fim: sem isto, abrir
 * um tópico de uma mensagem antiga e voltar jogaria a pessoa no fim do pai,
 * longe do que ela lia. A lista guarda a posição ao desmontar (a primeira
 * linha visível, ou "estava no fim"), e só a RESTAURA quando alguém pediu o
 * retorno: trocar de canal pela coluna continua abrindo no fim, como sempre.
 *
 * Module-level e não estado de componente: quem pede o retorno (o cabeçalho
 * do tópico) e quem o cumpre (a lista do pai) nunca estão montados juntos.
 */
export type PosicaoDaLista = { readonly ancora: string; readonly noFim: boolean };

/** Teto do mapa: uma posição por canal visitado, numa sessão de horas. */
const TETO_DE_POSICOES = 64;

const posicoes = new Map<string, PosicaoDaLista>();
const retornos = new Set<string>();

export function guardarPosicao(canalId: string, posicao: PosicaoDaLista): void {
  posicoes.delete(canalId);
  posicoes.set(canalId, posicao);
  if (posicoes.size > TETO_DE_POSICOES) {
    const maisAntiga = posicoes.keys().next().value;
    if (maisAntiga !== undefined) posicoes.delete(maisAntiga);
  }
}

/** A próxima montagem da lista deste canal volta à posição guardada. */
export function pedirRetorno(canalId: string): void {
  retornos.add(canalId);
}

/** Consumido uma vez: guardar depois de entregue faria todo remonte "voltar". */
export function consumirRetorno(canalId: string): PosicaoDaLista | undefined {
  if (!retornos.delete(canalId)) return undefined;
  return posicoes.get(canalId);
}
