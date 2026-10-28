import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CreateCategoriaDto, UpdateCategoriaDto } from './dto/categoria.dto.js';
import { CategoriasService } from './categorias.service.js';

@Controller()
export class CategoriasController {
  constructor(private readonly categorias: CategoriasService) {}

  @Post('categorias')
  @Roles('GESTOR')
  @HttpCode(HttpStatus.CREATED)
  criar(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoriaDto) {
    return this.categorias.criar(user, dto);
  }

  @Patch('categorias/:id')
  @Roles('GESTOR')
  atualizar(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoriaDto,
  ) {
    return this.categorias.atualizar(user, id, dto);
  }
}
