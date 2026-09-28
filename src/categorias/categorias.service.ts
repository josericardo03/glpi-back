import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCategoriaDto } from './dto/categoria.dto.js';

@Injectable()
export class CategoriasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async criar(user: AuthUser, dto: CreateCategoriaDto) {
    if (dto.id_categoria_pai) {
      const pai = await this.prisma.categorias_chamados.findFirst({
        where: { id: dto.id_categoria_pai, id_cliente: user.id_cliente },
      });
      if (!pai) throw new NotFoundException('Categoria pai não encontrada');
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.categorias_chamados.create({
        data: {
          id_cliente: user.id_cliente,
          nome: dto.nome.trim(),
          tipo_aplicacao: dto.tipo_aplicacao ?? 'AMBOS',
          status: dto.status ?? 'ATIVO',
          id_categoria_pai: dto.id_categoria_pai,
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'CREATE_CATEGORIA',
        tabela_afetada: 'categorias_chamados',
        registro_id: row.id,
        valor_anterior: null,
        valor_novo: { nome: row.nome, tipo_aplicacao: row.tipo_aplicacao },
      });
      return row;
    });
  }
}
