import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateKbArtigoDto,
  CreateKbCategoriaDto,
  CreateNotificacaoDto,
  FeedbackKbDto,
} from './dto/fase4.dto.js';

@Injectable()
export class Fase4Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async criarCategoria(user: AuthUser, dto: CreateKbCategoriaDto) {
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
          acao: 'CREATE_KB_CATEGORY',
          tabela_afetada: 'categorias_artigos_kb',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: { id: row.id, nome: row.nome },
        });
        return row;
      });
    } catch (error) {
      throw this.traduzir(error, 'Categoria de conhecimento já existe');
    }
  }

  async criarArtigo(user: AuthUser, dto: CreateKbArtigoDto) {
    const categoria = await this.prisma.categorias_artigos_kb.findFirst({
      where: { id: dto.id_categoria, id_cliente: user.id_cliente },
    });
    if (!categoria) throw new NotFoundException('Categoria de conhecimento não encontrada');
    const row = await this.prisma.$transaction(async (tx) => {
      const criado = await tx.artigos_kb.create({
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
        acao: 'CREATE_KB_ARTICLE',
        tabela_afetada: 'artigos_kb',
        registro_id: criado.id,
        valor_anterior: null,
        valor_novo: {
          id: criado.id,
          id_categoria: criado.id_categoria,
          titulo: criado.titulo,
          id_autor: criado.id_autor,
          status: criado.status,
        },
      });
      return criado;
    });
    return row;
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

  async feedback(user: AuthUser, idArtigo: number, dto: FeedbackKbDto) {
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
          acao: 'ADD_KB_FEEDBACK',
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
      throw this.traduzir(error, 'Você já avaliou este artigo');
    }
  }

  async criarNotificacao(user: AuthUser, dto: CreateNotificacaoDto) {
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

  private traduzir(error: unknown, mensagem: string) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(mensagem);
    }
    return error;
  }
}
