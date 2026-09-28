import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function conflito(error: unknown, mensagem: string) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictException(mensagem);
  }
  return error;
}
