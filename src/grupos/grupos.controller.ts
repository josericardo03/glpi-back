import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CreateGrupoDto, MembroGrupoDto } from './dto/grupo.dto.js';
import { GruposService } from './grupos.service.js';

@Controller()
export class GruposController {
  constructor(private readonly grupos: GruposService) {}

  @Post('grupos-suporte')
  @Roles('GESTOR')
  @HttpCode(HttpStatus.CREATED)
  criar(@CurrentUser() user: AuthUser, @Body() dto: CreateGrupoDto) {
    return this.grupos.criar(user, dto);
  }

  @Post('grupos-suporte/:id/membros')
  @Roles('GESTOR')
  @HttpCode(HttpStatus.CREATED)
  membro(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MembroGrupoDto,
  ) {
    return this.grupos.adicionarMembro(user, id, dto);
  }
}
