import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { conflito } from '../common/conflito.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAtivoDto } from './dto/ativo.dto.js';

@Injectable()
export class AtivosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async criar(user: AuthUser, dto: CreateAtivoDto) {
    if (dto.id_usuario_atribuido) {
      const usuario = await this.prisma.usuarios.findFirst({
        where: { id: dto.id_usuario_atribuido, id_cliente: user.id_cliente },
      });
      if (!usuario) throw new NotFoundException('Usuário não encontrado');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.ativos_cmdb.create({
          data: {
            id_cliente: user.id_cliente,
            codigo_patrimonio: dto.codigo_patrimonio.trim(),
            nome: dto.nome.trim(),
            tipo_ativo: dto.tipo_ativo,
            status: dto.status ?? 'ATIVO',
            id_usuario_atribuido: dto.id_usuario_atribuido,
            data_aquisicao: dto.data_aquisicao ? new Date(dto.data_aquisicao) : undefined,
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_ATIVO',
          tabela_afetada: 'ativos_cmdb',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: { codigo_patrimonio: row.codigo_patrimonio, nome: row.nome },
        });
        return row;
      });
    } catch (error) {
      throw conflito(error, 'Patrimônio já cadastrado neste tenant');
    }
  }
}
