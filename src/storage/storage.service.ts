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
}
