import { admin } from "./admin";
import { busca } from "./busca";
import { casa } from "./casa";
import { chat } from "./chat";
import { comum } from "./comum";
import { config } from "./config";
import { ds } from "./ds";
import { fixados } from "./fixados";
import { salas } from "./salas";
import { shell } from "./shell";
import { permissoesDeAlvo } from "./permissoesDeAlvo";
import { sessao } from "./sessao";
import { voz } from "./voz";

export { admin, busca, casa, chat, comum, config, ds, fixados, permissoesDeAlvo, salas, sessao, shell, voz };

/** Todos os módulos, para o teste varrer o catálogo inteiro. */
export const catalogo = { busca, casa, comum, sessao, salas, chat, voz, config, admin, ds, fixados, shell, permissoesDeAlvo } as const;
