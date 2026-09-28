import { Type } from 'class-transformer';
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
} from 'class-validator';
export const PRIORIDADES = ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA'] as const;
export const TIPOS_MUDANCA = ['PADRAO', 'NORMAL', 'EMERGENCIAL'] as const;

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

export class DecisaoDto {
  @IsIn(['APROVADO', 'REJEITADO'])
  status: 'APROVADO' | 'REJEITADO';

  @IsOptional()
  @IsString()
  @MinLength(3)
  justificativa_aprovador?: string;
}

