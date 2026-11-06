import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { conflito } from '../common/conflito.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { fatia } from '../common/paginacao.js';
import {
  CreateAtivoDto,
  CreateEspecificacaoDto,
  CreateManutencaoDto,
  CreateRelacionamentoDto,
  UpdateAtivoDto,
} from './dto/ativo.dto.js';

@Injectable()
export class AtivosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Totais do inventário para os cartões da tela (a lista em si é paginada no servidor). */
  async resumo(user: AuthUser) {
    const where = {
      id_cliente: user.id_cliente,
      ...(user.perfil === 'SOLICITANTE' ? { id_usuario_atribuido: user.id } : {}),
    };
    const [porTipo, porStatus] = await Promise.all([
      this.prisma.ativos_cmdb.groupBy({ by: ['tipo_ativo'], where, _count: { _all: true } }),
      this.prisma.ativos_cmdb.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ]);
    return {
      total: porTipo.reduce((soma, r) => soma + r._count._all, 0),
      por_tipo: Object.fromEntries(porTipo.map((r) => [r.tipo_ativo, r._count._all])),
      por_status: Object.fromEntries(porStatus.map((r) => [r.status, r._count._all])),
    };
  }

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

  async atualizar(user: AuthUser, id: number, dto: UpdateAtivoDto) {
    const atual = await this.prisma.ativos_cmdb.findFirst({
      where: { id, id_cliente: user.id_cliente },
    });
    if (!atual) throw new NotFoundException('Ativo não encontrado');
    if (typeof dto.id_usuario_atribuido === 'number') {
      await this.exigirUsuario(user.id_cliente, dto.id_usuario_atribuido);
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.ativos_cmdb.update({
          where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
          data: {
            codigo_patrimonio: dto.codigo_patrimonio?.trim(),
            nome: dto.nome?.trim(),
            tipo_ativo: dto.tipo_ativo,
            status: dto.status,
            id_usuario_atribuido:
              dto.id_usuario_atribuido === undefined ? undefined : dto.id_usuario_atribuido,
            data_aquisicao:
              dto.data_aquisicao === undefined
                ? undefined
                : dto.data_aquisicao === null
                  ? null
                  : new Date(dto.data_aquisicao),
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'UPDATE_ATIVO',
          tabela_afetada: 'ativos_cmdb',
          registro_id: id,
          valor_anterior: { nome: atual.nome, status: atual.status },
          valor_novo: { nome: row.nome, status: row.status, tipo_ativo: row.tipo_ativo },
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

  async detalhe(user: AuthUser, id: number) {
    const solicitante = user.perfil === 'SOLICITANTE';
    const ponta = { id: true, nome: true, tipo_ativo: true, codigo_patrimonio: true } as const;
    const ativo = await this.prisma.ativos_cmdb.findFirst({
      where: { id, id_cliente: user.id_cliente, ...(solicitante ? { id_usuario_atribuido: user.id } : {}) },
      include: {
        usuarios: { select: { id: true, nome: true } },
        especificacoes_ativos: { orderBy: { id: 'asc' } },
        historicos_manutencao_ativos: {
          orderBy: { data_inicio: 'desc' },
          include: { usuarios: { select: { id: true, nome: true } } },
        },
        rels_como_origem: { include: { destino: { select: ponta } } },
        rels_como_destino: { include: { origem: { select: ponta } } },
        chamados_ativos: {
          include: { chamados: { select: { id: true, titulo: true, status: true, id_solicitante: true } } },
        },
      },
    });
    if (!ativo) throw new NotFoundException('Ativo não encontrado');
    const {
      usuarios,
      especificacoes_ativos,
      historicos_manutencao_ativos,
      rels_como_origem,
      rels_como_destino,
      chamados_ativos,
      ...base
    } = ativo;
    return {
      ...base,
      usuario_atribuido: usuarios ? { id: usuarios.id, nome: usuarios.nome } : null,
      especificacoes: especificacoes_ativos.map((e) => ({ id: e.id, chave: e.chave_propriedade, valor: e.valor })),
      manutencoes: historicos_manutencao_ativos.map((m) => ({
        id: m.id,
        descricao_servico: m.descricao_servico,
        custo_manutencao: Number(m.custo_manutencao),
        data_inicio: m.data_inicio,
        data_fim: m.data_fim,
        tecnico: { id: m.usuarios.id, nome: m.usuarios.nome },
      })),
      // Este ativo depende do destino (DEPENDE_DE) e dá suporte à origem (SUPORTA).
      dependencias: [
        ...rels_como_origem.map((r) => ({ ...r.destino, relacao: 'DEPENDE_DE' as const })),
        ...rels_como_destino.map((r) => ({ ...r.origem, relacao: 'SUPORTA' as const })),
      ],
      chamados: chamados_ativos
        .map((v) => v.chamados)
        .filter((c) => !solicitante || c.id_solicitante === user.id)
        .map((c) => ({ id: c.id, titulo: c.titulo, status: c.status })),
    };
  }

  async adicionarEspecificacao(user: AuthUser, id: number, dto: CreateEspecificacaoDto) {
    await this.exigirAtivos(user.id_cliente, [id]);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.especificacoes_ativos.create({
          data: {
            id_cliente: user.id_cliente,
            id_ativo: id,
            chave_propriedade: dto.chave.trim(),
            valor: dto.valor.trim(),
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'ADD_ATIVO_ESPECIFICACAO',
          tabela_afetada: 'especificacoes_ativos',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: { id_ativo: id, chave: row.chave_propriedade },
        });
        return { id: row.id, chave: row.chave_propriedade, valor: row.valor };
      });
    } catch (error) {
      throw conflito(error, 'Este ativo já tem uma especificação com essa chave');
    }
  }

  async registrarManutencao(user: AuthUser, id: number, dto: CreateManutencaoDto) {
    await this.exigirAtivos(user.id_cliente, [id]);
    const inicio = new Date(dto.data_inicio);
    const fim = dto.data_fim ? new Date(dto.data_fim) : null;
    if (fim && fim < inicio) throw new BadRequestException('data_fim não pode ser anterior a data_inicio');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.historicos_manutencao_ativos.create({
        data: {
          id_cliente: user.id_cliente,
          id_ativo: id,
          id_tecnico: user.id,
          descricao_servico: dto.descricao_servico.trim(),
          custo_manutencao: dto.custo_manutencao,
          data_inicio: inicio,
          data_fim: fim,
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'ADD_ATIVO_MANUTENCAO',
        tabela_afetada: 'historicos_manutencao_ativos',
        registro_id: row.id,
        valor_anterior: null,
        valor_novo: { id_ativo: id, custo_manutencao: dto.custo_manutencao },
      });
      return {
        id: row.id,
        descricao_servico: row.descricao_servico,
        custo_manutencao: Number(row.custo_manutencao),
        data_inicio: row.data_inicio,
        data_fim: row.data_fim,
        tecnico: { id: user.id, nome: user.nome },
      };
    });
  }

  private async exigirUsuario(idCliente: number, id: number) {
    const usuario = await this.prisma.usuarios.findFirst({
      where: { id, id_cliente: idCliente },
    });
    if (!usuario) throw new NotFoundException('Usuário não encontrado');
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
