/**
 * Onde o cartão de detalhamento do usuário está aberto.
 *
 * Um cartão para o app inteiro, e não um Popover por linha de mensagem ou por
 * linha de membro (lei nº 1, mesmo motivo de `seletorDeReacao.ts`). Guarda o
 * retângulo medido no clique para não depender de um nó DOM que o virtualizador
 * pode desmontar durante o scroll.
 */

export type LadoDoCartao = "left" | "right" | "top" | "bottom";

export type AlvoDoCartao = {
  readonly userId: string;
  readonly serverId: string | undefined;
  readonly lado: LadoDoCartao;
  /** Em coordenadas de viewport, como `getBoundingClientRect`. */
  readonly x: number;
  readonly y: number;
  readonly largura: number;
  readonly altura: number;
};

let alvo: AlvoDoCartao | null = null;

const ouvintes = new Set<() => void>();

export function assinarCartaoDeUsuario(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function lerAlvoDoCartao(): AlvoDoCartao | null {
  return alvo;
}

export function abrirCartaoDeUsuario(
  userId: string,
  ancora: Element | null,
  opcoes?: { readonly serverId?: string | undefined; readonly lado?: LadoDoCartao },
): void {
  if (!userId) return;
  const r = ancora?.getBoundingClientRect();
  alvo = {
    userId,
    serverId: opcoes?.serverId || undefined,
    lado: opcoes?.lado ?? "right",
    x: r?.x ?? 0,
    y: r?.y ?? 0,
    largura: r?.width ?? 0,
    altura: r?.height ?? 0,
  };
  for (const o of ouvintes) o();
}

export function fecharCartaoDeUsuario(): void {
  if (alvo === null) return;
  alvo = null;
  for (const o of ouvintes) o();
}
