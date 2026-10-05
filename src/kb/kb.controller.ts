import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CreateArtigoDto, CreateCategoriaKbDto, FeedbackArtigoDto, UpdateArtigoDto } from './dto/artigo.dto.js';
import { CreateKbArtigoDto, CreateKbCategoriaDto, FeedbackKbDto } from './dto/kb.dto.js';
import { KbService } from './kb.service.js';

@Controller()
export class ArtigosController {
  constructor(private readonly kb: KbService) {}

  @Get('categorias-kb')
  categorias(@CurrentUser() user: AuthUser) {
    return this.kb.listarCategorias(user);
  }

  @Get('artigos-kb/:id')
  @Roles('SOLICITANTE')
  artigoPorId(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.kb.obterArtigo(user, id);
  }

  @Patch('artigos-kb/:id')
  @Roles('TECNICO')
  atualizarArtigo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateArtigoDto,
  ) {
    return this.kb.atualizarArtigo(user, id, dto);
  }

  @Post('categorias-kb')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  categoria(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoriaKbDto) {
    return this.kb.criarCategoria(user, dto, 'CREATE_KB_CATEGORY');
  }

  @Post('artigos-kb')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  artigo(@CurrentUser() user: AuthUser, @Body() dto: CreateArtigoDto) {
    return this.kb.criarArtigo(user, dto, 'CREATE_KB_ARTICLE');
  }

  @Post('artigos-kb/:id/feedback')
  @Roles('SOLICITANTE')
  @HttpCode(HttpStatus.CREATED)
  feedback(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FeedbackArtigoDto,
  ) {
    return this.kb.feedback(user, id, dto, 'ADD_KB_FEEDBACK');
  }
}

@Controller('kb')
export class KbController {
  constructor(private readonly kb: KbService) {}

  @Post('categorias')
  @Roles('GESTOR')
  @HttpCode(HttpStatus.CREATED)
  categoria(@CurrentUser() user: AuthUser, @Body() dto: CreateKbCategoriaDto) {
    return this.kb.criarCategoria(user, dto, 'CREATE_KB_CATEGORY');
  }

  @Post('artigos')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  artigo(@CurrentUser() user: AuthUser, @Body() dto: CreateKbArtigoDto) {
    return this.kb.criarArtigo(user, dto, 'CREATE_KB_ARTICLE');
  }

  @Post('artigos/:id/visualizar')
  @Roles('SOLICITANTE')
  @HttpCode(HttpStatus.OK)
  visualizar(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.kb.visualizar(user, id);
  }

  @Post('artigos/:id/feedback')
  @Roles('SOLICITANTE')
  @HttpCode(HttpStatus.CREATED)
  feedback(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FeedbackKbDto,
  ) {
    return this.kb.feedback(user, id, dto, 'ADD_KB_FEEDBACK');
  }
}
