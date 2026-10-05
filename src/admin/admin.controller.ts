import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import {
  BrandingAdminDto,
  CreateClienteDto,
  CreateDepartamentoAdminDto,
  CreateFeriadoDto,
  CreateGrupoAdminDto,
  CreateHorarioDto,
  CreateIntegracaoDto,
  CreateIntervaloDto,
  CreatePoliticaDto,
  CreateUsuarioAdminDto,
  FiltroAuditoriaDto,
  UpdateFeriadoDto,
  UpdateHorarioDto,
  UpdatePoliticaDto,
  UpdateUsuarioAdminDto,
} from './dto/admin.dto.js';
import { AdminService } from './admin.service.js';

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('clientes')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  clientes(@CurrentUser() user: AuthUser, @Body() dto: CreateClienteDto) {
    return this.admin.criarCliente(user, dto);
  }

  @Post('departamentos')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  departamentos(@CurrentUser() user: AuthUser, @Body() dto: CreateDepartamentoAdminDto) {
    return this.admin.criarDepartamento(user, dto);
  }

  @Post('usuarios')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  usuarios(@CurrentUser() user: AuthUser, @Body() dto: CreateUsuarioAdminDto) {
    return this.admin.criarUsuario(user, dto);
  }

  @Patch('usuarios/:id')
  @Roles('ADMIN')
  atualizarUsuario(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUsuarioAdminDto,
  ) {
    return this.admin.atualizarUsuario(user, id, dto);
  }

  @Post('grupos-suporte')
  @Roles('GESTOR')
  @HttpCode(HttpStatus.CREATED)
  grupos(@CurrentUser() user: AuthUser, @Body() dto: CreateGrupoAdminDto) {
    return this.admin.criarGrupo(user, dto);
  }

  @Get('horarios-comerciais')
  @Roles('ADMIN')
  listarHorarios(@CurrentUser() user: AuthUser) {
    return this.admin.listarHorarios(user);
  }

  @Patch('horarios-comerciais/:id')
  @Roles('ADMIN')
  atualizarHorario(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHorarioDto,
  ) {
    return this.admin.atualizarHorario(user, id, dto);
  }

  @Delete('horarios-comerciais/:id')
  @Roles('ADMIN')
  removerHorario(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.admin.removerHorario(user, id);
  }

  @Post('horarios-comerciais')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  horarios(@CurrentUser() user: AuthUser, @Body() dto: CreateHorarioDto) {
    return this.admin.criarHorario(user, dto);
  }

  @Post('horarios-comerciais/:id/intervalos')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  intervalos(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateIntervaloDto,
  ) {
    return this.admin.criarIntervalo(user, id, dto);
  }

  @Patch('horarios-comerciais/:id/intervalos/:idIntervalo')
  @Roles('ADMIN')
  atualizarIntervalo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('idIntervalo', ParseIntPipe) idIntervalo: number,
    @Body() dto: CreateIntervaloDto,
  ) {
    return this.admin.atualizarIntervalo(user, id, idIntervalo, dto);
  }

  @Delete('horarios-comerciais/:id/intervalos/:idIntervalo')
  @Roles('ADMIN')
  removerIntervalo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('idIntervalo', ParseIntPipe) idIntervalo: number,
  ) {
    return this.admin.removerIntervalo(user, id, idIntervalo);
  }

  @Get('feriados')
  @Roles('ADMIN')
  listarFeriados(@CurrentUser() user: AuthUser) {
    return this.admin.listarFeriados(user);
  }

  @Patch('feriados/:id')
  @Roles('ADMIN')
  atualizarFeriado(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFeriadoDto,
  ) {
    return this.admin.atualizarFeriado(user, id, dto);
  }

  @Delete('feriados/:id')
  @Roles('ADMIN')
  removerFeriado(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.admin.removerFeriado(user, id);
  }

  @Post('feriados')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  feriados(@CurrentUser() user: AuthUser, @Body() dto: CreateFeriadoDto) {
    return this.admin.criarFeriado(user, dto);
  }

  @Patch('politicas-sla/:id')
  @Roles('ADMIN')
  atualizarPolitica(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePoliticaDto,
  ) {
    return this.admin.atualizarPolitica(user, id, dto);
  }

  @Post('politicas-sla')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  politicas(@CurrentUser() user: AuthUser, @Body() dto: CreatePoliticaDto) {
    return this.admin.criarPolitica(user, dto);
  }

  @Post('branding')
  @Roles('ADMIN')
  async branding(
    @CurrentUser() user: AuthUser,
    @Body() dto: BrandingAdminDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resultado = await this.admin.branding(user, dto);
    res.status(resultado.criado ? HttpStatus.CREATED : HttpStatus.OK);
    return resultado.row;
  }

  @Post('integracoes')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  integracoes(@CurrentUser() user: AuthUser, @Body() dto: CreateIntegracaoDto) {
    return this.admin.criarIntegracao(user, dto);
  }

  @Post('integracoes/:id/testar')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  testar(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.admin.testarIntegracao(user, id);
  }

  @Get('auditoria')
  @Roles('ADMIN')
  auditoria(@CurrentUser() user: AuthUser, @Query() filtro: FiltroAuditoriaDto) {
    return this.admin.auditoria(user, filtro);
  }
}
