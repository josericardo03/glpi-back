import { Type } from 'class-transformer';
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
} from 'class-validator';

const PERFIS = ['ADMIN', 'GESTOR', 'TECNICO', 'SOLICITANTE'] as const;
const STATUS_USUARIO = ['ATIVO', 'DESATIVADO', 'PENDENTE_CONFIRMACAO'] as const;
const STATUS_SIMPLES = ['ATIVO', 'INATIVO'] as const;
const TIPO_CAT = ['INCIDENTE', 'REQUISICAO', 'AMBOS'] as const;
const TIPO_ATIVO = ['NOTEBOOK', 'SERVIDOR', 'LICENCA_SOFTWARE', 'RUST_ROUTER', 'SWITCH', 'OUTRO'] as const;
const STATUS_ATIVO = ['ATIVO', 'EM_MANUTENCAO', 'DESATIVADO', 'EM_ESTOQUE'] as const;
const STATUS_ARTIGO = ['RASCUNHO', 'REVISAO', 'PUBLICADO', 'ARQUIVADO'] as const;

export class CreateUsuarioDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  cargo: string;

  @IsIn(PERFIS)
  perfil: (typeof PERFIS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_departamento?: number;

  @IsOptional()
  @IsIn(STATUS_USUARIO)
  status?: (typeof STATUS_USUARIO)[number];
}


export class UpdateUsuarioDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  cargo?: string;

  @IsOptional()
  @IsIn(PERFIS)
  perfil?: (typeof PERFIS)[number];

  @IsOptional()
  @IsIn(STATUS_USUARIO)
  status?: (typeof STATUS_USUARIO)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_departamento?: number;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

