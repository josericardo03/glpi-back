import { IsBoolean } from 'class-validator';

export class MarcarNotificacaoDto {
  @IsBoolean()
  lida: boolean;
}
