import {
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

/**
 * Carregamento sob demanda que não guarda a falha para sempre.
 *
 * ⚠ **O `React.lazy` cacheia a promessa REJEITADA.** O estado do componente lazy
 * vira "rejected" na primeira falha e todo render seguinte relança o mesmo erro,
 * sem chamar o `import()` de novo: rede que oscilou uma vez, ou um deploy que
 * trocou o hash do chunk, e o componente quebra a cada abertura até F5.
 *
 * ⚠ **E trocar o `lazy` por um novo durante o render não resolve.** Enquanto o
 * componente suspende ele nunca chega a ser commitado, então o React descarta o
 * estado e re-renderiza do zero a cada tentativa: o "renovar se falhou" rodava
 * de novo a cada passagem, e o `import()` virava um laço (16 chamadas medidas
 * para uma abertura). Por isso aqui não há `lazy` nem Suspense: o carregamento
 * é um efeito, que só roda depois do commit e uma vez por montagem.
 *
 * Só o SUCESSO fica guardado. A promessa em andamento é compartilhada (duas
 * montagens simultâneas fazem um `import()`), e some ao terminar — com erro, a
 * próxima montagem pede de novo.
 */
export interface OpcoesDeCarga {
  /** Mostrado enquanto o módulo não chegou. */
  carregando: ReactNode;
  /** Mostrado quando o `import()` falhou; `tentar` pede outro. */
  erro: (tentar: () => void) => ReactNode;
}

type Estado<P> =
  | { readonly tipo: "carregando" }
  | { readonly tipo: "pronto"; readonly Componente: ComponentType<P> }
  | { readonly tipo: "erro" };

export function lazyComNovaTentativa<P extends object>(
  carregar: () => Promise<{ default: ComponentType<P> }>,
  { carregando, erro }: OpcoesDeCarga,
): ComponentType<P> {
  let pronto: ComponentType<P> | undefined;
  let emAndamento: Promise<ComponentType<P>> | undefined;
  let falhasSeguidas = 0;

  const pedir = (): Promise<ComponentType<P>> => {
    if (pronto) return Promise.resolve(pronto);
    emAndamento ??= carregar().then(
      (modulo) => {
        pronto = modulo.default;
        emAndamento = undefined;
        falhasSeguidas = 0;
        limparMarcaDeRecarga();
        return pronto;
      },
      (falha: unknown) => {
        // Sem guardar: a próxima chamada faz um `import()` novo.
        emAndamento = undefined;
        falhasSeguidas += 1;
        console.error("Componente sob demanda não carregou", falha);
        // A segunda falha seguida é "tentei de novo e falhou". A primeira só
        // oferece tentar: recarregar joga fora rascunho e chamada de voz.
        if (falhasSeguidas >= 2 && ehErroDeChunk(falha)) recarregarUmaVez();
        throw falha;
      },
    );
    return emAndamento;
  };

  return function SobDemanda(props: P) {
    const [estado, definir] = useState<Estado<P>>(() =>
      pronto ? { tipo: "pronto", Componente: pronto } : { tipo: "carregando" },
    );
    const [tentativa, definirTentativa] = useState(0);

    useEffect(() => {
      if (estado.tipo !== "carregando") return;
      let vivo = true;
      pedir().then(
        (Componente) => vivo && definir({ tipo: "pronto", Componente }),
        () => vivo && definir({ tipo: "erro" }),
      );
      return () => {
        vivo = false;
      };
      // `tentativa` reinicia o efeito quando o erro volta a "carregando".
    }, [estado.tipo, tentativa]);

    if (estado.tipo === "pronto") {
      const { Componente } = estado;
      return <Componente {...props} />;
    }
    if (estado.tipo === "erro") {
      return erro(() => {
        definir({ tipo: "carregando" });
        definirTentativa((t) => t + 1);
      });
    }
    return carregando;
  };
}

/* ------------------------------------------------------------- deploy antigo */

const MARCA = "vortex:recarga-por-chunk";

/**
 * Efeitos da página, atrás de um objeto para o teste trocá-los: recarregar de
 * verdade derrubaria o navegador de teste.
 */
export const acoesDaPagina = {
  recarregar: () => window.location.reload(),
};

/**
 * O erro é de módulo dinâmico que não veio? As mensagens são as dos três
 * motores (Chromium, Firefox, Safari); não há `name` próprio para casar.
 */
export function ehErroDeChunk(falha: unknown): boolean {
  const texto = falha instanceof Error ? falha.message : String(falha);
  return /dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(texto);
}

function lerMarca(): boolean {
  try {
    return sessionStorage.getItem(MARCA) === "1";
  } catch {
    // Armazenamento bloqueado: sem marca não dá para provar que não é laço, então
    // a resposta segura é NÃO recarregar.
    return true;
  }
}

function limparMarcaDeRecarga() {
  try {
    sessionStorage.removeItem(MARCA);
  } catch {
    /* sem armazenamento, sem marca */
  }
}

/**
 * Recarrega a página UMA vez por sessão de aba.
 *
 * Por que recarregar: depois de um deploy o `index.html` aberto aponta para
 * chunks que o servidor não tem mais (404), e nenhuma nova tentativa os
 * encontra — só o `index.html` novo conhece os hashes atuais. Por que uma vez:
 * se o servidor estiver fora, recarregar em laço troca um erro por um piscar
 * infinito. A marca vive em `sessionStorage` e sai quando qualquer chunk chega,
 * então um deploy futuro na mesma aba ainda pode recarregar.
 */
export function recarregarUmaVez(): boolean {
  if (lerMarca()) return false;
  try {
    sessionStorage.setItem(MARCA, "1");
  } catch {
    return false;
  }
  acoesDaPagina.recarregar();
  return true;
}

/** Só para teste: esquece a marca de recarga. */
export function esquecerRecarga(): void {
  limparMarcaDeRecarga();
}
