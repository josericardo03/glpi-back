import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** TOTP (RFC 6238) com HMAC-SHA1, 6 dígitos e passo de 30 s: compatível com Google Authenticator, Authy, Microsoft Authenticator... */

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const PASSO_SEGUNDOS = 30;
const DIGITOS = 6;

export function base32Codificar(bytes: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

export function base32Decodificar(texto: string): Buffer {
  const limpo = texto.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const c of limpo) {
    valor = (valor << 5) | ALFABETO.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Segredo de 160 bits (o tamanho recomendado), em base32. */
export const gerarSegredo = () => base32Codificar(randomBytes(20));

export function codigoDoPasso(segredo: string, passo: number): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const hmac = createHmac('sha1', base32Decodificar(segredo)).update(contador).digest();
  const deslocamento = hmac[hmac.length - 1]! & 15;
  const numero =
    ((hmac[deslocamento]! & 127) << 24) | (hmac[deslocamento + 1]! << 16) | (hmac[deslocamento + 2]! << 8) | hmac[deslocamento + 3]!;
  return String(numero % 10 ** DIGITOS).padStart(DIGITOS, '0');
}

export const passoAtual = (agora = Date.now()) => Math.floor(agora / 1000 / PASSO_SEGUNDOS);

const iguais = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Confere o código aceitando um passo de tolerância para cada lado (relógios levemente diferentes).
 * Devolve o passo que bateu, ou `null`. Um passo igual ou anterior a `ultimoPasso` é recusado: cada
 * código só vale uma vez, o que impede reutilizar um código visto por terceiros.
 */
export function verificarCodigo(segredo: string, codigo: string, ultimoPasso: bigint | number | null = null, agora = Date.now()): number | null {
  const limpo = codigo.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(limpo)) return null;
  const atual = passoAtual(agora);
  for (const passo of [atual, atual - 1, atual + 1]) {
    if (ultimoPasso !== null && BigInt(passo) <= BigInt(ultimoPasso)) continue;
    if (iguais(codigoDoPasso(segredo, passo), limpo)) return passo;
  }
  return null;
}

export function urlOtpauth(segredo: string, conta: string, emissor: string) {
  const rotulo = encodeURIComponent(`${emissor}:${conta}`);
  return `otpauth://totp/${rotulo}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}&algorithm=SHA1&digits=${DIGITOS}&period=${PASSO_SEGUNDOS}`;
}
