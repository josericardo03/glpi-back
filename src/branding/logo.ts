import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

/** Caminho público do logotipo guardado pelo sistema (o `?v=` só serve para trocar o cache do navegador). */
export const PREFIXO_LOGO = '/api/branding/logo/';
export const caminhoLogo = (idCliente: number, versao: number) => `${PREFIXO_LOGO}${idCliente}?v=${versao}`;

export const LOGO_MAX_BYTES = 1024 * 1024;
const SVG_MAX_BYTES = 256 * 1024;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** O tipo vem do conteúdo (assinatura do arquivo), não do nome nem do mimetype enviados pelo navegador. */
function detectarTipo(b: Buffer): string | null {
  if (b.subarray(0, 8).equals(PNG)) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/**
 * SVG é XML e pode carregar script. Dentro de <img> nada executa, mas o arquivo também é servido por URL pública:
 * aceitamos só SVG simples, sem script, eventos, objetos embutidos nem entidades externas.
 */
function svgSeguro(b: Buffer) {
  if (b.length > SVG_MAX_BYTES || b.includes(0)) return false;
  const texto = b.toString('utf8');
  if (!/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(texto)) return false;
  return !/<script|<foreignobject|<iframe|<embed|<object|<!entity|<!doctype|javascript:|\bon[a-z]+\s*=|\bhref\s*=\s*["']\s*(?!#)/i.test(texto);
}

export function validarLogo(arquivo: { buffer?: Buffer; size?: number } | undefined) {
  if (!arquivo?.buffer?.length) throw new BadRequestException('Envie o campo arquivo com uma imagem');
  if (arquivo.buffer.length > LOGO_MAX_BYTES) throw new PayloadTooLargeException('O logotipo deve ter no máximo 1 MB');
  const tipo = detectarTipo(arquivo.buffer) ?? (svgSeguro(arquivo.buffer) ? 'image/svg+xml' : null);
  if (!tipo) throw new BadRequestException('Envie uma imagem PNG, JPG, WebP ou SVG simples (sem scripts)');
  return { tipo, conteudo: arquivo.buffer };
}
