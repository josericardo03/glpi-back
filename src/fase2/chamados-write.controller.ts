import {
  BadRequestException,
  Body,
  Controller,
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
import { Catch, ExceptionFilter, ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ChamadosWriteService } from './chamados-write.service.js';
import type { ArquivoUpload } from '../storage/storage.service.js';
import {
  AnexoMetaDto,
  AtivoChamadoDto,
  ComentarioDto,
  CreateChamadoDto,
  PausaDto,
  StatusChamadoDto,
  WorklogDto,
} from './dto/fase2.dto.js';

@Catch(MulterError)
class AnexoFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const grande = exception.code === 'LIMIT_FILE_SIZE';
    res.status(grande ? 413 : 400).json({
      message: grande ? 'Arquivo excede 20 MB' : exception.message,
    });
  }
}

@Controller('chamados')
@UseFilters(AnexoFilter)
export class ChamadosWriteController {
  constructor(private readonly chamados: ChamadosWriteService) {}

  @Post()
  @Roles('SOLICITANTE')
  @HttpCode(HttpStatus.CREATED)
  abrir(@CurrentUser() user: AuthUser, @Body() dto: CreateChamadoDto) {
    return this.chamados.abrir(user, dto);
  }

  @Patch(':id/status')
  @Roles('TECNICO')
  status(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StatusChamadoDto,
  ) {
    return this.chamados.mudarStatus(user, id, dto);
  }

  @Post(':id/comentarios')
  @Roles('SOLICITANTE')
  @HttpCode(HttpStatus.CREATED)
  comentarios(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ComentarioDto,
  ) {
    return this.chamados.comentar(user, id, dto);
  }

  @Post(':id/pausas')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  pausar(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PausaDto,
  ) {
    return this.chamados.pausar(user, id, dto);
  }

  @Patch(':id/pausas/retomar')
  @Roles('TECNICO')
  retomar(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.chamados.retomar(user, id);
  }

  @Post(':id/worklogs')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  worklog(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WorklogDto,
  ) {
    return this.chamados.worklog(user, id, dto);
  }

  @Post(':id/anexos')
  @Roles('SOLICITANTE')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('arquivo', { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  anexar(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: ArquivoUpload,
    @Body() meta: AnexoMetaDto,
  ) {
    if (!file) throw new BadRequestException('Envie o campo arquivo');
    return this.chamados.anexar(user, id, file, meta.id_comentario);
  }

  @Get(':id/anexos/:anexoId')
  @Roles('SOLICITANTE')
  async baixar(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('anexoId', ParseIntPipe) anexoId: number,
  ) {
    const anexo = await this.chamados.baixar(user, id, anexoId);
    return new StreamableFile(Buffer.from(anexo.conteudo!), {
      type: anexo.tipo_mime,
      disposition: `attachment; filename="${anexo.nome_arquivo}"`,
    });
  }

  @Post(':id/ativos')
  @Roles('TECNICO')
  @HttpCode(HttpStatus.CREATED)
  ativos(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AtivoChamadoDto,
  ) {
    return this.chamados.vincularAtivo(user, id, dto);
  }
}
