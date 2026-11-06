import { BadRequestException } from '@nestjs/common';

/**
 * `limite` e `pagina` vindos da query string, convertidos em `take`/`skip`.
 * Valores inválidos (não numéricos) viram 400; limites acima do teto são reduzidos ao teto.
 */
export function fatia(limite: string | undefined, pagina: string | undefined, padrao: number, teto: number) {
  if (limite && !/^\d+$/.test(limite)) throw new BadRequestException('limite inválido');
  if (pagina && !/^\d+$/.test(pagina)) throw new BadRequestException('pagina inválida');
  const tamanho = Math.min(teto, Math.max(1, Number(limite) || padrao));
  const paginaNum = Math.max(1, Number(pagina) || 1);
  return { take: tamanho, skip: (paginaNum - 1) * tamanho };
}
