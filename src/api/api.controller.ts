import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { mascararConfig } from '../admin/segredo.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller()
export class ApiController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('dashboards/resumo')
  resumo(@CurrentUser() user: AuthUser) {
    return this.prisma.chamados.groupBy({
      by: ['status'],
      where: this.chamadosDoUsuario(user),
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
  usuarios(
    @CurrentUser() user: AuthUser,
    @Query('limite') limite?: string,
    @Query('pagina') pagina?: string,
  ) {
    if (user.perfil === 'SOLICITANTE') {
      return this.prisma.usuarios.findMany({
        where: { id_cliente: user.id_cliente, perfil: { in: ['GESTOR', 'ADMIN'] } },
        select: { id: true, nome: true, perfil: true },
        orderBy: { nome: 'asc' },
        ...this.fatia(limite, pagina, 100, 200),
      });
    }
    return this.prisma.usuarios.findMany({
      where: this.tenant(user),
      ...this.fatia(limite, pagina, 100, 200),
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
    return this.prisma.politicas_sla.findMany({
      where: this.tenant(user),
      include: { horarios_comerciais: { select: { id: true, nome: true, fuso_horario: true } } },
    });
  }

  @Get('chamados')
  chamados(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('limite') limite?: string,
    @Query('pagina') pagina?: string,
  ) {
    return this.prisma.chamados.findMany({
      where: {
        ...this.chamadosDoUsuario(user),
        ...(status ? { status } : {}),
      },
      orderBy: { data_abertura: 'desc' },
      ...this.fatia(limite, pagina, 100, 200),
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
        chamados_ativos: {
          include: {
            ativos_cmdb: {
              select: { id: true, nome: true, codigo_patrimonio: true, tipo_ativo: true },
            },
          },
        },
        chamados_problemas: {
          include: { problemas: { select: { id: true, titulo: true, status: true } } },
        },
        mudancas_chamados: {
          include: { mudancas: { select: { id: true, titulo: true, status: true } } },
        },
        pesquisas_csat: {
          select: { nota_satisfacao: true, comentarios: true, data_resposta: true },
        },
        worklogs: { orderBy: { data_execucao: 'desc' } },
        pausas_sla: { orderBy: { data_pausa: 'desc' } },
        historico_status_chamados: { orderBy: { data_alteracao: 'desc' } },
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
    if (user.perfil === 'SOLICITANTE' && chamado.id_solicitante !== user.id) {
      throw new ForbiddenException('Chamado de outro solicitante');
    }
    const comentarios =
      user.perfil === 'SOLICITANTE'
        ? chamado.comentarios_chamados.filter((item) => item.tipo_visibilidade === 'PUBLICO')
        : chamado.comentarios_chamados;
    const internos = new Set(
      chamado.comentarios_chamados
        .filter((item) => item.tipo_visibilidade === 'INTERNO')
        .map((item) => item.id),
    );
    const anexos =
      user.perfil === 'SOLICITANTE'
        ? chamado.anexos_chamados.filter(
            (anexo) => anexo.id_comentario == null || !internos.has(anexo.id_comentario),
          )
        : chamado.anexos_chamados;
    const ativos = chamado.chamados_ativos.map((vinculo) => ({
      id: vinculo.ativos_cmdb.id,
      nome: vinculo.ativos_cmdb.nome,
      codigo_patrimonio: vinculo.ativos_cmdb.codigo_patrimonio,
      tipo: vinculo.ativos_cmdb.tipo_ativo,
    }));
    return {
      ...chamado,
      id_ativo_afetado: ativos[0]?.id ?? null,
      ativos,
      problemas: chamado.chamados_problemas.map((vinculo) => vinculo.problemas),
      mudancas: chamado.mudancas_chamados.map((vinculo) => vinculo.mudancas),
      csat: chamado.pesquisas_csat
        ? { ...chamado.pesquisas_csat, avaliado: true }
        : { avaliado: false },
      comentarios_chamados: comentarios,
      anexos_chamados: anexos.map((anexo) => ({
        ...anexo,
        tamanho_bytes: Number(anexo.tamanho_bytes),
      })),
    };
  }

  @Get('triagem')
  triagem(
    @CurrentUser() user: AuthUser,
    @Query('limite') limite?: string,
    @Query('pagina') pagina?: string,
  ) {
    return this.prisma.chamados.findMany({
      where: { ...this.chamadosDoUsuario(user), status: 'NOVO' },
      orderBy: { data_abertura: 'asc' },
      ...this.fatia(limite, pagina, 100, 200),
    });
  }

  @Get('ativos')
  ativos(
    @CurrentUser() user: AuthUser,
    @Query('limite') limite?: string,
    @Query('pagina') pagina?: string,
  ) {
    return this.prisma.ativos_cmdb.findMany({
      where: {
        ...this.tenant(user),
        ...(user.perfil === 'SOLICITANTE' ? { id_usuario_atribuido: user.id } : {}),
      },
      ...this.fatia(limite, pagina, 100, 200),
    });
  }

  @Get('artigos-kb')
  async artigos(
    @CurrentUser() user: AuthUser,
    @Query('limite') limite?: string,
    @Query('pagina') pagina?: string,
    @Query('status') status?: string,
    @Query('meus') meus?: string,
  ) {
    const statusValidos = ['RASCUNHO', 'REVISAO', 'PUBLICADO', 'ARQUIVADO'];
    if (status && !statusValidos.includes(status)) {
      throw new BadRequestException('status de artigo inválido');
    }
    const tecnico = user.perfil !== 'SOLICITANTE';
    const meusArtigos = tecnico && meus === 'true';
    const statusFiltro = tecnico && status ? status : meusArtigos ? undefined : 'PUBLICADO';
    const rows = await this.prisma.artigos_kb.findMany({
      where: {
        ...this.tenant(user),
        ...(statusFiltro ? { status: statusFiltro } : {}),
        ...(meusArtigos ? { id_autor: user.id } : {}),
      },
      include: { feedbacks_artigos_kb: { select: { util: true, id_usuario: true } } },
      orderBy: { data_atualizacao: 'desc' },
      ...this.fatia(limite, pagina, 50, 100),
    });
    return rows.map(({ feedbacks_artigos_kb, ...artigo }) => this.comVotos(artigo, feedbacks_artigos_kb, user.id));
  }

  @Get('aprovacoes')
  aprovacoes(
    @CurrentUser() user: AuthUser,
    @Query('limite') limite?: string,
    @Query('pagina') pagina?: string,
    @Query('status') status?: string,
  ) {
    const permitidos = ['PENDENTE', 'APROVADO', 'REJEITADO', 'CANCELADO', 'TODOS'];
    if (status && !permitidos.includes(status)) {
      throw new BadRequestException('status de aprovação inválido');
    }
    const filtro = !status || status === 'PENDENTE' ? 'PENDENTE' : status;
    return this.prisma.requisicoes_aprovacao.findMany({
      where: {
        ...this.tenant(user),
        ...(filtro === 'TODOS' ? {} : { status: filtro }),
        ...(user.perfil === 'SOLICITANTE' ? { id_solicitante: user.id } : {}),
      },
      orderBy: { data_solicitacao: 'desc' },
      ...this.fatia(limite, pagina, 50, 100),
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
  @Roles('ADMIN')
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
  @Roles('ADMIN')
  async integracoes(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.integracoes.findMany({ where: this.tenant(user) });
    return rows.map((row) => ({
      ...row,
      configuracoes: mascararConfig((row.configuracoes ?? {}) as Record<string, unknown>),
    }));
  }

  @Get('problemas')
  @Roles('TECNICO')
  async problemas(
    @CurrentUser() user: AuthUser,
    @Query('limite') limite?: string,
    @Query('pagina') pagina?: string,
  ) {
    const rows = await this.prisma.problemas.findMany({
      where: this.tenant(user),
      include: {
        chamados_problemas: {
          include: { chamados: { select: { id: true, titulo: true, status: true } } },
        },
      },
      orderBy: { data_identificacao: 'desc' },
      ...this.fatia(limite, pagina, 50, 100),
    });
    return rows.map(({ chamados_problemas, ...problema }) => ({
      ...problema,
      chamados: chamados_problemas.map((vinculo) => vinculo.chamados),
    }));
  }

  @Get('mudancas')
  @Roles('TECNICO')
  async mudancas(
    @CurrentUser() user: AuthUser,
    @Query('limite') limite?: string,
    @Query('pagina') pagina?: string,
  ) {
    const rows = await this.prisma.mudancas.findMany({
      where: this.tenant(user),
      include: {
        mudancas_chamados: {
          include: { chamados: { select: { id: true, titulo: true, status: true } } },
        },
      },
      orderBy: { data_criacao: 'desc' },
      ...this.fatia(limite, pagina, 50, 100),
    });
    return rows.map(({ mudancas_chamados, ...mudanca }) => ({
      ...mudanca,
      chamados: mudancas_chamados.map((vinculo) => vinculo.chamados),
    }));
  }

  private tenant(user: AuthUser) {
    return { id_cliente: user.id_cliente };
  }

  private chamadosDoUsuario(user: AuthUser) {
    return {
      id_cliente: user.id_cliente,
      ...(user.perfil === 'SOLICITANTE' ? { id_solicitante: user.id } : {}),
    };
  }

  private comVotos<T extends object>(
    artigo: T,
    votos: { util: boolean; id_usuario: number }[],
    idUsuario: number,
  ) {
    const meu = votos.find((voto) => voto.id_usuario === idUsuario);
    return {
      ...artigo,
      votos_uteis: votos.filter((voto) => voto.util).length,
      votos_nao_uteis: votos.filter((voto) => !voto.util).length,
      meu_voto: meu ? meu.util : null,
    };
  }

  private fatia(limite: string | undefined, pagina: string | undefined, padrao: number, teto: number) {
    const tamanho = Math.min(teto, Math.max(1, Number(limite) || padrao));
    const paginaNum = Math.max(1, Number(pagina) || 1);
    return { take: tamanho, skip: (paginaNum - 1) * tamanho };
  }
}
