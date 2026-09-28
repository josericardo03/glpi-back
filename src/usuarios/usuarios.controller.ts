import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CreateUsuarioDto, UpdateUsuarioDto } from './dto/usuario.dto.js';
import { UsuariosService } from './usuarios.service.js';

@Controller()
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Post('usuarios')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  criar(@CurrentUser() user: AuthUser, @Body() dto: CreateUsuarioDto) {
    return this.usuarios.criar(user, dto);
  }

  @Patch('usuarios/:id')
  @Roles('ADMIN')
  atualizar(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUsuarioDto,
  ) {
    return this.usuarios.atualizar(user, id, dto);
  }
}
