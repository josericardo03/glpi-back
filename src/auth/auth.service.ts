import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import type { AuthUser, JwtPayload, PerfilUsuario } from './auth.types.js';

const BCRYPT_DUMMY =
  '$2b$10$2bFbWHtMwmUBC7P/u5VmrOoDag7CgAGO6wlPnZHaWQ477F/QlBuOa';

const JWT_ISSUER = 'glpi-back';
const JWT_AUDIENCE = 'itsm-portal';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly expiresIn: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.expiresIn = this.config.get<string>('JWT_EXPIRES_IN') ?? '8h';
    const secret = this.config.get<string>('JWT_SECRET') ?? '';
    if (secret.length < 32) {
      this.logger.warn(
        'JWT_SECRET tem menos de 32 caracteres. Defina um segredo forte em produção.',
      );
    }
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const candidatos = await this.prisma.usuarios.findMany({
      where: {
        email,
        ...(dto.id_cliente !== undefined ? { id_cliente: dto.id_cliente } : {}),
      },
      include: { clientes: true },
      take: 3,
    });

    const ambiguo = !dto.id_cliente && candidatos.length > 1;
    const usuario = ambiguo ? undefined : candidatos[0];

    const hash = usuario?.senha_hash ?? BCRYPT_DUMMY;
    const senhaOk = await this.verificarSenha(dto.password, hash);

    if (
      ambiguo ||
      !usuario ||
      !senhaOk ||
      usuario.status !== 'ATIVO' ||
      usuario.clientes.status !== 'ATIVO'
    ) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const perfil = this.assertPerfil(usuario.perfil);
    const payload: JwtPayload = {
      sub: usuario.id,
      id_cliente: usuario.id_cliente,
      perfil,
      email: usuario.email,
    };

    const access_token = await this.jwt.signAsync(payload, {
      expiresIn: this.expiresIn as `${number}h`,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    await this.prisma.usuarios.update({
      where: {
        id_cliente_id: { id_cliente: usuario.id_cliente, id: usuario.id },
      },
      data: { ultimo_login: new Date() },
    });

    const user = this.toAuthUser(usuario, perfil);

    return {
      access_token,
      token_type: 'Bearer' as const,
      expires_in: this.expiresInToSeconds(this.expiresIn),
      user: this.toMe(user, usuario.clientes),
    };
  }

  async validatePayload(payload: JwtPayload): Promise<AuthUser> {
    if (!payload?.sub || !payload.id_cliente) {
      throw new UnauthorizedException();
    }

    const usuario = await this.prisma.usuarios.findUnique({
      where: {
        id_cliente_id: { id_cliente: payload.id_cliente, id: payload.sub },
      },
      include: { clientes: true },
    });

    if (
      !usuario ||
      usuario.status !== 'ATIVO' ||
      usuario.clientes.status !== 'ATIVO'
    ) {
      throw new UnauthorizedException();
    }

    if (usuario.email.toLowerCase() !== payload.email.toLowerCase()) {
      throw new UnauthorizedException();
    }

    return this.toAuthUser(usuario, this.assertPerfil(usuario.perfil));
  }

  async me(user: AuthUser) {
    const cliente = await this.prisma.clientes.findUnique({
      where: { id: user.id_cliente },
    });
    if (!cliente) {
      throw new ForbiddenException('Tenant indisponível');
    }
    return this.toMe(user, cliente);
  }

  private async verificarSenha(plain: string, stored: string) {
    if (/^\$2[aby]\$/.test(stored)) {
      return bcrypt.compare(plain, stored);
    }
    await bcrypt.compare(plain, BCRYPT_DUMMY);
    return false;
  }

  private assertPerfil(perfil: string): PerfilUsuario {
    const allowed: PerfilUsuario[] = [
      'ADMIN',
      'GESTOR',
      'TECNICO',
      'SOLICITANTE',
    ];
    if (!allowed.includes(perfil as PerfilUsuario)) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    return perfil as PerfilUsuario;
  }

  private toAuthUser(
    usuario: {
      id: number;
      id_cliente: number;
      email: string;
      nome: string;
      perfil: string;
      cargo: string;
      status: string;
    },
    perfil: PerfilUsuario,
  ): AuthUser {
    return {
      id: usuario.id,
      id_cliente: usuario.id_cliente,
      email: usuario.email,
      nome: usuario.nome,
      perfil,
      cargo: usuario.cargo,
      status: usuario.status,
    };
  }

  private toMe(
    user: AuthUser,
    cliente: {
      id: number;
      razao_social: string;
      nome_fantasia: string;
      status: string;
    },
  ) {
    return {
      ...user,
      tenant: {
        id: cliente.id,
        razao_social: cliente.razao_social,
        nome_fantasia: cliente.nome_fantasia,
        status: cliente.status,
      },
    };
  }

  private expiresInToSeconds(value: string): number {
    const match = /^(\d+)([smhd])$/.exec(value.trim());
    if (!match) {
      return 8 * 3600;
    }
    const n = Number(match[1]);
    const unit = match[2];
    const map = { s: 1, m: 60, h: 3600, d: 86400 } as const;
    return n * map[unit as keyof typeof map];
  }
}

export { JWT_AUDIENCE, JWT_ISSUER };
