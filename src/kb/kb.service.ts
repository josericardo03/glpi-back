import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { conflito } from '../common/conflito.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService, type ArquivoUpload } from '../storage/storage.service.js';
import { CreateArtigoDto, CreateCategoriaKbDto, FeedbackArtigoDto, UpdateArtigoDto } from './dto/artigo.dto.js';
import { CreateKbArtigoDto, CreateKbCategoriaDto, FeedbackKbDto } from './dto/kb.dto.js';

@Injectable()
export class KbService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
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
      include: {
        feedbacks_artigos_kb: { select: { util: true, id_usuario: true } },
        anexos_artigos_kb: {
          select: {
            id: true,
            nome_arquivo: true,
            tipo_mime: true,
            tamanho_bytes: true,
            data_upload: true,
          },
          orderBy: { data_upload: 'asc' },
        },
      },
    });
    if (!artigo) throw new NotFoundException('Artigo não encontrado');
    const meu = artigo.feedbacks_artigos_kb.find((voto) => voto.id_usuario === user.id);
    const anexos = artigo.anexos_artigos_kb.map((anexo) => ({
      ...anexo,
      tamanho_bytes: Number(anexo.tamanho_bytes),
    }));
    return {
      ...artigo,
      votos_uteis: artigo.feedbacks_artigos_kb.filter((voto) => voto.util).length,
      votos_nao_uteis: artigo.feedbacks_artigos_kb.filter((voto) => !voto.util).length,
      meu_voto: meu ? meu.util : null,
      imagens: anexos.filter((anexo) => anexo.tipo_mime.startsWith('image/')),
      pdfs: anexos.filter((anexo) => anexo.tipo_mime === 'application/pdf'),
      feedbacks_artigos_kb: undefined,
      anexos_artigos_kb: undefined,
    };
  }

  async anexarImagem(user: AuthUser, idArtigo: number, file: ArquivoUpload) {
    await this.exigirArtigo(user, idArtigo, false);
    const salvo = this.storage.validarImagem(user.id_cliente, idArtigo, file);
    const anexo = await this.prisma.$transaction(async (tx) => {
      const row = await tx.anexos_artigos_kb.create({
        data: {
          id_cliente: user.id_cliente,
          id_artigo: idArtigo,
          nome_arquivo: salvo.nome_arquivo,
          caminho_storage: salvo.caminho_storage,
          tipo_mime: salvo.tipo_mime,
          tamanho_bytes: salvo.tamanho_bytes,
          conteudo: new Uint8Array(salvo.conteudo),
        },
        select: {
          id: true,
          id_cliente: true,
          id_artigo: true,
          nome_arquivo: true,
          caminho_storage: true,
          tipo_mime: true,
          tamanho_bytes: true,
          data_upload: true,
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: salvo.tipo_mime === 'application/pdf' ? 'ADD_KB_PDF' : 'ADD_KB_IMAGE',
        tabela_afetada: 'anexos_artigos_kb',
        registro_id: row.id,
        valor_anterior: null,
        valor_novo: {
          id_artigo: idArtigo,
          nome_arquivo: salvo.nome_arquivo,
          tamanho_bytes: salvo.tamanho_bytes,
        },
      });
      return row;
    });
    return { ...anexo, tamanho_bytes: Number(anexo.tamanho_bytes) };
  }

  async baixarImagem(user: AuthUser, idArtigo: number, idImagem: number) {
    await this.exigirArtigo(user, idArtigo, user.perfil === 'SOLICITANTE');
    const imagem = await this.prisma.anexos_artigos_kb.findFirst({
      where: { id: idImagem, id_cliente: user.id_cliente, id_artigo: idArtigo },
    });
    if (!imagem?.conteudo) throw new NotFoundException('Arquivo não encontrado');
    return imagem;
  }

  private async exigirArtigo(user: AuthUser, id: number, somentePublicado: boolean) {
    const artigo = await this.prisma.artigos_kb.findFirst({
      where: {
        id,
        id_cliente: user.id_cliente,
        ...(somentePublicado ? { status: 'PUBLICADO' } : {}),
      },
      select: { id: true },
    });
    if (!artigo) throw new NotFoundException('Artigo não encontrado');
    return artigo;
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
