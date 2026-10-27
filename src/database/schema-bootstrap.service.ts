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

    const client = new pg.Client({
      connectionString: url,
      ssl: sslDoPostgres(url),
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

      const anexosArtigosPath = join(process.cwd(), 'prisma', 'sql', 'itsm-anexos-artigos-kb.sql');
      if (existsSync(anexosArtigosPath)) {
        const anexosArtigos = await readFile(anexosArtigosPath, 'utf8');
        await client.query(anexosArtigos);
        this.logger.log('Tabela anexos_artigos_kb aplicada.');
      }

      const correcoesPath = join(process.cwd(), 'prisma', 'sql', 'itsm-correcoes.sql');
      if (existsSync(correcoesPath)) {
        const correcoes = await readFile(correcoesPath, 'utf8');
        await client.query(correcoes);
        this.logger.log('Correções de dados ITSM aplicadas.');
      }

      const indicesPath = join(process.cwd(), 'prisma', 'sql', 'itsm-indices.sql');
      if (existsSync(indicesPath)) {
        const indices = await readFile(indicesPath, 'utf8');
        await client.query(indices);
        this.logger.log('Índices ITSM aplicados.');
      }
      try {
        await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        await client.query(
          'CREATE INDEX IF NOT EXISTS idx_chamados_titulo_trgm ON chamados USING gin (titulo gin_trgm_ops)',
        );
        this.logger.log('Índice trigram de chamados aplicado.');
      } catch (erro) {
        this.logger.warn(
          `Índice trigram não aplicado. ${erro instanceof Error ? erro.message : String(erro)}`,
        );
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

/** SSL só quando a URL ou o ambiente pedem. No Docker o Postgres interno não tem certificado. */
function sslDoPostgres(url: string): false | { rejectUnauthorized: false } {
  if (process.env.DATABASE_SSL === 'true') return { rejectUnauthorized: false };
  if (/[?&]sslmode=(require|verify-full|verify-ca|no-verify)/.test(url)) {
    return { rejectUnauthorized: false };
  }
  return false;
}
