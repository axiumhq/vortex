/** Constantes injetadas pelo `define` do vite.config.ts; ver o comentario la. */
declare const __VERSAO__: string;
declare const __VERSAO_MEDIAPIPE__: string;

interface Window {
  vortex?: {
    janela: (acao: "minimizar" | "maximizar" | "restaurar" | "fechar") => Promise<void>;
    assinarJanela: (ouvinte: (estado: { maximizada: boolean; comFoco: boolean }) => void) => () => void;
  };
}
