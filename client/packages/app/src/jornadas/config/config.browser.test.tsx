import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { limparDispositivos } from "nucleo/store/dispositivos";
import { ligarAtalhosDeVoz } from "nucleo/sdk/atalhosDeVoz";
import { abrirConfig, lerConfig, limparConfig } from "nucleo/store/config";
import { ATALHOS_PADRAO, definirAtalho, lerAtalhosDeVoz } from "nucleo/store/atalhosDeVoz";
import { definirAparencia, restaurarAparencia, lerAparencia } from "nucleo/store/aparencia";
import { definirDensidade, lerDensidade } from "nucleo/store/densidade";
import { limparMeuStatus, semearMeuStatus } from "nucleo/store/meuStatus";
import {
  definirNotificacoes,
  lerNotificacoes,
} from "nucleo/store/notificacoes";
import {
  definirPreferenciasDeVoz,
  lerPreferenciasDeVoz,
  constraintsDeAudio,
} from "nucleo/store/preferenciasDeVoz";
import { definirSegurando, lerSegurando, microfoneAberto } from "nucleo/store/pushToTalk";
import type { Dispositivo, ResultadoDeConta } from "nucleo/sdk/perfil";
import { dispensarToast, lerToasts } from "nucleo/ui-logica/toastStore";

import { comum, config } from "../../textos";
import { aplicarTemaSalvo, definirFamilia, definirPersonalizacao, lerFamilia, lerPersonalizacao } from "../../tema/personalizado";
import { PERSONALIZACAO_PADRAO } from "../../tema/personalizar";
import { desmontar, montar } from "../../ui/ds/montar";
import { Avisos } from "../../ui/primitivos/Avisos";
import { CascaDeConfig } from "./CascaDeConfig";

interface Controle {
  eu: { displayName: string; username: string; pronomes: string; bio: string; avatarUrl: string | undefined } | undefined;
  completo: { bio: string; bannerUrl: string | undefined } | undefined;
  email: string | undefined;
  donos: { id: string; nome: string }[];
  chamadas: string[];
  salvo: { nome: string; bio: string | undefined }[];
  recados: string[];
  imagens: { qual: string; id: string | undefined }[];
  uploads: number;
  resultado: ResultadoDeConta;
  dispositivos: readonly Dispositivo[] | undefined;
  devolverFalhaNaLista: boolean;
  senhasUsadas: string[];
  comMidia: boolean;
  lento: Promise<unknown> | undefined;
}

const ctl = vi.hoisted(
  (): Controle => ({
    eu: { displayName: "Rafa", username: "rafa", pronomes: "", bio: "", avatarUrl: undefined },
    completo: { bio: "Oi, sou a Rafa", bannerUrl: undefined },
    email: "rafa@exemplo.com",
    donos: [],
    chamadas: [],
    salvo: [],
    recados: [],
    imagens: [],
    uploads: 0,
    resultado: { ok: true },
    dispositivos: undefined,
    devolverFalhaNaLista: false,
    senhasUsadas: [],
    comMidia: true,
    lento: undefined,
  }),
);

vi.mock("nucleo/sdk/anexos", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  temServidorDeMidia: () => ctl.comMidia,
  subirAnexo: () => {
    ctl.uploads += 1;
    return Promise.resolve("ANEXO1");
  },
}));

vi.mock("nucleo/sdk/perfil", async (original) => {
  const meu = await import("nucleo/store/meuStatus");
  return {
    ...(await original<Record<string, unknown>>()),
    lerMeuPerfil: () => ctl.eu,
    lerMeuPerfilCompleto: () => ctl.lento ?? Promise.resolve(ctl.completo),
    lerMeuEmail: () => Promise.resolve(ctl.email),
    servidoresQueEuDono: () => ctl.donos,
    salvarNomeEBio: (nome: string, bio: string | undefined) => {
      ctl.salvo.push({ nome, bio });
      return Promise.resolve(true);
    },
    definirStatusTexto: (texto: string) => {
      ctl.recados.push(texto);
      meu.definirMeuTextoLocal(texto || undefined);
      return Promise.resolve(true);
    },
    definirPresenca: (p: Parameters<typeof meu.definirMeuStatusLocal>[0]) => {
      meu.definirMeuStatusLocal(p);
      ctl.chamadas.push(`presenca:${p}`);
      return Promise.resolve(true);
    },
    trocarImagemDoPerfil: (qual: string, id: string | undefined) => {
      ctl.imagens.push({ qual, id });
      return Promise.resolve(true);
    },
    trocarSenhaComMotivo: (nova: string, atual: string) => {
      ctl.chamadas.push(`senha:${atual}>${nova}`);
      return Promise.resolve(ctl.resultado);
    },
    trocarEmailComMotivo: (novo: string, senha: string) => {
      ctl.chamadas.push(`email:${novo}:${senha}`);
      return Promise.resolve(ctl.resultado);
    },
    trocarNomeDeUsuarioComMotivo: (novo: string, senha: string) => {
      ctl.chamadas.push(`nome:${novo}:${senha}`);
      return Promise.resolve(ctl.resultado);
    },
    pedirExclusaoComMotivo: (_fator: string, senha: string) => {
      ctl.chamadas.push(`excluir:${senha}`);
      return Promise.resolve(ctl.resultado);
    },
    buscarDispositivos: () => ctl.lento ?? Promise.resolve(ctl.devolverFalhaNaLista ? undefined : ctl.dispositivos),
    derrubarDispositivoComMotivo: (id: string, senha: string) => {
      ctl.chamadas.push(`derrubar:${id}`);
      ctl.senhasUsadas.push(senha);
      return Promise.resolve(senha === "certa" ? OK : ctl.resultado);
    },
    derrubarOutrosComMotivo: (senha: string) => {
      ctl.chamadas.push("derrubarOutros");
      ctl.senhasUsadas.push(senha);
      return Promise.resolve(senha === "certa" ? OK : ctl.resultado);
    },
    renomearDispositivoComMotivo: (id: string, nome: string) => {
      ctl.chamadas.push(`renomear:${id}:${nome}`);
      return Promise.resolve({ ok: true } as ResultadoDeConta);
    },
  };
});

const OK: ResultadoDeConta = { ok: true };
const SENHA_ERRADA: ResultadoDeConta = { ok: false, causa: "senhaIncorreta", motivo: "x" };

beforeEach(async () => {
  await page.viewport(1280, 900);
  // O ponteiro do Playwright não volta sozinho entre testes: ficava onde o anterior clicou (no
  // cartão Floresta, por exemplo) e, quando a casca remontava por baixo dele, o Chrome mandava
  // `mouseenter` sem movimento nenhum — a prévia abria espiando outro tema. Estaciona no canto.
  const canto = document.createElement("div");
  canto.style.cssText = "position:fixed;inset-block-start:0;inset-inline-start:0;inline-size:4px;block-size:4px";
  document.body.append(canto);
  await userEvent.hover(canto);
  canto.remove();
  ctl.eu = { displayName: "Rafa", username: "rafa", pronomes: "", bio: "", avatarUrl: undefined };
  ctl.completo = { bio: "Oi, sou a Rafa", bannerUrl: undefined };
  ctl.email = "rafa@exemplo.com";
  ctl.donos = [];
  ctl.chamadas = [];
  ctl.salvo = [];
  ctl.recados = [];
  ctl.imagens = [];
  ctl.uploads = 0;
  ctl.resultado = { ok: true };
  ctl.dispositivos = [{ id: "S0", nome: "Este navegador", atual: true, desde: Date.UTC(2026, 0, 5) }];
  ctl.devolverFalhaNaLista = false;
  ctl.senhasUsadas = [];
  ctl.comMidia = true;
  ctl.lento = undefined;
  ctl.eu = { displayName: "Rafa", username: "rafa", pronomes: "", bio: "", avatarUrl: undefined };
  semearMeuStatus({ presenca: "online", texto: undefined });
});

afterEach(() => {
  desmontar();
  // O store de avisos é module-level e sobrevive ao `desmontar`: o próximo `<Avisos />` remonta
  // os que sobraram, no canto inferior direito, por cima dos controles do fim da casca. Desde o
  // Radix Toast 1.3 o viewport assenta numa transição, a camada do aviso registra DEPOIS da do
  // diálogo e recebe `pointer-events: auto` — um aviso de erro do perfil (que não expira) passou a
  // interceptar o clique num rádio de voz e vídeo três descrições adiante. Cada teste começa limpo.
  for (const aviso of lerToasts()) dispensarToast(aviso.id);
  limparConfig();
  limparMeuStatus();
  definirSegurando(false);
  definirAtalho("pushToTalk", ATALHOS_PADRAO.pushToTalk);
  definirPreferenciasDeVoz({
    modo: "deteccao",
    ruido: "padrao",
    entradaId: undefined,
    sensibilidadeAutomatica: true,
    atrasoAoSoltarMs: 120,
    sons: true,
    fundo: "nenhum",
  });
  definirPersonalizacao({ ...PERSONALIZACAO_PADRAO });
  definirFamilia("vidro");
  restaurarAparencia();
  definirDensidade("confortavel");
  vi.restoreAllMocks();
});

/** Dois quadros: o React já aplicou as mudanças de store feitas fora de `act`. */
const assentar = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
const texto = () => document.body.textContent;
const botao = (nome: string | RegExp) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    typeof nome === "string" ? (b.getAttribute("aria-label") ?? b.textContent) === nome : nome.test(b.getAttribute("aria-label") ?? b.textContent),
  );
const campo = (rotulo: string) =>
  [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")].find(
    (i) => document.querySelector(`label[for="${i.id}"]`)?.textContent?.startsWith(rotulo) === true,
  );
const alertas = () => [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
const radio = (nome: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => (b.getAttribute("aria-label") ?? b.textContent)?.startsWith(nome));
const interruptor = (nome: string) =>
  document.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${nome}"]`);

async function abrir(secao: Parameters<typeof abrirConfig>[0] = "perfil") {
  montar(
    <>
      <Avisos />
      <CascaDeConfig />
    </>,
  );
  abrirConfig(secao);
  await assentar();
}

describe("a casca", () => {
  it("abre por cima do shell sem desmontá-lo, e Esc devolve a pessoa ao mesmo lugar", async () => {
    montar(
      <>
        <div data-testid="shell" />
        <CascaDeConfig />
      </>,
    );
    const shell = document.querySelector('[data-testid="shell"]');
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    abrirConfig("conta");
    await assentar();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="shell"]')).toBe(shell);

    await userEvent.keyboard("{Escape}");
    await assentar();
    expect(lerConfig().secao).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[data-testid="shell"]')).toBe(shell);
  });

  it("a navegação tem ícones e o fechar mostra a dica Esc e fecha ao clicar", async () => {
    await abrir("perfil");
    const nav = document.querySelector(`nav[aria-label="${config.navegacao}"]`)!;
    const itens = [...nav.querySelectorAll("button[aria-current], button")];
    expect(itens.length).toBeGreaterThan(5);
    for (const item of itens) expect(item.querySelector("svg")).not.toBeNull();
    const fechar = page.getByRole("button", { name: config.fechar });
    await expect.element(fechar).toBeVisible();
    expect(fechar.element().textContent).toContain(config.dicaDeEsc);
    expect(document.querySelectorAll(`[aria-label="${comum.fechar}"]`).length).toBe(0);
    await fechar.click();
    await assentar();
    expect(lerConfig().secao).toBeNull();
  });

  it("navega pelas seis seções e marca a atual", async () => {
    await abrir("perfil");
    const nav = document.querySelector(`nav[aria-label="${config.navegacao}"]`)!;
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe(config.perfil);
    for (const [secao, nome] of [
      ["conta", config.conta],
      ["sessoes", config.dispositivos],
      ["vozEVideo", config.vozEVideo],
      ["notificacoes", config.notificacoes],
      ["aparencia", config.aparencia],
    ] as const) {
      const item = [...nav.querySelectorAll("button")].find((b) => b.textContent === nome)!;
      await userEvent.click(item);
      await assentar();
      expect(lerConfig().secao).toBe(secao);
      expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe(nome);
      expect(document.querySelector("header h2")?.textContent).toBe(nome);
    }
  });

  it("uma seção que não é desta jornada cai no perfil", async () => {
    await abrir("privacidade");
    await assentar();
    expect(lerConfig().secao).toBe("perfil");
  });
});

describe("perfil", () => {
  it("carrega os dados e só então mostra o formulário", async () => {
    let liberar: (v: unknown) => void = () => undefined;
    ctl.lento = new Promise((r) => {
      liberar = r;
    });
    await abrir();
    expect(document.querySelector(`[role="status"][aria-label="${config.carregando}"]`)).not.toBeNull();
    expect(campo(config.perfilTela.sobreVoce)).toBeUndefined();
    liberar({ bio: "Oi", bannerUrl: undefined });
    ctl.lento = undefined;
    await assentar();
    expect((campo(config.perfilTela.sobreVoce) as HTMLTextAreaElement).value).toBe("Oi");
  });

  it("alterações acendem a barra de salvar; descartar volta ao que estava", async () => {
    await abrir();
    expect(texto()).not.toContain(config.barraDeSalvar.recado);
    await userEvent.fill(campo(config.perfilTela.recado)!, "em reunião");
    await assentar();
    expect(texto()).toContain(config.barraDeSalvar.recado);
    await userEvent.click(botao(config.descartarAlteracoes)!);
    await assentar();
    expect((campo(config.perfilTela.recado) as HTMLInputElement).value).toBe("");
    expect(texto()).not.toContain(config.barraDeSalvar.recado);
  });

  it("salva nome, bio e recado, e a barra some", async () => {
    await abrir();
    await userEvent.fill(campo(config.perfilTela.nomeDeExibicao)!, "Rafa Souza");
    await userEvent.fill(campo(config.perfilTela.sobreVoce)!, "Nova bio");
    await userEvent.fill(campo(config.perfilTela.recado)!, "ocupada");
    await userEvent.click(botao(config.salvar)!);
    await assentar();
    expect(ctl.salvo).toEqual([{ nome: "Rafa Souza", bio: "Nova bio" }]);
    expect(ctl.recados).toEqual(["ocupada"]);
    expect(texto()).not.toContain(config.barraDeSalvar.recado);
    expect(texto()).toContain(config.salvouComSucesso);
  });

  it("só o recado alterado não reescreve nome nem bio", async () => {
    await abrir();
    await userEvent.fill(campo(config.perfilTela.recado)!, "almoço");
    await userEvent.click(botao(config.salvar)!);
    await assentar();
    expect(ctl.salvo).toEqual([]);
    expect(ctl.recados).toEqual(["almoço"]);
  });

  it("se a bio não carregou, o campo trava e salvar o nome nunca a apaga", async () => {
    ctl.completo = undefined;
    await abrir();
    const bio = campo(config.perfilTela.sobreVoce) as HTMLTextAreaElement;
    expect(bio.disabled).toBe(true);
    expect(texto()).toContain(config.naoDeuParaCarregar);
    await userEvent.fill(campo(config.perfilTela.nomeDeExibicao)!, "Rafa S");
    await userEvent.click(botao(config.salvar)!);
    await assentar();
    expect(ctl.salvo).toEqual([{ nome: "Rafa S", bio: undefined }]);
  });

  it("a presença vale no clique e a prévia do cartão acompanha", async () => {
    await abrir();
    await userEvent.click(radio(config.perfilTela.presencas.dnd)!);
    await assentar();
    expect(ctl.chamadas).toContain("presenca:dnd");
    expect(radio(config.perfilTela.presencas.dnd)?.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector('[data-testid="previa-do-cartao"]')?.textContent).toContain(config.perfilTela.presencas.dnd);
  });

  it("trocar a foto envia o arquivo, grava no perfil e mostra a nova imagem sem passar pela barra", async () => {
    await abrir();
    const arquivo = new File([new Uint8Array([137, 80, 78, 71])], "foto.png", { type: "image/png" });
    const seletor = document.querySelector<HTMLInputElement>('[data-testid="seletor-de-foto"]')!;
    const dt = new DataTransfer();
    dt.items.add(arquivo);
    seletor.files = dt.files;
    seletor.dispatchEvent(new Event("change", { bubbles: true }));
    await assentar();
    await expect.poll(() => ctl.imagens).toEqual([{ qual: "avatar", id: "ANEXO1" }]);
    expect(document.querySelector('[data-testid="foto-do-perfil"] img')).not.toBeNull();
    expect(texto()).not.toContain(config.barraDeSalvar.recado);
  });

  it("sem servidor de mídia os botões de imagem ficam desligados e a tela diz por quê", async () => {
    ctl.comMidia = false;
    await abrir();
    expect(botao(config.perfilTela.trocarAvatar)!.disabled).toBe(true);
    expect(botao(config.perfilTela.trocarBanner)!.disabled).toBe(true);
    expect(texto()).toContain(config.perfilTela.semMidia);
  });

  it("não aceita arquivo que não é imagem", async () => {
    await abrir();
    const seletor = document.querySelector<HTMLInputElement>('[data-testid="seletor-de-banner"]')!;
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "nota.txt", { type: "text/plain" }));
    seletor.files = dt.files;
    seletor.dispatchEvent(new Event("change", { bubbles: true }));
    await assentar();
    expect(ctl.uploads).toBe(0);
    expect(texto()).toContain(config.perfilTela.imagemInvalida);
  });
});

describe("conta", () => {
  it("mostra o e-mail escondido e revela sob pedido", async () => {
    await abrir("conta");
    expect(texto()).toContain("r***@exemplo.com");
    expect(texto()).not.toContain("rafa@exemplo.com");
    await userEvent.click(botao(config.contaTela.emailMostrar)!);
    await assentar();
    expect(texto()).toContain("rafa@exemplo.com");
  });

  it("e-mail que não carregou diz que não deu para consultar", async () => {
    ctl.email = undefined;
    await abrir("conta");
    expect(texto()).toContain(config.contaTela.emailIndisponivel);
  });

  it("trocar a senha com a atual errada mostra o erro no campo e limpa a senha digitada", async () => {
    ctl.resultado = SENHA_ERRADA;
    await abrir("conta");
    await userEvent.click(botao(config.contaTela.trocarSenha)!);
    await assentar();
    await userEvent.fill(campo(config.contaTela.senhaAtual)!, "errada");
    await userEvent.fill(campo(config.contaTela.senhaNova)!, "uma-senha-nova-1");
    await userEvent.fill(campo(config.contaTela.senhaConfirmar)!, "uma-senha-nova-1");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => alertas()).toContain(config.contaTela.erroSenhaAtual);
    expect((campo(config.contaTela.senhaAtual) as HTMLInputElement).value).toBe("");
    expect(document.querySelector('[role="dialog"] form')).not.toBeNull();
  });

  it("valida senha curta e senhas diferentes antes de ir ao servidor", async () => {
    await abrir("conta");
    await userEvent.click(botao(config.contaTela.trocarSenha)!);
    await assentar();
    await userEvent.fill(campo(config.contaTela.senhaAtual)!, "atual");
    await userEvent.fill(campo(config.contaTela.senhaNova)!, "curta");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => alertas()).toContain(config.contaTela.erroSenhaCurta);
    await userEvent.fill(campo(config.contaTela.senhaNova)!, "uma-senha-nova-1");
    await userEvent.fill(campo(config.contaTela.senhaConfirmar)!, "outra-coisa-1");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => alertas()).toContain(config.contaTela.erroSenhasDiferentes);
    expect(ctl.chamadas).toEqual([]);
  });

  it("troca a senha, fecha o diálogo e avisa", async () => {
    await abrir("conta");
    await userEvent.click(botao(config.contaTela.trocarSenha)!);
    await assentar();
    await userEvent.fill(campo(config.contaTela.senhaAtual)!, "atual-1234");
    await userEvent.fill(campo(config.contaTela.senhaNova)!, "uma-senha-nova-1");
    await userEvent.fill(campo(config.contaTela.senhaConfirmar)!, "uma-senha-nova-1");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => ctl.chamadas).toEqual(["senha:atual-1234>uma-senha-nova-1"]);
    await assentar();
    expect(texto()).toContain(config.contaTela.senhaTrocada);
    expect(campo(config.contaTela.senhaNova)).toBeUndefined();
  });

  it("e-mail em uso aparece no campo do e-mail", async () => {
    ctl.resultado = { ok: false, causa: "emailEmUso", motivo: "x" };
    await abrir("conta");
    await userEvent.click(botao(config.contaTela.trocarEmail)!);
    await assentar();
    await userEvent.fill(campo(config.contaTela.emailNovo)!, "outro@exemplo.com");
    await userEvent.fill(campo(config.contaTela.senhaAtual)!, "atual-1234");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => alertas()).toContain(config.contaTela.erroEmailEmUso);
  });

  it("nome de usuário em uso aparece no campo do nome", async () => {
    ctl.resultado = { ok: false, causa: "nomeEmUso", motivo: "x" };
    await abrir("conta");
    await userEvent.click(botao(config.contaTela.trocarNome)!);
    await assentar();
    await userEvent.fill(campo(config.contaTela.nomeDeUsuario)!, "outra");
    await userEvent.fill(campo(config.contaTela.senhaAtual)!, "atual-1234");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => alertas()).toContain(config.contaTela.erroNomeEmUso);
  });

  it("excluir a conta exige o nome de usuário e a senha, e avisa que o e-mail confirma", async () => {
    await abrir("conta");
    await userEvent.click(botao(config.contaTela.excluirBotao)!);
    await assentar();
    await userEvent.fill(campo(config.contaTela.excluirConfirmarNome)!, "outra-pessoa");
    await userEvent.fill(campo(config.contaTela.senhaAtual)!, "atual-1234");
    await userEvent.keyboard("{Enter}");
    await assentar();
    expect(ctl.chamadas).toEqual([]);
    await userEvent.fill(campo(config.contaTela.excluirConfirmarNome)!, "rafa");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => ctl.chamadas).toEqual(["excluir:atual-1234"]);
    await assentar();
    expect(texto()).toContain(config.contaTela.excluirEnviado);
  });

  it("quem é dono de servidor não pode excluir, e a frase diz quantos", async () => {
    ctl.donos = [
      { id: "S1", nome: "Turma" },
      { id: "S2", nome: "Jogos" },
    ];
    await abrir("conta");
    await userEvent.click(botao(config.contaTela.excluirBotao)!);
    await assentar();
    expect(texto()).toContain(config.contaTela.excluirDono(2));
    await userEvent.click(botao(config.contaTela.excluirConfirmar)!);
    await assentar();
    expect(ctl.chamadas).toEqual([]);
  });
});

describe("dispositivos", () => {
  const outros: Dispositivo[] = [
    { id: "S0", nome: "Este navegador", atual: true, desde: Date.UTC(2026, 0, 5) },
    { id: "S1", nome: "Celular", atual: false, desde: Date.UTC(2026, 0, 3) },
    { id: "S2", nome: "Notebook", atual: false, desde: Date.UTC(2026, 0, 2) },
  ];

  it("só a sessão atual: mostra o estado vazio e nenhum botão de desconectar", async () => {
    await abrir("sessoes");
    expect(document.querySelector('[data-testid="dispositivos-vazio"]')).not.toBeNull();
    expect(texto()).toContain(config.dispositivosTela.vazioTitulo);
    expect(botao(config.dispositivosTela.desconectarTodos)).toBeUndefined();
  });

  it("mostra o carregando enquanto a lista não chega", async () => {
    ctl.lento = new Promise<unknown>(() => undefined);
    await abrir("sessoes");
    expect(document.querySelector(`[role="status"][aria-label="${config.dispositivosTela.carregando}"]`)).not.toBeNull();
  });

  it("falha ao listar não vira lista vazia: diz o erro e deixa tentar de novo", async () => {
    ctl.devolverFalhaNaLista = true;
    await abrir("sessoes");
    expect(alertas()).toContain(config.naoDeuParaCarregar);
    expect(document.querySelector('[data-testid="dispositivos-vazio"]')).toBeNull();
  });

  it("pede a senha uma vez só e reaproveita para os próximos", async () => {
    ctl.dispositivos = outros;
    await abrir("sessoes");
    await userEvent.click(botao(config.dispositivosTela.desconectarRotulo("Celular"))!);
    await assentar();
    expect(texto()).toContain(config.dispositivosTela.confirmeTitulo);
    await userEvent.fill(campo(config.dispositivosTela.senhaAtual)!, "certa");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => ctl.chamadas).toEqual(["derrubar:S1"]);
    await assentar();
    // Segundo dispositivo: nenhum pedido de senha, a ação roda direto com a guardada.
    await userEvent.click(botao(config.dispositivosTela.desconectarRotulo("Notebook"))!);
    await assentar();
    expect(texto()).not.toContain(config.dispositivosTela.confirmeTitulo);
    await expect.poll(() => ctl.chamadas).toEqual(["derrubar:S1", "derrubar:S2"]);
    expect(ctl.senhasUsadas).toEqual(["certa", "certa"]);
  });

  it("senha errada fica no diálogo, com o erro no campo", async () => {
    ctl.dispositivos = outros;
    ctl.resultado = SENHA_ERRADA;
    await abrir("sessoes");
    await userEvent.click(botao(config.dispositivosTela.desconectarTodos)!);
    await assentar();
    await userEvent.fill(campo(config.dispositivosTela.senhaAtual)!, "errada");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => alertas()).toContain(config.dispositivosTela.senhaErro);
    expect(texto()).toContain(config.dispositivosTela.confirmeTitulo);
  });

  it("derrubar os outros desconecta todos menos este e a lista passa a mostrar só este", async () => {
    ctl.dispositivos = outros;
    await abrir("sessoes");
    await userEvent.click(botao(config.dispositivosTela.desconectarTodos)!);
    await assentar();
    await userEvent.fill(campo(config.dispositivosTela.senhaAtual)!, "certa");
    // O servidor passa a listar só a sessão atual.
    ctl.dispositivos = [outros[0]!];
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => ctl.chamadas).toEqual(["derrubarOutros"]);
    await expect.poll(() => document.querySelector('[data-testid="dispositivos-vazio"]')).not.toBeNull();
  });

  it("renomear um dispositivo não pede senha", async () => {
    ctl.dispositivos = outros;
    await abrir("sessoes");
    await userEvent.click(botao(config.dispositivosTela.renomearRotulo("Celular"))!);
    await assentar();
    await userEvent.fill(campo(config.dispositivosTela.nomeDoDispositivo)!, "Celular da Rafa");
    await userEvent.click(botao(config.dispositivosTela.salvarNome)!);
    await expect.poll(() => ctl.chamadas).toEqual(["renomear:S1:Celular da Rafa"]);
  });
});

describe("conta que ainda não chegou", () => {
  for (const secao of ["perfil", "conta"] as const) {
    it(`${secao}: mostra o esqueleto e depois o erro com "Tentar de novo", sem ficar em branco`, async () => {
      ctl.eu = undefined;
      await abrir(secao);
      expect(document.querySelector(`[role="status"][aria-label="${config.carregando}"]`)).not.toBeNull();
      await expect.poll(() => alertas(), { timeout: 6000 }).toContain(config.naoDeuParaCarregar);
      expect(document.querySelector(`[role="status"][aria-label="${config.carregando}"]`)).toBeNull();

      // Os dados chegam e a pessoa tenta de novo: a tela se completa.
      ctl.eu = { displayName: "Rafa", username: "rafa", pronomes: "", bio: "", avatarUrl: undefined };
      await userEvent.click(botao(comum.tentarDeNovo)!);
      await expect.poll(() => alertas()).not.toContain(config.naoDeuParaCarregar);
      await assentar();
      expect(document.querySelector(`[role="status"][aria-label="${config.carregando}"]`)).toBeNull();
      expect(texto()).toContain(secao === "conta" ? "@rafa" : config.perfilTela.sobreVoce);
    });
  }
});

describe("voz e vídeo", () => {
  const colunasDaPagina = () =>
    [...document.querySelectorAll("h3")].find((h) => h.textContent === config.vozTela.audio)?.closest("section")?.parentElement
      ?.parentElement as HTMLElement;

  it("em painel largo divide em duas colunas; em painel estreito, uma", async () => {
    await page.viewport(1440, 900);
    await abrir("vozEVideo");
    const faixas = () => getComputedStyle(colunasDaPagina()).gridTemplateColumns.split(" ").length;
    await expect.poll(() => getComputedStyle(colunasDaPagina()).display).toBe("grid");
    expect(faixas()).toBe(2);
    await page.viewport(900, 900);
    await expect.poll(() => getComputedStyle(colunasDaPagina()).display).toBe("flex");
    await page.viewport(414, 896);
  });

  const dispositivo = (kind: MediaDeviceKind, deviceId: string, label: string) =>
    ({ kind, deviceId, label, groupId: "g" }) as MediaDeviceInfo;
  const simular = (lista: MediaDeviceInfo[]) => {
    limparDispositivos();
    vi.spyOn(navigator.mediaDevices, "enumerateDevices").mockResolvedValue(lista);
  };
  const gatilho = (rotulo: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.getAttribute("aria-labelledby") && document.getElementById(b.getAttribute("aria-labelledby")!)?.textContent === rotulo,
    );

  it("microfone e saída são o menu do app: lista, marca o atual e guarda a escolha pelo teclado", async () => {
    simular([
      dispositivo("audioinput", "mic1", "Microfone USB"),
      dispositivo("audioinput", "mic2", "Headset"),
      dispositivo("audiooutput", "out1", "Alto-falantes"),
    ]);
    await abrir("vozEVideo");
    expect(document.querySelector("select")).toBeNull();
    await expect.poll(() => lerPreferenciasDeVoz().entradaId).toBeUndefined();

    const mic = gatilho(config.vozTela.microfone)!;
    expect(mic.textContent).toContain(config.vozTela.padraoDoSistema);
    mic.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => document.querySelectorAll('[role="menuitemradio"]').length).toBe(3);
    const marcado = () => document.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent;
    expect(marcado()).toBe(config.vozTela.padraoDoSistema);

    await assentar();
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => document.activeElement?.textContent).toBe("Microfone USB");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => lerPreferenciasDeVoz().entradaId).toBe("mic1");
    await assentar();
    expect(gatilho(config.vozTela.microfone)!.textContent).toContain("Microfone USB");

    await userEvent.click(gatilho(config.vozTela.microfone)!);
    await expect.poll(() => marcado()).toBe("Microfone USB");
    await userEvent.keyboard("{Escape}");
  });

  it("sem nenhum dispositivo: só o padrão do sistema e o aviso de que não há outro", async () => {
    simular([]);
    await abrir("vozEVideo");
    await userEvent.click(gatilho(config.vozTela.microfone)!);
    await expect.poll(() => document.querySelectorAll('[role="menuitemradio"]').length).toBe(1);
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(config.vozTela.semMicrofone);
  });

  it("escolher o modo pressionar mostra a tecla e o atraso, e guarda a preferência que o motor lê", async () => {
    await abrir("vozEVideo");
    expect(campo(config.vozTela.atrasoAoSoltar)).toBeUndefined();
    await userEvent.click(radio(config.vozTela.pressionar)!);
    await assentar();
    expect(lerPreferenciasDeVoz().modo).toBe("pressionar");
    expect(campo(config.vozTela.atrasoAoSoltar)).toBeDefined();
    expect(document.querySelector('[data-testid="tecla-de-falar"]')?.textContent).toBe("Alt + Espaço");
  });

  it("push-to-talk de verdade: o microfone só abre enquanto a tecla está segurada", async () => {
    ligarAtalhosDeVoz();
    definirPreferenciasDeVoz({ modo: "pressionar", atrasoAoSoltarMs: 0 });
    await abrir("vozEVideo");
    const aberto = () =>
      microfoneAberto({ mudo: false, surdo: false, modo: lerPreferenciasDeVoz().modo, segurando: lerSegurando() });
    expect(aberto()).toBe(false);

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", altKey: true, bubbles: true }));
    await assentar();
    expect(lerSegurando()).toBe(true);
    expect(aberto()).toBe(true);
    expect(texto()).toContain(config.vozTela.teclaSegurando);

    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", altKey: true, bubbles: true }));
    await assentar();
    expect(lerSegurando()).toBe(false);
    expect(aberto()).toBe(false);
    expect(texto()).not.toContain(config.vozTela.teclaSegurando);

    // Sem mudar o modo para "pressionar", a mesma tecla não decide mais nada.
    definirPreferenciasDeVoz({ modo: "deteccao" });
    expect(microfoneAberto({ mudo: false, surdo: false, modo: "deteccao", segurando: true })).toBe(true);
  });

  it("gravar outra tecla a aplica no mesmo atalho que o motor escuta, e Esc cancela", async () => {
    definirPreferenciasDeVoz({ modo: "pressionar" });
    await abrir("vozEVideo");
    const mudar = botao(config.vozTela.mudarTecla)!;
    await userEvent.click(mudar);
    await assentar();
    expect(texto()).toContain(config.vozTela.gravandoTecla);

    // Esc cancela a gravação sem fechar as configurações.
    mudar.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    await assentar();
    expect(lerAtalhosDeVoz().pushToTalk).toEqual(ATALHOS_PADRAO.pushToTalk);
    expect(lerConfig().secao).toBe("vozEVideo");

    await userEvent.click(botao(config.vozTela.mudarTecla)!);
    await assentar();
    botao(config.vozTela.cancelarGravacao)!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true }),
    );
    await assentar();
    expect(lerAtalhosDeVoz().pushToTalk).toEqual({ codigo: "KeyK", mod: true, alt: false, shift: false });
    expect(document.querySelector('[data-testid="tecla-de-falar"]')?.textContent).toBe("Ctrl + K");
  });

  it("a mesma tecla de outra ação avisa do conflito", async () => {
    definirAtalho("mutar", ATALHOS_PADRAO.pushToTalk);
    definirPreferenciasDeVoz({ modo: "pressionar" });
    await abrir("vozEVideo");
    expect(alertas()).toContain(config.vozTela.teclaEmConflito);
    definirAtalho("mutar", ATALHOS_PADRAO.mutar);
  });

  it("escolher a supressão de ruído guarda o nível e muda as restrições do microfone", async () => {
    await abrir("vozEVideo");
    await userEvent.click(radio(config.vozTela.ruidoNiveis.desligada)!);
    await assentar();
    expect(lerPreferenciasDeVoz().ruido).toBe("desligada");
    expect(constraintsDeAudio().noiseSuppression).toBe(false);
    expect(texto()).toContain(config.vozTela.ruidoAjuda.desligada);
    await userEvent.click(radio(config.vozTela.ruidoNiveis.agressiva)!);
    await assentar();
    expect(lerPreferenciasDeVoz().ruido).toBe("agressiva");
    expect(constraintsDeAudio().noiseSuppression).toBe(true);
  });

  it("escolher o fundo do vídeo guarda a preferência", async () => {
    await abrir("vozEVideo");
    await userEvent.click(radio(config.vozTela.fundos.desfoque)!);
    await assentar();
    expect(lerPreferenciasDeVoz().fundo).toBe("desfoque");
  });

  it("sem microfone, testar mostra o erro com a frase certa", async () => {
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(new DOMException("x", "NotFoundError"));
    await abrir("vozEVideo");
    await userEvent.click(botao(config.vozTela.testarBotao)!);
    await expect.poll(() => alertas()).toContain(config.vozTela.erroSemDispositivo);
  });

  it("microfone negado e microfone em uso têm frases diferentes", async () => {
    const espiao = vi.spyOn(navigator.mediaDevices, "getUserMedia");
    espiao.mockRejectedValue(new DOMException("x", "NotAllowedError"));
    await abrir("vozEVideo");
    await userEvent.click(botao(config.vozTela.testarBotao)!);
    await expect.poll(() => alertas()).toContain(config.vozTela.erroPermissao);
    // Desliga e liga de novo com outro erro.
    await userEvent.click(botao(config.vozTela.pararTeste)!);
    espiao.mockRejectedValue(new DOMException("x", "NotReadableError"));
    await userEvent.click(botao(config.vozTela.testarBotao)!);
    await expect.poll(() => alertas()).toContain(config.vozTela.erroEmUso);
  });

  it("o teste mede o nível de verdade e fecha a faixa ao parar", async () => {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const destino = ctx.createMediaStreamDestination();
    osc.connect(destino);
    osc.start();
    const parados: number[] = [];
    for (const t of destino.stream.getTracks()) {
      const parar = t.stop.bind(t);
      t.stop = () => {
        parados.push(1);
        parar();
      };
    }
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(destino.stream);
    await abrir("vozEVideo");
    await userEvent.click(botao(config.vozTela.testarBotao)!);
    const medidor = () => Number(document.querySelector('[data-testid="medidor-de-entrada"]')?.getAttribute("data-acesas"));
    await expect.poll(medidor, { timeout: 4000 }).toBeGreaterThan(0);
    await userEvent.click(botao(config.vozTela.pararTeste)!);
    await assentar();
    expect(parados.length).toBeGreaterThan(0);
    expect(medidor()).toBe(0);
    void ctx.close();
  });
});

describe("aparência", () => {
  const a = config.aparenciaTela;
  const raiz = () => document.documentElement.style;
  const previa = () => document.querySelector<HTMLElement>('[data-testid="previa-da-paleta"]');
  const abrirPersonalizar = async () => {
    await userEvent.click(botao(a.personalizar)!);
    await assentar();
  };

  it("o tema de fábrica (Vidro) é o padrão e não escreve nada no documento", async () => {
    await abrir("aparencia");
    expect(radio(a.temas.vidro)?.getAttribute("aria-checked")).toBe("true");
    expect(raiz().getPropertyValue("--vx-accent")).toBe("");
    expect(texto()).toContain(a.soEscuro);
    expect(document.querySelectorAll(`[role="radiogroup"][aria-label="${a.temasProntos}"] [role="radio"]`).length).toBeGreaterThanOrEqual(7);
  });

  it("escolher um tema aplica a paleta dele e voltar ao Vidro a remove", async () => {
    await abrir("aparencia");
    await userEvent.click(radio(a.temas.oceano)!);
    await assentar();
    expect(lerPersonalizacao()).toMatchObject({ ativo: true, tema: "oceano", personalizado: false });
    expect(radio(a.temas.oceano)?.getAttribute("aria-checked")).toBe("true");
    expect(radio(a.temas.vidro)?.getAttribute("aria-checked")).toBe("false");
    const acentoOceano = raiz().getPropertyValue("--vx-accent");
    expect(acentoOceano).toMatch(/^#[0-9a-f]{6}$/);

    await userEvent.click(radio(a.temas.brasa)!);
    await assentar();
    expect(raiz().getPropertyValue("--vx-accent")).not.toBe(acentoOceano);

    await userEvent.click(radio(a.temas.vidro)!);
    await assentar();
    expect(raiz().getPropertyValue("--vx-accent")).toBe("");
    expect(raiz().getPropertyValue("--vx-backdrop-base")).toBe("");
  });

  it("personalizar parte do tema escolhido e marca o cartão como personalizado", async () => {
    await abrir("aparencia");
    await userEvent.click(radio(a.temas.ametista)!);
    await assentar();
    const baseDoTema = raiz().getPropertyValue("--vx-backdrop-base");
    expect(texto()).not.toContain(a.personalizado);

    await abrirPersonalizar();
    await userEvent.fill(campo(a.matiz)!, "120");
    await assentar();
    expect(raiz().getPropertyValue("--vx-backdrop-base")).not.toBe(baseDoTema);
    expect(lerPersonalizacao()).toMatchObject({ tema: "ametista", personalizado: true });
    expect(radio(a.temas.ametista)?.textContent).toContain(a.personalizado);

    await userEvent.click(radio(a.destaques.menta)!);
    await assentar();
    expect(radio(a.destaques.menta)?.getAttribute("aria-checked")).toBe("true");

    await userEvent.click(botao(new RegExp(a.voltarAoTema))!);
    await assentar();
    expect(lerPersonalizacao()).toMatchObject({ tema: "ametista", personalizado: false });
    expect(raiz().getPropertyValue("--vx-backdrop-base")).toBe(baseDoTema);
  });

  it("a prévia mostra o tema sob o mouse sem mexer no resto do app", async () => {
    await abrir("aparencia");
    const antes = raiz().getPropertyValue("--vx-accent");
    expect(previa()?.style.getPropertyValue("--vx-accent")).toMatch(/^#[0-9a-f]{6}$/);
    expect(previa()?.getAttribute("aria-label")).toBe(a.previaDe(a.temas.vidro));

    const fundoAntes = previa()?.style.getPropertyValue("--vx-backdrop-base");
    await userEvent.hover(radio(a.temas.brasa)!);
    await assentar();
    expect(previa()?.getAttribute("aria-label")).toBe(a.previaDe(a.temas.brasa));
    expect(previa()?.style.getPropertyValue("--vx-backdrop-base")).not.toBe(fundoAntes);
    // O documento continua como estava: só o contêiner da prévia recebeu as cores.
    expect(raiz().getPropertyValue("--vx-accent")).toBe(antes);
    expect(lerPersonalizacao().tema).toBe("vidro");
    expect(previa()?.querySelector('[data-testid="previa-mencao"]')).not.toBeNull();
    expect(previa()?.textContent).toContain(comum.sinalAoVivo);

    await userEvent.click(radio(a.temas.brasa)!);
    await assentar();
    expect(raiz().getPropertyValue("--vx-accent")).toBe(previa()?.style.getPropertyValue("--vx-accent"));
  });

  it("cor de destaque livre: escura demais é ajustada e a tela mostra o antes e o depois", async () => {
    await abrir("aparencia");
    await abrirPersonalizar();
    const hex = campo(a.campoHex) ?? document.querySelector<HTMLInputElement>(`input[aria-label="${a.campoHex}"]`)!;
    await userEvent.fill(hex, "#00008b");
    await assentar();
    expect(lerPersonalizacao().destaqueLivre).toBe("#00008b");
    expect(texto()).toContain(a.destaqueAjustado);
    const antes = document.querySelector('[data-testid="destaque-Antes"]')?.textContent ?? "";
    const depois = document.querySelector('[data-testid="destaque-Depois"]')?.textContent ?? "";
    expect(antes).toContain("#00008b");
    expect(depois).not.toContain("#00008b");
    expect(raiz().getPropertyValue("--vx-accent")).toMatch(/^#[0-9a-f]{6}$/);
    expect(raiz().getPropertyValue("--vx-accent")).not.toBe("#00008b");

    // Uma cor que já se lê passa direto, sem aviso.
    await userEvent.fill(hex, "#a99bff");
    await assentar();
    expect(lerPersonalizacao().destaqueLivre).toBe("#a99bff");
    expect(texto()).not.toContain(a.destaqueAjustado);

    // Código inválido não troca a cor e avisa.
    await userEvent.fill(hex, "#12");
    await assentar();
    expect(texto()).toContain(a.hexInvalido);
    expect(lerPersonalizacao().destaqueLivre).toBe("#a99bff");
  });

  it("a escolha fica guardada para a próxima abertura", async () => {
    await abrir("aparencia");
    await userEvent.click(radio(a.temas.floresta)!);
    await abrirPersonalizar();
    await userEvent.click(radio(a.destaques.rosa)!);
    await assentar();
    const guardado = JSON.parse(localStorage.getItem("vortex:tema-personalizado") ?? "{}") as Record<string, unknown>;
    expect(guardado).toMatchObject({ ativo: true, tema: "floresta", personalizado: true, destaque: "rosa" });
  });

  describe("escuro ou claro", () => {
    const html = () => document.documentElement;
    const esquema = () => getComputedStyle(html()).colorScheme;
    const token = (nome: string) => getComputedStyle(html()).getPropertyValue(nome).trim();
    // O que o main.tsx faz ao abrir o app, antes da primeira pintura.
    beforeEach(aplicarTemaSalvo);

    it("o escuro é o padrão: três cartões, Escuro marcado, color-scheme escuro", async () => {
      await abrir("aparencia");
      const grupo = document.querySelector(`[role="radiogroup"][aria-label="${a.tema}"]`);
      expect(grupo?.querySelectorAll('[role="radio"]').length).toBe(3);
      expect(radio(a.familias.vidro)?.getAttribute("aria-checked")).toBe("true");
      expect(html().dataset.tema).toBe("vidro");
      expect(esquema()).toBe("dark");
      // A prévia do cartão claro desenha com os tokens do claro, sem mexer no documento.
      const miniClaro = radio(a.familias.claro)?.querySelector<HTMLElement>('[data-tema="claro"]');
      expect(miniClaro).not.toBeNull();
      expect(getComputedStyle(miniClaro!).backgroundColor).toBe("rgb(236, 238, 247)");
    });

    it("trocar para o claro muda o tema e o color-scheme, tira a paleta escura e guarda a escolha", async () => {
      await abrir("aparencia");
      await userEvent.click(radio(a.temas.oceano)!);
      await assentar();
      const acentoOceano = raiz().getPropertyValue("--vx-accent");
      expect(acentoOceano).toMatch(/^#[0-9a-f]{6}$/);

      await userEvent.click(radio(a.familias.claro)!);
      await expect.poll(() => html().dataset.tema).toBe("claro");
      expect(esquema()).toBe("light");
      // Nenhuma cor do tema pronto fica escrita no <html>: valem as do bloco claro.
      expect(raiz().getPropertyValue("--vx-accent")).toBe("");
      expect(raiz().getPropertyValue("--vx-backdrop-base")).toBe("");
      expect(raiz().getPropertyValue("--vx-shadow-selected")).toBe("");
      expect(token("--vx-accent")).toBe("#6848c9");
      expect(token("--vx-surface-solid")).toBe("#fdfdff");
      expect(localStorage.getItem("vortex:tema-familia")).toBe("claro");
      expect(radio(a.familias.claro)?.getAttribute("aria-checked")).toBe("true");
      // A escolha escura continua guardada, só não vale aqui.
      expect(lerPersonalizacao()).toMatchObject({ ativo: true, tema: "oceano" });

      // Sem controle inerte: os temas prontos e o personalizar somem, e a frase diz por quê.
      await expect.poll(() => radio(a.temas.oceano)).toBeUndefined();
      expect(botao(a.personalizar)).toBeUndefined();
      expect(document.querySelector('[data-testid="so-no-escuro"]')?.textContent).toBe(a.soEscuro);
      expect(previa()?.dataset.tema).toBe("claro");
      expect(previa()?.getAttribute("aria-label")).toBe(a.previaDe(a.familias.claro));

      // Voltar ao escuro devolve o tema pronto que estava.
      await userEvent.click(radio(a.familias.vidro)!);
      await expect.poll(() => html().dataset.tema).toBe("vidro");
      expect(esquema()).toBe("dark");
      expect(raiz().getPropertyValue("--vx-accent")).toBe(acentoOceano);
      await expect.poll(() => radio(a.temas.oceano)?.getAttribute("aria-checked")).toBe("true");
    });

    it("a personalização volta inteira ao sair do claro", async () => {
      await abrir("aparencia");
      await abrirPersonalizar();
      await userEvent.click(radio(a.destaques.menta)!);
      await assentar();
      const fundo = raiz().getPropertyValue("--vx-backdrop-base");
      const acento = raiz().getPropertyValue("--vx-accent");
      expect(acento).not.toBe("");

      definirFamilia("claro");
      await expect.poll(() => raiz().getPropertyValue("--vx-accent")).toBe("");
      expect(raiz().getPropertyValue("--vx-backdrop-base")).toBe("");

      definirFamilia("vidro");
      await expect.poll(() => raiz().getPropertyValue("--vx-accent")).toBe(acento);
      expect(raiz().getPropertyValue("--vx-backdrop-base")).toBe(fundo);
      expect(lerPersonalizacao()).toMatchObject({ personalizado: true, destaque: "menta" });
    });

    it("o vidro e o brilho continuam valendo no claro, sobre as superfícies do claro", async () => {
      definirFamilia("claro");
      definirAparencia({ vidro: 0 });
      await expect.poll(() => raiz().getPropertyValue("--vx-surface-glass")).toBe("rgba(251,252,255,1)");
      expect(raiz().getPropertyValue("--vx-backdrop-glass")).toBe("none");
    });

    it("a escolha sobrevive a reabrir o app: o módulo novo lê o claro guardado", async () => {
      definirPersonalizacao({ ...PERSONALIZACAO_PADRAO, ativo: true, tema: "brasa" });
      definirFamilia("claro");
      vi.resetModules();
      const novo = await import("../../tema/personalizado");
      expect(novo.lerFamilia()).toBe("claro");
      const alvo = document.createElement("div");
      novo.aplicarPersonalizacao(novo.lerPersonalizacao(), alvo);
      expect(alvo.dataset.tema).toBe("claro");
      expect(alvo.style.getPropertyValue("--vx-accent")).toBe("");
    });

    it("seguir o sistema acompanha o pedido de cor do sistema", async () => {
      const pedeClaro = { matches: true };
      const original = window.matchMedia.bind(window);
      vi.spyOn(window, "matchMedia").mockImplementation((q: string) =>
        q === "(prefers-color-scheme: light)" ? ({ ...original(q), matches: pedeClaro.matches }) : original(q),
      );
      await abrir("aparencia");
      await userEvent.click(radio(a.familias.sistema)!);
      await expect.poll(() => html().dataset.tema).toBe("claro");
      expect(lerFamilia()).toBe("sistema");
      expect(localStorage.getItem("vortex:tema-familia")).toBe("sistema");

      pedeClaro.matches = false;
      definirFamilia("sistema");
      await expect.poll(() => html().dataset.tema).toBe("vidro");
      expect(esquema()).toBe("dark");
    });
  });

  describe("vidro e fundo", () => {
    const vidro = () => campo(a.vidro) as HTMLInputElement;
    const brilho = () => campo(a.brilho) as HTMLInputElement;
    const painelDaPrevia = () => previa()?.querySelector<HTMLElement>('[class*="vidro"]');
    const mancha = () => previa()?.querySelector<HTMLElement>('[class*="campo"]');

    it("vidro sólido desliga o backdrop-filter e o translúcido o religa", async () => {
      await abrir("aparencia");
      expect(getComputedStyle(painelDaPrevia()!).backdropFilter).toContain("blur");
      await userEvent.fill(vidro(), "0");
      await assentar();
      expect(lerAparencia().vidro).toBe(0);
      expect(raiz().getPropertyValue("--vx-backdrop-glass")).toBe("none");
      expect(getComputedStyle(painelDaPrevia()!).backdropFilter).toBe("none");
      expect(texto()).toContain(a.vidroValor(0));
      expect(getComputedStyle(painelDaPrevia()!).backgroundColor).toMatch(/^rgb\(/);

      await userEvent.fill(vidro(), "100");
      await assentar();
      expect(raiz().getPropertyValue("--vx-backdrop-glass")).toBe("");
      expect(getComputedStyle(painelDaPrevia()!).backdropFilter).toContain("blur");
    });

    it("no meio do controle o desfoque fica mais fraco e a superfície mais opaca", async () => {
      await abrir("aparencia");
      const alfaDe = () => Number(/,\s*([0-9.]+)\)$/.exec(raiz().getPropertyValue("--vx-surface-glass"))?.[1] ?? "1");
      await userEvent.fill(vidro(), "50");
      await assentar();
      expect(raiz().getPropertyValue("--vx-blur-glass")).toBe("14px");
      expect(alfaDe()).toBeGreaterThan(0.52);
      expect(alfaDe()).toBeLessThan(1);
      expect(raiz().getPropertyValue("--vx-backdrop-glass")).toBe("");
    });

    it("o ajuste de vidro vale também no tema espiado na prévia", async () => {
      await abrir("aparencia");
      await userEvent.fill(vidro(), "0");
      await userEvent.hover(radio(a.temas.brasa)!);
      await assentar();
      expect(previa()?.getAttribute("aria-label")).toBe(a.previaDe(a.temas.brasa));
      expect(previa()?.style.getPropertyValue("--vx-backdrop-glass")).toBe("none");
    });

    it("brilho de fundo: reduz a intensidade e, desligado, apaga as manchas", async () => {
      await abrir("aparencia");
      expect(getComputedStyle(mancha()!).display).toBe("block");
      const cheia = Number(getComputedStyle(mancha()!).opacity);
      await userEvent.fill(brilho(), "50");
      await assentar();
      expect(Number(getComputedStyle(mancha()!).opacity)).toBeCloseTo(cheia / 2, 2);
      await userEvent.fill(brilho(), "0");
      await assentar();
      expect(lerAparencia().brilho).toBe(0);
      expect(getComputedStyle(mancha()!).display).toBe("none");
      expect(texto()).toContain(a.brilhoValor(0));
    });

    it("as cores das manchas acompanham o tema escolhido", async () => {
      await abrir("aparencia");
      // Os dois temas são escolhidos AQUI: partir do tema "atual" deixava o teste
      // depender do que um teste anterior gravou no dispositivo (se já fosse Brasa,
      // trocar para Brasa não mudava nada e o teste reprovava sozinho).
      await userEvent.click(radio(a.temas.oceano)!);
      await assentar();
      const antes = getComputedStyle(mancha()!).backgroundColor;
      await userEvent.click(radio(a.temas.brasa)!);
      await assentar();
      await expect.poll(() => getComputedStyle(mancha()!).backgroundColor).not.toBe(antes);
    });

    it("restaurar devolve vidro e brilho ao desenho de fábrica", async () => {
      await abrir("aparencia");
      await userEvent.fill(vidro(), "0");
      await userEvent.fill(brilho(), "0");
      await userEvent.click(botao(a.restaurarAjustes)!);
      await assentar();
      expect(lerAparencia()).toMatchObject({ vidro: 100, brilho: 100 });
      expect(raiz().getPropertyValue("--vx-backdrop-glass")).toBe("");
    });
  });

  describe("mensagens, texto e movimento", () => {
    const campoDoTexto = () => campo(a.tamanhoDoTexto) as HTMLInputElement;
    const interruptorDeMovimento = () => interruptor(a.reduzirAnimacoes)!;
    const paragrafo = () => previa()?.querySelector<HTMLElement>("p[class*='texto']");

    it("compacta tira a foto da prévia, junta as mensagens e fica guardada", async () => {
      await abrir("aparencia");
      // O vão entre as duas mensagens da prévia: a compacta junta as linhas.
      const alturaDe = () => {
        const [m1, m2] = previa()!.querySelectorAll<HTMLElement>("[class*='mensagem']");
        return m2!.getBoundingClientRect().top - m1!.getBoundingClientRect().bottom;
      };
      const confortavel = alturaDe();
      expect(document.documentElement.getAttribute("data-densidade")).toBe("confortavel");
      await userEvent.click(radio(a.compacta)!);
      await assentar();
      expect(lerDensidade()).toBe("compacto");
      expect(document.documentElement.getAttribute("data-densidade")).toBe("compacto");
      expect(radio(a.compacta)?.getAttribute("aria-checked")).toBe("true");
      expect(previa()?.querySelectorAll("[data-compacta]").length).toBe(2);
      expect(previa()?.querySelectorAll('[class*="avatar"]').length).toBe(0);
      expect(alturaDe()).toBeLessThan(confortavel);
      expect(localStorage.getItem("vortex:densidade")).toBe("compacto");

      await userEvent.click(radio(a.confortavel)!);
      await assentar();
      expect(previa()?.querySelectorAll("[data-compacta]").length).toBe(0);
    });

    it("tamanho do texto escala os tokens, e a prévia e a página não estouram a 125%", async () => {
      await abrir("aparencia");
      const base = parseFloat(getComputedStyle(paragrafo()!).fontSize);
      await userEvent.fill(campoDoTexto(), "125");
      await assentar();
      expect(lerAparencia().texto).toBe(125);
      expect(raiz().getPropertyValue("--vx-texto-escala")).toBe("1.25");
      expect(parseFloat(getComputedStyle(paragrafo()!).fontSize)).toBeCloseTo(base * 1.25, 1);
      expect(texto()).toContain(a.tamanhoDoTextoValor(125));
      const prev = previa()!;
      expect(prev.scrollWidth).toBeLessThanOrEqual(prev.clientWidth);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);

      await userEvent.fill(campoDoTexto(), "90");
      await assentar();
      expect(parseFloat(getComputedStyle(paragrafo()!).fontSize)).toBeCloseTo(base * 0.9, 1);

      await userEvent.fill(campoDoTexto(), "100");
      await assentar();
      expect(raiz().getPropertyValue("--vx-texto-escala")).toBe("");
    });

    it("reduzir animações: sem escolha segue o sistema; escolhendo, vale o atributo", async () => {
      await abrir("aparencia");
      const sistema = matchMedia("(prefers-reduced-motion: reduce)").matches;
      expect(interruptorDeMovimento().getAttribute("aria-checked")).toBe(String(sistema));
      expect(document.documentElement.hasAttribute("data-movimento")).toBe(false);

      await userEvent.click(interruptorDeMovimento());
      await assentar();
      expect(lerAparencia().reduzirAnimacoes).toBe(!sistema);
      expect(document.documentElement.getAttribute("data-movimento")).toBe(sistema ? "normal" : "reduzido");

      if (sistema) {
        await userEvent.click(interruptorDeMovimento());
        await assentar();
      }
      const alvo = document.createElement("div");
      alvo.style.transition = "opacity 200ms";
      document.body.append(alvo);
      expect(parseFloat(getComputedStyle(alvo).transitionDuration)).toBeLessThan(0.001);
      alvo.remove();

      await userEvent.click(botao(a.seguirOSistema)!);
      await assentar();
      expect(lerAparencia().reduzirAnimacoes).toBeNull();
      expect(document.documentElement.hasAttribute("data-movimento")).toBe(false);
      expect(botao(a.seguirOSistema)).toBeUndefined();
    });

    it("desligar de volta devolve as transições", async () => {
      await abrir("aparencia");
      const sistema = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (sistema) return;
      await userEvent.click(interruptorDeMovimento());
      await userEvent.click(interruptorDeMovimento());
      await assentar();
      const alvo = document.createElement("div");
      alvo.style.transition = "opacity 200ms";
      document.body.append(alvo);
      expect(parseFloat(getComputedStyle(alvo).transitionDuration)).toBeCloseTo(0.2, 2);
      alvo.remove();
    });
  });
});

describe("notificações", () => {
  it("só lista os eventos que o app dispara hoje", async () => {
    await abrir("notificacoes");
    const rotulos = [...document.querySelectorAll('[role="switch"]')].map((s) => s.getAttribute("aria-label"));
    expect(rotulos).toContain(config.notificacoesTela.notificacaoDe("Mensagem direta"));
    expect(rotulos).not.toContain(config.notificacoesTela.notificacaoDe("Chamada recebida"));
    expect(rotulos).not.toContain(config.notificacoesTela.notificacaoDe("Evento do servidor"));
  });

  it("cada interruptor escreve na matriz que o notificador consulta", async () => {
    await abrir("notificacoes");
    const som = interruptor(config.notificacoesTela.somDe("Mensagem em canal"))!;
    expect(som.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(som);
    await assentar();
    expect(lerNotificacoes().matriz.has("mensagem:som")).toBe(true);
    expect(interruptor(config.notificacoesTela.somDe("Mensagem em canal"))?.getAttribute("aria-checked")).toBe("true");

    const toast = interruptor(config.notificacoesTela.notificacaoDe("Mensagem em canal"))!;
    await userEvent.click(toast);
    await assentar();
    expect(lerNotificacoes().matriz.has("mensagem:toast")).toBe(false);
    definirNotificacoes({ matriz: new Set(["mensagem:toast"]) });
  });

  it("o interruptor dos sons das salas escreve a preferência de voz", async () => {
    await abrir("notificacoes");
    await userEvent.click(interruptor(config.notificacoesTela.sonsDeVoz)!);
    await assentar();
    expect(lerPreferenciasDeVoz().sons).toBe(false);
  });
});
