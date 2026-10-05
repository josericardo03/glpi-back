import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { conflito } from '../common/conflito.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateArtigoDto, CreateCategoriaKbDto, FeedbackArtigoDto, UpdateArtigoDto } from './dto/artigo.dto.js';
import { CreateKbArtigoDto, CreateKbCategoriaDto, FeedbackKbDto } from './dto/kb.dto.js';

@Injectable()
export class KbService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async criarCategoria(user: AuthUser, dto: CreateCategoriaKbDto | CreateKbCategoriaDto, acao: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.categorias_artigos_kb.create({
          data: {
            id_cliente: user.id_cliente,
            nome: dto.nome.trim(),
            descricao: dto.descricao?.trim(),
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao,
          tabela_afetada: 'categorias_artigos_kb',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: { id: row.id, nome: row.nome },
        });
        return row;
      });
    } catch (error) {
      throw conflito(error, 'Categoria de conhecimento já existe');
    }
  }

  async criarArtigo(user: AuthUser, dto: CreateArtigoDto | CreateKbArtigoDto, acao: string) {
    const categoria = await this.prisma.categorias_artigos_kb.findFirst({
      where: { id: dto.id_categoria, id_cliente: user.id_cliente },
    });
    if (!categoria) throw new NotFoundException('Categoria de conhecimento não encontrada');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.artigos_kb.create({
        data: {
          id_cliente: user.id_cliente,
          id_categoria: dto.id_categoria,
          id_autor: user.id,
          titulo: dto.titulo.trim(),
          conteudo: dto.conteudo.trim(),
          status: dto.status ?? 'RASCUNHO',
          visualizacoes: 0,
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao,
        tabela_afetada: 'artigos_kb',
        registro_id: row.id,
        valor_anterior: null,
        valor_novo: {
          id: row.id,
          id_categoria: row.id_categoria,
          titulo: row.titulo,
          id_autor: row.id_autor,
          status: row.status,
        },
      });
      return row;
    });
  }

  async listarCategorias(user: AuthUser) {
    const categorias = await this.prisma.categorias_artigos_kb.findMany({
      where: { id_cliente: user.id_cliente },
      orderBy: { nome: 'asc' },
    });
    const contagem = await this.prisma.artigos_kb.groupBy({
      by: ['id_categoria'],
      where: { id_cliente: user.id_cliente, status: 'PUBLICADO' },
      _count: true,
    });
    const totais = new Map(contagem.map((item) => [item.id_categoria, item._count]));
    return categorias.map((categoria) => ({
      ...categoria,
      total_artigos: totais.get(categoria.id) ?? 0,
    }));
  }

  async obterArtigo(user: AuthUser, id: number) {
    const artigo = await this.prisma.artigos_kb.findFirst({
      where: {
        id,
        id_cliente: user.id_cliente,
        ...(user.perfil === 'SOLICITANTE' ? { status: 'PUBLICADO' } : {}),
      },
      include: { feedbacks_artigos_kb: { select: { util: true, id_usuario: true } } },
    });
    if (!artigo) throw new NotFoundException('Artigo não encontrado');
    const meu = artigo.feedbacks_artigos_kb.find((voto) => voto.id_usuario === user.id);
    return {
      ...artigo,
      votos_uteis: artigo.feedbacks_artigos_kb.filter((voto) => voto.util).length,
      votos_nao_uteis: artigo.feedbacks_artigos_kb.filter((voto) => !voto.util).length,
      meu_voto: meu ? meu.util : null,
      feedbacks_artigos_kb: undefined,
    };
  }

  async atualizarArtigo(user: AuthUser, id: number, dto: UpdateArtigoDto) {
    const atual = await this.prisma.artigos_kb.findFirst({
      where: { id, id_cliente: user.id_cliente },
    });
    if (!atual) throw new NotFoundException('Artigo não encontrado');
    if (dto.id_categoria) {
      const categoria = await this.prisma.categorias_artigos_kb.findFirst({
        where: { id: dto.id_categoria, id_cliente: user.id_cliente },
      });
      if (!categoria) throw new NotFoundException('Categoria de conhecimento não encontrada');
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.artigos_kb.update({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
        data: {
          id_categoria: dto.id_categoria,
          titulo: dto.titulo?.trim(),
          conteudo: dto.conteudo?.trim(),
          status: dto.status,
          data_atualizacao: new Date(),
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'UPDATE_KB_ARTICLE',
        tabela_afetada: 'artigos_kb',
        registro_id: id,
        valor_anterior: { titulo: atual.titulo, status: atual.status },
        valor_novo: { titulo: row.titulo, status: row.status, id_categoria: row.id_categoria },
      });
      return row;
    });
  }

  async visualizar(user: AuthUser, id: number) {
    const artigo = await this.prisma.artigos_kb.findFirst({
      where: { id, id_cliente: user.id_cliente, status: 'PUBLICADO' },
    });
    if (!artigo) throw new NotFoundException('Artigo publicado não encontrado');
    return this.prisma.artigos_kb.update({
      where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
      data: { visualizacoes: { increment: 1 }, data_atualizacao: new Date() },
      select: { id: true, id_cliente: true, visualizacoes: true },
    });
  }

  async feedback(user: AuthUser, idArtigo: number, dto: FeedbackArtigoDto | FeedbackKbDto, acao: string) {
    const artigo = await this.prisma.artigos_kb.findFirst({
      where: { id: idArtigo, id_cliente: user.id_cliente, status: 'PUBLICADO' },
    });
    if (!artigo) throw new NotFoundException('Artigo publicado não encontrado');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.feedbacks_artigos_kb.create({
          data: {
            id_cliente: user.id_cliente,
            id_artigo: idArtigo,
            id_usuario: user.id,
            util: dto.util,
            comentario: dto.comentario?.trim(),
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao,
          tabela_afetada: 'feedbacks_artigos_kb',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: {
            id_artigo: idArtigo,
            id_usuario: user.id,
            util: dto.util,
            comentario: dto.comentario ?? null,
          },
        });
        return row;
      });
    } catch (error) {
      throw conflito(error, 'Você já avaliou este artigo');
    }
  }
}
