import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';

const CAMPOS_SECRETOS = new Set([
  'password',
  'senha',
  'secret',
  'token',
  'api_key',
  'bind_password',
  'client_secret',
]);

function chave(secret: string) {
  return scryptSync(secret, 'itsm-integracoes', 32);
}

export function criptografarConfig(
  config: Record<string, unknown>,
  secret: string,
): Record<string, unknown> {
  const key = chave(secret);
  const saida: Record<string, unknown> = {};
  for (const [nome, valor] of Object.entries(config)) {
    if (CAMPOS_SECRETOS.has(nome) && typeof valor === 'string' && !valor.startsWith('enc:v1:')) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const cifrado = Buffer.concat([cipher.update(valor, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      saida[nome] = `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${cifrado.toString('base64url')}`;
    } else {
      saida[nome] = valor;
    }
  }
  return saida;
}

export function mascararConfig(config: Record<string, unknown>) {
  const saida: Record<string, unknown> = {};
  for (const [nome, valor] of Object.entries(config)) {
    saida[nome] =
      CAMPOS_SECRETOS.has(nome) || (typeof valor === 'string' && valor.startsWith('enc:v1:'))
        ? '[criptografado]'
        : valor;
  }
  return saida;
}
