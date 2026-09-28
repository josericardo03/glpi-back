import { Type } from 'class-transformer';
import { IsInt, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateNotificacaoDto {
  @Type(() => Number)
  @IsInt()
  id_usuario: number;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  titulo: string;

  @IsString()
  @MinLength(2)
  mensagem: string;
}
