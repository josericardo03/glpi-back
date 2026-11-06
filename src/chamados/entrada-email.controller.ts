import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { LimitadorService } from '../common/limitador.service.js';
import { EntradaEmailService } from './entrada-email.service.js';

export class EntradaEmailDto {
  @IsEmail()
  de: string;

  @IsString()
  @MaxLength(255)
  assunto: string;

  @IsString()
  @MaxLength(20000)
  texto: string;
}

@Controller('entrada')
export class EntradaEmailController {
  constructor(
    private readonly entrada: EntradaEmailService,
    private readonly limitador: LimitadorService,
  ) {}

  /** Público (sem JWT): a autenticação é o token da integração EMAIL_ENTRADA, enviado em X-Integration-Token. */
  @Public()
  @Post('email')
  @HttpCode(HttpStatus.CREATED)
  receber(@Headers('x-integration-token') token: string | undefined, @Body() dto: EntradaEmailDto, @Req() req: Request) {
    this.limitador.exigir(`entrada:${req.ip ?? 'desconhecido'}`, 60, 60_000);
    return this.entrada.receber(token, dto);
  }
}
