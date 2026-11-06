import { base32Codificar, base32Decodificar, codigoDoPasso, gerarSegredo, passoAtual, urlOtpauth, verificarCodigo } from './totp.js';

// Vetores do RFC 6238 (SHA-1, segredo ASCII "12345678901234567890"); o RFC usa 8 dígitos, aqui são os 6 últimos.
const SEGREDO_RFC = base32Codificar(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('bate com o vetor do RFC 6238 em t=%i', (t, esperado) => {
    expect(codigoDoPasso(SEGREDO_RFC, Math.floor(t / 30))).toBe(esperado);
  });

  it('base32 faz ida e volta', () => {
    const bytes = Buffer.from('segredo-de-teste');
    expect(base32Decodificar(base32Codificar(bytes)).equals(bytes)).toBe(true);
  });

  it('gera segredos de 160 bits, todos diferentes', () => {
    const a = gerarSegredo();
    expect(base32Decodificar(a)).toHaveLength(20);
    expect(gerarSegredo()).not.toBe(a);
  });

  it('aceita o código do passo atual e a tolerância de um passo', () => {
    const segredo = gerarSegredo();
    const agora = Date.now();
    const passo = passoAtual(agora);
    expect(verificarCodigo(segredo, codigoDoPasso(segredo, passo), null, agora)).toBe(passo);
    expect(verificarCodigo(segredo, codigoDoPasso(segredo, passo - 1), null, agora)).toBe(passo - 1);
    expect(verificarCodigo(segredo, codigoDoPasso(segredo, passo + 1), null, agora)).toBe(passo + 1);
  });

  it('recusa código fora da tolerância, malformado ou de outro segredo', () => {
    const segredo = gerarSegredo();
    const agora = Date.now();
    const passo = passoAtual(agora);
    expect(verificarCodigo(segredo, codigoDoPasso(segredo, passo + 5), null, agora)).toBeNull();
    expect(verificarCodigo(segredo, '12345', null, agora)).toBeNull();
    expect(verificarCodigo(segredo, 'abcdef', null, agora)).toBeNull();
    expect(verificarCodigo(segredo, codigoDoPasso(gerarSegredo(), passo), null, agora)).toBeNull();
  });

  it('cada código só vale uma vez (anti-reuso)', () => {
    const segredo = gerarSegredo();
    const agora = Date.now();
    const passo = passoAtual(agora);
    const codigo = codigoDoPasso(segredo, passo);
    expect(verificarCodigo(segredo, codigo, null, agora)).toBe(passo);
    expect(verificarCodigo(segredo, codigo, passo, agora)).toBeNull();
  });

  it('ignora espaços no código digitado', () => {
    const segredo = gerarSegredo();
    const agora = Date.now();
    const codigo = codigoDoPasso(segredo, passoAtual(agora));
    expect(verificarCodigo(segredo, `${codigo.slice(0, 3)} ${codigo.slice(3)}`, null, agora)).not.toBeNull();
  });

  it('monta a URL otpauth para o aplicativo autenticador', () => {
    const url = urlOtpauth('ABC234', 'ana@x.com', 'Portal ITSM');
    expect(url).toMatch(/^otpauth:\/\/totp\/Portal%20ITSM%3Aana%40x\.com\?secret=ABC234&issuer=Portal%20ITSM/);
  });
});
