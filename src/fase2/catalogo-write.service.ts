import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMudancaDto, CreateProblemaDto, CsatDto, DecisaoDto } from './dto/fase2.dto.js';

@Injectable()
export class CatalogoWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async csat(user: AuthUser, dto: CsatDto) {
    const chamado = await this.prisma.chamados.findFirst({
      where: { id: dto.id_chamado, id_cliente: user.id_cliente },
    });
    if (!chamado) throw new NotFoundException('Chamado não encontrado');
    if (chamado.id_solicitante !== user.id) {
      throw new ForbiddenException('A avaliação é do solicitante do chamado');
    }
    if (!['RESOLVIDO', 'CONCLUIDO'].includes(chamado.status)) {
      throw new UnprocessableEntityException(
        'CSAT só é permitido em chamado RESOLVIDO ou CONCLUIDO',
      );
    }
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.pesquisas_csat.create({
          data: {
            id_cliente: user.id_cliente,
            id_chamado: chamado.id,
            id_solicitante: user.id,
            nota_satisfacao: dto.nota_satisfacao,
            comentarios: dto.comentarios?.trim(),
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'SUBMIT_CSAT',
          tabela_afetada: 'pesquisas_csat',
          registro_id: created.id,
          valor_anterior: null,
          valor_novo: {
            id_chamado: chamado.id,
            nota_satisfacao: dto.nota_satisfacao,
            comentarios: dto.comentarios ?? null,
          },
        });
        return created;
      });
      return row;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Este chamado já foi avaliado');
      }
      throw error;
    }
  }

  async problema(user: AuthUser, dto: CreateProblemaDto) {
    if (dto.id_chamado) {
      const chamado = await this.prisma.chamados.findFirst({
        where: { id: dto.id_chamado, id_cliente: user.id_cliente },
      });
      if (!chamado) throw new NotFoundException('Chamado não encontrado');
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.problemas.create({
        data: {
          id_cliente: user.id_cliente,
          titulo: dto.titulo.trim(),
          descricao: dto.descricao.trim(),
          prioridade: dto.prioridade,
          causa_raiz: dto.causa_raiz?.trim(),
          solucao_contorno: dto.solucao_contorno?.trim(),
          id_tecnico_atribuido: user.id,
        },
      });
      if (dto.id_chamado) {
        await tx.chamados_problemas.create({
          data: {
            id_cliente: user.id_cliente,
            id_chamado: dto.id_chamado,
            id_problema: created.id,
          },
        });
      }
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'CREATE_PROBLEMA',
        tabela_afetada: 'problemas',
        registro_id: created.id,
        valor_anterior: null,
        valor_novo: { titulo: created.titulo, prioridade: created.prioridade },
      });
      return created;
    });
  }

  async mudanca(user: AuthUser, dto: CreateMudancaDto) {
    const inicio = new Date(dto.janela_inicio);
    const fim = new Date(dto.janela_fim);
    if (!(fim > inicio)) {
      throw new BadRequestException('janela_fim deve ser posterior a janela_inicio');
    }
    if (dto.id_chamado) {
      const chamado = await this.prisma.chamados.findFirst({
        where: { id: dto.id_chamado, id_cliente: user.id_cliente },
      });
      if (!chamado) throw new NotFoundException('Chamado não encontrado');
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.mudancas.create({
        data: {
          id_cliente: user.id_cliente,
          titulo: dto.titulo.trim(),
          descricao: dto.descricao.trim(),
          justificativa: dto.justificativa.trim(),
          plano_impacto: dto.plano_impacto.trim(),
          plano_testes: dto.plano_testes.trim(),
          plano_retorno: dto.plano_retorno.trim(),
          tipo_mudanca: dto.tipo_mudanca,
          id_solicitante: user.id,
          janela_inicio: inicio,
          janela_fim: fim,
        },
      });
      if (dto.id_chamado) {
        await tx.mudancas_chamados.create({
          data: {
            id_cliente: user.id_cliente,
            id_mudanca: created.id,
            id_chamado: dto.id_chamado,
          },
        });
      }
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'CREATE_MUDANCA',
        tabela_afetada: 'mudancas',
        registro_id: created.id,
        valor_anterior: null,
        valor_novo: { titulo: created.titulo, tipo_mudanca: created.tipo_mudanca },
      });
      return created;
    });
  }

  async decidir(user: AuthUser, id: number, dto: DecisaoDto) {
    if (dto.status === 'REJEITADO' && !dto.justificativa_aprovador) {
      throw new BadRequestException('justificativa_aprovador é obrigatória na rejeição');
    }
    const row = await this.prisma.requisicoes_aprovacao.findFirst({
      where: { id, id_cliente: user.id_cliente },
    });
    if (!row) throw new NotFoundException('Aprovação não encontrada');
    if (row.status !== 'PENDENTE') {
      throw new ConflictException('Esta aprovação já foi decidida');
    }
    if ((row.id_chamado == null) === (row.id_mudanca == null)) {
      throw new BadRequestException('Aprovação precisa apontar chamado ou mudança, nunca os dois');
    }
    const atualizada = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.requisicoes_aprovacao.update({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
        data: {
          status: dto.status,
          justificativa_aprovador: dto.justificativa_aprovador?.trim(),
          data_decisao: new Date(),
          id_aprovador: user.id,
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'APPROVAL_DECISION',
        tabela_afetada: 'requisicoes_aprovacao',
        registro_id: id,
        valor_anterior: { status: row.status },
        valor_novo: { status: dto.status, justificativa_aprovador: dto.justificativa_aprovador ?? null },
      });
      return saved;
    });
    return atualizada;
  }
}
