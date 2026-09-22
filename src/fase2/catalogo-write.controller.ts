import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CatalogoWriteService } from './catalogo-write.service.js';
import { CreateMudancaDto, CreateProblemaDto, CsatDto, DecisaoDto } from './dto/fase2.dto.js';

@Controller()
export class CatalogoWriteController {
  constructor(private readonly catalogo: CatalogoWriteService) {}

  @Post('pesquisas-csat')
  @Roles('SOLICITANTE')
  @HttpCode(HttpStatus.CREATED)
  csat(@CurrentUser() user: AuthUser, @Body() dto: CsatDto) {
    return this.catalogo.csat(user, dto);
  }

  @Post('problemas')
  @Roles('GESTOR')
  @HttpCode(HttpStatus.CREATED)
  problema(@CurrentUser() user: AuthUser, @Body() dto: CreateProblemaDto) {
    return this.catalogo.problema(user, dto);
  }

  @Post('mudancas')
  @Roles('GESTOR')
  @HttpCode(HttpStatus.CREATED)
  mudanca(@CurrentUser() user: AuthUser, @Body() dto: CreateMudancaDto) {
    return this.catalogo.mudanca(user, dto);
  }

  @Post('aprovacoes/:id/decisao')
  @Roles('GESTOR')
  @HttpCode(HttpStatus.OK)
  decisao(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecisaoDto,
  ) {
    return this.catalogo.decidir(user, id, dto);
  }
}
