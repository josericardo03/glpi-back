import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './login.dto.js';

@Controller()
export class ApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('dashboards/resumo')
  resumo() {
    return this.prisma.chamados.groupBy({
      by: ['status'],
      _count: true,
    });
  }

  @Get('clientes')
  clientes() {
    return this.prisma.clientes.findMany();
  }

  @Get('usuarios')
  usuarios() {
    return this.prisma.usuarios.findMany({
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
  departamentos() {
    return this.prisma.departamentos.findMany();
  }

  @Get('grupos-suporte')
  grupos() {
    return this.prisma.grupos_suporte.findMany();
  }

  @Get('categorias')
  categorias() {
    return this.prisma.categorias_chamados.findMany();
  }

  @Get('politicas-sla')
  sla() {
    return this.prisma.politicas_sla.findMany();
  }

  @Get('chamados')
  chamados(@Query('status') status?: string) {
    return this.prisma.chamados.findMany({
      where: status ? { status } : undefined,
      orderBy: { data_abertura: 'desc' },
    });
  }

  @Get('chamados/:idCliente/:id')
  chamado(
    @Param('idCliente', ParseIntPipe) idCliente: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.prisma.chamados.findUnique({
      where: { id_cliente_id: { id_cliente: idCliente, id } },
      include: { comentarios_chamados: true, anexos_chamados: true },
    });
  }

  @Get('triagem')
  triagem() {
    return this.prisma.chamados.findMany({
      where: { status: 'NOVO' },
      orderBy: { data_abertura: 'asc' },
    });
  }

  @Get('ativos')
  ativos() {
    return this.prisma.ativos_cmdb.findMany();
  }

  @Get('artigos-kb')
  artigos() {
    return this.prisma.artigos_kb.findMany({
      where: { status: 'PUBLICADO' },
    });
  }

  @Get('aprovacoes')
  aprovacoes() {
    return this.prisma.requisicoes_aprovacao.findMany({
      where: { status: 'PENDENTE' },
    });
  }

  @Get('notificacoes')
  notificacoes() {
    return this.prisma.notificacoes.findMany({
      orderBy: { data_criacao: 'desc' },
      take: 50,
    });
  }

  @Get('auditoria')
  auditoria() {
    return this.prisma.logs_auditoria.findMany({
      orderBy: { data_criacao: 'desc' },
      take: 100,
    });
  }

  @Get('branding')
  branding() {
    return this.prisma.configuracoes_branding.findMany();
  }

  @Get('integracoes')
  integracoes() {
    return this.prisma.integracoes.findMany();
  }

  @Get('problemas')
  problemas() {
    return this.prisma.problemas.findMany();
  }

  @Get('mudancas')
  mudancas() {
    return this.prisma.mudancas.findMany();
  }
}
