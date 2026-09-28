import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { conflito } from '../common/conflito.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateArtigoDto, CreateCategoriaKbDto, FeedbackArtigoDto } from './dto/artigo.dto.js';
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
