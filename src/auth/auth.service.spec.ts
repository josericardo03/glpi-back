import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('AuthService', () => {
  const prisma = {
    usuarios: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    clientes: {
      findUnique: vi.fn(),
    },
  };

  const jwt = {
    signAsync: vi.fn().mockResolvedValue('jwt-token'),
  };

  let service: AuthService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'JWT_EXPIRES_IN' ? '8h' : 'x'.repeat(32),
            getOrThrow: () => 'x'.repeat(32),
          },
        },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('rejeita credenciais inexistentes sem revelar o motivo', async () => {
    prisma.usuarios.findMany.mockResolvedValue([]);
    await expect(
      service.login({ email: 'a@b.com', password: 'senha12345' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('exige id_cliente quando o e-mail existe em mais de um tenant', async () => {
    prisma.usuarios.findMany.mockResolvedValue([
      { senha_hash: '$2b$10$abcdefghijklmnopqrstuv' },
      { senha_hash: '$2b$10$abcdefghijklmnopqrstuv' },
    ]);
    await expect(
      service.login({ email: 'a@b.com', password: 'senha12345' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('e-mail em mais de um cliente', () => {
    const linha = (idCliente: number, senhaHash: string) => ({
      id: idCliente * 10,
      id_cliente: idCliente,
      email: 'a@b.com',
      nome: 'Ana',
      cargo: 'Analista',
      perfil: 'SOLICITANTE',
      status: 'ATIVO',
      senha_hash: senhaHash,
      clientes: { id: idCliente, razao_social: `R${idCliente}`, nome_fantasia: `Cliente ${idCliente}`, status: 'ATIVO' },
    });

    it('entra direto quando a senha confere em um só cliente', async () => {
      const hash = await bcrypt.hash('senha12345', 4);
      prisma.usuarios.findMany.mockResolvedValue([linha(1, hash), linha(2, await bcrypt.hash('outra-senha', 4))]);
      prisma.usuarios.update.mockResolvedValue({});
      const r = await service.login({ email: 'a@b.com', password: 'senha12345' });
      expect(r.user.id_cliente).toBe(1);
    });

    it('devolve 409 com os clientes cuja senha confere, para o usuário escolher', async () => {
      const hash = await bcrypt.hash('senha12345', 4);
      prisma.usuarios.findMany.mockResolvedValue([linha(1, hash), linha(2, hash)]);
      const erro = await service.login({ email: 'a@b.com', password: 'senha12345' }).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ConflictException);
      expect((erro as ConflictException).getResponse()).toMatchObject({
        clientes: [
          { id: 1, nome: 'Cliente 1' },
          { id: 2, nome: 'Cliente 2' },
        ],
      });
    });

    it('não revela os clientes quando a senha está errada', async () => {
      const hash = await bcrypt.hash('senha12345', 4);
      prisma.usuarios.findMany.mockResolvedValue([linha(1, hash), linha(2, hash)]);
      await expect(service.login({ email: 'a@b.com', password: 'errada-errada' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
