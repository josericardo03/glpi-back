import { criptografarConfig, descriptografarConfig, mascararConfig, segredosDeIntegracao } from './segredo.js';

describe('segredos de integração', () => {
  const config = { host: 'ldap.local', port: 389, Token: 'abc123', 'API-Key': 'k-1' };

  it('criptografa campos secretos sem diferenciar maiúsculas e hífen', () => {
    const cifrado = criptografarConfig(config, 'chave-1');
    expect(cifrado.host).toBe('ldap.local');
    expect(String(cifrado.Token)).toMatch(/^enc:v1:/);
    expect(String(cifrado['API-Key'])).toMatch(/^enc:v1:/);
  });

  it('descriptografa o que foi gravado', () => {
    const cifrado = criptografarConfig(config, 'chave-1');
    expect(descriptografarConfig(cifrado, 'chave-1')).toEqual(config);
  });

  it('aceita uma lista de chaves e usa a que servir (rotação de segredo)', () => {
    const cifrado = criptografarConfig(config, 'chave-antiga');
    expect(descriptografarConfig(cifrado, ['chave-nova', 'chave-antiga'])).toEqual(config);
  });

  it('falha com a chave errada', () => {
    const cifrado = criptografarConfig(config, 'chave-1');
    expect(() => descriptografarConfig(cifrado, 'outra')).toThrow();
  });

  it('mascara os valores secretos na resposta', () => {
    const mascarado = mascararConfig(criptografarConfig(config, 'chave-1'));
    expect(mascarado.Token).toBe('[criptografado]');
    expect(mascarado.host).toBe('ldap.local');
  });

  it('prefere INTEGRACOES_SECRET e mantém o JWT_SECRET como fallback de leitura', () => {
    expect(segredosDeIntegracao({ INTEGRACOES_SECRET: 'a', JWT_SECRET: 'b' })).toEqual(['a', 'b']);
    expect(segredosDeIntegracao({ JWT_SECRET: 'b' })).toEqual(['b']);
  });
});
