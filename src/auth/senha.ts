import { BadRequestException } from '@nestjs/common';

/** Regra única de senha (troca, redefinição e criação): 8 a 128 caracteres, com letra e número. */
export function exigirSenhaForte(senha: string) {
  if (senha.length < 8) throw new BadRequestException('A senha deve ter ao menos 8 caracteres');
  if (senha.length > 128) throw new BadRequestException('A senha deve ter no máximo 128 caracteres');
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) {
    throw new BadRequestException('A senha deve ter letras e números');
  }
}
