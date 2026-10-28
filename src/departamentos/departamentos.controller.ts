import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CreateDepartamentoDto, UpdateDepartamentoDto } from './dto/departamento.dto.js';
import { DepartamentosService } from './departamentos.service.js';

@Controller()
export class DepartamentosController {
  constructor(private readonly departamentos: DepartamentosService) {}

  @Post('departamentos')
  @Roles('GESTOR')
  @HttpCode(HttpStatus.CREATED)
  criar(@CurrentUser() user: AuthUser, @Body() dto: CreateDepartamentoDto) {
    return this.departamentos.criar(user, dto);
  }

  @Patch('departamentos/:id')
  @Roles('GESTOR')
  atualizar(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDepartamentoDto,
  ) {
    return this.departamentos.atualizar(user, id, dto);
  }
}
