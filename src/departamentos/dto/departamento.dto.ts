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

export class CreateDepartamentoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  codigo_sigla: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_responsavel?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_departamento_pai?: number;
}

export class UpdateDepartamentoDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  codigo_sigla?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome?: string;

  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    return Number(value);
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  id_responsavel?: number | null;

  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    return Number(value);
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  id_departamento_pai?: number | null;

  @IsOptional()
  @IsIn(STATUS_SIMPLES)
  status?: (typeof STATUS_SIMPLES)[number];
}

