import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  FUSO,
  diaObrigatorio,
  escopoChamado,
  hojeCuiaba,
  inicioCuiaba,
  intervaloDias,
  somarDias,
} from './chamado-consulta.js';
import { ListagemService } from './listagem.service.js';

const ABERTOS = Prisma.sql`('NOVO', 'EM_ATENDIMENTO', 'PENDENTE')`;

@Injectable()
export class PainelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listagem: ListagemService,
  ) {}

  async resumo(user: AuthUser, periodo?: string) {
    const dias = periodoDias(periodo);
    const hoje = hojeCuiaba();
    const ini = inicioCuiaba(somarDias(hoje, -(dias - 1)));
    const fim = inicioCuiaba(somarDias(hoje, 1));
    const iniAnt = inicioCuiaba(somarDias(hoje, -(dias * 2 - 1)));
    const hojeIni = inicioCuiaba(hoje);
    const volIni = somarDias(hoje, -6);
    const onde = escopoChamado(user);

    const [fila, metricas, status, prioridades, volume, categorias, tecnicos, ultimos] =
      await Promise.all([
        this.prisma.$queryRaw<
          {
            abertos: number;
            atribuidos_a_mim: number;
            nao_atribuidos: number;
            pendentes: number;
            sla_critico: number;
          }[]
        >(Prisma.sql`
          SELECT
            COUNT(*) FILTER (WHERE c.status IN ${ABERTOS})::int AS abertos,
            COUNT(*) FILTER (WHERE c.status IN ${ABERTOS} AND c.id_tecnico_atribuido = ${user.id})::int AS atribuidos_a_mim,
            COUNT(*) FILTER (WHERE c.status IN ${ABERTOS} AND c.id_tecnico_atribuido IS NULL)::int AS nao_atribuidos,
            COUNT(*) FILTER (WHERE c.status = 'PENDENTE')::int AS pendentes,
            COUNT(*) FILTER (
              WHERE c.status IN ${ABERTOS}
                AND (
                  c.sla_vencido
                  OR (c.data_previsao_resolucao IS NOT NULL AND c.data_previsao_resolucao <= NOW() + INTERVAL '4 hours')
                )
            )::int AS sla_critico
          FROM chamados c
          WHERE ${onde}
        `),
        this.prisma.$queryRaw<
          {
            total_periodo: number;
            resolvidos_hoje: number;
            mttr_min: number | null;
            sla_cumprido_pct: number | null;
            sla_anterior_pct: number | null;
            media_por_tecnico: number | null;
            csat: number | null;
          }[]
        >(Prisma.sql`
          SELECT
            COUNT(*) FILTER (WHERE c.data_abertura >= ${ini} AND c.data_abertura < ${fim})::int AS total_periodo,
            COUNT(*) FILTER (WHERE c.data_resolucao >= ${hojeIni} AND c.data_resolucao < ${fim})::int AS resolvidos_hoje,
            CASE
              WHEN COUNT(*) FILTER (WHERE c.data_resolucao >= ${ini} AND c.data_resolucao < ${fim}) = 0 THEN NULL
              ELSE ROUND(AVG(EXTRACT(EPOCH FROM (c.data_resolucao - c.data_abertura)) / 60) FILTER (
                WHERE c.data_resolucao >= ${ini} AND c.data_resolucao < ${fim}
              ))::int
            END AS mttr_min,
            ${pctSla(Prisma.sql`c.data_resolucao >= ${ini} AND c.data_resolucao < ${fim}`)} AS sla_cumprido_pct,
            ${pctSla(Prisma.sql`c.data_resolucao >= ${iniAnt} AND c.data_resolucao < ${ini}`)} AS sla_anterior_pct,
            CASE
              WHEN COUNT(DISTINCT c.id_tecnico_atribuido) FILTER (
                WHERE c.data_resolucao >= ${ini} AND c.data_resolucao < ${fim} AND c.id_tecnico_atribuido IS NOT NULL
              ) = 0 THEN NULL
              ELSE ROUND(
                COUNT(*) FILTER (
                  WHERE c.data_resolucao >= ${ini} AND c.data_resolucao < ${fim} AND c.id_tecnico_atribuido IS NOT NULL
                )::numeric
                / COUNT(DISTINCT c.id_tecnico_atribuido) FILTER (
                  WHERE c.data_resolucao >= ${ini} AND c.data_resolucao < ${fim} AND c.id_tecnico_atribuido IS NOT NULL
                ),
                1
              )::float8
            END AS media_por_tecnico,
            (
              SELECT CASE WHEN COUNT(p.nota_satisfacao) = 0 THEN NULL
                ELSE ROUND(AVG(p.nota_satisfacao)::numeric, 2)::float8 END
              FROM pesquisas_csat p
              JOIN chamados chamado_csat ON chamado_csat.id_cliente = p.id_cliente AND chamado_csat.id = p.id_chamado
              WHERE p.id_cliente = ${user.id_cliente}
                AND p.data_resposta >= ${ini}
                AND p.data_resposta < ${fim}
                AND (${user.perfil === 'SOLICITANTE' ? user.id : null}::int IS NULL OR chamado_csat.id_solicitante = ${user.perfil === 'SOLICITANTE' ? user.id : null})
            ) AS csat
          FROM chamados c
          WHERE ${onde}
        `),
        this.prisma.$queryRaw<{ status: string; total: number }[]>(Prisma.sql`
          SELECT c.status, COUNT(*)::int AS total
          FROM chamados c
          WHERE ${onde} AND c.data_abertura >= ${ini} AND c.data_abertura < ${fim}
          GROUP BY c.status
        `),
        this.prisma.$queryRaw<{ prioridade: string; total: number }[]>(Prisma.sql`
          SELECT c.prioridade, COUNT(*)::int AS total
          FROM chamados c
          WHERE ${onde} AND c.data_abertura >= ${ini} AND c.data_abertura < ${fim}
          GROUP BY c.prioridade
        `),
        this.prisma.$queryRaw<{ dia: string; abertos: number; fechados: number }[]>(Prisma.sql`
          SELECT to_char(d::date, 'YYYY-MM-DD') AS dia,
            COUNT(c.id) FILTER (
              WHERE (c.data_abertura AT TIME ZONE ${FUSO})::date = d::date
            )::int AS abertos,
            COUNT(c.id) FILTER (
              WHERE (COALESCE(c.data_fechamento, c.data_resolucao) AT TIME ZONE ${FUSO})::date = d::date
            )::int AS fechados
          FROM generate_series(${volIni}::date, ${hoje}::date, INTERVAL '1 day') AS d
          LEFT JOIN chamados c ON ${onde} AND (
            (c.data_abertura AT TIME ZONE ${FUSO})::date = d::date
            OR (COALESCE(c.data_fechamento, c.data_resolucao) AT TIME ZONE ${FUSO})::date = d::date
          )
          GROUP BY d
          ORDER BY d
        `),
        this.prisma.$queryRaw<{ nome: string; total: number }[]>(Prisma.sql`
          SELECT
            CASE WHEN pai.nome IS NULL THEN cat.nome ELSE pai.nome || ' / ' || cat.nome END AS nome,
            COUNT(*)::int AS total
          FROM chamados c
          JOIN categorias_chamados cat ON cat.id_cliente = c.id_cliente AND cat.id = c.id_categoria
          LEFT JOIN categorias_chamados pai ON pai.id_cliente = cat.id_cliente AND pai.id = cat.id_categoria_pai
          WHERE ${onde} AND c.data_abertura >= ${ini} AND c.data_abertura < ${fim}
          GROUP BY 1
          ORDER BY total DESC, nome
          LIMIT 5
        `),
        this.prisma.$queryRaw<
          { id: number; nome: string; ativos: number; resolvidos_hoje: number; sla_pct: number | null }[]
        >(Prisma.sql`
          SELECT u.id, u.nome,
            COUNT(*) FILTER (WHERE c.status IN ${ABERTOS})::int AS ativos,
            COUNT(*) FILTER (WHERE c.data_resolucao >= ${hojeIni} AND c.data_resolucao < ${fim})::int AS resolvidos_hoje,
            ${pctSla(Prisma.sql`c.data_resolucao >= ${ini} AND c.data_resolucao < ${fim}`)} AS sla_pct
          FROM usuarios u
          JOIN chamados c ON c.id_cliente = u.id_cliente AND c.id_tecnico_atribuido = u.id
          WHERE ${onde}
          GROUP BY u.id, u.nome
          HAVING COUNT(*) FILTER (WHERE c.status IN ${ABERTOS}) > 0
            OR COUNT(*) FILTER (WHERE c.data_resolucao >= ${ini} AND c.data_resolucao < ${fim}) > 0
          ORDER BY ativos DESC, u.nome
        `),
        this.listagem.ultimos(user, 5),
      ]);

    const kpi = metricas[0];
    const atual = fila[0];
    return {
      kpis: {
        abertos: atual?.abertos ?? 0,
        atribuidos_a_mim: atual?.atribuidos_a_mim ?? 0,
        nao_atribuidos: atual?.nao_atribuidos ?? 0,
        pendentes: atual?.pendentes ?? 0,
        sla_critico: atual?.sla_critico ?? 0,
        sla_cumprido_pct: numero(kpi?.sla_cumprido_pct),
        sla_variacao_pct: variacaoPontos(kpi?.sla_cumprido_pct, kpi?.sla_anterior_pct),
        mttr_min: numero(kpi?.mttr_min),
        media_por_tecnico: numero(kpi?.media_por_tecnico),
        resolvidos_hoje: kpi?.resolvidos_hoje ?? 0,
        total_periodo: kpi?.total_periodo ?? 0,
        csat: numero(kpi?.csat),
      },
      por_status: preencher(status, 'status', ['NOVO', 'EM_ATENDIMENTO', 'PENDENTE', 'RESOLVIDO', 'CONCLUIDO']),
      por_prioridade: preencher(prioridades, 'prioridade', ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA']),
      volume_diario: volume.map((item) => ({
        dia: String(item.dia).slice(0, 10),
        abertos: item.abertos,
        fechados: item.fechados,
      })),
      categorias_top: categorias,
      tecnicos: tecnicos.map((item) => ({ ...item, sla_pct: numero(item.sla_pct) })),
      ultimos_chamados: ultimos,
    };
  }

  async tma(user: AuthUser, de?: string, ate?: string) {
    if (!de || !ate) throw new BadRequestException('de e ate são obrigatórios');
    const inicioDia = diaObrigatorio(de, 'de');
    const fimDia = diaObrigatorio(ate, 'ate');
    if (inicioDia > fimDia) throw new BadRequestException('de não pode ser posterior a ate');
    const janela = intervaloDias(inicioDia, fimDia);
    const atual = await this.blocoTma(user.id_cliente, janela.inicio, janela.fim);
    const anterior = await this.blocoTma(user.id_cliente, janela.inicioAnterior, janela.fimAnterior);
    return {
      total_fechados: atual.total,
      variacao_pct: variacaoRelativa(atual.total, anterior.total),
      tma_min: atual.tma_min,
      tma_variacao_pct: variacaoRelativa(atual.tma_min, anterior.tma_min),
      csat: atual.csat,
      analistas: atual.analistas,
    };
  }

  private async blocoTma(idCliente: number, inicio: Date, fim: Date) {
    const fechado = Prisma.sql`
      c.id_cliente = ${idCliente}
      AND c.status IN ('RESOLVIDO', 'CONCLUIDO')
      AND COALESCE(c.data_fechamento, c.data_resolucao) >= ${inicio}
      AND COALESCE(c.data_fechamento, c.data_resolucao) < ${fim}
    `;
    const [resumo, analistas] = await Promise.all([
      this.prisma.$queryRaw<{ total: number; tma_min: number | null; csat: number | null }[]>(Prisma.sql`
        SELECT
          COUNT(*)::int AS total,
          CASE WHEN COUNT(*) = 0 THEN NULL
            ELSE ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(c.data_fechamento, c.data_resolucao) - c.data_abertura)) / 60))::int
          END AS tma_min,
          CASE WHEN COUNT(p.nota_satisfacao) = 0 THEN NULL
            ELSE ROUND(AVG(p.nota_satisfacao)::numeric, 2)::float8
          END AS csat
        FROM chamados c
        LEFT JOIN pesquisas_csat p ON p.id_cliente = c.id_cliente AND p.id_chamado = c.id
        WHERE ${fechado}
      `),
      this.prisma.$queryRaw<
        {
          id: number;
          nome: string;
          departamento: string | null;
          fechados: number;
          tma_min: number | null;
          reaberturas_pct: number | null;
          sla_pct: number | null;
          csat: number | null;
          avaliacoes: number;
        }[]
      >(Prisma.sql`
        SELECT u.id, u.nome, d.nome AS departamento,
          COUNT(*)::int AS fechados,
          ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(c.data_fechamento, c.data_resolucao) - c.data_abertura)) / 60))::int AS tma_min,
          ROUND(100.0 * COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM historico_status_chamados h
            WHERE h.id_cliente = c.id_cliente AND h.id_chamado = c.id
              AND h.status_anterior IN ('RESOLVIDO', 'CONCLUIDO')
              AND h.status_novo IN ('NOVO', 'EM_ATENDIMENTO', 'PENDENTE')
          )) / COUNT(*), 1)::float8 AS reaberturas_pct,
          ${pctSla(Prisma.sql`TRUE`)} AS sla_pct,
          CASE WHEN COUNT(p.nota_satisfacao) = 0 THEN NULL
            ELSE ROUND(AVG(p.nota_satisfacao)::numeric, 2)::float8
          END AS csat,
          COUNT(p.nota_satisfacao)::int AS avaliacoes
        FROM chamados c
        JOIN usuarios u ON u.id_cliente = c.id_cliente AND u.id = c.id_tecnico_atribuido
        LEFT JOIN departamentos d ON d.id_cliente = u.id_cliente AND d.id = u.id_departamento
        LEFT JOIN pesquisas_csat p ON p.id_cliente = c.id_cliente AND p.id_chamado = c.id
        WHERE ${fechado} AND c.id_tecnico_atribuido IS NOT NULL
        GROUP BY u.id, u.nome, d.nome
        ORDER BY fechados DESC, u.nome
      `),
    ]);
    return {
      total: resumo[0]?.total ?? 0,
      tma_min: numero(resumo[0]?.tma_min),
      csat: numero(resumo[0]?.csat),
      analistas: analistas.map((item) => ({
        ...item,
        tma_min: numero(item.tma_min),
        reaberturas_pct: numero(item.reaberturas_pct),
        sla_pct: numero(item.sla_pct),
        csat: numero(item.csat),
      })),
    };
  }
}

function periodoDias(periodo: string | undefined) {
  const valor = periodo?.trim() || '30d';
  if (valor === '7d') return 7;
  if (valor === '30d') return 30;
  if (valor === '90d') return 90;
  throw new BadRequestException('periodo inválido');
}

function pctSla(filtro: Prisma.Sql) {
  const comPrazo = Prisma.sql`${filtro} AND c.data_previsao_resolucao IS NOT NULL`;
  return Prisma.sql`CASE
    WHEN COUNT(*) FILTER (WHERE ${comPrazo}) = 0 THEN NULL
    ELSE ROUND(100.0 * COUNT(*) FILTER (
      WHERE ${comPrazo} AND c.data_resolucao <= c.data_previsao_resolucao
    ) / COUNT(*) FILTER (WHERE ${comPrazo}), 1)::float8
  END`;
}

function numero(valor: number | null | undefined) {
  if (valor === null || valor === undefined) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function variacaoPontos(atual: number | null | undefined, anterior: number | null | undefined) {
  if (atual === null || atual === undefined || anterior === null || anterior === undefined) return null;
  return Math.round((Number(atual) - Number(anterior)) * 10) / 10;
}

function variacaoRelativa(atual: number | null, anterior: number | null) {
  if (atual === null || anterior === null || anterior === 0) return null;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
}

function preencher<T extends string>(
  rows: ({ total: number } & Record<string, string | number>)[],
  campo: string,
  chaves: T[],
) {
  const mapa = new Map(rows.map((row) => [String(row[campo]), row.total]));
  return Object.fromEntries(chaves.map((chave) => [chave, mapa.get(chave) ?? 0])) as Record<T, number>;
}
