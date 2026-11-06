import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
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

  /** Mapa em que a dependência entra. Sem ele, vai para o mapa "Principal" (criado se não existir). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id_mapa?: number;
}

export class CreateMapaDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(500)
  descricao?: string | null;
}

export class UpdateMapaDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(500)
  descricao?: string | null;
}


export class CreateEspecificacaoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  chave: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  valor: string;
}

export class CreateManutencaoDto {
  @IsString()
  @MinLength(3)
  descricao_servico: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  custo_manutencao: number;

  @IsDateString()
  data_inicio: string;

  @IsOptional()
  @IsDateString()
  data_fim?: string;
}
