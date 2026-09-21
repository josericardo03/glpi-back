# Portal ITSM – backend (glpi-back)

API NestJS + Prisma 7 + PostgreSQL local (`itsm`).

## Subir

```bash
npm install
copy .env.example .env
npm run start:dev
```

O schema `prisma/sql/itsm-schema-v7.sql` é aplicado na primeira subida se `clientes` não existir. Se o banco estiver vazio, um tenant demo é criado.

## Autenticação (fase 1)

Todas as rotas `/api/*` exigem `Authorization: Bearer <token>`, exceto:

- `GET /api/health`
- `POST /api/auth/login`

### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@itsm.local",
  "password": "Admin@123456"
}
```

`id_cliente` é opcional. Informe-o se o mesmo e-mail existir em mais de um tenant.

Resposta:

```json
{
  "access_token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": 28800,
  "user": {
    "id": 1,
    "id_cliente": 1,
    "email": "admin@itsm.local",
    "nome": "Administrador",
    "perfil": "ADMIN",
    "tenant": { "id": 1, "nome_fantasia": "ITSM Demo", "status": "ATIVO" }
  }
}
```

### Sessão e tenant

- `GET /api/auth/me` — usuário autenticado + tenant
- `GET /api/tenants/current` — dados do tenant e branding

O JWT carrega `sub`, `id_cliente`, `perfil` e `email`. A cada request o usuário e o cliente são recarregados; contas ou tenants inativos perdem o acesso. Listagens filtram por `id_cliente` do token.

Credenciais demo (apenas se o seed rodou em banco vazio): `admin@itsm.local` / `Admin@123456`. Altere `SEED_ADMIN_PASSWORD` e `JWT_SECRET` (≥ 32 caracteres) antes de qualquer ambiente compartilhado.

```bash
npx prisma db pull
npx prisma generate
```
