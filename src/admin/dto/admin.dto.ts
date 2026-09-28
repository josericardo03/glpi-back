import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const STATUS_CLIENTE = ['ATIVO', 'BLOQUEADO', 'INATIVO'] as const;
const PERFIS = ['ADMIN', 'GESTOR', 'TECNICO', 'SOLICITANTE'] as const;
const STATUS_USUARIO = ['ATIVO', 'DESATIVADO', 'PENDENTE_CONFIRMACAO'] as const;
const STATUS_SIMPLES = ['ATIVO', 'INATIVO'] as const;
const PRIORIDADES = ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA'] as const;
const TIPOS = ['INCIDENTE', 'REQUISICAO', 'AMBOS'] as const;
const TIPOS_INTEGRACAO = ['LDAP', 'AD', 'SMTP', 'WEBHOOK'] as const;

export class CreateClienteDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  razao_social: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome_fantasia: string;

  @IsString()
  @MinLength(14)
  @MaxLength(18)
  @Matches(/^[\d./-]+$/)
  cnpj: string;

  @IsOptional()
  @IsIn(STATUS_CLIENTE)
  status?: (typeof STATUS_CLIENTE)[number];
}

export class CreateDepartamentoAdminDto {
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
  id_departamento_pai?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_responsavel?: number;
}

export class CreateUsuarioAdminDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(255)
  senha_hash: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_departamento?: number;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  cargo: string;

  @IsIn(PERFIS)
  perfil: (typeof PERFIS)[number];

  @IsOptional()
  @IsIn(STATUS_USUARIO)
  status?: (typeof STATUS_USUARIO)[number];
}

export class UpdateUsuarioAdminDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  senha_hash?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_departamento?: number;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  cargo?: string;

  @IsOptional()
  @IsIn(PERFIS)
  perfil?: string;

  @IsOptional()
  @IsIn(STATUS_USUARIO)
  status?: (typeof STATUS_USUARIO)[number];
}

export class MembroAdminDto {
  @Type(() => Number)
  @IsInt()
  id_usuario: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cargo_especialidade?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  carga_trabalho_max?: number;
}

export class CreateGrupoAdminDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome: string;

  @IsOptional()
  @IsString()
  descricao?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MembroAdminDto)
  membros?: MembroAdminDto[];
}

export class CreateHorarioDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  fuso_horario?: string;

  @IsOptional()
  @IsIn(STATUS_SIMPLES)
  status?: (typeof STATUS_SIMPLES)[number];
}

export class CreateIntervaloDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dia_semana: number;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  hora_inicio: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  hora_fim: string;
}

export class CreateFeriadoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  dia: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  mes: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  ano?: number | null;
}

export class CreatePoliticaDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome: string;

  @IsIn(PRIORIDADES)
  prioridade_alvo: (typeof PRIORIDADES)[number];

  @IsIn(TIPOS)
  tipo_chamado_alvo: (typeof TIPOS)[number];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  tempo_resposta_min: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  tempo_resolucao_min: number;

  @Type(() => Number)
  @IsInt()
  id_horario_comercial: number;

  @IsOptional()
  @IsIn(STATUS_SIMPLES)
  status?: (typeof STATUS_SIMPLES)[number];
}

export class BrandingAdminDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  logo_url?: string;

  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  cor_primaria?: string;

  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  cor_secundaria?: string;

  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  cor_fundo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nome_portal?: string;
}

export class CreateIntegracaoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome: string;

  @IsIn(TIPOS_INTEGRACAO)
  tipo: (typeof TIPOS_INTEGRACAO)[number];

  @IsObject()
  configuracoes: Record<string, unknown>;

  @IsOptional()
  @IsIn(STATUS_SIMPLES)
  status?: (typeof STATUS_SIMPLES)[number];
}

export class FiltroAuditoriaDto {
  @IsOptional()
  @IsDateString()
  data_inicio?: string;

  @IsOptional()
  @IsDateString()
  data_fim?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_usuario?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  acao?: string;
}
