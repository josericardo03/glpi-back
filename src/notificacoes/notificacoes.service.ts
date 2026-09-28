import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateNotificacaoDto } from './dto/criar-notificacao.dto.js';
import { MarcarNotificacaoDto } from './dto/notificacao.dto.js';

@Injectable()
export class NotificacoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async criar(user: AuthUser, dto: CreateNotificacaoDto) {
    const destino = await this.prisma.usuarios.findFirst({
      where: { id: dto.id_usuario, id_cliente: user.id_cliente },
    });
    if (!destino) throw new NotFoundException('Usuário não encontrado');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.notificacoes.create({
        data: {
          id_cliente: user.id_cliente,
          id_usuario: dto.id_usuario,
          titulo: dto.titulo.trim(),
          mensagem: dto.mensagem.trim(),
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'CREATE_NOTIFICATION',
        tabela_afetada: 'notificacoes',
        registro_id: row.id,
        valor_anterior: null,
        valor_novo: { id: row.id, id_usuario: row.id_usuario, titulo: row.titulo },
      });
      return row;
    });
  }

  async ler(user: AuthUser, id: number) {
    const atual = await this.prisma.notificacoes.findFirst({
      where: { id, id_cliente: user.id_cliente, id_usuario: user.id },
    });
    if (!atual) throw new NotFoundException('Notificação não encontrada');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.notificacoes.update({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
        data: { lida: true },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'READ_NOTIFICATION',
        tabela_afetada: 'notificacoes',
        registro_id: id,
        valor_anterior: { lida: atual.lida },
        valor_novo: { id, id_usuario: user.id, lida: true },
      });
      return row;
    });
  }

  async lerTodas(user: AuthUser) {
    const pendentes = await this.prisma.notificacoes.findMany({
      where: { id_cliente: user.id_cliente, id_usuario: user.id, lida: false },
      select: { id: true },
    });
    if (pendentes.length === 0) return { atualizadas: 0 };
    await this.prisma.$transaction(async (tx) => {
      await tx.notificacoes.updateMany({
        where: {
          id_cliente: user.id_cliente,
          id_usuario: user.id,
          lida: false,
          id: { in: pendentes.map((item) => item.id) },
        },
        data: { lida: true },
      });
      for (const item of pendentes) {
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'READ_NOTIFICATION',
          tabela_afetada: 'notificacoes',
          registro_id: item.id,
          valor_anterior: { lida: false },
          valor_novo: { id: item.id, id_usuario: user.id, lida: true },
        });
      }
    });
    return { atualizadas: pendentes.length };
  }

  async marcar(user: AuthUser, id: number, dto: MarcarNotificacaoDto) {
    const atual = await this.prisma.notificacoes.findFirst({
      where: { id, id_cliente: user.id_cliente, id_usuario: user.id },
    });
    if (!atual) throw new NotFoundException('Notificação não encontrada');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.notificacoes.update({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
        data: { lida: dto.lida },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'UPDATE_NOTIFICACAO',
        tabela_afetada: 'notificacoes',
        registro_id: id,
        valor_anterior: { lida: atual.lida },
        valor_novo: { lida: row.lida },
      });
      return row;
    });
  }
}
