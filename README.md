# Portal ITSM – backend (glpi-back)

API NestJS + Prisma + PostgreSQL local (`itsm`).

```bash
npm install
copy .env.example .env
npm run start:dev
```

Health: `GET http://localhost:3000/api/health`

O schema SQL em `prisma/sql/itsm-schema-v7.sql` é aplicado na primeira subida se a tabela `clientes` não existir.

```bash
npx prisma db pull
npx prisma generate
```
