import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async current(user: AuthUser) {
    const cliente = await this.prisma.clientes.findUnique({
      where: { id: user.id_cliente },
      include: { configuracoes_branding: true },
    });

    if (!cliente) {
      throw new NotFoundException('Tenant não encontrado');
    }

    return {
      id: cliente.id,
      razao_social: cliente.razao_social,
      nome_fantasia: cliente.nome_fantasia,
      cnpj: cliente.cnpj,
      status: cliente.status,
      data_contratacao: cliente.data_contratacao,
      branding: cliente.configuracoes_branding
        ? {
            logo_url: cliente.configuracoes_branding.logo_url,
            cor_primaria: cliente.configuracoes_branding.cor_primaria,
            cor_secundaria: cliente.configuracoes_branding.cor_secundaria,
            cor_fundo: cliente.configuracoes_branding.cor_fundo,
            nome_portal: cliente.configuracoes_branding.nome_portal,
          }
        : null,
    };
  }
}
