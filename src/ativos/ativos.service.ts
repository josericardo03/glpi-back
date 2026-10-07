import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { conflito } from '../common/conflito.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAtivoDto, CreateRelacionamentoDto } from './dto/ativo.dto.js';

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

  async criarRelacionamento(user: AuthUser, dto: CreateRelacionamentoDto) {
    if (dto.id_ativo_origem === dto.id_ativo_destino) {
      throw new BadRequestException('Um ativo não pode depender dele mesmo');
    }
    await this.exigirAtivos(user.id_cliente, [dto.id_ativo_origem, dto.id_ativo_destino]);
    const repetido = await this.prisma.relacionamentos_ativos.findFirst({
      where: {
        id_cliente: user.id_cliente,
        id_ativo_origem: dto.id_ativo_origem,
        id_ativo_destino: dto.id_ativo_destino,
      },
    });
    if (repetido) throw new ConflictException('Essa dependência já está cadastrada');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.relacionamentos_ativos.create({
          data: {
            id_cliente: user.id_cliente,
            id_ativo_origem: dto.id_ativo_origem,
            id_ativo_destino: dto.id_ativo_destino,
            tipo_relacionamento: dto.tipo_relacionamento,
          },
          include: includePontas,
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_ATIVO_RELACIONAMENTO',
          tabela_afetada: 'relacionamentos_ativos',
          registro_id: dto.id_ativo_origem,
          valor_anterior: null,
          valor_novo: {
            id_ativo_origem: dto.id_ativo_origem,
            id_ativo_destino: dto.id_ativo_destino,
            tipo_relacionamento: dto.tipo_relacionamento,
          },
        });
        return formatarRelacionamento(row);
      });
    } catch (error) {
      throw conflito(error, 'Essa dependência já está cadastrada');
    }
  }

  async listarRelacionamentos(user: AuthUser, limite?: string, pagina?: string) {
    const where = { id_cliente: user.id_cliente };
    const faixa = fatia(limite, pagina, 100, 200);
    const [rows, total] = await Promise.all([
      this.prisma.relacionamentos_ativos.findMany({
        where,
        include: includePontas,
        orderBy: { data_criacao: 'desc' },
        ...faixa,
      }),
      this.prisma.relacionamentos_ativos.count({ where }),
    ]);
    return { total, rows: rows.map(formatarRelacionamento) };
  }

  async removerRelacionamento(user: AuthUser, idOrigem: number, idDestino: number) {
    const atual = await this.prisma.relacionamentos_ativos.findFirst({
      where: {
        id_cliente: user.id_cliente,
        id_ativo_origem: idOrigem,
        id_ativo_destino: idDestino,
      },
    });
    if (!atual) throw new NotFoundException('Dependência não encontrada');
    await this.prisma.$transaction(async (tx) => {
      await tx.relacionamentos_ativos.deleteMany({
        where: {
          id_cliente: user.id_cliente,
          id_ativo_origem: idOrigem,
          id_ativo_destino: idDestino,
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'DELETE_ATIVO_RELACIONAMENTO',
        tabela_afetada: 'relacionamentos_ativos',
        registro_id: idOrigem,
        valor_anterior: {
          id_ativo_origem: atual.id_ativo_origem,
          id_ativo_destino: atual.id_ativo_destino,
          tipo_relacionamento: atual.tipo_relacionamento,
        },
        valor_novo: null,
      });
    });
    return { removido: true };
  }

  async impacto(user: AuthUser, id: number) {
    const ativo = await this.prisma.ativos_cmdb.findFirst({
      where: { id, id_cliente: user.id_cliente },
      select: { id: true, nome: true, tipo_ativo: true },
    });
    if (!ativo) throw new NotFoundException('Ativo não encontrado');
    const afetados = await this.prisma.$queryRaw<
      { id: number; nome: string; tipo_ativo: string; nivel: number }[]
    >(Prisma.sql`
      WITH RECURSIVE cadeia AS (
        SELECT r.id_ativo_origem AS id,
               1 AS nivel,
               ARRAY[r.id_ativo_destino, r.id_ativo_origem] AS visitados
        FROM relacionamentos_ativos r
        WHERE r.id_cliente = ${user.id_cliente}
          AND r.id_ativo_destino = ${id}
          AND r.tipo_relacionamento = 'DEPENDE_DE'
        UNION ALL
        SELECT r.id_ativo_origem,
               c.nivel + 1,
               c.visitados || r.id_ativo_origem
        FROM relacionamentos_ativos r
        JOIN cadeia c ON c.id = r.id_ativo_destino
        WHERE r.id_cliente = ${user.id_cliente}
          AND r.tipo_relacionamento = 'DEPENDE_DE'
          AND NOT (r.id_ativo_origem = ANY (c.visitados))
          AND c.nivel < 20
      ),
      menor AS (
        SELECT id, MIN(nivel)::int AS nivel
        FROM cadeia
        GROUP BY id
      )
      SELECT a.id, a.nome, a.tipo_ativo, m.nivel
      FROM menor m
      JOIN ativos_cmdb a ON a.id_cliente = ${user.id_cliente} AND a.id = m.id
      ORDER BY m.nivel, a.nome
    `);
    return { ativo, afetados };
  }

  private async exigirAtivos(idCliente: number, ids: number[]) {
    const encontrados = await this.prisma.ativos_cmdb.findMany({
      where: { id_cliente: idCliente, id: { in: ids } },
      select: { id: true },
    });
    if (encontrados.length !== new Set(ids).size) {
      throw new NotFoundException('Ativo não encontrado');
    }
  }
}

const includePontas = {
  origem: { select: { id: true, nome: true, tipo_ativo: true } },
  destino: { select: { id: true, nome: true, tipo_ativo: true } },
} as const;

type RelacionamentoComPontas = {
  id_cliente: number;
  id_ativo_origem: number;
  id_ativo_destino: number;
  tipo_relacionamento: string;
  data_criacao: Date;
  origem: { id: number; nome: string; tipo_ativo: string };
  destino: { id: number; nome: string; tipo_ativo: string };
};

function formatarRelacionamento(row: RelacionamentoComPontas) {
  return {
    id_cliente: row.id_cliente,
    id_ativo_origem: row.id_ativo_origem,
    id_ativo_destino: row.id_ativo_destino,
    tipo_relacionamento: row.tipo_relacionamento,
    data_criacao: row.data_criacao,
    origem: row.origem,
    destino: row.destino,
  };
}

function fatia(limite: string | undefined, pagina: string | undefined, padrao: number, teto: number) {
  if (limite && !/^\d+$/.test(limite)) throw new BadRequestException('limite inválido');
  if (pagina && !/^\d+$/.test(pagina)) throw new BadRequestException('pagina inválida');
  const tamanho = Math.min(teto, Math.max(1, Number(limite) || padrao));
  const paginaNum = Math.max(1, Number(pagina) || 1);
  return { take: tamanho, skip: (paginaNum - 1) * tamanho };
}
