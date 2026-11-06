import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_cliente?: number;

  /** Código de 6 dígitos do aplicativo autenticador, ou um código de recuperação. */
  @IsOptional()
  @IsString()
  @Length(6, 20)
  codigo_mfa?: string;
}

export class TrocarSenhaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  senha_atual: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  nova_senha: string;
}

export class EsqueciSenhaDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_cliente?: number;
}

export class RedefinirSenhaDto {
  @IsString()
  @Length(20, 200)
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  nova_senha: string;
}

export class CodigoMfaDto {
  @IsString()
  @Length(6, 20)
  codigo: string;
}

export class DesativarMfaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  senha: string;

  @IsString()
  @Length(6, 20)
  codigo: string;
}
