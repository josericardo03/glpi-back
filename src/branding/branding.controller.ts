import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import { UpdateBrandingDto } from './dto/branding.dto.js';
import { BrandingService } from './branding.service.js';
import { LOGO_MAX_BYTES } from './logo.js';

@Controller()
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Put('branding')
  @Roles('ADMIN')
  atualizar(@CurrentUser() user: AuthUser, @Body() dto: UpdateBrandingDto) {
    return this.branding.atualizar(user, dto);
  }

  @Post('branding/logo')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  // Um byte acima do limite: o multer corta o envio e a validação responde 413 com a mensagem certa.
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: LOGO_MAX_BYTES + 1 } }))
  enviarLogo(@CurrentUser() user: AuthUser, @UploadedFile() arquivo: { buffer: Buffer; size: number } | undefined) {
    if (!arquivo) throw new BadRequestException('Envie o campo arquivo com uma imagem');
    return this.branding.enviarLogo(user, arquivo);
  }

  /**
   * Pública de propósito: o navegador carrega o logotipo numa tag <img>, que não envia o token de acesso.
   * O endereço traz `?v=` (muda a cada envio), então o navegador pode guardar a imagem por muito tempo.
   */
  @Public()
  @Get('branding/logo/:idCliente')
  async logo(
    @Param('idCliente', ParseIntPipe) idCliente: number,
    @Query('v') versao: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const logo = await this.branding.obterLogo(idCliente);
    res.set({
      'Cache-Control': versao ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      // Se alguém abrir o arquivo direto no navegador, nada executa (vale principalmente para SVG).
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      // O front roda em outra origem que a API: sem isto, o navegador pode barrar a imagem.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    return new StreamableFile(Buffer.from(logo.conteudo), { type: logo.tipo_mime });
  }
}
