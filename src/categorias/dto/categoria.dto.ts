import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const STATUS_SIMPLES = ['ATIVO', 'INATIVO'] as const;
const TIPO_CAT = ['INCIDENTE', 'REQUISICAO', 'AMBOS'] as const;

export class CreateCategoriaDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome: string;

  @IsOptional()
  @IsIn(TIPO_CAT)
  tipo_aplicacao?: (typeof TIPO_CAT)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_categoria_pai?: number;

  @IsOptional()
  @IsIn(STATUS_SIMPLES)
  status?: (typeof STATUS_SIMPLES)[number];
}

export class UpdateCategoriaDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome?: string;

  @IsOptional()
  @IsIn(TIPO_CAT)
  tipo_aplicacao?: (typeof TIPO_CAT)[number];

  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    return Number(value);
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  id_categoria_pai?: number | null;

  @IsOptional()
  @IsIn(STATUS_SIMPLES)
  status?: (typeof STATUS_SIMPLES)[number];
}

