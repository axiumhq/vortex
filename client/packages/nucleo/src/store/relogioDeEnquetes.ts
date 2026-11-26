/**
 * Relógio compartilhado de baixa frequência — enquete que vence com a linha
 * aberta precisa saber "que minuto é agora" sem timer por linha.
 *
 * Refcount: o `setInterval` só existe enquanto há assinante e morre no último
 * cleanup. `lerMinutoAtual` devolve um número cacheado (estável entre
 * publicações), como todo `getSnapshot` do projeto.
 */
export const MINUTO_MS = 60_000;

const doMinuto = (agora: number): number => Math.floor(agora / MINUTO_MS) * MINUTO_MS;

let minuto = doMinuto(Date.now());
let intervalo: ReturnType<typeof setInterval> | undefined;
const ouvintes = new Set<() => void>();

function tique(): void {
  const novo = doMinuto(Date.now());
  if (novo === minuto) return;
  minuto = novo;
  for (const o of ouvintes) o();
}

export function assinarMinutoAtual(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  if (ouvintes.size === 1) {
    /* Reanexa: o valor pode ter envelhecido enquanto ninguém ouvia. */
    minuto = doMinuto(Date.now());
    intervalo = setInterval(tique, MINUTO_MS);
  }
  return () => {
    if (!ouvintes.delete(ouvinte)) return;
    if (ouvintes.size === 0 && intervalo !== undefined) {
      clearInterval(intervalo);
      intervalo = undefined;
    }
  };
}

export const lerMinutoAtual = (): number => minuto;
