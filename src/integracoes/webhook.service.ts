import { createHmac, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { descriptografarConfig, segredosDeIntegracao } from '../admin/segredo.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { destinoPermitido } from './rede.js';

export type ResultadoWebhook = { ok: true; status: number } | { ok: false; erro: string };

const TENTATIVAS = 3;
const ESPERAS_MS = [0, 1000, 4000];
const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Assinatura HMAC-SHA256 do corpo, no formato `sha256=<hex>`, para o receptor validar a origem. */
export function assinar(corpo: string, segredo: string) {
  return `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Entrega o evento a todos os webhooks ativos do cliente que o assinam. Nunca lança erro. */
  async emitir(idCliente: number, evento: string, dados: Record<string, unknown>) {
    try {
      const integracoes = await this.prisma.integracoes.findMany({
        where: { id_cliente: idCliente, tipo: 'WEBHOOK', status: 'ATIVO' },
      });
      await Promise.all(
        integracoes.map(async (integracao) => {
          const cfg = descriptografarConfig((integracao.configuracoes ?? {}) as Record<string, unknown>, this.segredos());
          const eventos = Array.isArray(cfg.eventos) ? (cfg.eventos as unknown[]).map(String) : [];
          if (eventos.length && !eventos.includes(evento) && !eventos.includes('*')) return;
          const resultado = await this.entregar(cfg, evento, idCliente, dados);
          await this.registrar(idCliente, integracao.id, evento, resultado);
        }),
      );
    } catch (erro) {
      this.logger.warn(`Falha ao emitir webhook ${evento}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  /** Dispara um evento de teste em uma integração específica e devolve o resultado. */
  async testar(idCliente: number, idIntegracao: number): Promise<ResultadoWebhook> {
    const integracao = await this.prisma.integracoes.findFirst({ where: { id: idIntegracao, id_cliente: idCliente } });
    if (!integracao) return { ok: false, erro: 'Integração não encontrada' };
    const cfg = descriptografarConfig((integracao.configuracoes ?? {}) as Record<string, unknown>, this.segredos());
    return this.entregar(cfg, 'teste', idCliente, { mensagem: 'Evento de teste do portal ITSM' }, 1);
  }

  private segredos() {
    return segredosDeIntegracao({
      INTEGRACOES_SECRET: this.config.get<string>('INTEGRACOES_SECRET'),
      JWT_SECRET: this.config.get<string>('JWT_SECRET'),
    });
  }

  private async entregar(
    cfg: Record<string, unknown>,
    evento: string,
    idCliente: number,
    dados: Record<string, unknown>,
    tentativas = TENTATIVAS,
  ): Promise<ResultadoWebhook> {
    const url = typeof cfg.url === 'string' ? cfg.url.trim() : '';
    let alvo: URL;
    try {
      alvo = new URL(url);
    } catch {
      return { ok: false, erro: 'URL do webhook inválida' };
    }
    if (alvo.protocol !== 'https:' && alvo.protocol !== 'http:') return { ok: false, erro: 'A URL deve ser http ou https' };
    const destino = await destinoPermitido(alvo.hostname);
    if (!destino.ok) return { ok: false, erro: destino.motivo };

    const corpo = JSON.stringify({ id: randomUUID(), evento, ocorrido_em: new Date().toISOString(), id_cliente: idCliente, dados });
    const segredo = typeof cfg.secret === 'string' ? cfg.secret : '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'itsm-webhook/1', 'X-ITSM-Event': evento };
    if (segredo) headers['X-ITSM-Signature'] = assinar(corpo, segredo);

    let ultimo: ResultadoWebhook = { ok: false, erro: 'Sem tentativas' };
    for (let i = 0; i < tentativas; i += 1) {
      await esperar(ESPERAS_MS[i] ?? 4000);
      try {
        const resposta = await fetch(alvo, { method: 'POST', headers, body: corpo, redirect: 'manual', signal: AbortSignal.timeout(5000) });
        if (resposta.status >= 200 && resposta.status < 300) return { ok: true, status: resposta.status };
        ultimo = { ok: false, erro: `Resposta HTTP ${resposta.status}` };
        // Erro do receptor (4xx) não melhora com nova tentativa; 5xx e falhas de rede sim.
        if (resposta.status < 500) return ultimo;
      } catch (erro) {
        ultimo = { ok: false, erro: erro instanceof Error ? erro.message : 'Falha de conexão' };
      }
    }
    return ultimo;
  }

  private async registrar(idCliente: number, idIntegracao: number, evento: string, r: ResultadoWebhook) {
    try {
      await this.prisma.historico_integracoes.create({
        data: {
          id_cliente: idCliente,
          id_integracao: idIntegracao,
          tipo_evento: `WEBHOOK_${evento}`.slice(0, 50),
          status: r.ok ? 'SUCESSO' : 'FALHA',
          dados_log: r.ok ? `HTTP ${r.status}` : r.erro,
        },
      });
    } catch (erro) {
      this.logger.warn(`Não foi possível registrar a entrega: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }
}
