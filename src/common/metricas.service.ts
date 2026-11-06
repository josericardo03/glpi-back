import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const BALDES = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const escapar = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const rotulos = (l: Record<string, string>) => {
  const itens = Object.entries(l).map(([k, v]) => `${k}="${escapar(v)}"`);
  return itens.length ? `{${itens.join(',')}}` : '';
};

type Histograma = { soma: number; n: number; baldes: number[]; labels: Record<string, string> };

/**
 * Métricas no formato de texto do Prometheus: requisições HTTP, processo e um retrato do negócio
 * (chamados por status, SLA vencido, sessões). Em memória, por instância: o Prometheus soma as instâncias.
 */
@Injectable()
export class MetricasService {
  private readonly contadores = new Map<string, { nome: string; labels: Record<string, string>; valor: number }>();
  private readonly duracoes = new Map<string, Histograma>();
  private readonly laco = monitorEventLoopDelay({ resolution: 20 });
  private negocio: { em: number; texto: string } = { em: 0, texto: '' };

  constructor(private readonly prisma: PrismaService) {
    this.laco.enable();
  }

  contar(nome: string, labels: Record<string, string> = {}, valor = 1) {
    const chave = `${nome}${rotulos(labels)}`;
    const atual = this.contadores.get(chave);
    if (atual) atual.valor += valor;
    else this.contadores.set(chave, { nome, labels, valor });
  }

  /** `rota` é o padrão da rota (`/api/chamados/:id`), nunca o caminho real: evita explodir o número de séries. */
  observarHttp(metodo: string, rota: string, status: number, segundos: number) {
    this.contar('itsm_http_requests_total', { metodo, rota, status: String(status) });
    const labels = { metodo, rota };
    const chave = `${metodo} ${rota}`;
    let h = this.duracoes.get(chave);
    if (!h) {
      h = { soma: 0, n: 0, baldes: BALDES.map(() => 0), labels };
      this.duracoes.set(chave, h);
    }
    h.soma += segundos;
    h.n += 1;
    BALDES.forEach((limite, i) => {
      if (segundos <= limite) h.baldes[i]! += 1;
    });
  }

  /** Estado do negócio lido do banco, com cache curto para um scrape frequente não pesar. */
  private async retratoDoNegocio(): Promise<string> {
    if (Date.now() - this.negocio.em < 15_000) return this.negocio.texto;
    const linhas: string[] = [];
    try {
      const porStatus = await this.prisma.chamados.groupBy({ by: ['status'], _count: { _all: true } });
      linhas.push('# HELP itsm_chamados Chamados por status.', '# TYPE itsm_chamados gauge');
      for (const r of porStatus) linhas.push(`itsm_chamados${rotulos({ status: r.status })} ${r._count._all}`);
      const vencidos = await this.prisma.chamados.count({ where: { sla_vencido: true, status: { in: ['NOVO', 'EM_ATENDIMENTO', 'PENDENTE'] } } });
      linhas.push('# HELP itsm_chamados_sla_vencido_abertos Chamados abertos com SLA vencido.', '# TYPE itsm_chamados_sla_vencido_abertos gauge', `itsm_chamados_sla_vencido_abertos ${vencidos}`);
      const sessoes = await this.prisma.sessoes.count({ where: { revogado_em: null, expira_em: { gt: new Date() } } });
      linhas.push('# HELP itsm_sessoes_ativas Sessões de usuário ativas.', '# TYPE itsm_sessoes_ativas gauge', `itsm_sessoes_ativas ${sessoes}`);
      linhas.push('# HELP itsm_banco_up 1 se o banco respondeu à coleta.', '# TYPE itsm_banco_up gauge', 'itsm_banco_up 1');
    } catch {
      linhas.push('# HELP itsm_banco_up 1 se o banco respondeu à coleta.', '# TYPE itsm_banco_up gauge', 'itsm_banco_up 0');
    }
    this.negocio = { em: Date.now(), texto: linhas.join('\n') };
    return this.negocio.texto;
  }

  async texto(): Promise<string> {
    const saida: string[] = [];
    const nomes = new Set<string>();
    for (const c of this.contadores.values()) {
      if (!nomes.has(c.nome)) {
        nomes.add(c.nome);
        saida.push(`# HELP ${c.nome} Total de ocorrências.`, `# TYPE ${c.nome} counter`);
      }
      saida.push(`${c.nome}${rotulos(c.labels)} ${c.valor}`);
    }
    if (this.duracoes.size) {
      saida.push('# HELP itsm_http_request_duration_seconds Duração das requisições HTTP.', '# TYPE itsm_http_request_duration_seconds histogram');
      for (const h of this.duracoes.values()) {
        BALDES.forEach((limite, i) => saida.push(`itsm_http_request_duration_seconds_bucket${rotulos({ ...h.labels, le: String(limite) })} ${h.baldes[i]}`));
        saida.push(`itsm_http_request_duration_seconds_bucket${rotulos({ ...h.labels, le: '+Inf' })} ${h.n}`);
        saida.push(`itsm_http_request_duration_seconds_sum${rotulos(h.labels)} ${h.soma}`, `itsm_http_request_duration_seconds_count${rotulos(h.labels)} ${h.n}`);
      }
    }
    const memoria = process.memoryUsage();
    const cpu = process.cpuUsage();
    saida.push(
      '# HELP process_resident_memory_bytes Memória residente do processo.',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${memoria.rss}`,
      '# HELP nodejs_heap_used_bytes Heap do V8 em uso.',
      '# TYPE nodejs_heap_used_bytes gauge',
      `nodejs_heap_used_bytes ${memoria.heapUsed}`,
      '# HELP process_cpu_seconds_total Tempo de CPU do processo.',
      '# TYPE process_cpu_seconds_total counter',
      `process_cpu_seconds_total ${(cpu.user + cpu.system) / 1e6}`,
      '# HELP nodejs_eventloop_lag_seconds Atraso médio do laço de eventos.',
      '# TYPE nodejs_eventloop_lag_seconds gauge',
      `nodejs_eventloop_lag_seconds ${Number.isFinite(this.laco.mean) ? this.laco.mean / 1e9 : 0}`,
      '# HELP process_uptime_seconds Tempo desde o início do processo.',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${process.uptime()}`,
      await this.retratoDoNegocio(),
    );
    return `${saida.join('\n')}\n`;
  }
}
