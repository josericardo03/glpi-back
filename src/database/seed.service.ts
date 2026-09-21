import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';

const DEMO_CNPJ = '00.000.000/0001-00';

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async runIfNeeded() {
    if (process.env.VITEST === 'true') {
      return;
    }

    try {
      const existentes = await this.prisma.clientes.count();
      if (existentes > 0) {
        this.logger.log('Seed ignorado: já existem clientes.');
        return;
      }

      const email =
        this.config.get<string>('SEED_ADMIN_EMAIL') ?? 'admin@itsm.local';
      const password =
        this.config.get<string>('SEED_ADMIN_PASSWORD') ?? 'Admin@123456';
      const senha_hash = await bcrypt.hash(password, 12);

      await this.prisma.$transaction(async (tx) => {
        const cliente = await tx.clientes.create({
          data: {
            razao_social: 'ITSM Demo Ltda',
            nome_fantasia: 'ITSM Demo',
            cnpj: DEMO_CNPJ,
            status: 'ATIVO',
          },
        });

        await tx.usuarios.create({
          data: {
            id_cliente: cliente.id,
            nome: 'Administrador',
            email,
            senha_hash,
            cargo: 'Administrador do sistema',
            perfil: 'ADMIN',
            status: 'ATIVO',
          },
        });

        await tx.configuracoes_branding.create({
          data: {
            id_cliente: cliente.id,
            nome_portal: 'Service Desk',
          },
        });
      });

      this.logger.log(
        `Tenant demo criado. Login: ${email} (defina SEED_ADMIN_PASSWORD para alterar a senha padrão).`,
      );
    } catch (error) {
      this.logger.warn(
        `Seed não executado. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
