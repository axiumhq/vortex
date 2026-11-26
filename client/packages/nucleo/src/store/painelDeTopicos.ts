/**
 * O painel de tópicos do canal: aberto ou não, e de qual canal.
 *
 * Store module-level com `useSyncExternalStore` (lei nº 1), no mesmo molde do de
 * fixados: quem abre e fecha o painel é o cabeçalho, mas quem o fecha ao trocar
 * de canal é o shell. A LISTA não mora aqui — ela é o recorte `canal:<id>` do
 * store de tópicos, que já é por entidade.
 */
export type EstadoDoPainelDeTopicos = {
  readonly aberto: boolean;
  readonly channelId: string | undefined;
};

const VAZIO: EstadoDoPainelDeTopicos = { aberto: false, channelId: undefined };

let estado = VAZIO;
const ouvintes = new Set<() => void>();

export function assinarPainelDeTopicos(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** Referência cacheada: só muda quando o estado muda. */
export function lerPainelDeTopicos(): EstadoDoPainelDeTopicos {
  return estado;
}

function publicar(proximo: EstadoDoPainelDeTopicos): void {
  if (proximo.aberto === estado.aberto && proximo.channelId === estado.channelId) return;
  estado = proximo;
  for (const o of ouvintes) o();
}

export function abrirPainelDeTopicos(channelId: string): void {
  publicar({ aberto: true, channelId });
}

export function fecharPainelDeTopicos(): void {
  if (!estado.aberto) return;
  publicar({ ...estado, aberto: false });
}

/** Só para testes e para o fim da sessão. */
export function limparPainelDeTopicos(): void {
  publicar(VAZIO);
}
