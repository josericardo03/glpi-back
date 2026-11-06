import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRACOES } from './schema-bootstrap.service.js';

describe('lista de migrações', () => {
  it('tem nomes únicos e ordenados por prefixo numérico', () => {
    const nomes = MIGRACOES.map((m) => m.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect([...nomes].sort()).toEqual(nomes);
  });

  it('todos os arquivos referenciados existem em prisma/sql', () => {
    for (const m of MIGRACOES) {
      expect(existsSync(join(process.cwd(), 'prisma', 'sql', m.arquivo)), m.arquivo).toBe(true);
    }
  });

  it('só a primeira migração é baseline', () => {
    expect(MIGRACOES.filter((m) => m.baseline).map((m) => m.nome)).toEqual(['001_schema_v7']);
  });
});
