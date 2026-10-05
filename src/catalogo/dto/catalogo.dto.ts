import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
export const PRIORIDADES = ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA'] as const;
export const TIPOS_MUDANCA = ['PADRAO', 'NORMAL', 'EMERGENCIAL'] as const;
export const STATUS_PROBLEMA = ['SOB_INVESTIGACAO', 'ERRO_CONHECIDO', 'RESOLVIDO', 'FECHADO'] as const;
export const STATUS_MUDANCA = [
  'RASCUNHO',
  'AVALIACAO',
  'APROVACAO',
  'AGENDADA',
  'EM_IMPLEMENTACAO',
  'CONCLUIDA',
  'CANCELADA',
] as const;

export class CsatDto {
  @Type(() => Number)
  @IsInt()
  id_chamado: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  nota_satisfacao: number;

  @IsOptional()
  @IsString()
  comentarios?: string;
}

export class CreateProblemaDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  titulo: string;

  @IsString()
  @MinLength(3)
  descricao: string;

  @IsIn(PRIORIDADES)
  prioridade: (typeof PRIORIDADES)[number];

  @IsOptional()
  @IsString()
  causa_raiz?: string;

  @IsOptional()
  @IsString()
  solucao_contorno?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_chamado?: number;
}

export class CreateMudancaDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  titulo: string;

  @IsString()
  @MinLength(3)
  descricao: string;

  @IsString()
  @MinLength(3)
  justificativa: string;

  @IsString()
  @MinLength(3)
  plano_impacto: string;

  @IsString()
  @MinLength(3)
  plano_testes: string;

  @IsString()
  @MinLength(3)
  plano_retorno: string;

  @IsIn(TIPOS_MUDANCA)
  tipo_mudanca: (typeof TIPOS_MUDANCA)[number];

  @IsDateString()
  janela_inicio: string;

  @IsDateString()
  janela_fim: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_chamado?: number;
}

export class UpdateProblemaDto {
  @IsOptional()
  @IsIn(STATUS_PROBLEMA)
  status?: (typeof STATUS_PROBLEMA)[number];

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? null : value))
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  causa_raiz?: string | null;

  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? null : value))
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  solucao_contorno?: string | null;

  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    return Number(value);
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  id_tecnico_atribuido?: number | null;

  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsDateString()
  data_resolucao?: string | null;
}

export class UpdateMudancaDto {
  @IsOptional()
  @IsIn(STATUS_MUDANCA)
  status?: (typeof STATUS_MUDANCA)[number];

  @IsOptional()
  @IsDateString()
  janela_inicio?: string | null;

  @IsOptional()
  @IsDateString()
  janela_fim?: string | null;
}

export class CreateAprovacaoDto {
  @IsString()
  @MinLength(3)
  descricao: string;

  @Type(() => Number)
  @IsInt()
  id_aprovador: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_chamado?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_mudanca?: number;
}

export class DecisaoDto {
  @IsIn(['APROVADO', 'REJEITADO'])
  status: 'APROVADO' | 'REJEITADO';

  @IsOptional()
  @IsString()
  @MinLength(3)
  justificativa_aprovador?: string;
}

