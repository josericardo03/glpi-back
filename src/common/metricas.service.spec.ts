import { describe, expect, it, vi } from 'vitest';
import { LoggerJson } from './logger-json.js';
import { MetricasService } from './metricas.service.js';

const prismaFalso = (falha = false) =>
  ({
    chamados: {
      groupBy: falha ? vi.fn().mockRejectedValue(new Error('fora')) : vi.fn().mockResolvedValue([{ status: 'NOVO', _count: { _all: 3 } }]),
      count: vi.fn().mockResolvedValue(2),
    },
    sessoes: { count: vi.fn().mockResolvedValue(5) },
  }) as never;

describe('MetricasService', () => {
  it('acumula requisições e histograma por rota', async () => {
    const m = new MetricasService(prismaFalso());
    m.observarHttp('GET', '/api/chamados/:id', 200, 0.03);
    m.observarHttp('GET', '/api/chamados/:id', 200, 0.7);
    const texto = await m.texto();
    expect(texto).toContain('itsm_http_requests_total{metodo="GET",rota="/api/chamados/:id",status="200"} 2');
    expect(texto).toContain('itsm_http_request_duration_seconds_bucket{metodo="GET",rota="/api/chamados/:id",le="0.05"} 1');
    expect(texto).toContain('itsm_http_request_duration_seconds_bucket{metodo="GET",rota="/api/chamados/:id",le="+Inf"} 2');
    expect(texto).toContain('itsm_http_request_duration_seconds_count{metodo="GET",rota="/api/chamados/:id"} 2');
  });

  it('expõe o retrato do negócio e sinaliza banco fora do ar sem lançar erro', async () => {
    const ok = await new MetricasService(prismaFalso()).texto();
    expect(ok).toContain('itsm_chamados{status="NOVO"} 3');
    expect(ok).toContain('itsm_sessoes_ativas 5');
    expect(ok).toContain('itsm_banco_up 1');
    const fora = await new MetricasService(prismaFalso(true)).texto();
    expect(fora).toContain('itsm_banco_up 0');
  });

  it('escapa aspas e quebras de linha nos rótulos', async () => {
    const m = new MetricasService(prismaFalso());
    m.contar('itsm_teste', { v: 'a"b\nc' });
    expect(await m.texto()).toContain('itsm_teste{v="a\\"b\\nc"} 1');
  });
});

describe('LoggerJson', () => {
  it('escreve uma linha JSON e mescla os campos de objetos', () => {
    const escrito: string[] = [];
    const espia = vi.spyOn(process.stdout, 'write').mockImplementation(((s: string) => (escrito.push(s), true)) as never);
    new LoggerJson().log({ evento: 'http', status: 200 }, 'Acesso');
    espia.mockRestore();
    const linha = JSON.parse(escrito[0]!);
    expect(linha).toMatchObject({ nivel: 'log', contexto: 'Acesso', evento: 'http', status: 200 });
    expect(typeof linha.ts).toBe('string');
  });
});
