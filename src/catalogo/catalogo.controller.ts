import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CatalogoService } from './catalogo.service.js';
import {
  CreateAprovacaoDto,
  CreateMudancaDto,
  CreateProblemaDto,
  CsatDto,
  DecisaoDto,
  UpdateMudancaDto,
  UpdateProblemaDto,
} from './dto/catalogo.dto.js';

@Controller()
export class CatalogoController {
  constructor(private readonly catalogo: CatalogoService) {}

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

  @Get('problemas/:id')
  @Roles('TECNICO')
  problemaPorId(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.catalogo.obterProblema(user, id);
  }

  @Patch('problemas/:id')
  @Roles('TECNICO')
  atualizarProblema(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProblemaDto,
  ) {
    return this.catalogo.atualizarProblema(user, id, dto);
  }

  @Get('mudancas/:id')
  @Roles('TECNICO')
  mudancaPorId(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.catalogo.obterMudanca(user, id);
  }

  @Patch('mudancas/:id')
  @Roles('GESTOR')
  atualizarMudanca(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMudancaDto,
  ) {
    return this.catalogo.atualizarMudanca(user, id, dto);
  }

  @Post('aprovacoes')
  @Roles('SOLICITANTE')
  @HttpCode(HttpStatus.CREATED)
  aprovacao(@CurrentUser() user: AuthUser, @Body() dto: CreateAprovacaoDto) {
    return this.catalogo.criarAprovacao(user, dto);
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
