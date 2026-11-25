# O que foi entregue

> Fechamento do planejamento. Os documentos 00 a 05 descrevem o **plano** e não
> foram reescritos; este registra o **resultado**, conferido no git e nas
> releases de `enzolaOps/vortex` (2026-10-08).

## Marcos

| Marco | O que entregou | PR |
| --- | --- | --- |
| M0 Extração | Camada de lógica separada no pacote `nucleo` | #325 |
| M1 Fundação | Interface nova (`app`): shell, tokens, lista de mensagens virtualizada, arnês `/dev` e gate | #327 |
| M2 Back-end e voz | Rota de saída de sala e eventos de voz no núcleo | #326 |
| M3 Sessão mínima | Entrar, restaurar sessão, segundo fator, sair | #328 |
| M4 Salas e palco | Salas, palco de voz, PiP e overlay mínimo | #329 |
| M5 Chat | Linha do tempo, composer e ações da mensagem | #330 |
| M6 Casa | Casa, DMs, chamada em DM e notificações mínimas | #331 |
| M7 Configurações e admin | Configurações, administração e permissões de voz | #333 |
| M8 Entrada completa | Criar conta, recuperar senha, convite sem sessão e QR | #332 |
| M9 Troca | A imagem do cliente passa a ser o app novo; depois, o app antigo é apagado | #334, #339 |

Depois do M9: passe de lacunas da v1 (#335), ajustes pós-lançamento (#336),
Aparência redesenhada (#337), avatares na sala e painel da chamada (#338) e a
marca nova (#344).

## Releases

| Versão | O que levou |
| --- | --- |
| v1.4.0 | A troca para o app novo: sessão, salas e palco, chat, casa e DMs, configurações, administração básica, criar conta e convite |
| v1.5.0 | Clicar na sala entra; painel da chamada na coluna; PiP só ao transmitir; miniaturas recolhíveis; realce de código; visualizador de imagem e seletor de emoji |
| v1.6.0 | Animação de entrada e saída do palco; painel da chamada integrado; Aparência nova (temas, prévia, vidro, densidade, tamanho do texto) |
| v1.7.0 | Sala sem palco no primeiro clique, categorias do servidor e mixer de áudio no desktop |
| v1.7.1 | Marca nova no app, no desktop e no instalador |

## Mudanças de rumo depois do lançamento

Decididas pelo dono, fora do plano original.

| Mudança | Resultado |
| --- | --- |
| Entrar na sala | Primeiro, clicar na sala passou a entrar (v1.5.0). Depois, ajuste final: o primeiro clique entra, o segundo abre o palco (v1.7.0) |
| Controles da chamada | Ficam fixos na coluna, como painel da chamada |
| Selo AO VIVO | Só aparece quando a pessoa está transmitindo |
| Aparência | Redesenhada: temas prontos, prévia ao vivo, cor de destaque livre |
| Marca | Símbolo novo no lugar do antigo (v1.7.1) |

## Ficou fora da v1, por decisão

Busca, embeds, TOTP, captcha, i18n (a v1 é só em português), tema claro e
layout customizável. Os três últimos já eram não-objetivos do PRD.

## Ondas seguintes (PRD, seção 5)

| Ordem | Onda |
| --- | --- |
| 1 | Acesso "só assistir" (back-end). **Pendência de longo prazo, por decisão do dono** |
| 2 | Eventos |
| 3 | Fórum |
| 4 | Tópicos |
| 5 | Enquete |
| 6 | Figurinhas e efeitos sonoros |
| 7 | Administração avançada (modo de entrada, fila de pedidos, emergência, auditoria) |
| 8 | Mais temas |

### Onda 4 — Tópicos (em andamento)

Entregue até aqui, no `nucleo`:

- Tópico é um canal de texto com `thread`: mensagens, digitação, não lidas,
  permissões e composer vêm de graça. Listas por canal pai, por servidor e "os
  que eu sigo", contagem de respostas e abertura de post, mais as escritas
  (criar, arquivar, seguir). Índice mensagem para tópico (PR #454).
- Não lidas e menções de tópico no rollup do servidor (rail).

Decisões do dono:

| Decisão | Regra |
| --- | --- |
| Rollup do servidor | O tópico só acende o servidor se a pessoa o **segue** ou se há **menção** nele. Tópico não seguido e sem menção não conta |
| Silêncio | O silêncio do canal pai vale para os tópicos dele, e o do próprio tópico também. Silêncio tira a não lida; a menção atravessa, como no canal comum |
| Som e notificação do sistema | Só para **menção**, com o mesmo som e a mesma notificação de canal, respeitando silêncio e foco. Mensagem comum em tópico seguido só marca não lida |
| Ler | Abrir o tópico faz `ack`, como num canal |

Toca store e rollup: precisa do gate do firehose antes de ir para produção
(adiado, ver dívidas).

### Lógica pronta para as próximas ondas

Módulos do `nucleo` que o `app` ainda não usa e que ficaram de propósito.

| Módulo | Serve a |
| --- | --- |
| `sdk/auditoria` | Onda 7, registro de auditoria |
| `sdk/seguranca`, `store/seguranca` | Onda 7, modo de entrada e fila de pedidos |
| `sdk/busca`, `store/busca`, `ui-logica/busca/filtros` | Busca (fora da v1) |
| `ui-logica/expressoes/atalhos`, `nomes`, `recentes` | Onda 6, soundboard e figurinhas |
| `store/ferramentaDoComposer` | Onda 6, seletores do composer (emoji, figurinha, soundboard) |

Os módulos de eventos e enquete já são usados pelo `app` e não aparecem acima.
Os de tópicos (`sdk/topicos`, `sdk/vortexCanal`, hooks de `store/hooks`) estão
no `nucleo` e já alimentam o aviso de não lidas do servidor no rail; as telas
de tópico no `app` são a próxima etapa da onda 4 (seção abaixo). Cerca de 40 outros módulos sem uso previsto foram apagados junto com os
testes (histórico no git, commit desta entrega).

## Dívidas abertas

| Dívida | Situação |
| --- | --- |
| Gate do firehose | Sem veredito válido em vários marcos (máquina disputada ou ambiente inválido). Adiado por decisão do dono |
| Testes E2E com back-end | Escritos, nunca executados contra uma pilha real |
| Electron: PiP, overlay e mixer de áudio | Sem teste manual |
| Armazenamento de arquivos (MinIO) | As imagens do MinIO pinadas não estão mais no Docker Hub. O `pi-infra` fica como está, por decisão do dono. Isso impede subir a pilha local para os E2E com back-end e é risco se o Pi precisar baixar a imagem de novo |
