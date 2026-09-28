import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CreateNotificacaoDto } from './dto/criar-notificacao.dto.js';
import { MarcarNotificacaoDto } from './dto/notificacao.dto.js';
import { NotificacoesService } from './notificacoes.service.js';

@Controller()
export class NotificacoesController {
  constructor(private readonly notificacoes: NotificacoesService) {}

  @Post('notificacoes')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  criar(@CurrentUser() user: AuthUser, @Body() dto: CreateNotificacaoDto) {
    return this.notificacoes.criar(user, dto);
  }

  @Patch('notificacoes/ler-todas')
  @Roles('SOLICITANTE')
  lerTodas(@CurrentUser() user: AuthUser) {
    return this.notificacoes.lerTodas(user);
  }

  @Patch('notificacoes/:id/ler')
  @Roles('SOLICITANTE')
  ler(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.notificacoes.ler(user, id);
  }

  @Patch('notificacoes/:id')
  @Roles('SOLICITANTE')
  marcar(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarcarNotificacaoDto,
  ) {
    return this.notificacoes.marcar(user, id, dto);
  }
}
