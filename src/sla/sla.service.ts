import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  offsetDoFuso,
  type Feriado,
  type Slot,
} from './business-time.js';

@Injectable()
export class SlaService {
  constructor(private readonly prisma: PrismaService) {}

  async prever(
    idCliente: number,
    prioridade: string,
    tipo: string,
    aPartirDe = new Date(),
  ) {
    const politica = await this.prisma.politicas_sla.findFirst({
      where: {
        id_cliente: idCliente,
        prioridade_alvo: prioridade,
        tipo_chamado_alvo: tipo,
        status: 'ATIVO',
      },
      include: {
        horarios_comerciais: { include: { intervalos_horarios: true } },
      },
    });
    if (!politica) {
      throw new UnprocessableEntityException(
        'Não há política de SLA ativa para esta prioridade e tipo',
      );
    }
    const grade = await this.grade(idCliente, politica);
    return {
      id_politica_sla: politica.id,
      data_previsao_resolucao: addBusinessMinutes(
        aPartirDe,
        politica.tempo_resolucao_min,
        grade.slots,
        grade.feriados,
        grade.offset,
      ),
    };
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
