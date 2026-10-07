import {
  Body,
  Controller,
  Delete,
  Get,
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
import { CreateAtivoDto, CreateRelacionamentoDto } from './dto/ativo.dto.js';
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
    @Res({ passthrough: true }) res: Response,
  ) {
    const { rows, total } = await this.ativos.listarRelacionamentos(user, limite, pagina);
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
  impacto(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.ativos.impacto(user, id);
  }
}
