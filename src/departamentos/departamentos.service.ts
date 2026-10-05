import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { conflito } from '../common/conflito.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateDepartamentoDto } from './dto/departamento.dto.js';

@Injectable()
export class DepartamentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async criar(user: AuthUser, dto: CreateDepartamentoDto) {
    if (dto.id_responsavel) await this.exigeUsuario(user.id_cliente, dto.id_responsavel);
    if (dto.id_departamento_pai) await this.exigeDepartamento(user.id_cliente, dto.id_departamento_pai);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.departamentos.create({
          data: {
            id_cliente: user.id_cliente,
            codigo_sigla: dto.codigo_sigla.trim().toUpperCase(),
            nome: dto.nome.trim(),
            id_responsavel: dto.id_responsavel,
            id_departamento_pai: dto.id_departamento_pai,
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_DEPARTMENT',
          tabela_afetada: 'departamentos',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: { codigo_sigla: row.codigo_sigla, nome: row.nome },
        });
        return row;
      });
    } catch (error) {
      throw conflito(error, 'Sigla já usada neste tenant');
    }
  }

  private async exigeUsuario(idCliente: number, id: number) {
    const row = await this.prisma.usuarios.findFirst({ where: { id, id_cliente: idCliente } });
    if (!row) throw new NotFoundException('Usuário não encontrado');
  }

  private async exigeDepartamento(idCliente: number, id: number) {
    const row = await this.prisma.departamentos.findFirst({ where: { id, id_cliente: idCliente } });
    if (!row) throw new NotFoundException('Departamento não encontrado');
  }
}
