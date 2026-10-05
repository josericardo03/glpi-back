# Ajustes solicitados pelo front-end (glpi-front)

Levantamento feito ao integrar todas as rotas da API no front. Cada item traz o problema, onde está no código e a sugestão de ajuste. Os campos seguem o padrão atual (snake_case, paginação com `pagina`/`limite`).

---

## 1. Segurança (prioridade alta)

### 1.1 `GET /auditoria` aberto para qualquer usuário logado
- **Onde:** `src/api/api.controller.ts`, método `auditoria()` (linha ~219), sem `@Roles`.
- **Problema:** o `RolesGuard` libera rotas sem `@Roles`, então um SOLICITANTE consegue ler os últimos 100 logs do tenant, incluindo `valor_novo`/`valor_anterior` (dados de usuários, chamados, configurações).
- **Ajuste:** remover a rota (já existe `GET /admin/auditoria`, restrita a ADMIN) ou adicionar `@Roles('ADMIN')`.

### 1.2 `GET /integracoes` devolve `configuracoes` para qualquer usuário logado
- **Onde:** `src/api/api.controller.ts`, método `integracoes()`, sem `@Roles`.
- **Problema:** o campo `configuracoes` (Json) costuma guardar URL, token e credenciais. Hoje um SOLICITANTE consegue ler esse campo.
- **Ajuste:** `@Roles('ADMIN')` e/ou mascarar segredos na resposta (ex.: `token: "****abcd"`).

### 1.3 Listagens sem restrição de perfil que expõem dados ao SOLICITANTE
- **Onde:** `src/api/api.controller.ts`.
- **Problema:** `GET /usuarios` (nome, e-mail, perfil, status de todos do tenant), `GET /ativos` (inventário inteiro), `GET /problemas` e `GET /mudancas` não têm `@Roles`.
- **Ajuste sugerido:**
  - `/problemas` e `/mudancas`: `@Roles('TECNICO')`.
  - `/ativos`: para SOLICITANTE, filtrar `id_usuario_responsavel = user.id` (o front já faz esse filtro só visualmente).
  - `/usuarios`: para SOLICITANTE, devolver só os campos necessários (ex.: `id`, `nome`, `perfil`) ou só gestores/admins (o front usa a lista para escolher o aprovador).

---

## 2. Rotas de consulta que faltam (o front contorna lendo a auditoria)

Hoje estes cadastros só têm rota de criação. O front reconstrói as listas a partir dos eventos de criação em `/admin/auditoria`. Isso só funciona para ADMIN, só alcança os 200 eventos mais recentes e não mostra edições.

| Rota sugerida | Retorno esperado | Quem usa |
|---|---|---|
| `GET /admin/horarios-comerciais` | lista com `id`, `nome`, `fuso_horario`, `status` e `intervalos: [{ id, dia_semana, hora_inicio, hora_fim }]` | ADMIN (tela de SLA) |
| `GET /admin/feriados` | lista com `id`, `nome`, `dia`, `mes`, `ano` (null = todo ano) | ADMIN (tela de SLA) |
| `GET /categorias-kb` | lista com `id`, `nome`, `descricao` (idealmente com `total_artigos` publicados) | todos (home da KB e editor) |

Observação: o evento de auditoria `CREATE_CATEGORIA_KB` / `CREATE_KB_CATEGORY` grava só `{ id, nome }` em `valor_novo`, sem `descricao`.

---

## 3. Detalhe do chamado incompleto

**Onde:** `GET /chamados/:idCliente/:id` (`api.controller.ts`, `chamado()`), que hoje inclui só `comentarios_chamados` e `anexos_chamados`.

Incluir na resposta:
- **Ativos vinculados** (`chamados_ativos` + dados do ativo: `id`, `nome`, `codigo_patrimonio`, `tipo`). O `POST /chamados/:id/ativos` grava o vínculo, mas o front não tem como mostrá-lo.
- **Ativo afetado** informado na abertura (`id_ativo_afetado`), se estiver em outra coluna/tabela.
- **Problemas e mudanças vinculados** (`chamados_problemas`, `mudancas_chamados`): `id`, `titulo`, `status`.
- **Avaliação CSAT** do chamado (`nota_satisfacao`, `comentarios`, `data`), ou ao menos `avaliado: boolean`. Hoje o front só descobre que já foi avaliado ao receber 409, e guarda a nota no navegador.
- **Worklogs, pausas e histórico de status**, se ainda não vierem (o front tem abas para isso).

---

## 4. Base de conhecimento

- **Rascunhos não aparecem em lugar nenhum:** `GET /artigos-kb` filtra `status: 'PUBLICADO'`. Um artigo criado como `RASCUNHO` ou `REVISAO` some para sempre.
  - Sugestão: aceitar `?status=` (ou `?meus=true`) para TECNICO+, devolvendo os artigos do autor ou de todos os status.
- **Não há edição nem publicação:** falta `PATCH /artigos-kb/:id` (`titulo`, `conteudo`, `id_categoria`, `status`) para revisar ou publicar um rascunho.
- **Falta `GET /artigos-kb/:id`** (o front hoje baixa a lista inteira para abrir um artigo).
- **Votos:** a listagem não traz a contagem de feedback (`votos_uteis`, `votos_nao_uteis`) nem o voto do usuário logado (`meu_voto`). O front mostra 0 e guarda o voto no navegador.
- **Rotas duplicadas com regras diferentes:**
  - `POST /categorias-kb` (`@Roles('TECNICO')`) e `POST /kb/categorias` (`@Roles('GESTOR')`) fazem a mesma coisa com permissões diferentes.
  - O mesmo vale para os pares `POST /artigos-kb` × `POST /kb/artigos` e os dois endpoints de feedback.
  - Sugestão: manter um só de cada e definir qual perfil pode criar categoria.

---

## 5. Aprovações

- `GET /aprovacoes` devolve só `PENDENTE`. O solicitante nunca vê se o pedido foi aprovado ou rejeitado (nem a `justificativa_aprovador`), e o gestor não tem histórico.
  - Sugestão: aceitar `?status=PENDENTE|APROVADO|REJEITADO|TODOS` (padrão `PENDENTE` para não quebrar).
- Incluir `data_decisao` e `justificativa_aprovador` na resposta.

---

## 6. Problemas e Mudanças (ITIL)

Hoje só existem `GET` (lista) e `POST`. Faltam:
- **Mudar status:** `PATCH /problemas/:id` (`status`, `causa_raiz`, `solucao_contorno`, `id_tecnico_atribuido`, `data_resolucao`) e `PATCH /mudancas/:id` (`status`, janela). Sem isso, um problema fica eternamente `SOB_INVESTIGACAO` e uma mudança eternamente `RASCUNHO`.
- **Lista oficial de status** (enum) de cada um, para o front não precisar adivinhar os códigos.
- **Ao aprovar uma aprovação vinculada a uma mudança**, atualizar o status da mudança (ex.: `RASCUNHO` → `APROVADA`/`REJEITADA`). Hoje a decisão não reflete na mudança.
- **Chamados vinculados** a cada problema/mudança na resposta (ou em `GET /problemas/:id` e `GET /mudancas/:id`).

---

## 7. SLA

- **Políticas não podem ser editadas nem desativadas:** não há `PATCH /admin/politicas-sla/:id`. Para mudar uma meta é preciso criar outra política, e as antigas continuam ativas, o que gera conflito de prioridade × tipo.
  - Sugestão: `PATCH` com `status` (ATIVO/INATIVO) e tempos.
- **Horários, intervalos e feriados não podem ser editados ou removidos:** sugestão de `PATCH`/`DELETE` em `/admin/horarios-comerciais/:id`, `/admin/horarios-comerciais/:id/intervalos/:idIntervalo` e `/admin/feriados/:id`.
- `GET /politicas-sla` traz `id_horario_comercial`, mas sem o nome do horário. Com o item 2 resolvido, isso deixa de ser problema.

---

## 8. Auditoria

- **Códigos de ação duplicados para a mesma operação**, o que atrapalha o filtro por `acao`:
  - `CREATE_USER` / `CREATE_USUARIO`
  - `UPDATE_USER` / `UPDATE_USUARIO`
  - `CREATE_DEPARTMENT` / `CREATE_DEPARTAMENTO`
  - `CREATE_SUPPORT_GROUP` / `CREATE_GRUPO`
  - `CREATE_KB_CATEGORY` / `CREATE_CATEGORIA_KB`
  - `CREATE_KB_ARTICLE` / `CREATE_ARTIGO`
  - `ADD_KB_FEEDBACK` / `FEEDBACK_ARTIGO`
  - `UPSERT_BRANDING` / `UPDATE_BRANDING`

  Sugestão: padronizar um código por operação.
- **`LINK_ATIVO`** grava `registro_id = id do chamado` e `valor_novo = { id_ativo }`. Funciona, mas o padrão das outras ações é `registro_id` = id do registro criado. Vale documentar ou incluir `id_chamado` explicitamente em `valor_novo`.
- **Teto fixo de 200** em `/admin/auditoria` sem paginação: com o volume crescendo, períodos maiores ficam truncados. Sugestão: aceitar `pagina`/`limite` ou cursor.

---

## 9. Resumo por prioridade

1. **Segurança:** itens 1.1, 1.2 e 1.3.
2. **Consultas que faltam:** `GET` de horários comerciais, feriados e categorias da KB (item 2).
3. **Detalhe do chamado:** ativos vinculados, CSAT e vínculos ITIL (item 3).
4. **Ciclo de vida:** `PATCH` de status para problemas, mudanças, artigos da KB e políticas de SLA (itens 4, 6 e 7).
5. **Histórico de aprovações** (item 5).
6. **Padronização dos códigos de auditoria e das rotas duplicadas da KB** (itens 4 e 8).
