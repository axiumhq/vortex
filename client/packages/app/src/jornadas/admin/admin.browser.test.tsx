import "../../arnes/redeFalsa";

import {
  RAIZ,
  canaisDeTexto,
  canaisDeVoz,
  categorias,
  channels,
  members,
  membrosOffline,
  membrosOnline,
  presence,
  secoesOnline,
  serverIds,
  servers,
  vozPorCanal,
} from "nucleo/sdk/adapter";
import type { EntradaDeAuditoria, FiltroDeAuditoria, InformacaoDeBanimento } from "nucleo/sdk/auditoria";
import type { Cargo } from "nucleo/sdk/cargos";
import { client } from "nucleo/sdk/client";
import { chaveDeMembro, SEM_CARGO } from "nucleo/sdk/domain";
import { aplicarEventoCru, filas, politicas, POLITICA_PADRAO } from "nucleo/sdk/seguranca";
import type { Banido, Convite, ConviteDoServidor } from "nucleo/sdk/servidores";
import { abrirConfig, limparConfig, lerConfig } from "nucleo/store/config";
import { limparFiltroDeMidia } from "nucleo/store/filtroDeMidia";
import { irParaCasa } from "nucleo/store/navegacao";
import { dispensarToast, lerToasts } from "nucleo/ui-logica/toastStore";
import { definirProntidao } from "nucleo/store/prontidao";
import { abrirServidor, limparUltimoLugar } from "nucleo/store/ultimoLugar";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { quadros } from "../../testes/esperas";
import { admin, permissoesDeAlvo } from "../../textos";
import { desmontar, montar, pegar } from "../../ui/ds/montar";
import { Avisos } from "../../ui/primitivos/Avisos";
import { CascaDeConfig } from "../config/CascaDeConfig";
import { ShellDasSalas } from "../salas/ShellDasSalas";

type Chamada = readonly [string, ...unknown[]];

interface Controle {
  /** Ações permitidas; vazio = ninguém pode nada. `"*"` = tudo. */
  acoes: Set<string>;
  dono: boolean;
  chamadas: Chamada[];
  convites: readonly ConviteDoServidor[] | undefined;
  banidos: readonly Banido[] | undefined;
  cargos: Cargo[];
  padrao: string[];
  topo: number;
  convitePrevia: Convite | { erro: string };
  entrada:
    | { tipo: "entrou"; serverId: string }
    | { tipo: "pedido" }
    | { tipo: "banido" };
  falhaNaLista: boolean;
  auditoria: readonly EntradaDeAuditoria[] | undefined;
  autoria: ReadonlyMap<string, InformacaoDeBanimento> | undefined;
  consultasDeAuditoria: FiltroDeAuditoria[];
  comMidia: boolean;
  lento: Promise<void> | undefined;
  /** Segura a leitura da política de segurança; `true`/`false` é se deu para ler. */
  politicaLenta: Promise<boolean> | undefined;
  falhaNaPermissao: boolean;
}

const ctl = vi.hoisted(
  (): Controle => ({
    acoes: new Set(["*"]),
    dono: false,
    chamadas: [],
    convites: [],
    banidos: [],
    cargos: [],
    padrao: [],
    topo: 0,
    convitePrevia: { erro: "Isso não parece um convite." },
    entrada: { tipo: "entrou", serverId: "S2" },
    falhaNaLista: false,
    auditoria: [],
    autoria: new Map(),
    consultasDeAuditoria: [],
    comMidia: true,
    lento: undefined,
    politicaLenta: undefined,
    falhaNaPermissao: false,
  }),
);

vi.mock("nucleo/sdk/anexos", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  temServidorDeMidia: () => ctl.comMidia,
}));

const registrar = (...c: Chamada) => {
  ctl.chamadas.push(c);
};
const feito = <T,>(valor: T) => Promise.resolve(valor);
const permitido = (acao: string) => ctl.acoes.has("*") || ctl.acoes.has(acao);

vi.mock("nucleo/sdk/permissoes", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  pode: (_canal: string, acao: string) => permitido(acao),
  podeNoServidor: (_servidor: string, acao: string) => permitido(acao),
}));

vi.mock("nucleo/sdk/seguranca", async (original) => {
  const real = await original<typeof import("nucleo/sdk/seguranca")>();
  return {
    ...real,
    podeGerenciarSeguranca: () => permitido("gerenciarServidor"),
    podeModerarPedidos: () => permitido("moderarPedidos"),
    carregarPolitica: (serverId: string) =>
      ctl.politicaLenta ?? real.carregarPolitica(serverId),
    editarPolitica: (
      s: string,
      mudanca: Parameters<typeof real.editarPolitica>[1],
    ) => {
      registrar("editarPolitica", mudanca);
      return real.editarPolitica(s, mudanca);
    },
    aprovarPedido: (_s: string, usuario: string) => {
      registrar("aprovarPedido", usuario);
      return feito(true);
    },
    recusarPedido: (_s: string, usuario: string) => {
      registrar("recusarPedido", usuario);
      return feito(true);
    },
    aprovarTodos: () => {
      registrar("aprovarTodos");
      return feito(undefined);
    },
  };
});

vi.mock("nucleo/sdk/cargos", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  meuAlcance: () => ({
    topo: ctl.topo,
    podeAtribuir: permitido("atribuirCargos"),
    podeEditarCargos: permitido("gerenciarCargos"),
    podeEditarPermissoes: permitido("gerenciarCargos"),
  }),
  cargosDoServidor: () => ctl.cargos,
  listarCargos: () => feito(ctl.cargos),
  lerPermissoesPadrao: () => ctl.padrao,
  pessoasDoServidor: (_s: string, ids: readonly string[]) =>
    ids.map((id) => ({
      id,
      nome: members.getSnapshot(chaveDeMembro("S1", id))?.displayName ?? id,
      username: members.getSnapshot(chaveDeMembro("S1", id))?.username ?? id,
      cargosIds: members.getSnapshot(chaveDeMembro("S1", id))?.cargosIds ?? [],
      editavel: true,
    })),
  criarCargo: (_s: string, nome: string) => {
    registrar("criarCargo", nome);
    return feito("R9");
  },
  salvarCargo: (
    _s: string,
    id: string,
    nome: string,
    cor: string | undefined,
    destacado: boolean,
  ) => {
    registrar("salvarCargo", id, nome, cor, destacado);
    return feito(true);
  },
  salvarPermissoes: (_s: string, id: string, ids: readonly string[]) => {
    registrar("salvarPermissoes", id, [...ids].sort());
    return feito(true);
  },
  salvarPermissoesPadrao: (_s: string, ids: readonly string[]) => {
    registrar("salvarPermissoesPadrao", [...ids].sort());
    return feito(true);
  },
  apagarCargo: (_s: string, id: string) => {
    registrar("apagarCargo", id);
    return feito(true);
  },
  reordenarCargos: (_s: string, ids: readonly string[]) => {
    registrar("reordenarCargos", [...ids]);
    return feito(true);
  },
  alternarCargo: (_s: string, usuario: string, cargo: string) => {
    registrar("alternarCargo", usuario, cargo);
    return feito(true);
  },
  moderarVoz: () => feito(true),
  moverParaCanalDeVoz: () => feito(true),
}));

vi.mock("nucleo/sdk/auditoria", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  // Imita o servidor: filtra por tipo e autor, ordena do mais recente e pagina pelo id da entrada.
  listarAuditoria: (_s: string, f: FiltroDeAuditoria = {}) => {
    ctl.consultasDeAuditoria.push(f);
    if (ctl.auditoria === undefined) return feito(undefined);
    let lista = ctl.auditoria.filter(
      (e) => (f.tipo === undefined || e.tipo === f.tipo) && (f.autorId === undefined || e.autorId === f.autorId),
    );
    if (f.antesDe !== undefined) {
      const i = lista.findIndex((e) => e.id === f.antesDe);
      lista = i < 0 ? [] : lista.slice(i + 1);
    }
    return feito(lista.slice(0, f.limite ?? 50));
  },
  autoriaDosBanimentos: () => feito(ctl.autoria),
}));

vi.mock("nucleo/sdk/canal", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  salvarPermissaoDeCanal: (
    canal: string,
    cargo: string | undefined,
    o: { allow: bigint; deny: bigint },
  ) => {
    registrar("salvarPermissaoDeCanal", canal, cargo, o.allow, o.deny);
    return feito(!ctl.falhaNaPermissao);
  },
}));

vi.mock("nucleo/sdk/categorias", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  conjuntoDoCanal: () => ({ padrao: undefined, cargos: {} }),
  conjuntoDaCategoriaPorId: () => ({ padrao: undefined, cargos: {} }),
  salvarPermissoesDaCategoria: (
    _s: string,
    categoria: string,
    c: {
      padrao?: { allow: bigint; deny: bigint };
      cargos: Record<string, { allow: bigint; deny: bigint }>;
    },
  ) => {
    registrar(
      "salvarPermissoesDaCategoria",
      categoria,
      c.padrao?.allow,
      c.padrao?.deny,
      Object.keys(c.cargos),
    );
    return feito(!ctl.falhaNaPermissao);
  },
}));

vi.mock("nucleo/sdk/moderacao", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  expulsarEmLote: (_s: string, ids: readonly string[]) => {
    registrar("expulsar", [...ids]);
    return feito({ feitos: ids, falhas: [] });
  },
  banirEmLote: (_s: string, ids: readonly string[], opcoes: object) => {
    registrar("banir", [...ids], opcoes);
    return feito({ feitos: ids, falhas: [] });
  },
  castigarEmLote: (
    _s: string,
    ids: readonly string[],
    opcoes: { minutos: number },
  ) => {
    registrar("castigar", [...ids], opcoes.minutos);
    return feito({ feitos: ids, falhas: [] });
  },
}));

vi.mock("nucleo/sdk/servidores", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  carregarMembros: () => feito(!ctl.falhaNaLista),
  souDono: () => ctl.dono,
  listarConvites: () =>
    ctl.falhaNaLista
      ? feito(undefined)
      : (ctl.lento ?? feito(undefined)).then(() => ctl.convites),
  revogarConvite: (_s: string, codigo: string) => {
    registrar("revogarConvite", codigo);
    ctl.convites = (ctl.convites ?? []).filter((c) => c.codigo !== codigo);
    return feito(true);
  },
  criarConvite: (canal: string) => {
    registrar("criarConvite", canal);
    return feito("NOVO123");
  },
  listarBanidos: () =>
    ctl.falhaNaLista ? feito(undefined) : feito(ctl.banidos),
  perdoar: (_s: string, usuario: string) => {
    registrar("perdoar", usuario);
    ctl.banidos = (ctl.banidos ?? []).filter((b) => b.userId !== usuario);
    return feito(true);
  },
  criarCanal: (_s: string, nome: string, voz: boolean, categoria: string) => {
    registrar("criarCanal", nome, voz, categoria);
    return feito("NOVOCANAL");
  },
  renomearCanal: (id: string, nome: string, topico: string | undefined) => {
    registrar("renomearCanal", id, nome, topico);
    return feito(true);
  },
  apagarCanal: (id: string) => {
    registrar("apagarCanal", id);
    return feito(true);
  },
  duplicarCanal: (id: string) => {
    registrar("duplicarCanal", id);
    return feito("COPIA");
  },
  moverCanaisParaCategoria: (
    _s: string,
    categoria: string,
    ordem: readonly string[],
  ) => {
    registrar("moverCanais", categoria, [...ordem]);
    return feito(true);
  },
  criarCategoriaEDevolverId: (_s: string, nome: string) => {
    registrar("criarCategoria", nome);
    return feito("CATNOVA");
  },
  renomearCategoria: () => feito(true),
  apagarCategoria: (_s: string, id: string) => {
    registrar("apagarCategoria", id);
    return feito(true);
  },
  criarServidor: (
    nome: string,
    categoria: string,
    canais: readonly object[],
  ) => {
    registrar("criarServidor", nome, categoria, canais);
    return feito("S2");
  },
  buscarConvite: () => feito(ctl.convitePrevia),
  entrarPorConvite: (codigo: string) => {
    registrar("entrarPorConvite", codigo);
    return feito(ctl.entrada);
  },
  sairDoServidor: (_s: string, silencioso: boolean) => {
    registrar("sair", silencioso);
    return feito(true);
  },
  transferirPropriedade: (_s: string, novoDono: string) => {
    registrar("transferir", novoDono);
    return feito(true);
  },
  salvarServidor: (_s: string, nome: string, descricao: string) => {
    registrar("salvarServidor", nome, descricao);
    return feito(true);
  },
}));

const S = "S1";
const parcial = <T,>(v: object) => v as unknown as T;

const cargo = (
  id: string,
  nome: string,
  rank: number,
  concedidas: string[] = [],
): Cargo => ({
  id,
  nome,
  cor: undefined,
  destacado: false,
  mencionavel: false,
  rank,
  concedidas,
  iconeUrl: undefined,
});

function canal(id: string, name: string, tipo: "texto" | "voz") {
  channels.set(
    id,
    parcial({
      id,
      serverId: S,
      name,
      tipo,
      topico: undefined,
      naoLidas: 0,
      mencoes: 0,
      silenciado: false,
    }),
  );
}

function pessoa(id: string, nome: string, extra: object = {}) {
  members.set(
    chaveDeMembro(S, id),
    parcial({
      id,
      displayName: nome,
      username: nome.toLowerCase(),
      sigla: nome.slice(0, 2),
      avatarUrl: undefined,
      statusTexto: undefined,
      cargosIds: [],
      silenciadoAte: undefined,
      entrouEm: "3 abr 2026",
      abaixoDeMim: true,
      ...extra,
    }),
  );
  presence.set(id, "online");
}

function semear() {
  serverIds.set(RAIZ, [S]);
  servers.set(
    S,
    parcial({
      id: S,
      name: "Grupo",
      sigla: "GR",
      naoLidas: 0,
      mencoes: 0,
      avatarUrl: undefined,
      descricao: "Para jogar",
    }),
  );
  canaisDeTexto.set(S, ["T1", "T2"]);
  canaisDeVoz.set(S, ["V1"]);
  canal("T1", "geral", "texto");
  canal("T2", "avisos", "texto");
  canal("V1", "Jogatina", "voz");
  vozPorCanal.set("V1", []);
  categorias.set(S, [
    { id: "CAT", titulo: "Salas", canais: ["V1", "T1"] },
    { id: "default", titulo: undefined, canais: ["T2"] },
  ]);
  pessoa("U1", "Ana", { cargosIds: ["R1"] });
  pessoa("U2", "Caio");
  pessoa("U3", "Eva", { silenciadoAte: Date.now() + 3_600_000 });
  pessoa("U4", "Davi", { abaixoDeMim: false });
  membrosOnline.set(S, ["U1", "U2", "U3", "U4"]);
  membrosOffline.set(S, []);
  secoesOnline.set(S, [
    {
      id: SEM_CARGO,
      rotulo: "online",
      cor: undefined,
      ids: ["U1", "U2", "U3", "U4"],
    },
  ]);
}

beforeEach(() => {
  // O aviso de um teste anterior ficaria por cima do botão que o próximo clica.
  for (const t of lerToasts()) dispensarToast(t.id);
  document.documentElement.dataset.tema = "vidro";
  localStorage.clear();
  limparUltimoLugar();
  limparConfig();
  irParaCasa();
  ctl.acoes = new Set(["*"]);
  ctl.dono = false;
  ctl.chamadas = [];
  ctl.convites = [];
  ctl.banidos = [];
  ctl.cargos = [
    cargo("R1", "Moderação", 1, ["KickMembers", "BanMembers"]),
    cargo("R2", "Artistas", 2),
  ];
  ctl.padrao = ["ViewChannel", "SendMessage"];
  ctl.topo = 0;
  ctl.convitePrevia = { erro: "Isso não parece um convite." };
  ctl.entrada = { tipo: "entrou", serverId: "S2" };
  ctl.falhaNaLista = false;
  ctl.auditoria = [];
  ctl.autoria = new Map();
  ctl.consultasDeAuditoria = [];
  ctl.comMidia = true;
  ctl.lento = undefined;
  ctl.politicaLenta = undefined;
  ctl.falhaNaPermissao = false;
  politicas.set(S, POLITICA_PADRAO);
  limparFiltroDeMidia();
  definirProntidao(true);
  semear();
});
afterEach(() => {
  desmontar();
  limparConfig();
  definirProntidao(false);
});

async function abrirSecao(secao: Parameters<typeof abrirConfig>[0]) {
  await page.viewport(1600, 900);
  abrirConfig(secao, S);
  montar(
    <>
      <CascaDeConfig />
      <Avisos />
    </>,
  );
  await expect.element(page.getByRole("dialog")).toBeVisible();
}

async function abrirShell() {
  await page.viewport(1600, 900);
  abrirServidor(S);
  montar(
    <div style={{ inlineSize: "1600px", blockSize: "860px" }}>
      <ShellDasSalas />
      <CascaDeConfig />
      <Avisos />
    </div>,
  );
  await expect
    .element(page.getByRole("heading", { name: "Grupo", level: 2 }))
    .toBeVisible();
}

const nav = () =>
  page.getByRole("navigation", { name: admin.navegacao.rotulo });
const chamou = (nome: string) => ctl.chamadas.filter((c) => c[0] === nome);

describe("navegação das configurações do servidor", () => {
  it("mostra as oito seções, em três grupos, para quem administra tudo", async () => {
    await abrirSecao("servidor");
    for (const nome of Object.values(admin.navegacao).filter(
      (n) =>
        !n.startsWith("Seções") &&
        n !== "Servidor" &&
        n !== "Pessoas" &&
        n !== "Moderação",
    )) {
      await expect
        .element(nav().getByRole("button", { name: nome, exact: true }))
        .toBeVisible();
    }
    expect(nav().element().querySelectorAll("button").length).toBe(9);
  });

  it("deixa AUSENTE (não cinza) a seção que a pessoa não pode usar", async () => {
    ctl.acoes = new Set(["gerenciarCanais"]);
    await abrirSecao("canais");
    const botoes = [...nav().element().querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    expect(botoes).toEqual([admin.navegacao.salasECanais]);
    expect(nav().element().querySelector("[disabled]")).toBeNull();
  });

  it("abrir uma seção proibida cai na primeira permitida", async () => {
    ctl.acoes = new Set(["banir"]);
    await abrirSecao("cargos");
    await expect.poll(() => lerConfig().secao).toBe("membros");
  });

  it("sem nenhuma permissão cai nas configurações pessoais", async () => {
    ctl.acoes = new Set();
    await abrirSecao("canais");
    await expect.poll(() => lerConfig().secao).toBe("perfil");
  });
});

describe("menu do servidor", () => {
  it("quem administra vê convidar, criar sala, configurações e sair", async () => {
    await abrirShell();
    await page.getByRole("button", { name: admin.menu.abrir }).click();
    for (const nome of [
      admin.menu.convidar,
      admin.canaisPagina.criar,
      admin.menu.configuracoes,
      admin.menu.sair,
    ]) {
      await expect
        .element(page.getByRole("menuitem", { name: nome }))
        .toBeVisible();
    }
  });

  it("um membro comum só vê sair — as outras ações não existem", async () => {
    ctl.acoes = new Set();
    await abrirShell();
    await page.getByRole("button", { name: admin.menu.abrir }).click();
    await expect
      .element(page.getByRole("menuitem", { name: admin.menu.sair }))
      .toBeVisible();
    expect(document.querySelectorAll('[role="menuitem"]').length).toBe(1);
  });

  it("o dono lê 'apagar o servidor' no lugar de sair", async () => {
    ctl.dono = true;
    await abrirShell();
    await page.getByRole("button", { name: admin.menu.abrir }).click();
    await expect
      .element(page.getByRole("menuitem", { name: admin.menu.apagar }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain(admin.menu.sair);
  });

  it("configurações do servidor abre a primeira seção permitida", async () => {
    ctl.acoes = new Set(["gerenciarCargos"]);
    await abrirShell();
    await page.getByRole("button", { name: admin.menu.abrir }).click();
    await page
      .getByRole("menuitem", { name: admin.menu.configuracoes })
      .click();
    await expect.poll(() => lerConfig().secao).toBe("cargos");
    expect(lerConfig().serverId).toBe(S);
  });
});

describe("sair do servidor", () => {
  it("para quem é membro, é sair — e diz que dá para voltar", async () => {
    await abrirShell();
    await page.getByRole("button", { name: admin.menu.abrir }).click();
    await page.getByRole("menuitem", { name: admin.menu.sair }).click();
    await expect
      .element(
        page.getByRole("dialog", { name: admin.sair.tituloMembro("Grupo") }),
      )
      .toBeVisible();
    expect(document.body.textContent).toContain(admin.sair.textoMembro);
    await page
      .getByRole("button", { name: admin.sair.confirmarMembro, exact: true })
      .click();
    await expect.poll(() => chamou("sair").length).toBe(1);
  });

  it("para o dono diz que o servidor será APAGADO e exige o nome digitado", async () => {
    ctl.dono = true;
    await abrirShell();
    await page.getByRole("button", { name: admin.menu.abrir }).click();
    await page.getByRole("menuitem", { name: admin.menu.apagar }).click();
    await expect
      .element(
        page.getByRole("dialog", { name: admin.sair.tituloDono("Grupo") }),
      )
      .toBeVisible();
    expect(document.body.textContent).toContain("apagado para todo mundo");
    await expect
      .element(page.getByRole("button", { name: admin.sair.transferir }))
      .toBeVisible();
    // Sem o nome, o botão não faz nada.
    await page.getByRole("button", { name: admin.sair.confirmarDono }).click();
    expect(chamou("sair")).toHaveLength(0);
    await page.getByLabelText(/Para confirmar/).fill("Grupo");
    await page.getByRole("button", { name: admin.sair.confirmarDono }).click();
    await expect.poll(() => chamou("sair").length).toBe(1);
  });

  it("transferir a propriedade chama a transferência para a pessoa escolhida", async () => {
    ctl.dono = true;
    await abrirShell();
    await page.getByRole("button", { name: admin.menu.abrir }).click();
    await page.getByRole("menuitem", { name: admin.menu.apagar }).click();
    await page.getByRole("button", { name: admin.sair.transferir }).click();
    await expect
      .element(page.getByRole("dialog", { name: admin.transferir.titulo }))
      .toBeVisible();
    await page.getByLabelText(admin.transferir.para).selectOptions("U2");
    await page
      .getByRole("dialog", { name: admin.transferir.titulo })
      .getByLabelText(/Para confirmar/)
      .fill("Grupo");
    await page
      .getByRole("button", { name: admin.transferir.confirmar, exact: true })
      .click();
    await expect
      .poll(() => chamou("transferir"))
      .toEqual([["transferir", "U2"]]);
  });
});

describe("criar servidor", () => {
  it("o '+' da dock cria um servidor com a sala inicial e abre o novo", async () => {
    await abrirShell();
    await page
      .getByRole("button", { name: admin.criarServidor.titulo })
      .click();
    await expect
      .element(page.getByRole("dialog", { name: admin.criarServidor.titulo }))
      .toBeVisible();
    // Nome vazio: erro dito, nada chamado.
    await page.getByRole("button", { name: admin.criarServidor.criar }).click();
    await expect
      .element(page.getByText(admin.criarServidor.nomeObrigatorio))
      .toBeVisible();
    expect(chamou("criarServidor")).toHaveLength(0);

    await page.getByLabelText(admin.criarServidor.nome).fill("Jogatina");
    await page.getByRole("button", { name: admin.criarServidor.criar }).click();
    await expect.poll(() => chamou("criarServidor").length).toBe(1);
    expect(chamou("criarServidor")[0]?.[1]).toBe("Jogatina");
    expect(chamou("criarServidor")[0]?.[3]).toEqual([
      { nome: "Geral", voz: true },
    ]);
  });

  it("entrar com convite mostra a prévia do servidor antes de entrar", async () => {
    ctl.convitePrevia = parcial<Convite>({
      codigo: "abc",
      serverId: "S2",
      nomeDoServidor: "Trampo",
      membros: 12,
      jaSouMembro: false,
      iconeUrl: undefined,
    });
    await abrirShell();
    await page
      .getByRole("button", { name: admin.criarServidor.titulo })
      .click();
    await page
      .getByRole("tab", { name: admin.criarServidor.abaEntrar })
      .click();
    // Sem convite digitado o botão não faz nada.
    await page
      .getByRole("button", { name: admin.criarServidor.entrar })
      .click();
    expect(chamou("entrarPorConvite")).toHaveLength(0);

    await page.getByLabelText(admin.criarServidor.convite).fill("abc");
    await expect.element(page.getByTestId("previa-do-convite")).toBeVisible();
    expect(pegar('[data-testid="previa-do-convite"]')?.textContent).toContain(
      "Trampo",
    );
    expect(pegar('[data-testid="previa-do-convite"]')?.textContent).toContain(
      "12 pessoas",
    );
    await page
      .getByRole("button", { name: admin.criarServidor.entrar })
      .click();
    await expect
      .poll(() => chamou("entrarPorConvite"))
      .toEqual([["entrarPorConvite", "abc"]]);
  });

  it("convite inválido diz o motivo e não deixa entrar", async () => {
    await abrirShell();
    await page
      .getByRole("button", { name: admin.criarServidor.titulo })
      .click();
    await page
      .getByRole("tab", { name: admin.criarServidor.abaEntrar })
      .click();
    await page.getByLabelText(admin.criarServidor.convite).fill("lixo");
    await expect
      .element(page.getByText("Isso não parece um convite."))
      .toBeVisible();
    await page
      .getByRole("button", { name: admin.criarServidor.entrar })
      .click();
    expect(chamou("entrarPorConvite")).toHaveLength(0);
  });

  it("banido e pedido pendente são desfechos próprios, com frase", async () => {
    ctl.convitePrevia = parcial<Convite>({
      codigo: "abc",
      serverId: "S2",
      nomeDoServidor: "Trampo",
      membros: 1,
      jaSouMembro: false,
    });
    ctl.entrada = { tipo: "banido" };
    await abrirShell();
    await page
      .getByRole("button", { name: admin.criarServidor.titulo })
      .click();
    await page
      .getByRole("tab", { name: admin.criarServidor.abaEntrar })
      .click();
    await page.getByLabelText(admin.criarServidor.convite).fill("abc");
    await expect.element(page.getByTestId("previa-do-convite")).toBeVisible();
    await page
      .getByRole("button", { name: admin.criarServidor.entrar })
      .click();
    await expect
      .element(page.getByText(admin.criarServidor.banido))
      .toBeVisible();
  });
});

describe("salas e canais", () => {
  it("lista as categorias com os canais e o tipo de cada um", async () => {
    await abrirSecao("canais");
    const linhas = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid="linha-de-canal"]',
      ),
    ];
    expect(linhas.map((l) => [l.dataset.canal, l.dataset.tipo])).toEqual([
      ["V1", "voz"],
      ["T1", "texto"],
      ["T2", "texto"],
    ]);
    expect(document.body.textContent).toContain(
      admin.canaisPagina.semCategoria,
    );
  });

  it("as ações da linha só aparecem com o ponteiro ou o foco, e apagar é de perigo", async () => {
    await abrirSecao("canais");
    const linha = document.querySelector<HTMLElement>(
      '[data-testid="linha-de-canal"][data-canal="T1"]',
    );
    if (!linha) throw new Error("linha T1 não montou");
    const grupo = linha.lastElementChild as HTMLElement;
    const opacidade = () => getComputedStyle(grupo).opacity;
    await expect.poll(opacidade).toBe("0");
    await page.getByTestId("linha-de-canal").nth(1).hover();
    await expect.poll(opacidade).toBe("1");
    await page.getByTestId("linha-de-canal").nth(2).hover();
    await expect.poll(opacidade).toBe("0");
    // Teclado: o foco dentro da linha acende o grupo.
    linha
      .querySelector<HTMLButtonElement>("button:not([aria-disabled])")
      ?.focus();
    await expect.poll(opacidade).toBe("1");
    const apagar = linha.querySelector<HTMLElement>(
      `[aria-label="${admin.canaisPagina.apagar("geral")}"]`,
    );
    expect(apagar).not.toBeNull();
    expect(getComputedStyle(apagar as HTMLElement).color).not.toBe(
      getComputedStyle(linha).color,
    );
  });

  it("servidor sem nenhum canal mostra o vazio com a próxima ação", async () => {
    categorias.set(S, []);
    await abrirSecao("canais");
    await expect.element(page.getByTestId("estado-vazio")).toBeVisible();
    expect(pegar('[data-testid="estado-vazio"]')?.textContent).toContain(
      admin.canaisPagina.vazio,
    );
  });

  it("cria uma sala de voz na categoria escolhida; nome vazio é erro dito", async () => {
    await abrirSecao("canais");
    await page
      .getByRole("button", { name: admin.canaisPagina.criar, exact: true })
      .click();
    await expect
      .element(
        page.getByRole("dialog", { name: admin.canaisPagina.criarTitulo }),
      )
      .toBeVisible();
    await page
      .getByRole("button", { name: admin.canaisPagina.criarConfirmar })
      .click();
    await expect
      .element(page.getByText(admin.canaisPagina.nomeObrigatorio))
      .toBeVisible();
    expect(chamou("criarCanal")).toHaveLength(0);

    await page
      .getByLabelText(admin.canaisPagina.nome, { exact: true })
      .fill("Estudo");
    await page
      .getByRole("button", { name: admin.canaisPagina.criarConfirmar })
      .click();
    await expect
      .poll(() => chamou("criarCanal"))
      .toEqual([["criarCanal", "Estudo", true, "CAT"]]);
  });

  it("cria um canal de texto quando escolhido", async () => {
    await abrirSecao("canais");
    await page
      .getByRole("button", { name: admin.canaisPagina.criar, exact: true })
      .click();
    await page.getByRole("radio", { name: admin.canaisPagina.canal }).click();
    await page
      .getByLabelText(admin.canaisPagina.nome, { exact: true })
      .fill("links");
    await page
      .getByRole("button", { name: admin.canaisPagina.criarConfirmar })
      .click();
    await expect
      .poll(() => chamou("criarCanal"))
      .toEqual([["criarCanal", "links", false, "CAT"]]);
  });

  it("editar renomeia, duplicar e apagar passam pela confirmação", async () => {
    await abrirSecao("canais");
    await page
      .getByRole("button", { name: admin.canaisPagina.editar("geral") })
      .click();
    const campo = page.getByLabelText(admin.canaisPagina.nome, { exact: true });
    await expect.element(campo).toHaveValue("geral");
    await campo.fill("conversa");
    await page
      .getByRole("button", { name: admin.canaisPagina.salvarConfirmar })
      .click();
    await expect
      .poll(() => chamou("renomearCanal"))
      .toEqual([["renomearCanal", "T1", "conversa", ""]]);

    await page
      .getByRole("button", { name: admin.canaisPagina.duplicar("avisos") })
      .click();
    await expect
      .poll(() => chamou("duplicarCanal"))
      .toEqual([["duplicarCanal", "T2"]]);

    await page
      .getByRole("button", { name: admin.canaisPagina.apagar("avisos") })
      .click();
    await expect
      .element(
        page.getByRole("dialog", {
          name: admin.canaisPagina.apagarTitulo("avisos"),
        }),
      )
      .toBeVisible();
    expect(chamou("apagarCanal")).toHaveLength(0);
    await page
      .getByRole("button", { name: admin.canaisPagina.apagarConfirmar })
      .click();
    await expect
      .poll(() => chamou("apagarCanal"))
      .toEqual([["apagarCanal", "T2"]]);
  });

  it("mover para outra categoria é uma escolha na edição, e só escreve se mudou", async () => {
    await abrirSecao("canais");
    await page
      .getByRole("button", { name: admin.canaisPagina.editar("geral") })
      .click();
    await page
      .getByRole("button", { name: admin.canaisPagina.salvarConfirmar })
      .click();
    await expect.poll(() => chamou("renomearCanal").length).toBe(1);
    expect(chamou("moverCanais")).toHaveLength(0);

    await page
      .getByRole("button", { name: admin.canaisPagina.editar("avisos") })
      .click();
    await page
      .getByLabelText(admin.canaisPagina.categoria, { exact: true })
      .selectOptions("CAT");
    await page
      .getByRole("button", { name: admin.canaisPagina.salvarConfirmar })
      .click();
    await expect
      .poll(() => chamou("moverCanais"))
      .toEqual([["moverCanais", "CAT", ["T2"]]]);
  });

  it("apagar uma sala avisa que quem está nela é desconectado", async () => {
    await abrirSecao("canais");
    await page
      .getByRole("button", { name: admin.canaisPagina.apagar("Jogatina") })
      .click();
    expect(document.body.textContent).toContain(admin.canaisPagina.apagarSala);
  });

  it("subir e descer reordenam dentro da categoria; as pontas não têm seta", async () => {
    await abrirSecao("canais");
    expect(
      page
        .getByRole("button", { name: admin.canaisPagina.subir("Jogatina") })
        .element(),
    ).toHaveProperty("disabled", true);
    await page
      .getByRole("button", { name: admin.canaisPagina.descer("Jogatina") })
      .click();
    await expect
      .poll(() => chamou("moverCanais"))
      .toEqual([["moverCanais", "CAT", ["T1", "V1"]]]);
  });
});

describe("convites", () => {
  it("mostra 'carregando' enquanto a lista não chega", async () => {
    let soltar: () => void = () => undefined;
    ctl.lento = new Promise<void>((r) => {
      soltar = r;
    });
    await abrirSecao("convites");
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent(admin.convitesPagina.carregando);
    soltar();
    await expect.element(page.getByTestId("estado-vazio")).toBeVisible();
  });

  it("sem convites, o vazio diz o que fazer", async () => {
    await abrirSecao("convites");
    await expect.element(page.getByTestId("estado-vazio")).toBeVisible();
    expect(pegar('[data-testid="estado-vazio"]')?.textContent).toContain(
      admin.convitesPagina.vazio,
    );
  });

  it("falha na consulta NÃO vira lista vazia: mostra o erro e deixa tentar de novo", async () => {
    ctl.falhaNaLista = true;
    await abrirSecao("convites");
    await expect.element(page.getByTestId("estado-de-erro")).toBeVisible();
    expect(document.querySelector('[data-testid="estado-vazio"]')).toBeNull();
    ctl.falhaNaLista = false;
    ctl.convites = [{ codigo: "AB12", canal: "geral", porId: "U1" }];
    await page
      .getByRole("button", { name: admin.estados.tentarDeNovo })
      .click();
    await expect.element(page.getByTestId("linha-de-convite")).toBeVisible();
  });

  it("lista código, quem criou e o canal; revogar tira da lista", async () => {
    ctl.convites = [
      { codigo: "AB12", canal: "geral", porId: "U1" },
      { codigo: "CD34", canal: "avisos", porId: "U2" },
    ];
    await abrirSecao("convites");
    const linhas = () =>
      document.querySelectorAll('[data-testid="linha-de-convite"]');
    await expect.poll(() => linhas().length).toBe(2);
    expect(linhas()[0]?.textContent).toContain("Ana");
    await page
      .getByRole("button", {
        name: admin.convitesPagina.revogarConvite("AB12"),
      })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: admin.convitesPagina.revogar, exact: true })
      .click();
    await expect.poll(() => linhas().length).toBe(1);
    expect(chamou("revogarConvite")).toEqual([["revogarConvite", "AB12"]]);
  });

  it("criar convite escolhe o canal de destino e mostra o link para copiar", async () => {
    await abrirSecao("convites");
    await page
      .getByRole("button", { name: admin.convitesPagina.criar, exact: true })
      .click();
    await expect
      .element(
        page.getByRole("dialog", { name: admin.convitesPagina.criarTitulo }),
      )
      .toBeVisible();
    await page.getByLabelText(admin.convitesPagina.destino).selectOptions("T2");
    await page
      .getByRole("button", { name: admin.convitesPagina.gerar })
      .click();
    await expect
      .element(page.getByTestId("link-do-convite"))
      .toHaveValue(`${location.origin}/convite/NOVO123`);
    expect(chamou("criarConvite")).toEqual([["criarConvite", "T2"]]);
  });
});

describe("cargos", () => {
  it("lista os cargos com contagem de pessoas e o @todos", async () => {
    await abrirSecao("cargos");
    await expect
      .poll(
        () => document.querySelectorAll('[data-testid="item-de-cargo"]').length,
      )
      .toBe(2);
    expect(pegar('[data-cargo="R1"]')?.textContent).toContain("Moderação");
    expect(document.body.textContent).toContain(admin.cargosPagina.todos);
  });

  it("editar permissões acende 'alterações não salvas' e salva só o que mudou", async () => {
    await abrirSecao("cargos");
    await page.getByRole("button", { name: /^Artistas/ }).click();
    expect(
      document.querySelector('[role="region"][aria-label*="alterações"]'),
    ).toBeNull();
    await page.getByRole("switch", { name: "Falar" }).click();
    await page.getByRole("switch", { name: "Câmera e tela" }).click();
    await expect
      .element(page.getByRole("region", { name: /alterações não salvas/i }))
      .toBeVisible();
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect
      .poll(() => chamou("salvarPermissoes"))
      .toEqual([["salvarPermissoes", "R2", ["Speak", "Video"]]]);
  });

  it("descartar volta ao que o servidor tem", async () => {
    await abrirSecao("cargos");
    await page.getByRole("button", { name: /^Artistas/ }).click();
    await page.getByRole("switch", { name: "Falar" }).click();
    await page
      .getByRole("button", { name: admin.cargosPagina.descartar })
      .click();
    expect(
      page
        .getByRole("switch", { name: "Falar" })
        .element()
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(chamou("salvarPermissoes")).toHaveLength(0);
  });

  it("o @todos edita as permissões padrão", async () => {
    await abrirSecao("cargos");
    await page.getByRole("button", { name: admin.cargosPagina.todos }).click();
    await page.getByRole("switch", { name: "Reagir" }).click();
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect
      .poll(() => chamou("salvarPermissoesPadrao"))
      .toEqual([
        ["salvarPermissoesPadrao", ["React", "SendMessage", "ViewChannel"]],
      ]);
  });

  it("criar cargo e apagar passam pelo servidor; apagar pergunta antes", async () => {
    await abrirSecao("cargos");
    await page.getByRole("button", { name: admin.cargosPagina.criar }).click();
    await expect
      .poll(() => chamou("criarCargo"))
      .toEqual([["criarCargo", admin.cargosPagina.novoNome]]);
    await page.getByRole("button", { name: /^Artistas/ }).click();
    await page.getByRole("button", { name: admin.cargosPagina.apagar }).click();
    await expect
      .element(
        page.getByRole("dialog", {
          name: admin.cargosPagina.apagarTitulo("Artistas"),
        }),
      )
      .toBeVisible();
    expect(chamou("apagarCargo")).toHaveLength(0);
  });

  it("subir e descer mandam a ordem inteira", async () => {
    ctl.topo = 0;
    await abrirSecao("cargos");
    await page
      .getByRole("button", { name: admin.cargosPagina.descer("Moderação") })
      .click();
    await expect
      .poll(() => chamou("reordenarCargos"))
      .toEqual([["reordenarCargos", ["R2", "R1"]]]);
  });

  it("cargo acima do meu não abre o editor: diz o motivo", async () => {
    ctl.topo = 1; // eu sou o rank 1; o cargo R1 é igual ao meu e não é editável
    await abrirSecao("cargos");
    await page.getByRole("button", { name: /^Moderação/ }).click();
    await expect
      .element(page.getByText(admin.cargosPagina.acimaDeVoce))
      .toBeVisible();
    expect(
      document.querySelector('[data-testid="editor-de-cargo"]'),
    ).toBeNull();
  });

  it("sem permissão de criar cargo o botão não existe", async () => {
    ctl.acoes = new Set(["x"]);
    await abrirSecao("cargos");
    // Cai na seção permitida (nenhuma de servidor) e o botão nunca aparece.
    expect(document.body.textContent).not.toContain(admin.cargosPagina.criar);
  });
});

describe("membros e moderação", () => {
  const linhas = () => [
    ...document.querySelectorAll<HTMLElement>(
      '[data-testid="linha-de-membro"]',
    ),
  ];

  it("lista as pessoas com cargos e data de entrada, e conta o total", async () => {
    await abrirSecao("membros");
    await expect.poll(() => linhas().length).toBe(4);
    expect(linhas()[0]?.textContent).toContain("Moderação");
    expect(linhas()[0]?.textContent).toContain("3 abr 2026");
    expect(pegar('[data-testid="total-de-membros"]')?.textContent).toBe(
      "4 pessoas",
    );
  });

  it("filtra por nome e por cargo; nada encontrado diz como seguir", async () => {
    await abrirSecao("membros");
    await expect.poll(() => linhas().length).toBe(4);
    await page.getByLabelText(admin.membrosPagina.buscar).fill("ca");
    await expect.poll(() => linhas().length).toBe(1);
    await page.getByLabelText(admin.membrosPagina.buscar).fill("zzz");
    await expect.element(page.getByTestId("estado-vazio")).toBeVisible();
    expect(document.body.textContent).toContain(admin.membrosPagina.vazioDica);
    await page.getByLabelText(admin.membrosPagina.buscar).fill("");
    await page.getByRole("button", { name: /^Moderação · 1$/ }).click();
    await expect.poll(() => linhas().length).toBe(1);
  });

  it("os filtros de cargo mostram quantas pessoas cada um tem", async () => {
    await abrirSecao("membros");
    await expect.poll(() => linhas().length).toBe(4);
    await expect
      .element(page.getByRole("button", { name: /^Moderação · 1$/ }))
      .toBeVisible();
  });

  it("falha ao atualizar com a tabela cheia avisa em voz baixa, sem tela de erro nem toast", async () => {
    ctl.falhaNaLista = true;
    await abrirSecao("membros");
    await expect.poll(() => linhas().length).toBe(4);
    await expect
      .element(page.getByTestId("aviso-dados-de-antes"))
      .toBeVisible();
    expect(document.querySelector('[data-testid="estado-de-erro"]')).toBeNull();
    expect(lerToasts().length).toBe(0);
  });

  it("sem falha, nenhum aviso de dados antigos", async () => {
    await abrirSecao("membros");
    await expect.poll(() => linhas().length).toBe(4);
    expect(
      document.querySelector('[data-testid="aviso-dados-de-antes"]'),
    ).toBeNull();
  });

  it("castigo em andamento aparece na linha", async () => {
    await abrirSecao("membros");
    await expect.poll(() => linhas().length).toBe(4);
    expect(linhas()[2]?.textContent).toContain("Em castigo por");
  });

  it("expulsar pergunta antes e chama a expulsão da pessoa certa", async () => {
    await abrirSecao("membros");
    await page
      .getByRole("button", { name: admin.membrosPagina.acoes("Caio") })
      .click();
    await page
      .getByRole("menuitem", { name: admin.membrosPagina.expulsar })
      .click();
    await expect
      .element(
        page.getByRole("dialog", {
          name: admin.membrosPagina.expulsarTitulo("Caio"),
        }),
      )
      .toBeVisible();
    expect(chamou("expulsar")).toHaveLength(0);
    await page
      .getByRole("button", { name: admin.membrosPagina.expulsar, exact: true })
      .click();
    await expect.poll(() => chamou("expulsar")).toEqual([["expulsar", ["U2"]]]);
  });

  it("banir leva motivo e a opção de apagar as últimas 24 horas", async () => {
    await abrirSecao("membros");
    await page
      .getByRole("button", { name: admin.membrosPagina.acoes("Caio") })
      .click();
    await page
      .getByRole("menuitem", { name: admin.membrosPagina.banir })
      .click();
    await page.getByLabelText(admin.membrosPagina.motivo).fill("spam");
    await page
      .getByRole("switch", { name: admin.membrosPagina.apagarMensagens })
      .click();
    await page
      .getByRole("button", { name: admin.membrosPagina.banir, exact: true })
      .click();
    await expect
      .poll(() => chamou("banir"))
      .toEqual([
        ["banir", ["U2"], { motivo: "spam", excluirMensagensDe: 86_400 }],
      ]);
  });

  it("castigo por 1 hora e tirar o castigo", async () => {
    await abrirSecao("membros");
    await page
      .getByRole("button", { name: admin.membrosPagina.acoes("Caio") })
      .click();
    await page
      .getByRole("menuitem", { name: admin.membrosPagina.umaHora })
      .click();
    await expect
      .poll(() => chamou("castigar"))
      .toEqual([["castigar", ["U2"], 60]]);
    await page
      .getByRole("button", { name: admin.membrosPagina.acoes("Eva") })
      .click();
    await page
      .getByRole("menuitem", { name: admin.membrosPagina.tirarCastigo })
      .click();
    await expect
      .poll(() => chamou("castigar")[1])
      .toEqual(["castigar", ["U3"], 0]);
  });

  it("quem está acima de mim na hierarquia NÃO tem menu de ações", async () => {
    await abrirSecao("membros");
    await expect.poll(() => linhas().length).toBe(4);
    expect(
      document.querySelector(
        `[aria-label="${admin.membrosPagina.acoes("Davi")}"]`,
      ),
    ).toBeNull();
    expect(
      document.querySelector(
        `[aria-label="${admin.membrosPagina.acoes("Caio")}"]`,
      ),
    ).not.toBeNull();
  });

  it("sem permissão de banir, o menu nem oferece banir", async () => {
    ctl.acoes = new Set(["expulsar"]);
    await abrirSecao("membros");
    await page
      .getByRole("button", { name: admin.membrosPagina.acoes("Caio") })
      .click();
    await expect
      .element(
        page.getByRole("menuitem", { name: admin.membrosPagina.expulsar }),
      )
      .toBeVisible();
    expect(
      document.querySelector('[role="menuitem"]:not([data-variante])'),
    ).toBeNull();
    expect(
      [...document.querySelectorAll('[role="menuitem"]')].map(
        (i) => i.textContent,
      ),
    ).toEqual([admin.membrosPagina.expulsar]);
  });

  it("mudar cargos liga e desliga o cargo da pessoa", async () => {
    await abrirSecao("membros");
    await page
      .getByRole("button", { name: admin.membrosPagina.acoes("Caio") })
      .click();
    await page
      .getByRole("menuitem", { name: admin.membrosPagina.gerenciarCargos })
      .click();
    await expect
      .element(
        page.getByRole("dialog", {
          name: admin.membrosPagina.cargosDe("Caio"),
        }),
      )
      .toBeVisible();
    await page.getByRole("switch", { name: "Artistas" }).click();
    await expect
      .poll(() => chamou("alternarCargo"))
      .toEqual([["alternarCargo", "U2", "R2"]]);
  });
});

describe("acesso", () => {
  const pedidos = (...ids: string[]) => ({
    requests: ids.map((id) => ({
      user: id,
      created_at: "2026-10-01T10:00:00.000Z",
    })),
    users: ids.map((id) => ({
      _id: id,
      username: id.toLowerCase(),
      display_name: `Pessoa ${id}`,
    })),
  });
  const lerPedidos = vi.fn<(caminho: string) => Promise<unknown>>();
  let espiao: { mockRestore: () => void };

  beforeEach(() => {
    politicas.set(S, { ...POLITICA_PADRAO, modo: "aprovacao" });
    filas.set(S, "carregando");
    lerPedidos.mockResolvedValue(pedidos("P1", "P2"));
    espiao = vi
      .spyOn(client.api, "get")
      .mockImplementation(((caminho: string) => lerPedidos(caminho)) as never);
  });
  afterEach(() => {
    espiao.mockRestore();
  });

  const linhas = () =>
    document.querySelectorAll('[data-testid="linha-de-pedido"]');

  it("a fila lista os pedidos, e aprovar e recusar chamam o adapter", async () => {
    await abrirSecao("acesso");
    await expect.poll(() => linhas().length).toBe(2);
    await page
      .getByRole("button", {
        name: admin.acessoPagina.aprovarPessoa("Pessoa P1"),
      })
      .click();
    await expect
      .poll(() => chamou("aprovarPedido"))
      .toEqual([["aprovarPedido", "P1"]]);
    await page
      .getByRole("button", {
        name: admin.acessoPagina.recusarPessoa("Pessoa P2"),
      })
      .click();
    await expect
      .poll(() => chamou("recusarPedido"))
      .toEqual([["recusarPedido", "P2"]]);
    await page
      .getByRole("button", { name: admin.acessoPagina.aprovarTodos })
      .click();
    await expect.poll(() => chamou("aprovarTodos").length).toBe(1);
  });

  it("o evento de pedido removido tira a linha, com o módulo importado depois", async () => {
    await abrirSecao("acesso");
    await expect.poll(() => linhas().length).toBe(2);
    // A ligação ao socket acontece na avaliação do módulo; importar tarde não pode perdê-la.
    await import("nucleo/sdk/seguranca");
    (
      client.events as unknown as { emit: (n: string, e: unknown) => void }
    ).emit("event", {
      type: "ServerJoinRequestDelete",
      id: S,
      user: "P1",
    });
    await expect.poll(() => linhas().length).toBe(1);
    expect(linhas()[0]?.getAttribute("data-pessoa")).toBe("P2");
  });

  it("escolher como se entra grava a política; fila vazia explica", async () => {
    vi.spyOn(client.api, "patch").mockResolvedValue({ security: { join_mode: "Closed" } } as never);
    lerPedidos.mockResolvedValue(pedidos());
    await abrirSecao("acesso");
    await expect
      .element(page.getByText(admin.acessoPagina.vazio))
      .toBeVisible();
    await page
      .getByRole("radio", { name: admin.acessoPagina.fechado.titulo })
      .click();
    await expect
      .poll(() => chamou("editarPolitica"))
      .toEqual([["editarPolitica", { modo: "fechado" }]]);
  });

  it("falha ao ler a fila é erro, não lista vazia", async () => {
    lerPedidos.mockRejectedValue(new Error("falhou"));
    await abrirSecao("acesso");
    await expect.element(page.getByTestId("estado-de-erro")).toBeVisible();
    expect(document.querySelector('[data-testid="estado-vazio"]')).toBeNull();
  });

  it("quem só modera pedidos vê a fila e não a escolha de entrada", async () => {
    ctl.acoes = new Set(["moderarPedidos"]);
    await abrirSecao("acesso");
    await expect.poll(() => linhas().length).toBe(2);
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
  });

  it("quem só gerencia o servidor vê a escolha, e a fila fica fora", async () => {
    ctl.acoes = new Set(["gerenciarServidor"]);
    await abrirSecao("acesso");
    await expect.element(page.getByRole("radiogroup")).toBeVisible();
    expect(linhas().length).toBe(0);
  });

  it("sem permissão a seção não existe na navegação", async () => {
    ctl.acoes = new Set(["gerenciarCanais"]);
    await abrirSecao("canais");
    expect(nav().element().textContent).not.toContain(admin.navegacao.acesso);
  });
});

function entrada(n: number, extra: Partial<EntradaDeAuditoria> = {}): EntradaDeAuditoria {
  return {
    id: `E${String(1000 - n).padStart(4, "0")}`,
    autor: n % 2 === 0 ? "Ana" : "Caio",
    autorId: n % 2 === 0 ? "U1" : "U2",
    alvoId: undefined,
    alvo: undefined,
    frase: n % 3 === 0 ? "baniu alguém" : "apagou uma mensagem",
    tipo: n % 3 === 0 ? "BanCreate" : "MessageDelete",
    razao: undefined,
    quandoMs: 1_700_000_000_000 - n * 60_000,
    quandoTexto: `há ${n} min`,
    mudancas: [],
    ...extra,
  };
}
const entradas = (n: number) => Array.from({ length: n }, (_, i) => entrada(i));
const totalNaLista = () => document.querySelector('[data-testid="lista-de-auditoria"]')?.getAttribute("data-total");

describe("registro de atividade", () => {
  it("sem permissão para ver o registro, a seção fica ausente", async () => {
    ctl.acoes = new Set(["banir"]);
    await abrirSecao("banimentos");
    const botoes = [...nav().element().querySelectorAll("button")].map((b) => b.textContent);
    expect(botoes).not.toContain(admin.navegacao.auditoria);
  });

  it("abre a seção com permissão e mostra a frase de cada entrada", async () => {
    ctl.auditoria = [entrada(0, { razao: "spam", alvo: "Rui" })];
    await abrirSecao("auditoria");
    await expect.element(page.getByTestId("entrada-de-auditoria")).toBeVisible();
    const texto = document.querySelector('[data-testid="entrada-de-auditoria"]')?.textContent ?? "";
    expect(texto).toContain("Ana");
    expect(texto).toContain("baniu alguém");
    expect(texto).toContain(admin.auditoriaPagina.motivo("spam"));
    expect(texto).toContain(admin.auditoriaPagina.alvo("Rui"));
  });

  it("sem entradas, o vazio explica; falha na consulta é erro, não vazio", async () => {
    await abrirSecao("auditoria");
    await expect.element(page.getByTestId("estado-vazio")).toBeVisible();
    expect(document.body.textContent).toContain(admin.auditoriaPagina.vazio);
    desmontar();
    ctl.auditoria = undefined;
    await abrirSecao("auditoria");
    await expect.element(page.getByTestId("estado-de-erro")).toBeVisible();
    expect(document.querySelector('[data-testid="estado-vazio"]')).toBeNull();
  });

  it("virtualiza: 50 entradas não montam 50 linhas", async () => {
    ctl.auditoria = entradas(50);
    await abrirSecao("auditoria");
    await expect.poll(totalNaLista).toBe("50");
    expect(document.querySelectorAll('[data-testid="entrada-de-auditoria"]').length).toBeLessThan(25);
  });

  it("filtra por tipo de ação e por autor, pedindo ao servidor", async () => {
    ctl.auditoria = entradas(12);
    await abrirSecao("auditoria");
    await expect.poll(totalNaLista).toBe("12");
    await page.getByRole("combobox", { name: admin.auditoriaPagina.filtroAcao }).selectOptions("BanCreate");
    await expect.poll(totalNaLista).toBe("4");
    expect(ctl.consultasDeAuditoria.at(-1)?.tipo).toBe("BanCreate");
    await page.getByRole("combobox", { name: admin.auditoriaPagina.filtroAcao }).selectOptions("");
    await page.getByRole("combobox", { name: admin.auditoriaPagina.filtroAutor }).selectOptions("U2");
    await expect.poll(totalNaLista).toBe("6");
    expect(ctl.consultasDeAuditoria.at(-1)?.autorId).toBe("U2");
  });

  it("filtro sem resultado diz que é o filtro, não que o registro está vazio", async () => {
    ctl.auditoria = [entrada(1)];
    await abrirSecao("auditoria");
    await expect.poll(totalNaLista).toBe("1");
    await page.getByRole("combobox", { name: admin.auditoriaPagina.filtroAcao }).selectOptions("BanCreate");
    await expect.element(page.getByText(admin.auditoriaPagina.vazioComFiltro)).toBeVisible();
  });

  it("carregar mais pagina pelo id da última entrada e some quando acaba", async () => {
    ctl.auditoria = entradas(53);
    await abrirSecao("auditoria");
    await expect.poll(totalNaLista).toBe("50");
    expect(document.body.textContent).not.toContain(admin.auditoriaPagina.fim);
    await page.getByRole("button", { name: admin.auditoriaPagina.carregarMais }).click();
    await expect.poll(totalNaLista).toBe("53");
    expect(ctl.consultasDeAuditoria.at(-1)?.antesDe).toBe(entrada(49).id);
    await expect.element(page.getByText(admin.auditoriaPagina.fim)).toBeVisible();
    const botoes = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(botoes).not.toContain(admin.auditoriaPagina.carregarMais);
  });
});

describe("banimentos", () => {
  it("sem banidos, o vazio explica", async () => {
    await abrirSecao("banimentos");
    await expect.element(page.getByTestId("estado-vazio")).toBeVisible();
    expect(document.body.textContent).toContain(admin.banimentosPagina.vazio);
  });

  it("lista com motivo e perdoa", async () => {
    ctl.banidos = [
      { userId: "B1", nome: "Rui", razao: "spam" },
      { userId: "B2", nome: "Lia", razao: undefined },
    ];
    await abrirSecao("banimentos");
    const linhas = () =>
      document.querySelectorAll('[data-testid="linha-de-banido"]');
    await expect.poll(() => linhas().length).toBe(2);
    expect(linhas()[0]?.textContent).toContain("spam");
    expect(linhas()[1]?.textContent).toContain(admin.banimentosPagina.semRazao);
    await page
      .getByRole("button", {
        name: admin.banimentosPagina.perdoarPessoa("Rui"),
      })
      .click();
    await expect.poll(() => linhas().length).toBe(1);
    expect(chamou("perdoar")).toEqual([["perdoar", "B1"]]);
  });

  it("mostra quem baniu quando o registro sabe, e degrada sem erro quando não sabe", async () => {
    ctl.banidos = [
      { userId: "B1", nome: "Rui", razao: "spam" },
      { userId: "B2", nome: "Lia", razao: undefined },
    ];
    ctl.autoria = new Map([["B1", { porNome: "Ana", quandoMs: 1, quandoTexto: "3 abr" }]]);
    await abrirSecao("banimentos");
    const celulas = () => [...document.querySelectorAll('[data-testid="banido-por"]')].map((c) => c.textContent);
    await expect.poll(celulas).toEqual(["Ana", admin.banimentosPagina.autoriaDesconhecida]);
    expect(document.querySelector('[data-testid="estado-de-erro"]')).toBeNull();
  });

  it("se o registro não pôde ser lido, a lista segue e a coluna diz que não consta", async () => {
    ctl.banidos = [{ userId: "B1", nome: "Rui", razao: "spam" }];
    ctl.autoria = undefined;
    await abrirSecao("banimentos");
    await expect
      .poll(() => document.querySelector('[data-testid="banido-por"]')?.textContent)
      .toBe(admin.banimentosPagina.autoriaDesconhecida);
    expect(document.querySelector('[data-testid="estado-de-erro"]')).toBeNull();
  });

  it("falha na consulta é erro, não lista vazia", async () => {
    ctl.falhaNaLista = true;
    await abrirSecao("banimentos");
    await expect.element(page.getByTestId("estado-de-erro")).toBeVisible();
    expect(document.querySelector('[data-testid="estado-vazio"]')).toBeNull();
  });
});

describe("visão geral", () => {
  it("com envio de imagem: o botão de trocar o ícone aparece, com ícone de imagem", async () => {
    await abrirSecao("servidor");
    const botao = page.getByRole("button", {
      name: admin.visaoGeral.trocarIcone,
    });
    await expect.element(botao).toBeVisible();
    expect(
      document.querySelector('[data-testid="seletor-do-icone"]'),
    ).not.toBeNull();
    expect(botao.element().querySelector("svg.lucide-image")).not.toBeNull();
  });

  it("sem envio de imagem: diz por quê e não mostra controle inerte", async () => {
    ctl.comMidia = false;
    await abrirSecao("servidor");
    await expect
      .element(page.getByText(admin.visaoGeral.semMidia))
      .toBeVisible();
    expect(document.body.textContent).not.toContain(
      admin.visaoGeral.trocarIcone,
    );
    expect(
      document.querySelector('[data-testid="seletor-do-icone"]'),
    ).toBeNull();
  });

  it("salva nome e descrição só quando algo mudou", async () => {
    await abrirSecao("servidor");
    expect(
      document.querySelector('[role="region"][aria-label*="alterações"]'),
    ).toBeNull();
    await page.getByLabelText(admin.visaoGeral.nome).fill("Turma");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect
      .poll(() => chamou("salvarServidor"))
      .toEqual([["salvarServidor", "Turma", "Para jogar"]]);
  });

  it("nome vazio é erro dito e não deixa salvar", async () => {
    await abrirSecao("servidor");
    await page.getByLabelText(admin.visaoGeral.nome).fill("");
    await expect
      .element(page.getByText(admin.visaoGeral.nomeObrigatorio))
      .toBeVisible();
    expect(
      document.querySelector('[role="region"][aria-label*="alterações"]'),
    ).toBeNull();
  });

  it("a casca tem o foco preso e dá para clicar dentro do diálogo (o véu não intercepta)", async () => {
    await abrirSecao("servidor");
    // `click` do Playwright falha se outro elemento interceptar o ponteiro.
    await page
      .getByRole("button", { name: admin.navegacao.convites, exact: true })
      .click();
    await expect.poll(() => lerConfig().secao).toBe("convites");
  });
});

describe("segurança", () => {
  const t = admin.segurancaPagina;
  const adiado = <T,>() => {
    let ok!: (v: T) => void;
    let nao!: (e: unknown) => void;
    const p = new Promise<T>((a, b) => {
      ok = a;
      nao = b;
    });
    return { p, ok, nao };
  };
  const radio = (nome: string) =>
    page.getByRole("radio", { name: new RegExp(`^${nome}`) });
  const marcado = (nome: string) =>
    radio(nome).element().getAttribute("aria-checked");
  const interruptor = (nome: string) =>
    page.getByRole("switch", { name: nome, exact: true });
  const ligado = (nome: string) =>
    interruptor(nome).element().getAttribute("aria-checked");
  const espiar = (
    metodo: "patch" | "put" | "delete",
    resposta: Promise<unknown>,
  ) =>
    vi.spyOn(client.api, metodo).mockImplementation((() => resposta) as never);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aparece na navegação para quem gerencia o servidor e fica AUSENTE para quem não", async () => {
    await abrirSecao("seguranca");
    await expect
      .element(
        nav().getByRole("button", {
          name: admin.navegacao.seguranca,
          exact: true,
        }),
      )
      .toBeVisible();
    desmontar();
    ctl.acoes = new Set(["gerenciarCanais"]);
    await abrirSecao("seguranca");
    await expect.poll(() => lerConfig().secao).toBe("canais");
    const botoes = [...nav().element().querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    expect(botoes).toEqual([admin.navegacao.salasECanais]);
  });

  it("carregando, depois erro com nova tentativa, depois a página", async () => {
    const lento = adiado<boolean>();
    ctl.politicaLenta = lento.p;
    await abrirSecao("seguranca");
    await expect.element(page.getByText(t.carregando)).toBeVisible();
    lento.ok(false);
    await expect.element(page.getByTestId("estado-de-erro")).toBeVisible();
    ctl.politicaLenta = undefined;
    await page
      .getByRole("button", { name: admin.estados.tentarDeNovo })
      .click();
    await expect.element(radio("Nenhum")).toBeVisible();
    expect(marcado("Nenhum")).toBe("true");
  });

  it("nível de verificação é otimista: responde no clique e mantém o que o servidor confirmou", async () => {
    const resposta = adiado<unknown>();
    const patch = espiar("patch", resposta.p);
    await abrirSecao("seguranca");
    await radio("Médio").click();
    await expect.poll(() => marcado("Médio")).toBe("true");
    expect(patch).toHaveBeenCalledWith("/servers/S1", {
      security: { verification_level: "Medium" },
    });
    resposta.ok({ security: { verification_level: "Medium" } });
    await expect.poll(() => marcado("Médio")).toBe("true");
    expect(marcado("Nenhum")).toBe("false");
  });

  it("nível de verificação: se o servidor recusa, desfaz e avisa", async () => {
    const resposta = adiado<unknown>();
    espiar("patch", resposta.p);
    await abrirSecao("seguranca");
    await radio("Alto").click();
    await expect.poll(() => marcado("Alto")).toBe("true");
    resposta.nao(new Error("recusou"));
    await expect.poll(() => marcado("Nenhum")).toBe("true");
    expect(marcado("Alto")).toBe("false");
    expect(lerToasts().some((x) => x.tipo === "erro")).toBe(true);
  });

  it("mensagens privadas entre membros: liga e, se falha, volta", async () => {
    const ok = adiado<unknown>();
    const patch = espiar("patch", ok.p);
    await abrirSecao("seguranca");
    await interruptor(t.dm).click();
    await expect.poll(() => ligado(t.dm)).toBe("true");
    expect(patch).toHaveBeenCalledWith("/servers/S1", {
      security: { allow_member_dms: true },
    });
    ok.ok({ security: { allow_member_dms: true } });
    await expect.poll(() => ligado(t.dm)).toBe("true");

    vi.restoreAllMocks();
    const falha = adiado<unknown>();
    espiar("patch", falha.p);
    await interruptor(t.convitesEmDm).click();
    await expect.poll(() => ligado(t.convitesEmDm)).toBe("true");
    falha.nao(new Error("recusou"));
    await expect.poll(() => ligado(t.convitesEmDm)).toBe("false");
  });

  it("filtro de mídia: otimista e com rollback em falha", async () => {
    const falha = adiado<unknown>();
    const patch = espiar("patch", falha.p);
    await abrirSecao("seguranca");
    await radio("Verificar todo mundo").click();
    await expect.poll(() => marcado("Verificar todo mundo")).toBe("true");
    expect(patch).toHaveBeenCalledWith("/servers/S1", {
      explicit_content_filter: "AllMembers",
    });
    falha.nao(new Error("recusou"));
    await expect.poll(() => marcado("Não verificar")).toBe("true");
    expect(marcado("Verificar todo mundo")).toBe("false");
    expect(lerToasts().some((x) => x.titulo === t.filtroFalhou)).toBe(true);
  });

  it("emergência: pede confirmação, mostra quando termina e encerra", async () => {
    const ate = new Date(Date.now() + 3_600_000).toISOString();
    const ativa = {
      security: {
        emergency: {
          until: ate,
          pause_invites: true,
          silence_everyone: true,
          freeze_joins: true,
        },
      },
    };
    const put = espiar("put", Promise.resolve(ativa));
    await abrirSecao("seguranca");
    await interruptor(t.emergenciaTitulo).click();
    // Só pergunta: nada foi para o servidor ainda.
    await expect.element(page.getByText(t.confirmarTitulo)).toBeVisible();
    expect(put).not.toHaveBeenCalled();
    await page.getByRole("button", { name: t.confirmarAcao }).click();
    await expect.poll(() => put.mock.calls.length).toBe(1);
    expect(put.mock.calls[0]?.[0]).toBe("/servers/S1/emergency");
    await expect.element(page.getByTestId("emergencia-ativa")).toBeVisible();
    const hora = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(Date.parse(ate));
    expect(
      page.getByTestId("emergencia-ativa").element().textContent,
    ).toContain(t.emergenciaAtiva(hora));
    expect(ligado(t.emergenciaTitulo)).toBe("true");

    const del = espiar("delete", Promise.resolve({ security: {} }));
    await page.getByRole("button", { name: t.encerrar }).click();
    await expect.poll(() => del.mock.calls.length).toBe(1);
    expect(del.mock.calls[0]?.[0]).toBe("/servers/S1/emergency");
    await expect
      .poll(() => document.querySelector('[data-testid="emergencia-ativa"]'))
      .toBeNull();
    expect(ligado(t.emergenciaTitulo)).toBe("false");
  });

  it("emergência recusada pelo servidor não liga o aviso", async () => {
    const put = vi
      .spyOn(client.api, "put")
      .mockRejectedValue(new Error("recusou"));
    await abrirSecao("seguranca");
    await interruptor(t.emergenciaTitulo).click();
    await page.getByRole("button", { name: t.confirmarAcao }).click();
    await expect.poll(() => put.mock.calls.length).toBe(1);
    await expect
      .poll(() => lerToasts().some((x) => x.tipo === "erro"))
      .toBe(true);
    expect(
      document.querySelector('[data-testid="emergencia-ativa"]'),
    ).toBeNull();
  });
});

describe("permissões por canal e por categoria", () => {
  const nomeDoEstado = (permissao: string, estado: string) =>
    `${permissao}: ${estado}`;
  const barra = () =>
    document.querySelector('[role="region"][aria-label*="alterações"]');
  const radio = (permissao: string, estado: string) =>
    page.getByRole("radio", {
      name: nomeDoEstado(permissao, estado),
      exact: true,
    });

  async function abrirDoCanal(nome: string) {
    await abrirSecao("canais");
    await page
      .getByRole("button", { name: permissoesDeAlvo.abrirCanal(nome) })
      .click();
    await expect
      .element(
        page.getByRole("dialog", { name: permissoesDeAlvo.tituloCanal(nome) }),
      )
      .toBeVisible();
  }

  it("troca bits (inclusive acima de 31) e salva allow e deny certos por cargo", async () => {
    await abrirDoCanal("Jogatina");
    await page.getByRole("button", { name: /^Artistas/ }).click();
    expect(barra()).toBeNull();
    await radio("Ver o canal", permissoesDeAlvo.permitir).click();
    await radio("Falar", permissoesDeAlvo.negar).click();
    await radio("Mencionar cargos", permissoesDeAlvo.negar).click();
    await expect
      .element(page.getByRole("region", { name: /alterações não salvas/i }))
      .toBeVisible();
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect
      .poll(() => chamou("salvarPermissaoDeCanal"))
      .toEqual([
        [
          "salvarPermissaoDeCanal",
          "V1",
          "R2",
          1n << 20n,
          (1n << 31n) | (1n << 38n),
        ],
      ]);
    await expect.poll(barra).toBeNull();
  });

  it("'todos' grava no cargo padrão (sem cargo)", async () => {
    await abrirDoCanal("geral");
    await radio("Enviar mensagem", permissoesDeAlvo.negar).click();
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect
      .poll(() => chamou("salvarPermissaoDeCanal"))
      .toEqual([["salvarPermissaoDeCanal", "T1", undefined, 0n, 1n << 22n]]);
  });

  it("descartar volta ao que o servidor tem e não escreve nada", async () => {
    await abrirDoCanal("geral");
    await radio("Reagir", permissoesDeAlvo.negar).click();
    expect(
      radio("Reagir", permissoesDeAlvo.negar)
        .element()
        .getAttribute("aria-checked"),
    ).toBe("true");
    await page
      .getByRole("button", { name: admin.cargosPagina.descartar })
      .click();
    await expect
      .poll(() =>
        radio("Reagir", permissoesDeAlvo.negar)
          .element()
          .getAttribute("aria-checked"),
      )
      .toBe("false");
    expect(barra()).toBeNull();
    expect(chamou("salvarPermissaoDeCanal")).toHaveLength(0);
  });

  it("fechar com rascunho pergunta; cancelar mantém e confirmar descarta", async () => {
    await abrirDoCanal("geral");
    await radio("Reagir", permissoesDeAlvo.negar).click();
    await page
      .getByRole("button", { name: "Fechar", exact: true })
      .first()
      .click();
    const pergunta = page.getByRole("dialog", {
      name: permissoesDeAlvo.descartarTitulo,
    });
    await expect.element(pergunta).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect.element(pergunta).not.toBeInTheDocument();
    expect(
      radio("Reagir", permissoesDeAlvo.negar)
        .element()
        .getAttribute("aria-checked"),
    ).toBe("true");

    await page
      .getByRole("button", { name: "Fechar", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: permissoesDeAlvo.descartarConfirmar })
      .click();
    await expect
      .element(
        page.getByRole("dialog", {
          name: permissoesDeAlvo.tituloCanal("geral"),
        }),
      )
      .not.toBeInTheDocument();
    expect(chamou("salvarPermissaoDeCanal")).toHaveLength(0);
  });

  it("erro do servidor mantém o rascunho e avisa", async () => {
    ctl.falhaNaPermissao = true;
    await abrirDoCanal("geral");
    await radio("Reagir", permissoesDeAlvo.negar).click();
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect.element(page.getByText(permissoesDeAlvo.falhou)).toBeVisible();
    expect(barra()).not.toBeNull();
    expect(
      radio("Reagir", permissoesDeAlvo.negar)
        .element()
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("a categoria salva o conjunto inteiro", async () => {
    await abrirSecao("canais");
    await page
      .getByRole("button", { name: permissoesDeAlvo.abrirCategoria("Salas") })
      .click();
    await page.getByRole("button", { name: /^Artistas/ }).click();
    await radio("Anexar arquivo", permissoesDeAlvo.negar).click();
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect
      .poll(() => chamou("salvarPermissoesDaCategoria"))
      .toEqual([
        ["salvarPermissoesDaCategoria", "CAT", undefined, undefined, ["R2"]],
      ]);
  });

  it("sem permissão de gerenciar permissões, nenhuma entrada aparece", async () => {
    ctl.acoes = new Set(["gerenciarCanais"]);
    await abrirSecao("canais");
    await expect
      .element(
        page.getByRole("button", { name: admin.canaisPagina.editar("geral") }),
      )
      .toBeVisible();
    expect(document.querySelector('[aria-label^="Permissões de"]')).toBeNull();
    expect(
      document.querySelector('[aria-label^="Permissões da categoria"]'),
    ).toBeNull();
  });
});

describe("aviso de emergÃªncia no topo do servidor", () => {
  const ate = () => Date.now() + 3_600_000;
  const emergenciaAte = (ateMs: number) => ({
    ...POLITICA_PADRAO,
    emergencia: {
      ateMs,
      pausaConvites: true,
      silenciaTodos: true,
      congelaEntradas: true,
    },
  });
  const aviso = () =>
    document.querySelector<HTMLElement>('[data-testid="aviso-de-emergencia"]');
  const hora = (ms: number) =>
    new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(ms);

  /** Onde fica a Ã¡rea principal e o que rola dentro dela: Ã© a Ã¢ncora da lista. */
  function geometria() {
    const principal = document.querySelector("main")!;
    const r = principal.getBoundingClientRect();
    const rolaveis = [...principal.querySelectorAll<HTMLElement>("*")]
      .filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY))
      .map((el) => {
        const b = el.getBoundingClientRect();
        return [b.top, b.height, el.scrollTop];
      });
    return { topo: r.top, altura: r.height, rolaveis };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aparece com a hora do fim e a lista nÃ£o mexe um pixel", async () => {
    await abrirShell();
    const antes = geometria();
    const fim = ate();
    politicas.set(S, emergenciaAte(fim));
    await expect.poll(aviso).not.toBeNull();
    expect(aviso()!.textContent).toContain(
      admin.avisoDeEmergencia.texto(hora(fim)),
    );
    await quadros(3);
    expect(geometria()).toEqual(antes);  });

  it("some sozinho quando o prazo vence", async () => {
    await abrirShell();
    politicas.set(S, emergenciaAte(Date.now() + 400));
    await expect.poll(aviso).not.toBeNull();
    await expect.poll(aviso, { timeout: 3000 }).toBeNull();
  });

  it("some quando o servidor limpa a emergÃªncia por evento", async () => {
    await abrirShell();
    politicas.set(S, emergenciaAte(ate()));
    await expect.poll(aviso).not.toBeNull();
    aplicarEventoCru({ type: "ServerUpdate", id: S, clear: ["Security"] });
    await expect.poll(aviso).toBeNull();
  });

  it("quem administra encerra, depois de confirmar", async () => {
    await abrirShell();
    politicas.set(S, emergenciaAte(ate()));
    const del = vi
      .spyOn(client.api, "delete")
      .mockImplementation((() => Promise.resolve({ security: {} })) as never);
    await expect.poll(aviso).not.toBeNull();
    await page
      .getByRole("button", { name: admin.avisoDeEmergencia.encerrar, exact: true })
      .click();
    // SÃ³ pergunta: nada foi para o servidor ainda.
    await expect
      .element(page.getByText(admin.avisoDeEmergencia.confirmarTitulo))
      .toBeVisible();
    expect(del).not.toHaveBeenCalled();
    await page
      .getByRole("button", { name: admin.avisoDeEmergencia.confirmarAcao })
      .click();
    await expect.poll(() => del.mock.calls.length).toBe(1);
    expect(del.mock.calls[0]?.[0]).toBe("/servers/S1/emergency");
    await expect.poll(aviso).toBeNull();
  });

  it("sem permissÃ£o o aviso aparece, mas sem o botÃ£o de encerrar", async () => {
    ctl.acoes = new Set();
    await abrirShell();
    politicas.set(S, emergenciaAte(ate()));
    await expect.poll(aviso).not.toBeNull();
    expect(aviso()!.querySelector("button")).toBeNull();
  });

  it("emergÃªncia de outro servidor nÃ£o aparece no aberto", async () => {
    await abrirShell();
    politicas.set("S2", emergenciaAte(ate()));
    await quadros(3);
    expect(aviso()).toBeNull();
  });
});
