import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { MetricasService } from './metricas.service.js';

const log = new Logger('Acesso');
const SEM_LOG = /^\/api\/(health|metrics)(\/|$)/;

/**
 * Dá um id a cada requisição (aceita `X-Request-Id` do proxy, se for um valor curto e seguro; devolve no
 * cabeçalho da resposta), registra uma linha de acesso e alimenta as métricas. Instale antes do roteamento.
 */
export function middlewareDeAcesso(metricas: MetricasService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const recebido = req.headers['x-request-id'];
    const id = typeof recebido === 'string' && /^[\w.-]{8,64}$/.test(recebido) ? recebido : randomUUID();
    res.setHeader('X-Request-Id', id);
    (req as Request & { idRequisicao?: string }).idRequisicao = id;
    const inicio = process.hrtime.bigint();

    res.on('finish', () => {
      const segundos = Number(process.hrtime.bigint() - inicio) / 1e9;
      // Padrão da rota (`/api/chamados/:id`), não o caminho real: evita um rótulo por id e vazamento de dados no log de métricas.
      const padrao = req.route?.path ? `${req.baseUrl}${req.route.path}` : '';
      // Sem rota casada, ou só o curinga do 404 do Nest: um rótulo único em vez de um por caminho.
      const rota = padrao && !padrao.includes('*') ? padrao : 'nao_encontrada';
      if (!SEM_LOG.test(req.originalUrl.split('?')[0] ?? '')) {
        metricas.observarHttp(req.method, rota, res.statusCode, segundos);
        const usuario = (req as Request & { user?: { id?: number; id_cliente?: number } }).user;
        const linha = {
          evento: 'http',
          id_requisicao: id,
          metodo: req.method,
          rota,
          caminho: req.originalUrl.split('?')[0],
          status: res.statusCode,
          ms: Math.round(segundos * 1000 * 10) / 10,
          ip: req.ip,
          ...(usuario?.id ? { id_usuario: usuario.id, id_cliente: usuario.id_cliente } : {}),
        };
        if (res.statusCode >= 500) log.error(linha);
        else if (res.statusCode >= 400) log.warn(linha);
        else log.log(linha);
      }
    });
    next();
  };
}
