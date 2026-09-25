import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const STATUS_ARTIGO = ['RASCUNHO', 'REVISAO', 'PUBLICADO', 'ARQUIVADO'] as const;

export class CreateKbCategoriaDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome: string;

  @IsOptional()
  @IsString()
  descricao?: string;
}

export class CreateKbArtigoDto {
  @Type(() => Number)
  @IsInt()
  id_categoria: number;

  @IsString()
  @MinLength(3)
  @MaxLength(255)
  titulo: string;

  @IsString()
  @MinLength(3)
  conteudo: string;

  @IsOptional()
  @IsIn(STATUS_ARTIGO)
  status?: (typeof STATUS_ARTIGO)[number];
}

export class FeedbackKbDto {
  @IsBoolean()
  util: boolean;

  @IsOptional()
  @IsString()
  comentario?: string;
}

export class CreateNotificacaoDto {
  @Type(() => Number)
  @IsInt()
  id_usuario: number;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  titulo: string;

  @IsString()
  @MinLength(2)
  mensagem: string;
}
