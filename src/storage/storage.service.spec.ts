import { BadRequestException } from '@nestjs/common';
import { StorageService } from './storage.service.js';

const arquivo = (originalname: string, conteudo: Buffer, mimetype = 'application/octet-stream') => ({
  buffer: conteudo,
  originalname,
  mimetype,
  size: conteudo.length,
});

describe('StorageService.validar (anexos de chamado)', () => {
  const storage = new StorageService();
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

  it('aceita PDF verdadeiro e define o tipo pela extensão, não pelo cliente', () => {
    const r = storage.validar(1, 2, arquivo('manual.pdf', Buffer.from('%PDF-1.7 ...'), 'text/html'));
    expect(r.tipo_mime).toBe('application/pdf');
  });

  it('recusa HTML renomeado para .pdf', () => {
    expect(() => storage.validar(1, 2, arquivo('x.pdf', Buffer.from('<script>alert(1)</script>')))).toThrow(BadRequestException);
  });

  it('recusa extensões fora da lista', () => {
    expect(() => storage.validar(1, 2, arquivo('x.html', Buffer.from('<b>oi</b>')))).toThrow(BadRequestException);
    expect(() => storage.validar(1, 2, arquivo('x.exe', Buffer.from('MZ')))).toThrow(BadRequestException);
    expect(() => storage.validar(1, 2, arquivo('semextensao', Buffer.from('abc')))).toThrow(BadRequestException);
  });

  it('confere a assinatura de imagens', () => {
    expect(storage.validar(1, 2, arquivo('foto.png', PNG)).tipo_mime).toBe('image/png');
    expect(() => storage.validar(1, 2, arquivo('foto.png', Buffer.from('não é png')))).toThrow(BadRequestException);
  });

  it('texto puro passa e binário com extensão .log não', () => {
    expect(storage.validar(1, 2, arquivo('erro.log', Buffer.from('linha 1\nlinha 2'))).tipo_mime).toBe('text/plain');
    expect(() => storage.validar(1, 2, arquivo('erro.log', Buffer.from([0x41, 0x00, 0x42])))).toThrow(BadRequestException);
  });

  it('sanitiza o nome do arquivo', () => {
    const r = storage.validar(1, 2, arquivo('../../etc/relatório final.txt', Buffer.from('ok')));
    expect(r.nome_arquivo).not.toMatch(/[\s/]/);
    expect(r.nome_arquivo.endsWith('.txt')).toBe(true);
  });
});

describe('StorageService: modo disco', () => {
  let pasta: string;
  const storage = new StorageService();

  beforeEach(async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    pasta = await mkdtemp(join(tmpdir(), 'anexos-'));
    process.env.ANEXOS_STORAGE = 'disco';
    process.env.ANEXOS_DIR = pasta;
  });

  afterEach(async () => {
    delete process.env.ANEXOS_STORAGE;
    delete process.env.ANEXOS_DIR;
    const { rm } = await import('node:fs/promises');
    await rm(pasta, { recursive: true, force: true });
  });

  it('usa o prefixo disco:// nos anexos novos', () => {
    const r = storage.validar(1, 2, { buffer: Buffer.from('oi'), originalname: 'a.txt', mimetype: 'text/plain', size: 2 });
    expect(r.caminho_storage).toMatch(/^disco:\/\/1\/2\/\d+-a\.txt$/);
  });

  it('grava em arquivo, não devolve conteúdo para o banco e lê de volta', async () => {
    const r = storage.validar(1, 2, { buffer: Buffer.from('conteudo'), originalname: 'a.txt', mimetype: 'text/plain', size: 8 });
    expect(await storage.persistir(r.caminho_storage, r.conteudo)).toBeNull();
    const lido = await storage.carregar({ caminho_storage: r.caminho_storage, conteudo: null });
    expect(lido.toString()).toBe('conteudo');
    await storage.descartar(r.caminho_storage);
    await expect(storage.carregar({ caminho_storage: r.caminho_storage, conteudo: null })).rejects.toMatchObject({ status: 404 });
  });

  it('anexos antigos (postgres://) continuam lidos do banco', async () => {
    const lido = await storage.carregar({ caminho_storage: 'postgres://1/2/1-a.txt', conteudo: new Uint8Array(Buffer.from('antigo')) });
    expect(lido.toString()).toBe('antigo');
  });

  it('nunca sai da pasta de anexos (path traversal)', async () => {
    await expect(storage.persistir('disco://../../fora.txt', Buffer.from('x'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(storage.carregar({ caminho_storage: 'disco://../../etc/passwd', conteudo: null })).rejects.toBeDefined();
  });
});
