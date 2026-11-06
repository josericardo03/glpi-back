import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { conflito } from '../common/conflito.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateGrupoDto, MembroGrupoDto, UpdateGrupoDto } from './dto/grupo.dto.js';

@Injectable()
export class GruposService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async criar(user: AuthUser, dto: CreateGrupoDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.grupos_suporte.create({
          data: {
            id_cliente: user.id_cliente,
            nome: dto.nome.trim(),
            descricao: dto.descricao?.trim(),
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_SUPPORT_GROUP',
          tabela_afetada: 'grupos_suporte',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: { nome: row.nome },
        });
        return row;
      });
    } catch (error) {
      throw conflito(error, 'Já existe um grupo com esse nome');
    }
  }

  async atualizar(user: AuthUser, id: number, dto: UpdateGrupoDto) {
    const atual = await this.prisma.grupos_suporte.findFirst({
      where: { id, id_cliente: user.id_cliente },
    });
    if (!atual) throw new NotFoundException('Grupo não encontrado');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.grupos_suporte.update({
          where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
          data: {
            nome: dto.nome?.trim(),
            status: dto.status,
            descricao:
              dto.descricao === undefined ? undefined : dto.descricao === null ? null : dto.descricao.trim(),
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'UPDATE_SUPPORT_GROUP',
          tabela_afetada: 'grupos_suporte',
          registro_id: id,
          valor_anterior: { nome: atual.nome, status: atual.status },
          valor_novo: { nome: row.nome, status: row.status },
        });
        return row;
      });
    } catch (error) {
      throw conflito(error, 'Já existe um grupo com esse nome');
    }
  }

  async adicionarMembro(user: AuthUser, idGrupo: number, dto: MembroGrupoDto) {
    const grupo = await this.prisma.grupos_suporte.findFirst({
      where: { id: idGrupo, id_cliente: user.id_cliente },
    });
    if (!grupo) throw new NotFoundException('Grupo não encontrado');
    const usuario = await this.prisma.usuarios.findFirst({
      where: { id: dto.id_usuario, id_cliente: user.id_cliente },
    });
    if (!usuario) throw new NotFoundException('Usuário não encontrado');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.membros_grupos.create({
          data: {
            id_cliente: user.id_cliente,
            id_grupo: idGrupo,
            id_usuario: dto.id_usuario,
            cargo_especialidade: dto.cargo_especialidade?.trim(),
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'ADD_MEMBRO_GRUPO',
          tabela_afetada: 'membros_grupos',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: { id_grupo: idGrupo, id_usuario: dto.id_usuario },
        });
        return row;
      });
    } catch (error) {
      throw conflito(error, 'Usuário já pertence a este grupo');
    }
  }

  /**
   * Membros de todos os grupos do tenant. A carga de trabalho (%) é a razão entre os chamados
   * abertos do técnico e o limite  do vínculo, limitada a 100.
   */
  async listarMembros(user: AuthUser) {
    const membros = await this.prisma.membros_grupos.findMany({
      where: { id_cliente: user.id_cliente },
      include: { usuarios: { select: { id: true, nome: true, email: true, cargo: true, avatar_url: true } } },
      orderBy: [{ id_grupo: 'asc' }, { id: 'asc' }],
    });
    const abertos = await this.prisma.chamados.groupBy({
      by: ['id_tecnico_atribuido'],
      where: {
        id_cliente: user.id_cliente,
        status: { in: ['NOVO', 'EM_ATENDIMENTO', 'PENDENTE'] },
        id_tecnico_atribuido: { in: [...new Set(membros.map((m) => m.id_usuario))] },
      },
      _count: { _all: true },
    });
    const porTecnico = new Map(abertos.map((a) => [a.id_tecnico_atribuido, a._count._all]));
    return membros.map((m) => {
      const total = porTecnico.get(m.id_usuario) ?? 0;
      return {
        id: m.id,
        id_grupo: m.id_grupo,
        id_usuario: m.id_usuario,
        cargo_especialidade: m.cargo_especialidade,
        carga_trabalho_max: m.carga_trabalho_max,
        chamados_abertos: total,
        carga_trabalho_pct: Math.min(100, Math.round((total * 100) / Math.max(1, m.carga_trabalho_max))),
        usuario: m.usuarios,
      };
    });
  }
}
