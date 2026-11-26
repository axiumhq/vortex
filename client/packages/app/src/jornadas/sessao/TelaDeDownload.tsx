import { useEffect, useState } from "react";

import { comum, sessao } from "../../textos";
import { FundoVidro, PainelVidro } from "../../ui/ds";
import {
  Baixar,
  CantoSuperiorDireito,
  CompartilharTela,
  Copiar,
  Janela,
  Marcar,
  Microfone,
  SetaEsquerda,
  Tela,
} from "../../ui/icones";
import { Marca } from "../../ui/Marca";
import css from "./TelaDeDownload.module.css";

const BASE = "https://github.com/axiumhq/vortex/releases/latest/download/";
const RELEASES = "https://github.com/axiumhq/vortex/releases";
const ORIGEM_PADRAO =
  "https://raw.githubusercontent.com/axiumhq/vortex/main/client/packages/app/public";

export type PacoteId = "windows" | "debian" | "arch" | "linux";
export type SistemaDetectado = PacoteId | "macos" | "desconhecido";

interface Pacote {
  readonly id: PacoteId;
  readonly sistema: string;
  readonly formato: string;
  readonly arquivo: string;
  readonly instrucao: string;
  readonly usaInstaladorLinux?: boolean;
}

export function comandoInstaladorLinux(
  origemAtual = typeof window !== "undefined" ? window.location.origin : "",
): string {
  const origem = origemAtual.startsWith("https://")
    ? origemAtual
    : ORIGEM_PADRAO;
  return `curl --proto '=https' --tlsv1.2 -fsSL ${origem}/install.sh | sh`;
}

/**
 * Identifica o sistema do visitante apenas para pré-selecionar o pacote mais provável.
 * Nunca esconde os outros pacotes nem bloqueia o download.
 */
export function detectarSistema(
  agente = typeof navigator !== "undefined" ? navigator.userAgent : "",
  plataforma = typeof navigator !== "undefined" ? navigator.platform : "",
): SistemaDetectado {
  const texto = `${agente} ${plataforma}`.toLowerCase();
  if (/iphone|ipad|ipod|android/.test(texto)) return "desconhecido";
  if (/mac\s?os|macintosh|darwin|macintel/.test(texto)) return "macos";
  if (/win/.test(texto)) return "windows";
  if (/arch/.test(texto)) return "arch";
  if (/ubuntu|debian|mint|pop!_os|elementary/.test(texto)) return "debian";
  if (/linux|x11/.test(texto)) return "linux";
  return "desconhecido";
}

export function TelaDeDownload({
  sistemaInicial,
}: {
  /** Usado em testes para fixar o sistema detectado sem depender do ambiente. */
  sistemaInicial?: SistemaDetectado;
} = {}) {
  const t = sessao.download;
  const detectado = sistemaInicial ?? detectarSistema();
  const recomendado: PacoteId | undefined =
    detectado === "macos" || detectado === "desconhecido"
      ? undefined
      : detectado;

  const [selecionado, setSelecionado] = useState<PacoteId>(
    recomendado ?? "windows",
  );
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!copiado) return;
    const id = window.setTimeout(() => setCopiado(false), 2000);
    return () => window.clearTimeout(id);
  }, [copiado]);

  const comandoLinux = comandoInstaladorLinux();

  const pacotes: readonly Pacote[] = [
    {
      id: "windows",
      sistema: t.windows,
      formato: t.instaladorWindows,
      arquivo: "Vortex-Setup.exe",
      instrucao: t.instrucaoWindows,
    },
    {
      id: "debian",
      sistema: t.debian,
      formato: t.pacoteDebian,
      arquivo: "Vortex.deb",
      instrucao: t.instrucaoLinuxUnica,
      usaInstaladorLinux: true,
    },
    {
      id: "arch",
      sistema: t.arch,
      formato: t.pacoteArch,
      arquivo: "Vortex.pkg.tar.zst",
      instrucao: t.instrucaoLinuxUnica,
      usaInstaladorLinux: true,
    },
    {
      id: "linux",
      sistema: t.linux,
      formato: t.pacoteLinux,
      arquivo: "Vortex-linux.zip",
      instrucao: t.instrucaoLinuxUnica,
      usaInstaladorLinux: true,
    },
  ];

  const ativo = pacotes.find((p) => p.id === selecionado) ?? pacotes[0]!;
  const comandoAtivo = ativo.usaInstaladorLinux ? comandoLinux : undefined;

  const recursos = [
    {
      icone: <Microfone tamanho={16} />,
      titulo: t.recursoAtalhosTitulo,
      descricao: t.recursoAtalhosTexto,
    },
    {
      icone: <CompartilharTela tamanho={16} />,
      titulo: t.recursoAudioTitulo,
      descricao: t.recursoAudioTexto,
    },
    {
      icone: <Janela tamanho={16} />,
      titulo: t.recursoSobreposicaoTitulo,
      descricao: t.recursoSobreposicaoTexto,
    },
    {
      icone: <Tela tamanho={16} />,
      titulo: t.recursoBandejaTitulo,
      descricao: t.recursoBandejaTexto,
    },
  ] as const;

  const copiarComando = () => {
    if (!comandoAtivo || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    void navigator.clipboard.writeText(comandoAtivo).then(
      () => setCopiado(true),
      () => undefined,
    );
  };

  return (
    <FundoVidro className={css.pagina} data-testid="tela-de-download">
      <div className={css.envoltorio}>
        <header className={css.topo}>
          <a className={css.marca} href="/">
            <Marca tamanho={28} variante="cor" />
            <span>{comum.nomeDoApp}</span>
          </a>
          <a className={css.voltar} href="/">
            <SetaEsquerda tamanho={16} />
            <span>{t.voltar}</span>
          </a>
        </header>

        <main className={css.grade}>
          <section className={css.apresentacao}>
            <div className={css.cabecalho}>
              <h1 className={css.titulo}>{t.titulo}</h1>
              <p className={css.subtitulo}>{t.subtitulo}</p>
            </div>

            <div className={css.ctaBloco}>
              <div className={css.ctaLinha}>
                <a
                  className={css.botaoPrincipal}
                  href={`${BASE}${ativo.arquivo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="download-principal"
                >
                  <Baixar tamanho={18} />
                  <span>{t.baixarPara(ativo.sistema)}</span>
                  <span className={css.ctaFormato}>{ativo.formato}</span>
                </a>
                <a
                  className={css.linkSecundario}
                  href={RELEASES}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span>{t.todasAsVersoes}</span>
                  <CantoSuperiorDireito tamanho={14} />
                </a>
              </div>
              <p className={css.meta}>
                {detectado === "macos" ? t.macos : t.fonte}
              </p>
            </div>

            <ul className={css.recursos}>
              {recursos.map((item) => (
                <li key={item.titulo} className={css.recurso}>
                  <span className={css.recursoIcone}>{item.icone}</span>
                  <div className={css.recursoTexto}>
                    <p className={css.recursoTitulo}>{item.titulo}</p>
                    <p className={css.recursoDescricao}>{item.descricao}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <PainelVidro
            como="section"
            variante="sobreposto"
            raio="lg"
            elevacao={3}
            className={css.painel}
            aria-label={t.tituloPacotes}
          >
            <div className={css.painelCabecalho}>
              <h2 className={css.painelTitulo}>{t.tituloPacotes}</h2>
              <p className={css.painelSub}>{t.subtituloPacotes}</p>
            </div>

            <div className={css.listaPacotes} role="list">
              {pacotes.map((pacote) => {
                const ehSelecionado = pacote.id === ativo.id;
                const ehRecomendado = pacote.id === recomendado;
                return (
                  <div
                    key={pacote.id}
                    role="listitem"
                    className={css.pacote}
                    data-selecionado={ehSelecionado ? "true" : undefined}
                  >
                    <button
                      type="button"
                      className={css.pacoteSeletor}
                      aria-pressed={ehSelecionado}
                      onClick={() => {
                        setSelecionado(pacote.id);
                        setCopiado(false);
                      }}
                    >
                      <span className={css.pacoteNomeLinha}>
                        <span className={css.pacoteNome}>{pacote.sistema}</span>
                        {ehRecomendado && (
                          <span className={css.etiquetaSistema}>
                            {t.sinalSeuSistema}
                          </span>
                        )}
                      </span>
                      <span className={css.pacoteMeta}>
                        {pacote.formato} ·{" "}
                        <span className={css.pacoteArquivo}>
                          {pacote.arquivo}
                        </span>
                      </span>
                    </button>

                    <a
                      className={css.pacoteBaixar}
                      href={`${BASE}${pacote.arquivo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t.baixarPara(pacote.sistema)}
                      data-pacote={pacote.id}
                    >
                      <Baixar tamanho={14} />
                      <span>{t.baixar}</span>
                    </a>
                  </div>
                );
              })}
            </div>

            <div className={css.guia} aria-live="polite">
              <h3 className={css.guiaTitulo}>
                {comandoAtivo ? t.instalarNoLinux : t.comoInstalar}
              </h3>
              <p className={css.guiaTexto}>{ativo.instrucao}</p>
              {comandoAtivo && (
                <div className={css.comandoCaixa}>
                  <code className={css.comandoCodigo}>{comandoAtivo}</code>
                  <button
                    type="button"
                    className={css.copiarBotao}
                    onClick={copiarComando}
                    aria-label={copiado ? t.copiado : t.copiarComando}
                  >
                    {copiado ? <Marcar tamanho={14} /> : <Copiar tamanho={14} />}
                    <span>{copiado ? t.copiado : t.copiar}</span>
                  </button>
                </div>
              )}
            </div>

            {detectado !== "macos" && (
              <p className={css.rodapePainel}>{t.macos}</p>
            )}
          </PainelVidro>
        </main>
      </div>
    </FundoVidro>
  );
}
