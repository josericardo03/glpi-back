import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCategoriaDto, UpdateCategoriaDto } from './dto/categoria.dto.js';

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

  async atualizar(user: AuthUser, id: number, dto: UpdateCategoriaDto) {
    const atual = await this.prisma.categorias_chamados.findFirst({
      where: { id, id_cliente: user.id_cliente },
    });
    if (!atual) throw new NotFoundException('Categoria não encontrada');
    if (dto.id_categoria_pai === id) {
      throw new BadRequestException('A categoria não pode ser pai dela mesma');
    }
    if (typeof dto.id_categoria_pai === 'number') {
      await this.semCiclo(user.id_cliente, id, dto.id_categoria_pai);
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const salva = await tx.categorias_chamados.update({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
        data: {
          nome: dto.nome?.trim(),
          tipo_aplicacao: dto.tipo_aplicacao,
          status: dto.status,
          id_categoria_pai: dto.id_categoria_pai === undefined ? undefined : dto.id_categoria_pai,
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'UPDATE_CATEGORIA',
        tabela_afetada: 'categorias_chamados',
        registro_id: id,
        valor_anterior: { nome: atual.nome, status: atual.status },
        valor_novo: { nome: salva.nome, status: salva.status, tipo_aplicacao: salva.tipo_aplicacao },
      });
      return salva;
    });
    return row;
  }

  private async semCiclo(idCliente: number, id: number, paiId: number) {
    let atual: number | null = paiId;
    for (let passo = 0; passo < 20 && atual != null; passo += 1) {
      if (atual === id) throw new BadRequestException('A categoria não pode ser pai dela mesma');
      const pai: { id_categoria_pai: number | null } | null = await this.prisma.categorias_chamados.findFirst({
        where: { id: atual, id_cliente: idCliente },
        select: { id_categoria_pai: true },
      });
      if (!pai) throw new NotFoundException('Categoria pai não encontrada');
      atual = pai.id_categoria_pai;
    }
  }
}
