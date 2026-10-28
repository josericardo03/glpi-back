import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { conflito } from '../common/conflito.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateDepartamentoDto, UpdateDepartamentoDto } from './dto/departamento.dto.js';

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

  async atualizar(user: AuthUser, id: number, dto: UpdateDepartamentoDto) {
    const atual = await this.prisma.departamentos.findFirst({
      where: { id, id_cliente: user.id_cliente },
    });
    if (!atual) throw new NotFoundException('Departamento não encontrado');
    if (dto.id_departamento_pai === id) {
      throw new BadRequestException('O departamento não pode ser pai dele mesmo');
    }
    if (typeof dto.id_responsavel === 'number') await this.exigeUsuario(user.id_cliente, dto.id_responsavel);
    if (typeof dto.id_departamento_pai === 'number') {
      await this.semCiclo(user.id_cliente, id, dto.id_departamento_pai);
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.departamentos.update({
          where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
          data: {
            codigo_sigla: dto.codigo_sigla?.trim().toUpperCase(),
            nome: dto.nome?.trim(),
            status: dto.status,
            id_responsavel: dto.id_responsavel === undefined ? undefined : dto.id_responsavel,
            id_departamento_pai:
              dto.id_departamento_pai === undefined ? undefined : dto.id_departamento_pai,
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'UPDATE_DEPARTMENT',
          tabela_afetada: 'departamentos',
          registro_id: id,
          valor_anterior: { nome: atual.nome, codigo_sigla: atual.codigo_sigla, status: atual.status },
          valor_novo: { nome: row.nome, codigo_sigla: row.codigo_sigla, status: row.status },
        });
        return row;
      });
    } catch (error) {
      throw conflito(error, 'Sigla já usada neste tenant');
    }
  }

  private async semCiclo(idCliente: number, id: number, paiId: number) {
    let atual: number | null = paiId;
    for (let passo = 0; passo < 20 && atual != null; passo += 1) {
      if (atual === id) throw new BadRequestException('O departamento não pode ser pai dele mesmo');
      const pai: { id_departamento_pai: number | null } | null = await this.prisma.departamentos.findFirst({
        where: { id: atual, id_cliente: idCliente },
        select: { id_departamento_pai: true },
      });
      if (!pai) throw new NotFoundException('Departamento não encontrado');
      atual = pai.id_departamento_pai;
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
