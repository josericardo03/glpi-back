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
