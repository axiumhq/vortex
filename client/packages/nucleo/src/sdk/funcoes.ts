import { createEffect, createRoot } from "solid-js";

import { client } from "./client";

/*
 * Separado de `config.ts` de propósito: `client.ts` importa `API_URL` de lá, então
 * entrar por `config.ts` antes de `client.ts` quebra com "Cannot access API_URL
 * before initialization". Este módulo só depende do client, sem ciclo.
 */

/* ------------------------------------------------- funções do fork (vortex) */

/**
 * Funções anunciadas pelo servidor em `features.vortex` (`string[]`).
 *
 * ⚠ **Campo do fork**, como `desktop_min_version`: leitura estreita. Ausente,
 * não-array ou sem o nome -> `false`. O default é o lado seguro: um servidor
 * Stoat puro nunca deve ver controle que ele não sabe atender.
 */
let funcoesDoArnes: readonly string[] | undefined;
const ouvintesDeFuncoes = new Set<() => void>();

export function servidorTemFuncao(nome: string): boolean {
  if (funcoesDoArnes !== undefined) return funcoesDoArnes.includes(nome);
  const v = (
    client.configuration as { features?: { vortex?: unknown } } | undefined
  )?.features?.vortex;
  return Array.isArray(v) && v.includes(nome);
}

export const servidorTemEnquetes = (): boolean => servidorTemFuncao("polls");

/**
 * Liga/desliga funções simuladas pelo arnês (sem servidor). `undefined`
 * volta a ler a configuração real. Só o arnês e os testes chamam.
 */
export function definirFuncoesDoArnes(nomes: readonly string[] | undefined): void {
  funcoesDoArnes = nomes;
  for (const o of ouvintesDeFuncoes) o();
}

/**
 * Assina mudanças nas funções do servidor: a configuração chegando
 * (`client.configured`) ou o arnês mexendo. O root do Solid sai no cleanup.
 */
export function assinarFuncoesDoServidor(ouvinte: () => void): () => void {
  ouvintesDeFuncoes.add(ouvinte);
  let primeira = true;
  const dispose = createRoot((d) => {
    createEffect(() => {
      client.configured();
      if (primeira) {
        primeira = false;
        return;
      }
      ouvinte();
    });
    return d;
  });
  return () => {
    ouvintesDeFuncoes.delete(ouvinte);
    dispose();
  };
}
