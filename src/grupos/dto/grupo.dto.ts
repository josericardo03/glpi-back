import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const PERFIS = ['ADMIN', 'GESTOR', 'TECNICO', 'SOLICITANTE'] as const;
const STATUS_USUARIO = ['ATIVO', 'DESATIVADO', 'PENDENTE_CONFIRMACAO'] as const;
const STATUS_SIMPLES = ['ATIVO', 'INATIVO'] as const;
const TIPO_CAT = ['INCIDENTE', 'REQUISICAO', 'AMBOS'] as const;
const TIPO_ATIVO = ['NOTEBOOK', 'SERVIDOR', 'LICENCA_SOFTWARE', 'RUST_ROUTER', 'SWITCH', 'OUTRO'] as const;
const STATUS_ATIVO = ['ATIVO', 'EM_MANUTENCAO', 'DESATIVADO', 'EM_ESTOQUE'] as const;
const STATUS_ARTIGO = ['RASCUNHO', 'REVISAO', 'PUBLICADO', 'ARQUIVADO'] as const;

export class CreateGrupoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome: string;

  @IsOptional()
  @IsString()
  descricao?: string;
}

export class UpdateGrupoDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome?: string;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? null : value))
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  descricao?: string | null;

  @IsOptional()
  @IsIn(STATUS_SIMPLES)
  status?: (typeof STATUS_SIMPLES)[number];
}


export class MembroGrupoDto {
  @Type(() => Number)
  @IsInt()
  id_usuario: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cargo_especialidade?: string;
}

