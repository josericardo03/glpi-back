import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MulterError } from 'multer';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import type { ArquivoUpload } from '../storage/storage.service.js';
import { CreateArtigoDto, CreateCategoriaKbDto, FeedbackArtigoDto, UpdateArtigoDto } from './dto/artigo.dto.js';
import { CreateKbArtigoDto, CreateKbCategoriaDto, FeedbackKbDto } from './dto/kb.dto.js';
import { KbService } from './kb.service.js';

@Catch(MulterError)
class ImagemFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const grande = exception.code === 'LIMIT_FILE_SIZE';
    res.status(grande ? 413 : 400).json({
      message: grande ? 'Arquivo excede 20 MB' : exception.message,
    });
  }
}

@Controller()
export class ArtigosController {
  constructor(private readonly kb: KbService) {}

  @Get('categorias-kb')
  categorias(@CurrentUser() user: AuthUser) {
    return this.kb.listarCategorias(user);
  }

  @Get('artigos-kb/:id')
  @Roles('SOLICITANTE')
  artigoPorId(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.kb.obterArtigo(user, id);
  }

  @Patch('artigos-kb/:id')
  @Roles('TECNICO')
  atualizarArtigo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateArtigoDto,
  ) {
    return this.kb.atualizarArtigo(user, id, dto);
  }

  @Post('categorias-kb')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  categoria(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoriaKbDto) {
    return this.kb.criarCategoria(user, dto, 'CREATE_KB_CATEGORY');
  }

  @Post('artigos-kb')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  artigo(@CurrentUser() user: AuthUser, @Body() dto: CreateArtigoDto) {
    return this.kb.criarArtigo(user, dto, 'CREATE_KB_ARTICLE');
  }

  @Post('artigos-kb/:id/anexos')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  @UseFilters(ImagemFilter)
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 20 * 1024 * 1024 } }))
  anexarArquivo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: ArquivoUpload,
  ) {
    if (!file) throw new BadRequestException('Envie o campo arquivo');
    return this.kb.anexarImagem(user, id, file);
  }

  @Get('artigos-kb/:id/anexos/:anexoId')
  @Roles('SOLICITANTE')
  baixarArquivo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('anexoId', ParseIntPipe) anexoId: number,
  ) {
    return this.baixarImagem(user, id, anexoId);
  }

  @Delete('artigos-kb/:id/anexos/:anexoId')
  @Roles('TECNICO')
  removerArquivo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('anexoId', ParseIntPipe) anexoId: number,
  ) {
    return this.kb.removerAnexo(user, id, anexoId);
  }

  @Delete('artigos-kb/:id/imagens/:imagemId')
  @Roles('TECNICO')
  removerImagem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('imagemId', ParseIntPipe) imagemId: number,
  ) {
    return this.kb.removerAnexo(user, id, imagemId);
  }

  @Post('artigos-kb/:id/imagens')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  @UseFilters(ImagemFilter)
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 20 * 1024 * 1024 } }))
  anexarImagem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: ArquivoUpload,
  ) {
    if (!file) throw new BadRequestException('Envie o campo arquivo');
    return this.kb.anexarImagem(user, id, file);
  }

  @Get('artigos-kb/:id/imagens/:imagemId')
  @Roles('SOLICITANTE')
  async baixarImagem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('imagemId', ParseIntPipe) imagemId: number,
  ) {
    const imagem = await this.kb.baixarImagem(user, id, imagemId);
    return new StreamableFile(Buffer.from(imagem.conteudo!), {
      type: imagem.tipo_mime,
      disposition: `inline; filename="${imagem.nome_arquivo}"`,
    });
  }

  @Post('artigos-kb/:id/feedback')
  @Roles('SOLICITANTE')
  @HttpCode(HttpStatus.CREATED)
  feedback(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FeedbackArtigoDto,
  ) {
    return this.kb.feedback(user, id, dto, 'ADD_KB_FEEDBACK');
  }
}

@Controller('kb')
export class KbController {
  constructor(private readonly kb: KbService) {}

  @Post('categorias')
  @Roles('GESTOR')
  @HttpCode(HttpStatus.CREATED)
  categoria(@CurrentUser() user: AuthUser, @Body() dto: CreateKbCategoriaDto) {
    return this.kb.criarCategoria(user, dto, 'CREATE_KB_CATEGORY');
  }

  @Post('artigos')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  artigo(@CurrentUser() user: AuthUser, @Body() dto: CreateKbArtigoDto) {
    return this.kb.criarArtigo(user, dto, 'CREATE_KB_ARTICLE');
  }

  @Post('artigos/:id/anexos')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  @UseFilters(ImagemFilter)
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 20 * 1024 * 1024 } }))
  anexarArquivo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: ArquivoUpload,
  ) {
    if (!file) throw new BadRequestException('Envie o campo arquivo');
    return this.kb.anexarImagem(user, id, file);
  }

  @Get('artigos/:id/anexos/:anexoId')
  @Roles('SOLICITANTE')
  baixarArquivo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('anexoId', ParseIntPipe) anexoId: number,
  ) {
    return this.baixarImagem(user, id, anexoId);
  }

  @Delete('artigos/:id/anexos/:anexoId')
  @Roles('TECNICO')
  removerArquivo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('anexoId', ParseIntPipe) anexoId: number,
  ) {
    return this.kb.removerAnexo(user, id, anexoId);
  }

  @Delete('artigos/:id/imagens/:imagemId')
  @Roles('TECNICO')
  removerImagem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('imagemId', ParseIntPipe) imagemId: number,
  ) {
    return this.kb.removerAnexo(user, id, imagemId);
  }

  @Post('artigos/:id/imagens')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  @UseFilters(ImagemFilter)
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 20 * 1024 * 1024 } }))
  anexarImagem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: ArquivoUpload,
  ) {
    if (!file) throw new BadRequestException('Envie o campo arquivo');
    return this.kb.anexarImagem(user, id, file);
  }

  @Get('artigos/:id/imagens/:imagemId')
  @Roles('SOLICITANTE')
  async baixarImagem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('imagemId', ParseIntPipe) imagemId: number,
  ) {
    const imagem = await this.kb.baixarImagem(user, id, imagemId);
    return new StreamableFile(Buffer.from(imagem.conteudo!), {
      type: imagem.tipo_mime,
      disposition: `inline; filename="${imagem.nome_arquivo}"`,
    });
  }

  @Post('artigos/:id/visualizar')
  @Roles('SOLICITANTE')
  @HttpCode(HttpStatus.OK)
  visualizar(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.kb.visualizar(user, id);
  }

  @Post('artigos/:id/feedback')
  @Roles('SOLICITANTE')
  @HttpCode(HttpStatus.CREATED)
  feedback(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FeedbackKbDto,
  ) {
    return this.kb.feedback(user, id, dto, 'ADD_KB_FEEDBACK');
  }
}
