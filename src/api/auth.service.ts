import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './login.dto.js';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(dto: LoginDto) {
    const usuario = await this.prisma.usuarios.findFirst({
      where: { email: dto.email, status: 'ATIVO' },
    });

    if (!usuario || usuario.senha_hash !== dto.password) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const { senha_hash: _, ...user } = usuario;
    return { accessToken: `local-${user.id}`, user };
  }
}
