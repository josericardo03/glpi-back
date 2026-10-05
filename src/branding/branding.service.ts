import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateBrandingDto } from './dto/branding.dto.js';

@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async atualizar(user: AuthUser, dto: UpdateBrandingDto) {
    const anterior = await this.prisma.configuracoes_branding.findFirst({
      where: { id_cliente: user.id_cliente },
    });
    return this.prisma.$transaction(async (tx) => {
      const row = anterior
        ? await tx.configuracoes_branding.update({
            where: { id_cliente_id: { id_cliente: user.id_cliente, id: anterior.id } },
            data: dto,
          })
        : await tx.configuracoes_branding.create({
            data: { id_cliente: user.id_cliente, ...dto },
          });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'UPSERT_BRANDING',
        tabela_afetada: 'configuracoes_branding',
        registro_id: row.id,
        valor_anterior: anterior ? { nome_portal: anterior.nome_portal } : null,
        valor_novo: { nome_portal: row.nome_portal },
      });
      return row;
    });
  }
}
