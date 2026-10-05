import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

const poolLogger = new Logger('PrismaPool');

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL não definida');
    }
    const { connectionString, max } = poolConfig(url);
    const pool = new Pool({
      connectionString,
      max,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      query_timeout: 30_000,
    });
    super({
      adapter: new PrismaPg(pool, {
        disposeExternalPool: true,
        onPoolError: (error) => poolLogger.error(error.message),
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

function poolConfig(url: string) {
  const limiteUrl = url.match(/[?&]connection_limit=(\d+)/);
  const semLimite = url
    .replace(/([?&])connection_limit=\d+&/, '$1')
    .replace(/[?&]connection_limit=\d+$/, '');
  const pedido = Number(process.env.PG_POOL_MAX ?? limiteUrl?.[1] ?? 20);
  const max = Number.isFinite(pedido) && pedido > 0 ? pedido : 20;
  return { connectionString: semLimite, max };
}
