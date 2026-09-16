# Portal ITSM – backend (glpi-back)

API NestJS gerada a partir das telas do protótipo: tickets, triagem, dashboards, cadastros, SLA, KB, ativos, relatórios, auditoria, branding e integrações.

## Subir o servidor

```bash
npm install
copy .env.example .env
npm run start:dev
```

Health: `GET http://localhost:3000/api/health`

Login de exemplo: `POST /api/auth/login` com `maria@empresa.com` / `123456`.

## Pastas

| Pasta | Tela do protótipo |
| --- | --- |
| `src/modules/auth` | Login |
| `src/modules/tickets` | Criar / detalhes / histórico |
| `src/modules/triage` | Fila de triagem |
| `src/modules/dashboards` | Gestor e técnico |
| `src/modules/users` | Gestão de usuários |
| `src/modules/groups` | Gestão de grupos |
| `src/modules/departments` | Departamentos |
| `src/modules/sla` | Regras de SLA |
| `src/modules/categories` | Categorias |
| `src/modules/approvals` | Aprovações |
| `src/modules/reports` | Relatórios |
| `src/modules/knowledge-base` | Base de conhecimento |
| `src/modules/assets` | Inventário de ativos |
| `src/modules/notifications` | Central de notificações |
| `src/modules/audit` | Logs de auditoria |
| `src/modules/branding` | Branding |
| `src/modules/integrations` | Integrações |
| `src/modules/profile` | Meu perfil |
| `prisma/schema.prisma` | Modelo para PostgreSQL |

Os endpoints hoje devolvem dados mock para o front ligar sem banco. Quando o Postgres estiver no ar: `npx prisma migrate dev`.
