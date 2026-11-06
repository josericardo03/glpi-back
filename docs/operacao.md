# Operação

Guia de quem mantém o ITSM no ar: variáveis, logs, métricas, backup/restauração e verificação (CI).

## Variáveis de ambiente que importam em produção

| Variável | Para quê |
| --- | --- |
| `DATABASE_URL`, `DIRECT_URL` | Postgres (a `DIRECT_URL` é usada nas migrações). |
| `JWT_SECRET` | Assina os tokens de acesso. Mínimo de 32 caracteres aleatórios. |
| `JWT_EXPIRES_IN` | Vida do token de acesso (padrão `15m`; a sessão é renovada pelo cookie de refresh). |
| `INTEGRACOES_SECRET` | Chave que cifra senhas de SMTP, segredos de webhook e tokens. Se mudar, reconfigure as integrações. |
| `CORS_ORIGIN` | Origem exata do front (com cookies, não deixe aberto). |
| `APP_URL` | URL pública do front: entra nos links dos e-mails (recuperar senha, chamados). |
| `TRUST_PROXY` | Proxies confiáveis para `req.ip` (o padrão atende o nginx do compose). |
| `LOG_FORMAT` | `json` (padrão em produção) ou `texto`. `LOG_LEVEL=debug` liga os logs de depuração. |
| `METRICS_TOKEN` | Liga `GET /api/metrics`. Sem ele a rota responde 404. |
| `ANEXOS_STORAGE`, `ANEXOS_DIR` | `postgres` (padrão no código) ou `disco`. O compose usa `disco` em `/dados/anexos`. |
| `SLA_VARREDURA_MS` | Intervalo da varredura de SLA (padrão 60 s). Só uma instância varre por vez (lock no banco). |
| `REDE_PERMITE_INTERNA` | `true` permite webhooks/SMTP para IPs privados. Deixe desligado, salvo rede interna controlada. |
| `DB_BOOTSTRAP_STRICT` | Em produção, falhar a subida se uma migração não puder ser aplicada. |

## Logs

Em produção cada evento é **uma linha JSON** no stdout (stderr para erros):

```json
{"ts":"2026-11-06T14:59:23.381Z","nivel":"warn","contexto":"Acesso","evento":"http","id_requisicao":"abc12345-teste","metodo":"GET","rota":"/api/chamados","caminho":"/api/chamados","status":401,"ms":2,"ip":"::ffff:127.0.0.1"}
```

- `id_requisicao` também volta no cabeçalho `X-Request-Id`; se o proxy já mandar um, ele é mantido. Peça esse id a quem reportar um erro.
- `rota` é o padrão (`/api/chamados/:id`), nunca o caminho com o id real.
- Linhas `evento: "http"` têm nível `log` (2xx/3xx), `warn` (4xx) e `error` (5xx).
- A auditoria de negócio (login, falha de login, mudança de senha, MFA, etc.) fica na tabela de auditoria, não só no log.

## Saúde e métricas

- `GET /api/health/live`: o processo responde (não toca no banco). Use para *liveness*.
- `GET /api/health`: confere o banco (503 se indisponível). Use para *readiness* e no healthcheck do compose.
- `GET /api/metrics` com `Authorization: Bearer $METRICS_TOKEN`: formato Prometheus.

Séries principais: `itsm_http_requests_total{metodo,rota,status}`, `itsm_http_request_duration_seconds` (histograma),
`itsm_chamados{status}`, `itsm_chamados_sla_vencido_abertos`, `itsm_sessoes_ativas`, `itsm_banco_up`, além de memória,
CPU e atraso do laço de eventos do Node.

```yaml
scrape_configs:
  - job_name: itsm
    metrics_path: /api/metrics
    authorization: { credentials: "<METRICS_TOKEN>" }
    static_configs: [{ targets: ["itsm.exemplo.com:80"] }]
```

Alertas sugeridos: `itsm_banco_up == 0`; taxa de 5xx > 2% por 5 min; p95 de `itsm_http_request_duration_seconds` > 1 s;
`itsm_chamados_sla_vencido_abertos` crescendo continuamente. O projeto **não traz** Prometheus/Grafana/Alertmanager:
as métricas estão expostas, a coleta e os alertas são da sua infraestrutura.

## Backup e restauração

O `docker-compose.yml` (repositório do front) tem o serviço `backup`: ao subir e a cada `BACKUP_INTERVALO_HORAS` (24)
ele grava no volume `backups`:

- `itsm-<carimbo>.dump`: `pg_dump` em formato custom, lido de volta (`pg_restore --list`) antes de ser aceito;
- `anexos-<carimbo>.tar.gz`: o volume de anexos (quando `ANEXOS_STORAGE=disco`, os anexos **não** estão no banco);
- `SHA256-<carimbo>.txt`: somas de verificação. Backups com mais de `BACKUP_RETENCAO_DIAS` (14) são apagados.

**Isso ainda é o mesmo servidor.** Copie o volume `backups` para fora da máquina (rclone/rsync/S3, snapshot do disco).
Backup que mora no mesmo disco do banco não protege contra perda do disco.

```bash
# fazer um backup agora
docker compose run --rm backup sh /backup/backup.sh

# listar
docker compose run --rm --entrypoint ls backup -l /backups
```

### Restaurar (destrutivo)

```bash
docker compose stop api web
# copie o .dump (e o .tar.gz) para dentro do container de backup, ou rode o script no host com os mesmos arquivos
docker compose run --rm -e CONFIRMO=sim -e DATABASE_URL=postgresql://itsm:SENHA@postgres:5432/itsm \
  -e ANEXOS_DIR=/dados/anexos -v anexos_restaurar:/dados/anexos \
  backup sh /backup/restaurar.sh /backups/itsm-AAAAMMDDTHHMMSSZ.dump /backups/anexos-AAAAMMDDTHHMMSSZ.tar.gz
docker compose up -d
```

(no compose o volume de anexos tem o prefixo do projeto; ajuste o `-v` ao nome real de `docker volume ls`).
O script confere a soma SHA-256, restaura numa única transação (falhou, nada muda) e extrai os anexos.

**Teste a restauração** num banco vazio de tempos em tempos. O fluxo dump → restore foi exercitado com este script
(mesmo número de chamados, usuários, anexos e migrações; arquivo adulterado é recusado), mas o serviço do compose em si
não foi executado em Docker durante o desenvolvimento.

### Migrar anexos antigos do banco para o disco

Quem já tem anexos no Postgres e passa a usar `ANEXOS_STORAGE=disco` pode esvaziar a coluna sem perder nada
(antes, faça um backup):

```bash
DATABASE_URL=... ANEXOS_DIR=/dados/anexos node scripts/mover-anexos-para-disco.mjs --dry-run
DATABASE_URL=... ANEXOS_DIR=/dados/anexos node scripts/mover-anexos-para-disco.mjs
```

Depois de conferir os downloads, `VACUUM FULL anexos_chamados, anexos_artigos_kb;` devolve o espaço.

## Verificação contínua (CI)

- **Back** (`.github/workflows/ci.yml`): tipos, lint, testes unitários, build; sobe a API num Postgres de serviço
  (as migrações rodam do zero) e executa os três testes de fumaça (fluxos, autenticação/MFA/sessões, integrações),
  além de `health/live` e `metrics`.
- **Front** (`.github/workflows/ci.yml`): `tsc` e `next build` (API real e modo mock).
- O workflow `Docker` existente continua construindo/publicando a imagem e fazendo o deploy.

Rodar o mesmo localmente (com um Postgres descartável):

```bash
npm run build && node dist/main.js &   # PORT=3100 e as variáveis do .env.example
npm run test:smoke && npm run test:smoke:auth && npm run test:smoke:integracoes
```

## O que ainda não existe

- Conectores reais de **LDAP/AD** (o teste de conexão só verifica TCP) e leitura de caixa **IMAP** (a entrada de e-mail é
  um endpoint `POST /api/entrada/email` que um serviço de e-mail/automação chama com token).
- Armazenamento em **S3** (há banco e disco).
- Pilha de monitoramento/alertas (somente as métricas expostas) e cópia externa dos backups.
- Paginação **no servidor** (busca, filtros, totais por `X-Total-Count`) vale para chamados, triagem, aprovações, problemas, mudanças, ativos (com `GET /ativos/resumo`) e usuários. A **Base de Conhecimento** e os seletores (usuários/ativos em formulários) ainda carregam a lista inteira e filtram no navegador: com milhares de artigos ou ativos, isso é o próximo gargalo.
- Limitador de requisições é **em memória**: com várias instâncias da API cada uma conta separado.
