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
import {
  CreateAprovacaoDto,
  CreateMudancaDto,
  CreateProblemaDto,
  CsatDto,
  DecisaoDto,
  UpdateMudancaDto,
  UpdateProblemaDto,
} from './dto/catalogo.dto.js';

@Injectable()
export class CatalogoService {
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

  async obterProblema(user: AuthUser, id: number) {
    const row = await this.prisma.problemas.findFirst({
      where: { id, id_cliente: user.id_cliente },
      include: {
        chamados_problemas: {
          include: { chamados: { select: { id: true, titulo: true, status: true } } },
        },
      },
    });
    if (!row) throw new NotFoundException('Problema não encontrado');
    return {
      ...row,
      chamados: row.chamados_problemas.map((vinculo) => vinculo.chamados),
    };
  }

  async atualizarProblema(user: AuthUser, id: number, dto: UpdateProblemaDto) {
    const atual = await this.prisma.problemas.findFirst({
      where: { id, id_cliente: user.id_cliente },
    });
    if (!atual) throw new NotFoundException('Problema não encontrado');
    if (typeof dto.id_tecnico_atribuido === 'number') {
      const tecnico = await this.prisma.usuarios.findFirst({
        where: { id: dto.id_tecnico_atribuido, id_cliente: user.id_cliente },
      });
      if (!tecnico) throw new NotFoundException('Técnico não encontrado');
    }
    const encerra = dto.status === 'RESOLVIDO' || dto.status === 'FECHADO';
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.problemas.update({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
        data: {
          status: dto.status,
          causa_raiz: textoOuNulo(dto.causa_raiz),
          solucao_contorno: textoOuNulo(dto.solucao_contorno),
          id_tecnico_atribuido:
            dto.id_tecnico_atribuido === undefined ? undefined : dto.id_tecnico_atribuido,
          data_resolucao:
            dto.data_resolucao === undefined
              ? encerra && !atual.data_resolucao
                ? new Date()
                : undefined
              : dto.data_resolucao === null
                ? null
                : new Date(dto.data_resolucao),
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'UPDATE_PROBLEMA',
        tabela_afetada: 'problemas',
        registro_id: id,
        valor_anterior: { status: atual.status },
        valor_novo: { status: row.status, causa_raiz: row.causa_raiz },
      });
      return row;
    });
  }

  async obterMudanca(user: AuthUser, id: number) {
    const row = await this.prisma.mudancas.findFirst({
      where: { id, id_cliente: user.id_cliente },
      include: {
        mudancas_chamados: {
          include: { chamados: { select: { id: true, titulo: true, status: true } } },
        },
      },
    });
    if (!row) throw new NotFoundException('Mudança não encontrada');
    return {
      ...row,
      chamados: row.mudancas_chamados.map((vinculo) => vinculo.chamados),
    };
  }

  async atualizarMudanca(user: AuthUser, id: number, dto: UpdateMudancaDto) {
    const atual = await this.prisma.mudancas.findFirst({
      where: { id, id_cliente: user.id_cliente },
    });
    if (!atual) throw new NotFoundException('Mudança não encontrada');
    if (dto.janela_inicio === null || dto.janela_fim === null) {
      throw new BadRequestException('A janela da mudança não pode ser removida');
    }
    const inicio = dto.janela_inicio ? new Date(dto.janela_inicio) : atual.janela_inicio;
    const fim = dto.janela_fim ? new Date(dto.janela_fim) : atual.janela_fim;
    if (!(fim > inicio)) {
      throw new BadRequestException('janela_fim deve ser posterior a janela_inicio');
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.mudancas.update({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
        data: {
          status: dto.status,
          janela_inicio: dto.janela_inicio ? inicio : undefined,
          janela_fim: dto.janela_fim ? fim : undefined,
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'UPDATE_MUDANCA',
        tabela_afetada: 'mudancas',
        registro_id: id,
        valor_anterior: { status: atual.status },
        valor_novo: { status: row.status },
      });
      return row;
    });
  }

  async criarAprovacao(user: AuthUser, dto: CreateAprovacaoDto) {
    const temChamado = dto.id_chamado != null;
    const temMudanca = dto.id_mudanca != null;
    if (temChamado === temMudanca) {
      throw new BadRequestException('Aprovação precisa apontar chamado ou mudança, nunca os dois');
    }
    if (temChamado) {
      const chamado = await this.prisma.chamados.findFirst({
        where: { id: dto.id_chamado, id_cliente: user.id_cliente },
      });
      if (!chamado) throw new NotFoundException('Chamado não encontrado');
    }
    if (temMudanca) {
      const mudanca = await this.prisma.mudancas.findFirst({
        where: { id: dto.id_mudanca, id_cliente: user.id_cliente },
      });
      if (!mudanca) throw new NotFoundException('Mudança não encontrada');
    }
    const aprovador = await this.prisma.usuarios.findFirst({
      where: { id: dto.id_aprovador, id_cliente: user.id_cliente },
    });
    if (!aprovador) throw new NotFoundException('Aprovador não encontrado');
    if (aprovador.perfil !== 'GESTOR' && aprovador.perfil !== 'ADMIN') {
      throw new BadRequestException('O aprovador precisa ser GESTOR ou ADMIN');
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.requisicoes_aprovacao.create({
        data: {
          id_cliente: user.id_cliente,
          id_chamado: dto.id_chamado,
          id_mudanca: dto.id_mudanca,
          id_solicitante: user.id,
          id_aprovador: dto.id_aprovador,
          descricao: dto.descricao.trim(),
          status: 'PENDENTE',
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'CREATE_APPROVAL',
        tabela_afetada: 'requisicoes_aprovacao',
        registro_id: row.id,
        valor_anterior: null,
        valor_novo: {
          id_chamado: row.id_chamado,
          id_mudanca: row.id_mudanca,
          id_aprovador: row.id_aprovador,
          status: row.status,
        },
      });
      return row;
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
      if (saved.id_mudanca) {
        await tx.mudancas.update({
          where: { id_cliente_id: { id_cliente: user.id_cliente, id: saved.id_mudanca } },
          data: { status: dto.status === 'APROVADO' ? 'AGENDADA' : 'CANCELADA' },
        });
      }
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

function textoOuNulo(valor: string | null | undefined) {
  if (valor === undefined) return undefined;
  const limpo = valor?.trim() ?? '';
  return limpo || null;
}
