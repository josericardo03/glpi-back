import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './current-user.decorator.js';
import {
  CodigoMfaDto,
  DesativarMfaDto,
  EsqueciSenhaDto,
  LoginDto,
  RedefinirSenhaDto,
  TrocarSenhaDto,
} from './dto/login.dto.js';
import { Public } from './public.decorator.js';
import type { AuthUser } from './auth.types.js';

export const COOKIE_REFRESH = 'itsm_refresh';
const CAMINHO_COOKIE = '/api/auth';
const VALIDADE_COOKIE_MS = 14 * 24 * 3600_000;

const contexto = (req: Request) => ({ ip: req.ip ?? null, agente: req.headers['user-agent'] ?? null });

function lerCookie(req: Request, nome: string): string | undefined {
  const bruto = req.headers.cookie;
  if (!bruto) return undefined;
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return undefined;
}

/**
 * O refresh token vive só neste cookie: httpOnly (o JavaScript da página não lê, então um XSS não o rouba),
 * SameSite=Lax e restrito ao caminho /api/auth. `secure` acompanha o protocolo da requisição.
 */
function gravarCookie(res: Response, req: Request, token: string) {
  res.cookie(COOKIE_REFRESH, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: CAMINHO_COOKIE,
    maxAge: VALIDADE_COOKIE_MS,
  });
}

function limparCookie(res: Response, req: Request) {
  res.clearCookie(COOKIE_REFRESH, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: CAMINHO_COOKIE });
}

/**
 * Cabeçalho personalizado exigido nas rotas que usam o cookie: outro site não consegue enviá-lo sem
 * passar pela checagem de CORS, o que fecha a porta para CSRF mesmo se o SameSite for ignorado.
 */
function exigirCabecalhoAjax(req: Request) {
  if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
    throw new BadRequestException('Cabeçalho X-Requested-With ausente');
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { refresh_token, ...resposta } = await this.auth.login(dto, contexto(req));
    gravarCookie(res, req, refresh_token);
    return resposta;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    exigirCabecalhoAjax(req);
    const token = lerCookie(req, COOKIE_REFRESH);
    if (!token) {
      limparCookie(res, req);
      // Com passthrough o Nest ainda serializa o valor retornado: devolver `res.json()` (o próprio res) quebra.
      throw new UnauthorizedException('Sem sessão');
    }
    try {
      const { refresh_token, ...resposta } = await this.auth.refresh(token, contexto(req));
      if (refresh_token) gravarCookie(res, req, refresh_token);
      return resposta;
    } catch (erro) {
      limparCookie(res, req);
      throw erro;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    exigirCabecalhoAjax(req);
    const resultado = await this.auth.logout(lerCookie(req, COOKIE_REFRESH));
    limparCookie(res, req);
    return resultado;
  }

  @Post('logout-todos')
  @HttpCode(HttpStatus.OK)
  async logoutTodos(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const resultado = await this.auth.logoutTodos(user);
    limparCookie(res, req);
    return resultado;
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @Get('sessoes')
  sessoes(@CurrentUser() user: AuthUser) {
    return this.auth.listarSessoes(user);
  }

  @Delete('sessoes/:id')
  revogarSessao(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.revogarSessao(user, id);
  }

  @Post('senha')
  @HttpCode(HttpStatus.OK)
  trocarSenha(@CurrentUser() user: AuthUser, @Body() dto: TrocarSenhaDto, @Req() req: Request) {
    return this.auth.trocarSenha(user, dto.senha_atual, dto.nova_senha, contexto(req));
  }

  @Public()
  @Post('esqueci-senha')
  @HttpCode(HttpStatus.OK)
  esqueciSenha(@Body() dto: EsqueciSenhaDto, @Req() req: Request) {
    return this.auth.esqueciSenha(dto.email, dto.id_cliente, contexto(req));
  }

  @Public()
  @Post('redefinir-senha')
  @HttpCode(HttpStatus.OK)
  redefinirSenha(@Body() dto: RedefinirSenhaDto, @Req() req: Request) {
    return this.auth.redefinirSenha(dto.token, dto.nova_senha, contexto(req));
  }

  @Post('mfa/configurar')
  @HttpCode(HttpStatus.OK)
  configurarMfa(@CurrentUser() user: AuthUser) {
    return this.auth.configurarMfa(user);
  }

  @Post('mfa/ativar')
  @HttpCode(HttpStatus.OK)
  ativarMfa(@CurrentUser() user: AuthUser, @Body() dto: CodigoMfaDto) {
    return this.auth.ativarMfa(user, dto.codigo);
  }

  @Post('mfa/desativar')
  @HttpCode(HttpStatus.OK)
  desativarMfa(@CurrentUser() user: AuthUser, @Body() dto: DesativarMfaDto) {
    return this.auth.desativarMfa(user, dto.senha, dto.codigo);
  }
}
