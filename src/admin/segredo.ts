import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const CAMPOS_SECRETOS = new Set([
  'password',
  'senha',
  'secret',
  'token',
  'api_key',
  'apikey',
  'bind_password',
  'client_secret',
  'authorization',
]);

/** Compara sem diferenciar maiúsculas/minúsculas e sem hífen (`API-Key`, `apiKey`, `Token`). */
const ehSecreto = (nome: string) => CAMPOS_SECRETOS.has(nome.toLowerCase().replace(/-/g, '_'));

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
    if (ehSecreto(nome) && typeof valor === 'string' && !valor.startsWith('enc:v1:')) {
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

const PREFIXO = 'enc:v1:';

/** Inverso de `criptografarConfig`, para uso interno (conectores). Nunca devolva o resultado pela API. */
export function descriptografarConfig(
  config: Record<string, unknown>,
  segredos: string | string[],
): Record<string, unknown> {
  const chaves = (Array.isArray(segredos) ? segredos : [segredos]).map(chave);
  const saida: Record<string, unknown> = {};
  for (const [nome, valor] of Object.entries(config)) {
    saida[nome] = typeof valor === 'string' && valor.startsWith(PREFIXO) ? abrir(valor, chaves) : valor;
  }
  return saida;
}

/** Tenta cada chave (a atual e as anteriores), o que permite trocar o segredo sem perder dados. */
function abrir(valor: string, chaves: Buffer[]): string {
  const [iv, tag, cifrado] = valor.slice(PREFIXO.length).split(':');
  if (!iv || !tag || !cifrado) throw new Error('Valor criptografado malformado');
  for (const key of chaves) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(cifrado, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      // chave errada: tenta a próxima
    }
  }
  throw new Error('Não foi possível descriptografar o valor com as chaves informadas');
}

/**
 * Segredo próprio das integrações (`INTEGRACOES_SECRET`). Sem ele, usa o `JWT_SECRET` por
 * compatibilidade: trocar o JWT_SECRET sem definir o segredo próprio invalidaria os valores já gravados.
 */
export function segredosDeIntegracao(env: { INTEGRACOES_SECRET?: string; JWT_SECRET?: string }) {
  return [env.INTEGRACOES_SECRET, env.JWT_SECRET].filter((s): s is string => !!s);
}

export function mascararConfig(config: Record<string, unknown>) {
  const saida: Record<string, unknown> = {};
  for (const [nome, valor] of Object.entries(config)) {
    saida[nome] =
      ehSecreto(nome) || (typeof valor === 'string' && valor.startsWith('enc:v1:'))
        ? '[criptografado]'
        : valor;
  }
  return saida;
}
