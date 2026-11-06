import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { BadRequestException, Injectable, Logger, NotFoundException, PayloadTooLargeException } from '@nestjs/common';

export type ArquivoUpload = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

const LIMITE = 20 * 1024 * 1024;

/**
 * Onde o conteúdo dos anexos fica: `postgres` (coluna BYTEA, o padrão) ou `disco` (arquivos em `ANEXOS_DIR`,
 * pensado para um volume). Cada anexo guarda no `caminho_storage` o prefixo do seu driver, então os dois
 * modos convivem: trocar a variável só afeta os anexos novos.
 */
const prefixoDoModo = () => (process.env.ANEXOS_STORAGE === 'disco' ? 'disco' : 'postgres');

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  private absoluto(caminho: string) {
    const base = resolve(process.env.ANEXOS_DIR ?? './storage');
    const alvo = resolve(base, caminho.slice('disco://'.length));
    // Os nomes já vêm saneados, mas a barreira final fica aqui: nunca sair de ANEXOS_DIR.
    if (!alvo.startsWith(base + sep)) throw new BadRequestException('Caminho de anexo inválido');
    return alvo;
  }

  /** Grava o conteúdo no driver do caminho. Devolve o que vai para a coluna `conteudo` (nada, no modo disco). */
  async persistir(caminho: string, conteudo: Buffer): Promise<Uint8Array<ArrayBuffer> | null> {
    if (!caminho.startsWith('disco://')) return new Uint8Array(conteudo);
    const arquivo = this.absoluto(caminho);
    await mkdir(dirname(arquivo), { recursive: true });
    await writeFile(arquivo, conteudo, { flag: 'wx' });
    return null;
  }

  /** Lê o conteúdo de um anexo, de onde ele estiver. */
  async carregar(anexo: { caminho_storage: string; conteudo: Uint8Array | null }): Promise<Buffer> {
    if (anexo.caminho_storage.startsWith('disco://')) {
      try {
        return await readFile(this.absoluto(anexo.caminho_storage));
      } catch {
        throw new NotFoundException('Arquivo não encontrado no armazenamento');
      }
    }
    if (!anexo.conteudo) throw new NotFoundException('Anexo não encontrado');
    return Buffer.from(anexo.conteudo);
  }

  /** Apaga o arquivo do disco (se o anexo for de disco). Falha não interrompe: sobra um arquivo órfão. */
  async descartar(caminho: string) {
    if (!caminho.startsWith('disco://')) return;
    try {
      await unlink(this.absoluto(caminho));
    } catch (erro) {
      this.logger.warn(`Arquivo ${caminho} não removido: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

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
    // O tipo vem da extensão e o conteúdo é conferido: o mimetype enviado pelo cliente não é confiável.
    const tipo = TIPOS_ANEXO_CHAMADO[extensao(nome)];
    if (!tipo || !tipo.confere(file.buffer)) {
      throw new BadRequestException('Tipo de arquivo não permitido ou conteúdo incompatível com a extensão');
    }
    return {
      nome_arquivo: nome,
      caminho_storage: `${prefixoDoModo()}://${idCliente}/${idChamado}/${Date.now()}-${nome}`,
      tipo_mime: tipo.mime,
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
      caminho_storage: `${prefixoDoModo()}://${idCliente}/artigos-kb/${idArtigo}/${Date.now()}-${nome}`,
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

const extensao = (nome: string) => {
  const i = nome.lastIndexOf('.');
  return i < 0 ? '' : nome.slice(i).toLowerCase();
};

const ehPng = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const ehJpeg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const ehPdf = (b: Buffer) => b.subarray(0, 4).toString('ascii') === '%PDF';
const ehZip = (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b;
/** Texto puro não contém bytes nulos (binário renomeado para .txt/.log é recusado). */
const ehTexto = (b: Buffer) => !b.subarray(0, 8192).includes(0);

/** Extensões aceitas nos anexos de chamado (as mesmas do formulário do front). */
export const TIPOS_ANEXO_CHAMADO: Record<string, { mime: string; confere: (buffer: Buffer) => boolean }> = {
  '.pdf': { mime: 'application/pdf', confere: ehPdf },
  '.png': { mime: 'image/png', confere: ehPng },
  '.jpg': { mime: 'image/jpeg', confere: ehJpeg },
  '.jpeg': { mime: 'image/jpeg', confere: ehJpeg },
  '.zip': { mime: 'application/zip', confere: ehZip },
  '.txt': { mime: 'text/plain', confere: ehTexto },
  '.log': { mime: 'text/plain', confere: ehTexto },
};
