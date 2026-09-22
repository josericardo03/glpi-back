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

export const TIPOS_CHAMADO = ['INCIDENTE', 'REQUISICAO'] as const;
export const ORIGENS = ['PORTAL', 'TELEFONE', 'EMAIL', 'CHAT', 'API'] as const;
export const PRIORIDADES = ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA'] as const;
export const STATUS_CHAMADO = [
  'NOVO',
  'EM_ATENDIMENTO',
  'PENDENTE',
  'RESOLVIDO',
  'CONCLUIDO',
] as const;
export const MOTIVOS_PAUSA = [
  'AGUARDANDO_SOLICITANTE',
  'AGUARDANDO_TERCEIRO',
  'FORNECEDOR_EXTERNO',
  'MANUTENCAO_PROGRAMADA',
] as const;
export const VISIBILIDADES = ['PUBLICO', 'INTERNO'] as const;
export const TIPOS_MUDANCA = ['PADRAO', 'NORMAL', 'EMERGENCIAL'] as const;

export class CreateChamadoDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  titulo: string;

  @IsString()
  @MinLength(3)
  descricao: string;

  @Type(() => Number)
  @IsInt()
  id_categoria: number;

  @IsIn(TIPOS_CHAMADO)
  tipo: (typeof TIPOS_CHAMADO)[number];

  @IsOptional()
  @IsIn(ORIGENS)
  origem?: (typeof ORIGENS)[number];

  @IsIn(PRIORIDADES)
  prioridade: (typeof PRIORIDADES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_ativo_afetado?: number;
}

export class StatusChamadoDto {
  @IsIn(STATUS_CHAMADO)
  status_novo: (typeof STATUS_CHAMADO)[number];

  @IsOptional()
  @IsString()
  @MinLength(3)
  resolucao?: string;

  @IsOptional()
  @IsDateString()
  data_resolucao?: string;

  @IsOptional()
  @IsDateString()
  data_fechamento?: string;

  @IsOptional()
  @IsIn(MOTIVOS_PAUSA)
  motivo_pausa?: (typeof MOTIVOS_PAUSA)[number];
}

export class ComentarioDto {
  @IsString()
  @MinLength(1)
  mensagem: string;

  @IsOptional()
  @IsIn(VISIBILIDADES)
  tipo_visibilidade?: (typeof VISIBILIDADES)[number];
}

export class PausaDto {
  @IsIn(MOTIVOS_PAUSA)
  motivo_pausa: (typeof MOTIVOS_PAUSA)[number];
}

export class WorklogDto {
  @IsString()
  @MinLength(3)
  descricao_atividade: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  tempo_trabalhado_min: number;

  @IsDateString()
  data_execucao: string;
}

export class AtivoChamadoDto {
  @Type(() => Number)
  @IsInt()
  id_ativo: number;
}

export class AnexoMetaDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_comentario?: number;
}

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
