import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { COR_HEX_RE, LOGO_URL_RE } from '../../admin/dto/admin.dto.js';

export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(LOGO_URL_RE, { message: 'logo_url deve ser uma URL http(s) ou um caminho interno' })
  logo_url?: string;

  @IsOptional()
  @Matches(COR_HEX_RE)
  cor_primaria?: string;

  @IsOptional()
  @Matches(COR_HEX_RE)
  cor_secundaria?: string;

  @IsOptional()
  @Matches(COR_HEX_RE)
  cor_fundo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nome_portal?: string;
}
