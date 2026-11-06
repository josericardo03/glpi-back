/** Qualquer método de evento vira um espião que não faz nada. */
const EVENTOS_FALSOS = new Proxy({}, { get: () => vi.fn() });

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CatalogoService } from './catalogo.service.js';

const base: AuthUser = {
  id: 7,
  id_cliente: 1,
  email: 's@x.com',
  nome: 'Usuário',
  perfil: 'SOLICITANTE',
  cargo: 'Analista',
  status: 'ATIVO',
};
const gestor: AuthUser = { ...base, id: 20, perfil: 'GESTOR' };

describe('CatalogoService', () => {
  const tx = {
    requisicoes_aprovacao: { create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    mudancas: { findFirst: vi.fn(), update: vi.fn() },
  };
  const prisma = {
    chamados: { findFirst: vi.fn() },
    mudancas: { findFirst: vi.fn() },
    usuarios: { findFirst: vi.fn() },
    requisicoes_aprovacao: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { record: vi.fn() };
  let service: CatalogoService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CatalogoService(prisma as never, audit as never, EVENTOS_FALSOS as never);
  });

  describe('criarAprovacao', () => {
    it('o solicitante não pede aprovação para o chamado de outra pessoa', async () => {
      prisma.chamados.findFirst.mockResolvedValue({ id: 1, id_solicitante: 99 });
      await expect(
        service.criarAprovacao(base, { descricao: 'preciso', id_aprovador: 20, id_chamado: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ninguém aprova a própria solicitação', async () => {
      prisma.chamados.findFirst.mockResolvedValue({ id: 1, id_solicitante: 20 });
      prisma.usuarios.findFirst.mockResolvedValue({ id: 20, perfil: 'GESTOR' });
      await expect(
        service.criarAprovacao(gestor, { descricao: 'preciso', id_aprovador: 20, id_chamado: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('só procura aprovadores ativos', async () => {
      prisma.chamados.findFirst.mockResolvedValue({ id: 1, id_solicitante: 7 });
      prisma.usuarios.findFirst.mockResolvedValue(null);
      await expect(
        service.criarAprovacao(base, { descricao: 'preciso', id_aprovador: 20, id_chamado: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.usuarios.findFirst.mock.calls[0]![0].where.status).toBe('ATIVO');
    });
  });

  describe('decidir', () => {
    const pendente = { id: 4, id_cliente: 1, id_aprovador: 20, id_chamado: 1, id_mudanca: null, status: 'PENDENTE' };

    it('a segunda decisão simultânea recebe conflito (atualização condicionada a PENDENTE)', async () => {
      prisma.requisicoes_aprovacao.findFirst.mockResolvedValue(pendente);
      tx.requisicoes_aprovacao.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.decidir(gestor, 4, { status: 'APROVADO' })).rejects.toBeInstanceOf(ConflictException);
      expect(tx.requisicoes_aprovacao.updateMany.mock.calls[0]![0].where.status).toBe('PENDENTE');
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('registra a decisão quando ainda estava pendente', async () => {
      prisma.requisicoes_aprovacao.findFirst.mockResolvedValue(pendente);
      tx.requisicoes_aprovacao.updateMany.mockResolvedValue({ count: 1 });
      tx.requisicoes_aprovacao.findUniqueOrThrow.mockResolvedValue({ ...pendente, status: 'APROVADO' });
      await expect(service.decidir(gestor, 4, { status: 'APROVADO' })).resolves.toMatchObject({ status: 'APROVADO' });
      expect(audit.record).toHaveBeenCalledOnce();
    });
  });
});
