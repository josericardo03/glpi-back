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

