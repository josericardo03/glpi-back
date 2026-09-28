import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CreateAtivoDto } from './dto/ativo.dto.js';
import { AtivosService } from './ativos.service.js';

@Controller()
export class AtivosController {
  constructor(private readonly ativos: AtivosService) {}

  @Post('ativos')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  criar(@CurrentUser() user: AuthUser, @Body() dto: CreateAtivoDto) {
    return this.ativos.criar(user, dto);
  }
}
