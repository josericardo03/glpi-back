import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    try {
      await Promise.race([
        this.$connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Prisma connect timeout')), 2500),
        ),
      ]);
    } catch (error) {
      console.warn(
        'Prisma não conectou no Postgres (pooler). A API segue via Data API do Supabase.',
        error instanceof Error ? error.message : error,
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
