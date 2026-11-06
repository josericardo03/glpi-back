import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import { SeedService } from './seed.service.js';

export type Migracao = {
  nome: string;
  arquivo: string;
  /** Marcada como aplicada, sem executar, quando o banco já tem a tabela `clientes` (bancos anteriores ao controle). */
  baseline?: boolean;
};

/**
 * Migrações em ordem. Cada uma roda uma única vez e fica registrada em `schema_migrations`.
 * Para mudar o banco, crie um novo arquivo em `prisma/sql` e acrescente-o ao final desta lista.
 */
export const MIGRACOES: Migracao[] = [
  { nome: '001_schema_v7', arquivo: 'itsm-schema-v7.sql', baseline: true },
  { nome: '002_anexos_artigos_kb', arquivo: 'itsm-anexos-artigos-kb.sql' },
  { nome: '003_correcoes_dados', arquivo: 'itsm-correcoes.sql' },
  { nome: '004_indices', arquivo: 'itsm-indices.sql' },
  { nome: '005_pausa_unica_por_chamado', arquivo: 'itsm-pausa-unica.sql' },
  { nome: '006_sla_alertas', arquivo: 'itsm-sla-alertas.sql' },
  { nome: '007_autenticacao', arquivo: 'itsm-autenticacao.sql' },
  { nome: '008_mapas_software', arquivo: 'itsm-mapas-software.sql' },
];

/** Identificador do lock que impede duas instâncias de migrarem ao mesmo tempo. */
const LOCK_MIGRACOES = 727_001;

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
    const url = this.config.get<string>('DIRECT_URL') ?? this.config.get<string>('DATABASE_URL');

    if (!url) {
      this.logger.warn('DIRECT_URL/DATABASE_URL ausente. Schema SQL não será aplicado.');
      return;
    }

    // Em produção, falhar ao migrar interrompe a subida: rodar com o schema pela metade é pior que não subir.
    const estrito = (this.config.get<string>('DB_BOOTSTRAP_STRICT') ?? String(process.env.NODE_ENV === 'production')) === 'true';

    const client = new pg.Client({
      connectionString: url,
      ssl: sslDoPostgres(url),
      connectionTimeoutMillis: 8000,
    });

    try {
      await client.connect();
      await this.migrar(client);
      await this.indiceTrigram(client);
    } catch (error) {
      const detalhe = error instanceof Error ? error.message : String(error);
      if (estrito) {
        this.logger.error(`Falha ao aplicar o schema SQL: ${detalhe}`);
        throw error;
      }
      this.logger.warn(`Não foi possível aplicar o schema SQL (Postgres/TLS). A API sobe mesmo assim. ${detalhe}`);
    } finally {
      await client.end().catch(() => undefined);
    }

    await this.seed.runIfNeeded();
  }

  private async migrar(client: pg.Client) {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_MIGRACOES]);
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          nome VARCHAR(100) PRIMARY KEY,
          aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      const aplicadas = new Set(
        (await client.query<{ nome: string }>('SELECT nome FROM schema_migrations')).rows.map((r) => r.nome),
      );

      for (const migracao of MIGRACOES) {
        if (aplicadas.has(migracao.nome)) continue;

        if (migracao.baseline) {
          const existe = await client.query<{ regclass: string | null }>(`SELECT to_regclass('public.clientes') AS regclass`);
          if (existe.rows[0]?.regclass) {
            await this.registrar(client, migracao.nome);
            this.logger.log(`Schema ITSM já existe (tabela clientes). ${migracao.nome} registrada sem executar.`);
            continue;
          }
        }

        const caminho = join(process.cwd(), 'prisma', 'sql', migracao.arquivo);
        if (!existsSync(caminho)) {
          if (migracao.baseline) {
            this.logger.warn(`Arquivo SQL não encontrado: ${caminho}`);
            continue;
          }
          throw new Error(`Arquivo de migração não encontrado: ${caminho}`);
        }
        const sql = await readFile(caminho, 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await this.registrar(client, migracao.nome);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw new Error(`Migração ${migracao.nome} falhou: ${error instanceof Error ? error.message : String(error)}`);
        }
        this.logger.log(`Migração ${migracao.nome} aplicada.`);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_MIGRACOES]).catch(() => undefined);
    }
  }

  private registrar(client: pg.Client, nome: string) {
    return client.query('INSERT INTO schema_migrations (nome) VALUES ($1) ON CONFLICT DO NOTHING', [nome]);
  }

  /** Opcional: depende da extensão pg_trgm, que nem todo usuário do banco pode criar. */
  private async indiceTrigram(client: pg.Client) {
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      await client.query('CREATE INDEX IF NOT EXISTS idx_chamados_titulo_trgm ON chamados USING gin (titulo gin_trgm_ops)');
      this.logger.log('Índice trigram de chamados aplicado.');
    } catch (erro) {
      this.logger.warn(`Índice trigram não aplicado. ${erro instanceof Error ? erro.message : String(erro)}`);
    }
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
