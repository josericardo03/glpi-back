import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
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
});
