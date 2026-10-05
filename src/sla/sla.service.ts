import { Injectable, Logger, OnModuleDestroy, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  offsetDoFuso,
  type Feriado,
  type Slot,
} from './business-time.js';

export function escolherPolitica<T extends { id: number; tipo_chamado_alvo: string }>(
  politicas: T[],
  tipo: string,
): T | undefined {
  const ordenadas = [...politicas].sort((a, b) => a.id - b.id);
  return (
    ordenadas.find((politica) => politica.tipo_chamado_alvo === tipo) ??
    ordenadas.find((politica) => politica.tipo_chamado_alvo === 'AMBOS')
  );
}

@Injectable()
export class SlaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlaService.name);
  private timer?: NodeJS.Timeout;
  private varrendo = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.VITEST === 'true') return;
    void this.varrerVencidos();
    this.timer = setInterval(() => void this.varrerVencidos(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async prever(
    idCliente: number,
    prioridade: string,
    tipo: string,
    aPartirDe = new Date(),
  ) {
    const politicas = await this.prisma.politicas_sla.findMany({
      where: {
        id_cliente: idCliente,
        prioridade_alvo: prioridade,
        tipo_chamado_alvo: { in: [tipo, 'AMBOS'] },
        status: 'ATIVO',
      },
      include: {
        horarios_comerciais: { include: { intervalos_horarios: true } },
      },
    });
    const politica = escolherPolitica(politicas, tipo);
    if (!politica) {
      throw new UnprocessableEntityException(
        'Não há política de SLA ativa para esta prioridade e tipo',
      );
    }
    const grade = await this.grade(idCliente, politica);
    return {
      id_politica_sla: politica.id,
      data_previsao_resposta: addBusinessMinutes(
        aPartirDe,
        politica.tempo_resposta_min,
        grade.slots,
        grade.feriados,
        grade.offset,
      ),
      data_previsao_resolucao: addBusinessMinutes(
        aPartirDe,
        politica.tempo_resolucao_min,
        grade.slots,
        grade.feriados,
        grade.offset,
      ),
    };
  }

  private async varrerVencidos() {
    if (this.varrendo) return;
    this.varrendo = true;
    try {
      await this.prisma.$executeRaw`
        UPDATE chamados
        SET sla_vencido = TRUE
        WHERE sla_vencido = FALSE
          AND (
            (status NOT IN ('RESOLVIDO', 'CONCLUIDO', 'PENDENTE') AND data_previsao_resolucao < NOW())
            OR (status = 'NOVO' AND data_previsao_resposta IS NOT NULL AND data_previsao_resposta < NOW())
            OR (
              status IN ('RESOLVIDO', 'CONCLUIDO')
              AND data_resolucao IS NOT NULL
              AND data_previsao_resolucao IS NOT NULL
              AND data_resolucao > data_previsao_resolucao
            )
          )
      `;
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
    } finally {
      this.varrendo = false;
    }
  }

  async adiarPrevisao(
    idCliente: number,
    idPolitica: number | null,
    previsao: Date | null,
    inicioPausa: Date,
    fimPausa: Date,
  ) {
    if (!previsao || !idPolitica) return previsao;
    const politica = await this.prisma.politicas_sla.findFirst({
      where: { id_cliente: idCliente, id: idPolitica },
      include: {
        horarios_comerciais: { include: { intervalos_horarios: true } },
      },
    });
    if (!politica) return previsao;
    const grade = await this.grade(idCliente, politica);
    const uteis = businessMinutesBetween(
      inicioPausa,
      fimPausa,
      grade.slots,
      grade.feriados,
      grade.offset,
    );
    return addBusinessMinutes(previsao, uteis, grade.slots, grade.feriados, grade.offset);
  }

  private async grade(
    idCliente: number,
    politica: {
      horarios_comerciais: {
        fuso_horario: string;
        intervalos_horarios: { dia_semana: number; hora_inicio: Date; hora_fim: Date }[];
      };
    },
  ) {
    const feriadosRows = await this.prisma.feriados.findMany({
      where: { id_cliente: idCliente },
    });
    const feriados: Feriado[] = feriadosRows.map((f) => ({
      dia: f.dia,
      mes: f.mes,
      ano: f.ano,
    }));
    const slots: Slot[] = politica.horarios_comerciais.intervalos_horarios.map((i) => ({
      dia: i.dia_semana,
      inicio: minutos(i.hora_inicio),
      fim: minutos(i.hora_fim),
    }));
    return {
      slots,
      feriados,
      offset: offsetDoFuso(politica.horarios_comerciais.fuso_horario),
    };
  }
}

function minutos(valor: Date): number {
  return valor.getUTCHours() * 60 + valor.getUTCMinutes();
}
