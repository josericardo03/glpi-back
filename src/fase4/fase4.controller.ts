import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import {
  CreateKbArtigoDto,
  CreateKbCategoriaDto,
  CreateNotificacaoDto,
  FeedbackKbDto,
} from './dto/fase4.dto.js';
import { Fase4Service } from './fase4.service.js';

@Controller('kb')
export class KbController {
  constructor(private readonly fase4: Fase4Service) {}

  @Post('categorias')
  @Roles('GESTOR')
  @HttpCode(HttpStatus.CREATED)
  categoria(@CurrentUser() user: AuthUser, @Body() dto: CreateKbCategoriaDto) {
    return this.fase4.criarCategoria(user, dto);
  }

  @Post('artigos')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  artigo(@CurrentUser() user: AuthUser, @Body() dto: CreateKbArtigoDto) {
    return this.fase4.criarArtigo(user, dto);
  }

  @Post('artigos/:id/visualizar')
  @Roles('SOLICITANTE')
  @HttpCode(HttpStatus.OK)
  visualizar(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.fase4.visualizar(user, id);
  }

  @Post('artigos/:id/feedback')
  @Roles('SOLICITANTE')
  @HttpCode(HttpStatus.CREATED)
  feedback(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FeedbackKbDto,
  ) {
    return this.fase4.feedback(user, id, dto);
  }
}

@Controller()
export class NotificacoesController {
  constructor(private readonly fase4: Fase4Service) {}

  @Post('notificacoes')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  criar(@CurrentUser() user: AuthUser, @Body() dto: CreateNotificacaoDto) {
    return this.fase4.criarNotificacao(user, dto);
  }

  @Patch('notificacoes/ler-todas')
  @Roles('SOLICITANTE')
  lerTodas(@CurrentUser() user: AuthUser) {
    return this.fase4.lerTodas(user);
  }

  @Patch('notificacoes/:id/ler')
  @Roles('SOLICITANTE')
  ler(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.fase4.ler(user, id);
  }
}
