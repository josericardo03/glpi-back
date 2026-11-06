import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.types.js';
import { MapasService } from './mapas.service.js';

const user = { id: 1, id_cliente: 7, perfil: 'TECNICO' } as AuthUser;

function montar(opcoes: { mapa?: object | null; ligacoes?: number; padrao?: { id: number } | null } = {}) {
  const prisma = {
    mapas_software: {
      findFirst: vi.fn(async (args: { where: { nome?: unknown } }) =>
        args.where.nome ? (opcoes.padrao ?? null) : (opcoes.mapa === undefined ? { id: 3, nome: 'Rede', descricao: null } : opcoes.mapa),
      ),
      create: vi.fn(async () => ({ id: 9 })),
      delete: vi.fn(async () => ({})),
    },
    relacionamentos_ativos: { count: vi.fn(async () => opcoes.ligacoes ?? 0) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const audit = { record: vi.fn(async () => undefined) };
  return { prisma, audit, service: new MapasService(prisma as never, audit as never) };
}

describe('MapasService', () => {
  it('recusa apagar mapa com dependências sem confirmação', async () => {
    const { service, prisma } = montar({ ligacoes: 2 });
    await expect(service.remover(user, 3, false)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.mapas_software.delete).not.toHaveBeenCalled();
  });

  it('apaga o mapa com dependências quando confirmado e audita', async () => {
    const { service, prisma, audit } = montar({ ligacoes: 2 });
    await expect(service.remover(user, 3, true)).resolves.toEqual({ removido: true, ligacoes_removidas: 2 });
    expect(prisma.mapas_software.delete).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ acao: 'DELETE_MAPA_SOFTWARE' }));
  });

  it('mapa de outro tenant ou inexistente é 404', async () => {
    const { service } = montar({ mapa: null });
    await expect(service.remover(user, 3, true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolver cria o mapa Principal quando o tenant ainda não tem', async () => {
    const { service, prisma } = montar({ padrao: null });
    await expect(service.resolver(prisma as never, 7)).resolves.toBe(9);
    expect(prisma.mapas_software.create).toHaveBeenCalledTimes(1);
  });

  it('resolver reaproveita o Principal existente', async () => {
    const { service, prisma } = montar({ padrao: { id: 4 } });
    await expect(service.resolver(prisma as never, 7)).resolves.toBe(4);
    expect(prisma.mapas_software.create).not.toHaveBeenCalled();
  });
});
