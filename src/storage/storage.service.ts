import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';

export type ArquivoUpload = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

const LIMITE = 20 * 1024 * 1024;

@Injectable()
export class StorageService {
  validar(idCliente: number, idChamado: number, file: ArquivoUpload) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Arquivo vazio');
    }
    if (file.size > LIMITE) {
      throw new PayloadTooLargeException('Arquivo excede 20 MB');
    }
    const nome = (file.originalname || 'arquivo')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120);
    return {
      nome_arquivo: nome,
      caminho_storage: `postgres://${idCliente}/${idChamado}/${Date.now()}-${nome}`,
      tipo_mime: file.mimetype || 'application/octet-stream',
      tamanho_bytes: file.size,
      conteudo: file.buffer,
    };
  }

  validarImagem(idCliente: number, idArtigo: number, file: ArquivoUpload) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Arquivo vazio');
    }
    if (file.size > LIMITE) {
      throw new PayloadTooLargeException('Arquivo excede 20 MB');
    }
    const tipo = file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype;
    if (!TIPOS_ANEXO.has(tipo) || !assinaturaAnexo(tipo, file.buffer)) {
      throw new BadRequestException('Envie uma imagem PNG, JPEG, GIF ou WebP, ou um PDF');
    }
    const nome = (file.originalname || 'imagem')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120);
    return {
      nome_arquivo: nome,
      caminho_storage: `postgres://${idCliente}/artigos-kb/${idArtigo}/${Date.now()}-${nome}`,
      tipo_mime: tipo,
      tamanho_bytes: file.size,
      conteudo: file.buffer,
    };
  }
}

const TIPOS_ANEXO = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);

function assinaturaAnexo(tipo: string, buffer: Buffer) {
  if (tipo === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (tipo === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (tipo === 'image/gif') return buffer.subarray(0, 3).toString('ascii') === 'GIF';
  if (tipo === 'application/pdf') return buffer.subarray(0, 4).toString('ascii') === '%PDF';
  return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
}
