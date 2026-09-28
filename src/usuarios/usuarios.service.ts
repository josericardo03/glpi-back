import { Injectable, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { conflito } from '../common/conflito.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUsuarioDto, UpdateUsuarioDto } from './dto/usuario.dto.js';

const usuarioPublico = {
  id: true,
  id_cliente: true,
  nome: true,
  email: true,
  cargo: true,
  perfil: true,
  status: true,
  id_departamento: true,
  data_cadastro: true,
} as const;

@Injectable()
export class UsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async criar(user: AuthUser, dto: CreateUsuarioDto) {
    if (dto.id_departamento) await this.exigeDepartamento(user.id_cliente, dto.id_departamento);
    const senhaHash = await bcrypt.hash(dto.password, 12);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const criado = await tx.usuarios.create({
          data: {
            id_cliente: user.id_cliente,
            nome: dto.nome.trim(),
            email: dto.email.trim().toLowerCase(),
            senha_hash: senhaHash,
            cargo: dto.cargo.trim(),
            perfil: dto.perfil,
            status: dto.status ?? 'ATIVO',
            id_departamento: dto.id_departamento,
          },
          select: usuarioPublico,
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_USUARIO',
          tabela_afetada: 'usuarios',
          registro_id: criado.id,
          valor_anterior: null,
          valor_novo: { email: criado.email, perfil: criado.perfil },
        });
        return criado;
      });
    } catch (error) {
      throw conflito(error, 'E-mail já cadastrado neste tenant');
    }
  }

  async atualizar(user: AuthUser, id: number, dto: UpdateUsuarioDto) {
    const atual = await this.prisma.usuarios.findFirst({
      where: { id, id_cliente: user.id_cliente },
      select: usuarioPublico,
    });
    if (!atual) throw new NotFoundException('Usuário não encontrado');
    if (dto.id_departamento) await this.exigeDepartamento(user.id_cliente, dto.id_departamento);
    const senhaHash = dto.password ? await bcrypt.hash(dto.password, 12) : undefined;
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.usuarios.update({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
        data: {
          nome: dto.nome?.trim(),
          cargo: dto.cargo?.trim(),
          perfil: dto.perfil,
          status: dto.status,
          id_departamento: dto.id_departamento,
          ...(senhaHash ? { senha_hash: senhaHash } : {}),
        },
        select: usuarioPublico,
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'UPDATE_USUARIO',
        tabela_afetada: 'usuarios',
        registro_id: id,
        valor_anterior: { perfil: atual.perfil, status: atual.status },
        valor_novo: { perfil: row.perfil, status: row.status },
      });
      return row;
    });
  }

  private async exigeDepartamento(idCliente: number, id: number) {
    const row = await this.prisma.departamentos.findFirst({ where: { id, id_cliente: idCliente } });
    if (!row) throw new NotFoundException('Departamento não encontrado');
  }
}
