import { Injectable, Logger, OnModuleDestroy, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { EventosService } from '../integracoes/eventos.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  offsetDoFuso,
  type Feriado,
  type Slot,
} from './business-time.js';

export function escolherPolitica<
  T extends { id: number; tipo_chamado_alvo: string; prioridade_alvo: string },
>(politicas: T[], tipo: string, prioridade: string): T | undefined {
  const daPrioridade = politicas.filter((politica) => politica.prioridade_alvo === prioridade);
  return (
    preferirTipo(daPrioridade, tipo) ??
    preferirTipo(politicas, tipo) ??
    [...politicas].sort((a, b) => a.id - b.id)[0]
  );
}

function preferirTipo<T extends { id: number; tipo_chamado_alvo: string }>(politicas: T[], tipo: string) {
  const ordenadas = [...politicas].sort((a, b) => a.id - b.id);
  return (
    ordenadas.find((politica) => politica.tipo_chamado_alvo === tipo) ??
    ordenadas.find((politica) => politica.tipo_chamado_alvo === 'AMBOS')
  );
}

/** Identificador do lock consultivo da varredura de SLA. */
const LOCK_VARREDURA = 727_002;

@Injectable()
export class SlaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlaService.name);
  private timer?: NodeJS.Timeout;
  private varrendo = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventosService,
  ) {}

  onModuleInit() {
    if (process.env.VITEST === 'true') return;
    void this.varrerVencidos();
    this.timer = setInterval(() => void this.varrerVencidos(), Number(process.env.SLA_VARREDURA_MS) || 60_000);
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
      where: { id_cliente: idCliente, status: 'ATIVO' },
      include: {
        horarios_comerciais: { include: { intervalos_horarios: true } },
      },
    });
    const politica = escolherPolitica(politicas, tipo, prioridade);
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

  /**
   * Marca os chamados com SLA vencido e dispara os alertas "perto de vencer" e "vencido".
   * Só uma instância da API varre por vez (lock consultivo), e cada alerta sai uma única vez por chamado
   * (tabela sla_alertas). Rodar em várias réplicas não duplica avisos.
   */
  async varrerVencidos() {
    if (this.varrendo) return;
    this.varrendo = true;
    try {
      const alertas = await this.prisma.$transaction(async (tx) => {
        const [lock] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_VARREDURA}) AS ok`;
        if (!lock?.ok) return [];
        const vencidos = await tx.$queryRaw<{ id_cliente: number; id_chamado: number; tipo: 'VENCIDO' }[]>`
          WITH vencidos AS (
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
            RETURNING id_cliente, id, status
          )
          INSERT INTO sla_alertas (id_cliente, id_chamado, tipo)
          SELECT id_cliente, id, 'VENCIDO' FROM vencidos WHERE status IN ('NOVO', 'EM_ATENDIMENTO')
          ON CONFLICT DO NOTHING
          RETURNING id_cliente, id_chamado, tipo
        `;
        // "Perto de vencer": falta menos de 20% do prazo (no mínimo 15 minutos) e o chamado segue em andamento.
        const perto = await tx.$queryRaw<{ id_cliente: number; id_chamado: number; tipo: 'PERTO' }[]>`
          INSERT INTO sla_alertas (id_cliente, id_chamado, tipo)
          SELECT c.id_cliente, c.id, 'PERTO'
          FROM chamados c
          WHERE c.sla_vencido = FALSE
            AND c.status IN ('NOVO', 'EM_ATENDIMENTO')
            AND c.data_previsao_resolucao IS NOT NULL
            AND c.data_previsao_resolucao > NOW()
            AND (c.data_previsao_resolucao - NOW()) <= GREATEST(INTERVAL '15 minutes', (c.data_previsao_resolucao - c.data_abertura) * 0.2)
          ON CONFLICT DO NOTHING
          RETURNING id_cliente, id_chamado, tipo
        `;
        return [...vencidos, ...perto];
      });
      for (const alerta of alertas) {
        const chamado = await this.prisma.chamados.findFirst({
          where: { id: alerta.id_chamado, id_cliente: alerta.id_cliente },
          select: { id: true, id_cliente: true, titulo: true, prioridade: true, status: true, id_solicitante: true, id_tecnico_atribuido: true },
        });
        if (chamado) await this.eventos.slaAlerta(chamado, alerta.tipo);
      }
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
