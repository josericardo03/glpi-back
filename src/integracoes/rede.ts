import { lookup } from 'node:dns/promises';
import net from 'node:net';

/**
 * Endereços que um servidor de aplicação não deve alcançar a pedido de um usuário (SSRF):
 * loopback, redes privadas, link-local (inclui o serviço de metadados de nuvem) e faixas reservadas.
 */
export function enderecoInterno(ip: string): boolean {
  if (ip.startsWith('::ffff:')) return enderecoInterno(ip.slice(7));
  if (net.isIPv6(ip)) {
    const baixo = ip.toLowerCase();
    return baixo === '::1' || baixo === '::' || baixo.startsWith('fc') || baixo.startsWith('fd') || baixo.startsWith('fe80');
  }
  const partes = ip.split('.').map(Number);
  if (partes.length !== 4 || partes.some((p) => !Number.isInteger(p))) return true;
  const [a, b] = partes as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** Loopback e link-local nunca são destino válido, nem para o servidor SMTP da empresa. */
export function enderecoProibido(ip: string): boolean {
  if (ip.startsWith('::ffff:')) return enderecoProibido(ip.slice(7));
  if (net.isIPv6(ip)) {
    const baixo = ip.toLowerCase();
    return baixo === '::1' || baixo === '::' || baixo.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 0 || a === 127 || (a === 169 && b === 254);
}

async function resolver(host: string): Promise<string[]> {
  if (net.isIP(host)) return [host];
  const encontrados = await lookup(host, { all: true });
  return encontrados.map((e) => e.address);
}

/**
 * Valida o destino de uma conexão iniciada pelo servidor. `REDE_PERMITE_INTERNA=true` libera redes
 * privadas (webhooks para serviços internos); loopback e link-local continuam bloqueados.
 */
export async function destinoPermitido(host: string, opcoes: { permitirRedeInterna?: boolean } = {}) {
  const permitirInterna = opcoes.permitirRedeInterna ?? process.env.REDE_PERMITE_INTERNA === 'true';
  let enderecos: string[];
  try {
    enderecos = await resolver(host);
  } catch {
    return { ok: false as const, motivo: 'Não foi possível resolver o endereço' };
  }
  if (!enderecos.length) return { ok: false as const, motivo: 'Endereço sem resolução' };
  const barrado = enderecos.find((ip) => (permitirInterna ? enderecoProibido(ip) : enderecoInterno(ip)));
  if (barrado) {
    return {
      ok: false as const,
      motivo: permitirInterna
        ? 'Destino não permitido (loopback ou link-local)'
        : 'Destino em rede interna não permitido (defina REDE_PERMITE_INTERNA=true para liberar redes privadas)',
    };
  }
  return { ok: true as const };
}
