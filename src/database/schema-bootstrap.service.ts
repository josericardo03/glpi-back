import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import { SeedService } from './seed.service.js';

@Injectable()
export class SchemaBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(SchemaBootstrapService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly seed: SeedService,
  ) {}

  async onModuleInit() {
    if (process.env.VITEST === 'true') {
      return;
    }
    const url =
      this.config.get<string>('DIRECT_URL') ??
      this.config.get<string>('DATABASE_URL');

    if (!url) {
      this.logger.warn('DIRECT_URL/DATABASE_URL ausente. Schema SQL não será aplicado.');
      return;
    }

    const sqlPath = join(process.cwd(), 'prisma', 'sql', 'itsm-schema-v7.sql');
    if (!existsSync(sqlPath)) {
      this.logger.warn(`Arquivo SQL não encontrado: ${sqlPath}`);
      await this.seed.runIfNeeded();
      return;
    }

    const isLocal =
      url.includes('localhost') || url.includes('127.0.0.1');

    const client = new pg.Client({
      connectionString: url,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });

    try {
      await client.connect();
      const exists = await client.query<{ regclass: string | null }>(
        `SELECT to_regclass('public.clientes') AS regclass`,
      );

      if (exists.rows[0]?.regclass) {
        this.logger.log('Schema ITSM já existe (tabela clientes). Nada a criar.');
      } else {
        const sql = await readFile(sqlPath, 'utf8');
        await client.query(sql);
        this.logger.log('Schema ITSM v7 criado no PostgreSQL.');
      }
    } catch (error) {
      this.logger.warn(
        `Não foi possível aplicar o schema SQL (Postgres/TLS). A API sobe mesmo assim. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      await client.end().catch(() => undefined);
    }

    await this.seed.runIfNeeded();
  }
}
