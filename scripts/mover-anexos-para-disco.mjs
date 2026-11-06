/**
 * Move os anexos que estão no banco (coluna BYTEA) para arquivos em ANEXOS_DIR, esvaziando a coluna.
 * Serve para quem passa a usar ANEXOS_STORAGE=disco e quer tirar o histórico de dentro do Postgres
 * (backups menores e mais rápidos). Pode ser interrompido e repetido: cada anexo é movido isoladamente.
 *
 *   DATABASE_URL=postgresql://... ANEXOS_DIR=/dados/anexos node scripts/mover-anexos-para-disco.mjs [--dry-run]
 *
 * Faça um backup antes. Depois de conferir os downloads, rode VACUUM FULL nas tabelas para devolver o espaço.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';

const require = createRequire(`${process.cwd()}/package.json`);
const pg = require('pg');

const TABELAS = ['anexos_chamados', 'anexos_artigos_kb'];
const LOTE = 50;
const simulacao = process.argv.includes('--dry-run');
const base = resolve(process.env.ANEXOS_DIR ?? './storage');

if (!process.env.DATABASE_URL) {
  console.error('Defina DATABASE_URL.');
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
await db.connect();

let movidos = 0;
let bytes = 0;
try {
  for (const tabela of TABELAS) {
    for (;;) {
      const { rows } = await db.query(
        `SELECT id_cliente, id, caminho_storage, conteudo FROM ${tabela}
         WHERE caminho_storage LIKE 'postgres://%' AND conteudo IS NOT NULL
         ORDER BY id_cliente, id LIMIT $1`,
        [LOTE],
      );
      if (rows.length === 0) break;
      for (const linha of rows) {
        const novo = linha.caminho_storage.replace(/^postgres:\/\//, 'disco://');
        const arquivo = resolve(base, novo.slice('disco://'.length));
        if (!arquivo.startsWith(base + sep)) throw new Error(`Caminho fora de ANEXOS_DIR: ${novo}`);
        if (simulacao) {
          movidos += 1;
          bytes += linha.conteudo.length;
          continue;
        }
        await mkdir(dirname(arquivo), { recursive: true });
        await writeFile(arquivo, linha.conteudo);
        // Só esvazia depois de o arquivo estar gravado, e só se o registro não mudou nesse meio tempo.
        const r = await db.query(
          `UPDATE ${tabela} SET caminho_storage = $1, conteudo = NULL WHERE id_cliente = $2 AND id = $3 AND caminho_storage = $4`,
          [novo, linha.id_cliente, linha.id, linha.caminho_storage],
        );
        if (r.rowCount === 1) {
          movidos += 1;
          bytes += linha.conteudo.length;
        }
      }
      if (simulacao) break; // sem UPDATE o mesmo lote voltaria para sempre
    }
  }
} finally {
  await db.end();
}

console.log(`${simulacao ? '[simulação] ' : ''}${movidos} anexo(s), ${(bytes / 1024 / 1024).toFixed(2)} MB ${simulacao ? 'seriam movidos' : 'movidos'} para ${base}`);
