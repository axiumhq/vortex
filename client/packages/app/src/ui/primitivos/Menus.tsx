import * as Contexto from "@radix-ui/react-context-menu";
import * as Suspenso from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";

import { Marcar } from "../icones";
import { classeDoItem, classeDoMenu, classeDoRotulo, classeDoSeparador, estilos, juntar } from "./classes";
import { useRecipienteDePortal } from "./portal";

/**
 * Menus. Item sem `onSelect`, `disabled` ou `asChild` é erro de lint
 * (ITEM_INERTE): item que não faz nada ensina a pessoa a não confiar no menu.
 */

/** `perigo` pinta a ação destrutiva; o resto é igual. */
type ComVariante = { variante?: "perigo" };

// Menu suspenso (botão "mais opções")
export const MenuSuspenso = Suspenso.Root;
export const GatilhoDoMenu = Suspenso.Trigger;

export function ConteudoDoMenu({ className, ...props }: ComponentProps<typeof Suspenso.Content>) {
  const recipiente = useRecipienteDePortal();
  return (
    <Suspenso.Portal container={recipiente}>
      <Suspenso.Content sideOffset={6} {...props} className={juntar(classeDoMenu, className)} />
    </Suspenso.Portal>
  );
}

export function ItemDeMenu({
  variante,
  className,
  ...props
}: ComponentProps<typeof Suspenso.Item> & ComVariante) {
  return (
    <Suspenso.Item {...props} data-variante={variante} className={juntar(classeDoItem, className)} />
  );
}

/**
 * Escolha única dentro do menu (o "select" do app): a opção atual é marcada, e
 * as setas, Enter e a digitação do início do nome vêm do Radix.
 */
export const GrupoDeEscolha = Suspenso.RadioGroup;

export function ItemDeEscolha({
  className,
  children,
  ...props
}: ComponentProps<typeof Suspenso.RadioItem>) {
  return (
    <Suspenso.RadioItem {...props} className={juntar(classeDoItem, className)}>
      <span className={estilos.itemTexto}>{children}</span>
      <Suspenso.ItemIndicator className={estilos.itemMarca}>
        <Marcar aria-hidden />
      </Suspenso.ItemIndicator>
    </Suspenso.RadioItem>
  );
}

export function SeparadorDeMenu({ className, ...props }: ComponentProps<typeof Suspenso.Separator>) {
  return <Suspenso.Separator {...props} className={juntar(classeDoSeparador, className)} />;
}

export function RotuloDeMenu({ className, ...props }: ComponentProps<typeof Suspenso.Label>) {
  return <Suspenso.Label {...props} className={juntar(classeDoRotulo, className)} />;
}

// Menu de contexto (botão direito)
export const MenuDeContexto = Contexto.Root;
export const GatilhoDoMenuDeContexto = Contexto.Trigger;

export function ConteudoDoMenuDeContexto({
  className,
  ...props
}: ComponentProps<typeof Contexto.Content>) {
  const recipiente = useRecipienteDePortal();
  return (
    <Contexto.Portal container={recipiente}>
      <Contexto.Content {...props} className={juntar(classeDoMenu, className)} />
    </Contexto.Portal>
  );
}

export function ItemDeMenuDeContexto({
  variante,
  className,
  ...props
}: ComponentProps<typeof Contexto.Item> & ComVariante) {
  return (
    <Contexto.Item {...props} data-variante={variante} className={juntar(classeDoItem, className)} />
  );
}

export function SeparadorDeMenuDeContexto({
  className,
  ...props
}: ComponentProps<typeof Contexto.Separator>) {
  return <Contexto.Separator {...props} className={juntar(classeDoSeparador, className)} />;
}

export function RotuloDeMenuDeContexto({
  className,
  ...props
}: ComponentProps<typeof Contexto.Label>) {
  return <Contexto.Label {...props} className={juntar(classeDoRotulo, className)} />;
}
