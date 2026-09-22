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

export class CreateGrupoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome: string;

  @IsOptional()
  @IsString()
  descricao?: string;
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

export class CreateCategoriaKbDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome: string;

  @IsOptional()
  @IsString()
  descricao?: string;
}

export class CreateArtigoDto {
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

export class FeedbackArtigoDto {
  @IsBoolean()
  util: boolean;

  @IsOptional()
  @IsString()
  comentario?: string;
}

export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  logo_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(7)
  cor_primaria?: string;

  @IsOptional()
  @IsString()
  @MaxLength(7)
  cor_secundaria?: string;

  @IsOptional()
  @IsString()
  @MaxLength(7)
  cor_fundo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nome_portal?: string;
}

export class MarcarNotificacaoDto {
  @IsBoolean()
  lida: boolean;
}
