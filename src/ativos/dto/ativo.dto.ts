import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const TIPO_ATIVO = ['NOTEBOOK', 'SERVIDOR', 'LICENCA_SOFTWARE', 'RUST_ROUTER', 'SWITCH', 'OUTRO'] as const;
const STATUS_ATIVO = ['ATIVO', 'EM_MANUTENCAO', 'DESATIVADO', 'EM_ESTOQUE'] as const;

export class CreateAtivoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  codigo_patrimonio: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  nome: string;

  @IsIn(TIPO_ATIVO)
  tipo_ativo: (typeof TIPO_ATIVO)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_usuario_atribuido?: number;

  @IsOptional()
  @IsIn(STATUS_ATIVO)
  status?: (typeof STATUS_ATIVO)[number];

  @IsOptional()
  @IsDateString()
  data_aquisicao?: string;
}

export class UpdateAtivoDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  codigo_patrimonio?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  nome?: string;

  @IsOptional()
  @IsIn(TIPO_ATIVO)
  tipo_ativo?: (typeof TIPO_ATIVO)[number];

  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    return Number(value);
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  id_usuario_atribuido?: number | null;

  @IsOptional()
  @IsIn(STATUS_ATIVO)
  status?: (typeof STATUS_ATIVO)[number];

  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsDateString()
  data_aquisicao?: string | null;
}

export class CreateRelacionamentoDto {
  @Type(() => Number)
  @IsInt()
  id_ativo_origem: number;

  @Type(() => Number)
  @IsInt()
  id_ativo_destino: number;

  @IsIn(['DEPENDE_DE'])
  tipo_relacionamento: 'DEPENDE_DE';
}

