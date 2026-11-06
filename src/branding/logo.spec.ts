import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { LOGO_MAX_BYTES, validarLogo } from './logo.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const svg = (corpo: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${corpo}</svg>`);

describe('validarLogo', () => {
  it('detecta PNG, JPG e WebP pelo conteúdo', () => {
    expect(validarLogo({ buffer: PNG }).tipo).toBe('image/png');
    expect(validarLogo({ buffer: JPG }).tipo).toBe('image/jpeg');
    expect(validarLogo({ buffer: WEBP }).tipo).toBe('image/webp');
  });

  it('aceita SVG simples, com ou sem declaração XML', () => {
    expect(validarLogo({ buffer: svg('<rect width="10" height="10"/>') }).tipo).toBe('image/svg+xml');
    expect(validarLogo({ buffer: Buffer.concat([Buffer.from('<?xml version="1.0"?>'), svg('<circle r="4"/>')]) }).tipo).toBe('image/svg+xml');
  });

  it.each([
    ['script', '<script>alert(1)</script>'],
    ['evento onload', '<rect onload="x()"/>'],
    ['javascript:', '<a href="javascript:alert(1)"><rect/></a>'],
    ['foreignObject', '<foreignObject><div/></foreignObject>'],
    ['link externo', '<image href="https://exemplo.com/x.png"/>'],
    ['entidade', '<!ENTITY x "y">'],
  ])('recusa SVG com %s', (_nome, corpo) => {
    expect(() => validarLogo({ buffer: svg(corpo) })).toThrow(BadRequestException);
  });

  it('recusa arquivo que não é imagem, mesmo com nome e tipo de imagem', () => {
    expect(() => validarLogo({ buffer: Buffer.from('MZ programa') })).toThrow(BadRequestException);
    expect(() => validarLogo(undefined)).toThrow(BadRequestException);
    expect(() => validarLogo({ buffer: Buffer.alloc(0) })).toThrow(BadRequestException);
  });

  it('recusa acima de 1 MB', () => {
    expect(() => validarLogo({ buffer: Buffer.concat([PNG, Buffer.alloc(LOGO_MAX_BYTES)]) })).toThrow(PayloadTooLargeException);
  });
});
