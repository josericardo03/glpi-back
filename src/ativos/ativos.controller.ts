import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import {
  CreateAtivoDto,
  CreateEspecificacaoDto,
  CreateMapaDto,
  CreateManutencaoDto,
  CreateRelacionamentoDto,
  UpdateAtivoDto,
  UpdateMapaDto,
} from './dto/ativo.dto.js';
import { AtivosService } from './ativos.service.js';
import { MapasService } from './mapas.service.js';

@Controller()
export class AtivosController {
  constructor(
    private readonly ativos: AtivosService,
    private readonly mapas: MapasService,
  ) {}

  @Get('mapas-software')
  @Roles('TECNICO')
  listarMapas(@CurrentUser() user: AuthUser) {
    return this.mapas.listar(user);
  }

  @Post('mapas-software')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  criarMapa(@CurrentUser() user: AuthUser, @Body() dto: CreateMapaDto) {
    return this.mapas.criar(user, dto);
  }

  @Patch('mapas-software/:id')
  @Roles('TECNICO')
  atualizarMapa(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMapaDto,
  ) {
    return this.mapas.atualizar(user, id, dto);
  }

  @Delete('mapas-software/:id')
  @Roles('TECNICO')
  removerMapa(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('com_ligacoes') comLigacoes: string | undefined,
  ) {
    return this.mapas.remover(user, id, comLigacoes === 'true');
  }

  @Post('ativos')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  criar(@CurrentUser() user: AuthUser, @Body() dto: CreateAtivoDto) {
    return this.ativos.criar(user, dto);
  }

  @Patch('ativos/:id')
  @Roles('TECNICO')
  atualizar(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAtivoDto,
  ) {
    return this.ativos.atualizar(user, id, dto);
  }

  @Get('ativos/resumo')
  @Roles('SOLICITANTE')
  resumo(@CurrentUser() user: AuthUser) {
    return this.ativos.resumo(user);
  }

  @Post('ativos/relacionamentos')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  criarRelacionamento(@CurrentUser() user: AuthUser, @Body() dto: CreateRelacionamentoDto) {
    return this.ativos.criarRelacionamento(user, dto);
  }

  @Get('ativos/relacionamentos')
  @Roles('TECNICO')
  async listarRelacionamentos(
    @CurrentUser() user: AuthUser,
    @Query('limite') limite: string | undefined,
    @Query('pagina') pagina: string | undefined,
    @Query('id_mapa', new ParseIntPipe({ optional: true })) idMapa: number | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { rows, total } = await this.ativos.listarRelacionamentos(user, limite, pagina, idMapa);
    res.setHeader('X-Total-Count', String(total));
    return rows;
  }

  @Delete('ativos/relacionamentos/:idOrigem/:idDestino')
  @Roles('TECNICO')
  removerRelacionamento(
    @CurrentUser() user: AuthUser,
    @Param('idOrigem', ParseIntPipe) idOrigem: number,
    @Param('idDestino', ParseIntPipe) idDestino: number,
  ) {
    return this.ativos.removerRelacionamento(user, idOrigem, idDestino);
  }

  @Get('ativos/:id/impacto')
  @Roles('TECNICO')
  impacto(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('id_mapa', new ParseIntPipe({ optional: true })) idMapa: number | undefined,
  ) {
    return this.ativos.impacto(user, id, idMapa);
  }

  @Post('ativos/:id/especificacoes')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  especificacao(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateEspecificacaoDto,
  ) {
    return this.ativos.adicionarEspecificacao(user, id, dto);
  }

  @Post('ativos/:id/manutencoes')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  manutencao(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateManutencaoDto,
  ) {
    return this.ativos.registrarManutencao(user, id, dto);
  }

  // Declarada por último: o segmento dinâmico não pode capturar 'ativos/relacionamentos'.
  @Get('ativos/:id')
  @Roles('SOLICITANTE')
  detalhe(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.ativos.detalhe(user, id);
  }
}
