import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { auditAls } from './audit.context.js';

type Writer = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AuditService {
  async record(
    writer: Writer,
    entry: {
      id_cliente: number;
      acao: string;
      tabela_afetada: string;
      registro_id?: number | null;
      valor_anterior?: Prisma.InputJsonValue | null;
      valor_novo?: Prisma.InputJsonValue | null;
    },
  ) {
    const ctx = auditAls.getStore();
    await writer.logs_auditoria.create({
      data: {
        id_cliente: entry.id_cliente,
        id_usuario: ctx?.user?.id ?? null,
        acao: entry.acao,
        tabela_afetada: entry.tabela_afetada,
        registro_id: entry.registro_id ?? null,
        valor_anterior:
          entry.valor_anterior == null ? Prisma.JsonNull : entry.valor_anterior,
        valor_novo: entry.valor_novo == null ? Prisma.JsonNull : entry.valor_novo,
        endereco_ip: ctx?.ip ?? null,
      },
    });
  }
}
