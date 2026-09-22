import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import {
  CreateArtigoDto,
  CreateAtivoDto,
  CreateCategoriaDto,
  CreateCategoriaKbDto,
  CreateDepartamentoDto,
  CreateGrupoDto,
  CreateUsuarioDto,
  FeedbackArtigoDto,
  MarcarNotificacaoDto,
  MembroGrupoDto,
  UpdateBrandingDto,
  UpdateUsuarioDto,
} from './dto/fase3.dto.js';
import { Fase3Service } from './fase3.service.js';

@Controller()
export class Fase3Controller {
  constructor(private readonly fase3: Fase3Service) {}

  @Post('usuarios')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  criarUsuario(@CurrentUser() user: AuthUser, @Body() dto: CreateUsuarioDto) {
    return this.fase3.criarUsuario(user, dto);
  }

  @Patch('usuarios/:id')
  @Roles('ADMIN')
  atualizarUsuario(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUsuarioDto,
  ) {
    return this.fase3.atualizarUsuario(user, id, dto);
  }

  @Post('departamentos')
  @Roles('GESTOR')
  @HttpCode(HttpStatus.CREATED)
  departamento(@CurrentUser() user: AuthUser, @Body() dto: CreateDepartamentoDto) {
    return this.fase3.criarDepartamento(user, dto);
  }

  @Post('categorias')
  @Roles('GESTOR')
  @HttpCode(HttpStatus.CREATED)
  categoria(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoriaDto) {
    return this.fase3.criarCategoria(user, dto);
  }

  @Post('grupos-suporte')
  @Roles('GESTOR')
  @HttpCode(HttpStatus.CREATED)
  grupo(@CurrentUser() user: AuthUser, @Body() dto: CreateGrupoDto) {
    return this.fase3.criarGrupo(user, dto);
  }

  @Post('grupos-suporte/:id/membros')
  @Roles('GESTOR')
  @HttpCode(HttpStatus.CREATED)
  membro(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MembroGrupoDto,
  ) {
    return this.fase3.adicionarMembro(user, id, dto);
  }

  @Post('ativos')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  ativo(@CurrentUser() user: AuthUser, @Body() dto: CreateAtivoDto) {
    return this.fase3.criarAtivo(user, dto);
  }

  @Post('categorias-kb')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  categoriaKb(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoriaKbDto) {
    return this.fase3.criarCategoriaKb(user, dto);
  }

  @Post('artigos-kb')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  artigo(@CurrentUser() user: AuthUser, @Body() dto: CreateArtigoDto) {
    return this.fase3.criarArtigo(user, dto);
  }

  @Post('artigos-kb/:id/feedback')
  @Roles('SOLICITANTE')
  @HttpCode(HttpStatus.CREATED)
  feedback(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FeedbackArtigoDto,
  ) {
    return this.fase3.feedbackArtigo(user, id, dto);
  }

  @Put('branding')
  @Roles('ADMIN')
  branding(@CurrentUser() user: AuthUser, @Body() dto: UpdateBrandingDto) {
    return this.fase3.atualizarBranding(user, dto);
  }

  @Patch('notificacoes/:id')
  @Roles('SOLICITANTE')
  notificacao(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarcarNotificacaoDto,
  ) {
    return this.fase3.marcarNotificacao(user, id, dto);
  }
}
