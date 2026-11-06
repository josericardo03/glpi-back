import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, NotFoundException, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { MetricasService } from './metricas.service.js';

const iguais = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

@Controller()
export class MetricasController {
  constructor(private readonly metricas: MetricasService) {}

  /**
   * Só existe com METRICS_TOKEN definido (sem ele, 404, como se a rota não existisse) e exige
   * `Authorization: Bearer <token>`. Aponte o scrape do Prometheus para cá com esse cabeçalho.
   */
  @Public()
  @Get('metrics')
  async coletar(@Headers('authorization') autorizacao: string | undefined, @Res({ passthrough: true }) res: Response) {
    const esperado = process.env.METRICS_TOKEN;
    if (!esperado) throw new NotFoundException();
    if (!autorizacao?.startsWith('Bearer ') || !iguais(autorizacao.slice(7), esperado)) throw new UnauthorizedException();
    // O tipo é definido só no sucesso: nos erros o corpo é JSON e um Content-Type de texto o contradiria.
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return this.metricas.texto();
  }
}
