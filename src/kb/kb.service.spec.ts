import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { KbService } from './kb.service.js';

const base: AuthUser = {
  id: 7,
  id_cliente: 1,
  email: 't@x.com',
  nome: 'Técnico',
  perfil: 'TECNICO',
  cargo: 'Analista',
  status: 'ATIVO',
};

describe('KbService.removerRascunho', () => {
  const tx = { artigos_kb: { delete: vi.fn() } };
  const prisma = {
    artigos_kb: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { record: vi.fn() };
  let service: KbService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new KbService(prisma as never, audit as never, {} as never);
  });

  it('o autor exclui o próprio rascunho e a exclusão é auditada', async () => {
    prisma.artigos_kb.findFirst.mockResolvedValue({ id: 3, titulo: 'x', status: 'RASCUNHO', id_autor: 7 });
    await expect(service.removerRascunho(base, 3)).resolves.toEqual({ removido: true });
    expect(tx.artigos_kb.delete).toHaveBeenCalledOnce();
    expect(audit.record.mock.calls[0]![1]).toMatchObject({ acao: 'DELETE_KB_ARTICLE' });
  });

  it('artigo publicado não pode ser excluído', async () => {
    prisma.artigos_kb.findFirst.mockResolvedValue({ id: 3, titulo: 'x', status: 'PUBLICADO', id_autor: 7 });
    await expect(service.removerRascunho(base, 3)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.artigos_kb.delete).not.toHaveBeenCalled();
  });

  it('um técnico não exclui o rascunho de outro autor, mas um gestor exclui', async () => {
    prisma.artigos_kb.findFirst.mockResolvedValue({ id: 3, titulo: 'x', status: 'RASCUNHO', id_autor: 99 });
    await expect(service.removerRascunho(base, 3)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.removerRascunho({ ...base, perfil: 'GESTOR' }, 3)).resolves.toEqual({ removido: true });
  });

  it('artigo inexistente (ou de outro tenant) responde 404', async () => {
    prisma.artigos_kb.findFirst.mockResolvedValue(null);
    await expect(service.removerRascunho(base, 3)).rejects.toBeInstanceOf(NotFoundException);
  });
});
