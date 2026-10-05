import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { conflito } from '../common/conflito.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateGrupoDto, MembroGrupoDto } from './dto/grupo.dto.js';

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
}
