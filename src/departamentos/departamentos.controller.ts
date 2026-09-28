import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CreateDepartamentoDto } from './dto/departamento.dto.js';
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
}
