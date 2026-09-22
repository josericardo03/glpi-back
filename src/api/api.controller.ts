import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller()
export class ApiController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('dashboards/resumo')
  resumo(@CurrentUser() user: AuthUser) {
    return this.prisma.chamados.groupBy({
      by: ['status'],
      where: this.tenant(user),
      _count: true,
    });
  }

  @Get('clientes')
  clientes(@CurrentUser() user: AuthUser) {
    return this.prisma.clientes.findMany({
      where: { id: user.id_cliente },
    });
  }

  @Get('usuarios')
  usuarios(@CurrentUser() user: AuthUser) {
    return this.prisma.usuarios.findMany({
      where: this.tenant(user),
      select: {
        id: true,
        id_cliente: true,
        nome: true,
        email: true,
        cargo: true,
        perfil: true,
        status: true,
        id_departamento: true,
        avatar_url: true,
        data_cadastro: true,
        ultimo_login: true,
      },
    });
  }

  @Get('departamentos')
  departamentos(@CurrentUser() user: AuthUser) {
    return this.prisma.departamentos.findMany({ where: this.tenant(user) });
  }

  @Get('grupos-suporte')
  grupos(@CurrentUser() user: AuthUser) {
    return this.prisma.grupos_suporte.findMany({ where: this.tenant(user) });
  }

  @Get('categorias')
  categorias(@CurrentUser() user: AuthUser) {
    return this.prisma.categorias_chamados.findMany({
      where: this.tenant(user),
    });
  }

  @Get('politicas-sla')
  sla(@CurrentUser() user: AuthUser) {
    return this.prisma.politicas_sla.findMany({ where: this.tenant(user) });
  }

  @Get('chamados')
  chamados(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.prisma.chamados.findMany({
      where: {
        ...this.tenant(user),
        ...(status ? { status } : {}),
      },
      orderBy: { data_abertura: 'desc' },
    });
  }

  @Get('chamados/:idCliente/:id')
  async chamado(
    @CurrentUser() user: AuthUser,
    @Param('idCliente', ParseIntPipe) idCliente: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    if (idCliente !== user.id_cliente) {
      throw new ForbiddenException('Recurso de outro tenant');
    }
    const chamado = await this.prisma.chamados.findUnique({
      where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
      include: {
        comentarios_chamados: true,
        anexos_chamados: {
          select: {
            id: true,
            id_cliente: true,
            id_chamado: true,
            id_comentario: true,
            nome_arquivo: true,
            caminho_storage: true,
            tipo_mime: true,
            tamanho_bytes: true,
            data_upload: true,
          },
        },
      },
    });
    if (!chamado) {
      throw new NotFoundException('Chamado não encontrado');
    }
    return {
      ...chamado,
      anexos_chamados: chamado.anexos_chamados.map((anexo) => ({
        ...anexo,
        tamanho_bytes: Number(anexo.tamanho_bytes),
      })),
    };
  }

  @Get('triagem')
  triagem(@CurrentUser() user: AuthUser) {
    return this.prisma.chamados.findMany({
      where: { ...this.tenant(user), status: 'NOVO' },
      orderBy: { data_abertura: 'asc' },
    });
  }

  @Get('ativos')
  ativos(@CurrentUser() user: AuthUser) {
    return this.prisma.ativos_cmdb.findMany({ where: this.tenant(user) });
  }

  @Get('artigos-kb')
  artigos(@CurrentUser() user: AuthUser) {
    return this.prisma.artigos_kb.findMany({
      where: { ...this.tenant(user), status: 'PUBLICADO' },
    });
  }

  @Get('aprovacoes')
  aprovacoes(@CurrentUser() user: AuthUser) {
    return this.prisma.requisicoes_aprovacao.findMany({
      where: { ...this.tenant(user), status: 'PENDENTE' },
    });
  }

  @Get('notificacoes')
  notificacoes(@CurrentUser() user: AuthUser) {
    return this.prisma.notificacoes.findMany({
      where: { id_cliente: user.id_cliente, id_usuario: user.id },
      orderBy: { data_criacao: 'desc' },
      take: 50,
    });
  }

  @Get('auditoria')
  auditoria(@CurrentUser() user: AuthUser) {
    return this.prisma.logs_auditoria.findMany({
      where: this.tenant(user),
      orderBy: { data_criacao: 'desc' },
      take: 100,
    });
  }

  @Get('branding')
  branding(@CurrentUser() user: AuthUser) {
    return this.prisma.configuracoes_branding.findMany({
      where: this.tenant(user),
    });
  }

  @Get('integracoes')
  integracoes(@CurrentUser() user: AuthUser) {
    return this.prisma.integracoes.findMany({ where: this.tenant(user) });
  }

  @Get('problemas')
  problemas(@CurrentUser() user: AuthUser) {
    return this.prisma.problemas.findMany({ where: this.tenant(user) });
  }

  @Get('mudancas')
  mudancas(@CurrentUser() user: AuthUser) {
    return this.prisma.mudancas.findMany({ where: this.tenant(user) });
  }

  private tenant(user: AuthUser) {
    return { id_cliente: user.id_cliente };
  }
}
