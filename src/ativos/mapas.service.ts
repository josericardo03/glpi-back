import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { conflito } from '../common/conflito.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateMapaDto, UpdateMapaDto } from './dto/ativo.dto.js';

/** Nome do mapa que recebe as dependências cadastradas sem informar um mapa. */
export const MAPA_PADRAO = 'Principal';

type Cliente = Prisma.TransactionClient | PrismaService;

@Injectable()
export class MapasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listar(user: AuthUser) {
    const [mapas, contagens] = await Promise.all([
      this.prisma.mapas_software.findMany({
        where: { id_cliente: user.id_cliente },
        orderBy: { nome: 'asc' },
      }),
      this.prisma.relacionamentos_ativos.groupBy({
        by: ['id_mapa'],
        where: { id_cliente: user.id_cliente },
        _count: { _all: true },
      }),
    ]);
    const porMapa = new Map(contagens.map((c) => [c.id_mapa, c._count._all]));
    return mapas.map((m) => formatar(m, porMapa.get(m.id) ?? 0));
  }

  async criar(user: AuthUser, dto: CreateMapaDto) {
    const nome = dto.nome.trim();
    if (nome.length < 2) throw new BadRequestException('Informe um nome com ao menos 2 caracteres');
    await this.exigirNomeLivre(user.id_cliente, nome);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.mapas_software.create({
          data: { id_cliente: user.id_cliente, nome, descricao: dto.descricao?.trim() || null },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_MAPA_SOFTWARE',
          tabela_afetada: 'mapas_software',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: { nome: row.nome },
        });
        return formatar(row, 0);
      });
    } catch (error) {
      throw conflito(error, 'Já existe um mapa com esse nome');
    }
  }

  async atualizar(user: AuthUser, id: number, dto: UpdateMapaDto) {
    const atual = await this.exigir(this.prisma, user.id_cliente, id);
    const nome = dto.nome?.trim();
    if (nome && nome.toLowerCase() !== atual.nome.toLowerCase()) {
      await this.exigirNomeLivre(user.id_cliente, nome, id);
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.mapas_software.update({
          where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
          data: {
            nome,
            descricao: dto.descricao === undefined ? undefined : (dto.descricao?.trim() || null),
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'UPDATE_MAPA_SOFTWARE',
          tabela_afetada: 'mapas_software',
          registro_id: id,
          valor_anterior: { nome: atual.nome, descricao: atual.descricao },
          valor_novo: { nome: row.nome, descricao: row.descricao },
        });
        const total = await tx.relacionamentos_ativos.count({
          where: { id_cliente: user.id_cliente, id_mapa: id },
        });
        return formatar(row, total);
      });
    } catch (error) {
      throw conflito(error, 'Já existe um mapa com esse nome');
    }
  }

  /** Sem `comLigacoes`, recusa apagar um mapa que ainda tem dependências (evita perder o desenho sem querer). */
  async remover(user: AuthUser, id: number, comLigacoes: boolean) {
    const atual = await this.exigir(this.prisma, user.id_cliente, id);
    const ligacoes = await this.prisma.relacionamentos_ativos.count({
      where: { id_cliente: user.id_cliente, id_mapa: id },
    });
    if (ligacoes > 0 && !comLigacoes) {
      throw new ConflictException(
        `O mapa ainda tem ${ligacoes} dependência(s). Confirme para apagá-las junto com o mapa.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      // As dependências saem em cascata (FK); o mapa só é apagado dentro da transação.
      await tx.mapas_software.delete({ where: { id_cliente_id: { id_cliente: user.id_cliente, id } } });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'DELETE_MAPA_SOFTWARE',
        tabela_afetada: 'mapas_software',
        registro_id: id,
        valor_anterior: { nome: atual.nome, ligacoes },
        valor_novo: null,
      });
    });
    return { removido: true, ligacoes_removidas: ligacoes };
  }

  /** Mapa informado (precisa existir no tenant) ou o padrão, criado na primeira necessidade. */
  async resolver(cliente: Cliente, idCliente: number, idMapa?: number) {
    if (idMapa !== undefined) {
      await this.exigir(cliente, idCliente, idMapa);
      return idMapa;
    }
    const existente = await cliente.mapas_software.findFirst({
      where: { id_cliente: idCliente, nome: { equals: MAPA_PADRAO, mode: 'insensitive' } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (existente) return existente.id;
    try {
      const criado = await cliente.mapas_software.create({
        data: { id_cliente: idCliente, nome: MAPA_PADRAO, descricao: 'Mapa padrão das dependências.' },
        select: { id: true },
      });
      return criado.id;
    } catch (error) {
      // Outra requisição criou o mapa ao mesmo tempo: usa o dele.
      const criadoPorOutra = await cliente.mapas_software.findFirst({
        where: { id_cliente: idCliente, nome: { equals: MAPA_PADRAO, mode: 'insensitive' } },
        select: { id: true },
      });
      if (criadoPorOutra) return criadoPorOutra.id;
      throw error;
    }
  }

  async exigir(cliente: Cliente, idCliente: number, id: number) {
    const mapa = await cliente.mapas_software.findFirst({ where: { id, id_cliente: idCliente } });
    if (!mapa) throw new NotFoundException('Mapa não encontrado');
    return mapa;
  }

  private async exigirNomeLivre(idCliente: number, nome: string, ignorarId?: number) {
    const igual = await this.prisma.mapas_software.findFirst({
      where: {
        id_cliente: idCliente,
        nome: { equals: nome, mode: 'insensitive' },
        ...(ignorarId ? { NOT: { id: ignorarId } } : {}),
      },
      select: { id: true },
    });
    if (igual) throw new ConflictException('Já existe um mapa com esse nome');
  }
}

function formatar(
  m: { id: number; nome: string; descricao: string | null; data_criacao: Date },
  ligacoes: number,
) {
  return { id: m.id, nome: m.nome, descricao: m.descricao, data_criacao: m.data_criacao, total_ligacoes: ligacoes };
}
