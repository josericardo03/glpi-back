import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type ConsultaLista,
  comNomes,
  fatia,
  includeNomes,
  ordemChamados,
  whereChamados,
} from './chamado-consulta.js';

@Injectable()
export class ListagemService {
  constructor(private readonly prisma: PrismaService) {}

  async chamados(user: AuthUser, consulta: ConsultaLista, fila: 'chamados' | 'triagem') {
    const where = whereChamados(user, consulta, fila);
    const ordem = ordemChamados(consulta.ordenar, fila === 'triagem' ? 'asc' : 'desc');
    const { take, skip } = fatia(consulta.limite, consulta.pagina, 100, 200);
    const [ids, totais] = await Promise.all([
      this.prisma.$queryRaw<{ id: number }[]>(
        Prisma.sql`SELECT c.id FROM chamados c WHERE ${where} ORDER BY ${ordem} LIMIT ${take} OFFSET ${skip}`,
      ),
      this.prisma.$queryRaw<{ total: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS total FROM chamados c WHERE ${where}`,
      ),
    ]);
    if (ids.length === 0) return { rows: [], total: totais[0]?.total ?? 0 };
    const encontrados = await this.prisma.chamados.findMany({
      where: { id_cliente: user.id_cliente, id: { in: ids.map((item) => item.id) } },
      include: includeNomes,
    });
    const posicao = new Map(ids.map((item, indice) => [item.id, indice]));
    encontrados.sort((a, b) => (posicao.get(a.id) ?? 0) - (posicao.get(b.id) ?? 0));
    return { rows: encontrados.map((row) => comNomes(row)), total: totais[0]?.total ?? 0 };
  }

  async ultimos(user: AuthUser, quantidade: number) {
    const rows = await this.prisma.chamados.findMany({
      where: {
        id_cliente: user.id_cliente,
        ...(user.perfil === 'SOLICITANTE' ? { id_solicitante: user.id } : {}),
      },
      include: includeNomes,
      orderBy: { data_abertura: 'desc' },
      take: quantidade,
    });
    return rows.map((row) => comNomes(row));
  }

  async ativos(user: AuthUser, consulta: ConsultaLista) {
    const where = {
      id_cliente: user.id_cliente,
      ...(user.perfil === 'SOLICITANTE' ? { id_usuario_atribuido: user.id } : {}),
    };
    const pagina = fatia(consulta.limite, consulta.pagina, 100, 200);
    const [rows, total] = await Promise.all([
      this.prisma.ativos_cmdb.findMany({
        where,
        include: { usuarios: { select: { id: true, nome: true } } },
        ...pagina,
      }),
      this.prisma.ativos_cmdb.count({ where }),
    ]);
    return {
      total,
      rows: rows.map(({ usuarios, ...ativo }) => ({
        ...ativo,
        usuario_atribuido: usuarios ? { id: usuarios.id, nome: usuarios.nome } : null,
      })),
    };
  }

  async artigos(user: AuthUser, consulta: ConsultaLista) {
    const statusValidos = ['RASCUNHO', 'REVISAO', 'PUBLICADO', 'ARQUIVADO'];
    if (consulta.status && !statusValidos.includes(consulta.status)) {
      throw new BadRequestException('status de artigo inválido');
    }
    const tecnico = user.perfil !== 'SOLICITANTE';
    const meusArtigos = tecnico && consulta.meus === 'true';
    const statusFiltro = tecnico && consulta.status ? consulta.status : meusArtigos ? undefined : 'PUBLICADO';
    const where = {
      id_cliente: user.id_cliente,
      ...(statusFiltro ? { status: statusFiltro } : {}),
      ...(meusArtigos ? { id_autor: user.id } : {}),
    };
    const pagina = fatia(consulta.limite, consulta.pagina, 50, 100);
    const [rows, total] = await Promise.all([
      this.prisma.artigos_kb.findMany({
        where,
        include: {
          feedbacks_artigos_kb: { select: { util: true, id_usuario: true } },
          usuarios: { select: { id: true, nome: true } },
          categorias_artigos_kb: { select: { id: true, nome: true } },
        },
        orderBy: { data_atualizacao: 'desc' },
        ...pagina,
      }),
      this.prisma.artigos_kb.count({ where }),
    ]);
    return {
      total,
      rows: rows.map(({ feedbacks_artigos_kb, usuarios, categorias_artigos_kb, ...artigo }) => ({
        ...artigo,
        autor: { id: usuarios.id, nome: usuarios.nome },
        categoria: { id: categorias_artigos_kb.id, nome: categorias_artigos_kb.nome },
        votos_uteis: feedbacks_artigos_kb.filter((voto) => voto.util).length,
        votos_nao_uteis: feedbacks_artigos_kb.filter((voto) => !voto.util).length,
        meu_voto: feedbacks_artigos_kb.find((voto) => voto.id_usuario === user.id)?.util ?? null,
      })),
    };
  }

  async aprovacoes(user: AuthUser, consulta: ConsultaLista) {
    const permitidos = ['PENDENTE', 'APROVADO', 'REJEITADO', 'CANCELADO', 'TODOS'];
    if (consulta.status && !permitidos.includes(consulta.status)) {
      throw new BadRequestException('status de aprovação inválido');
    }
    const filtro = !consulta.status || consulta.status === 'PENDENTE' ? 'PENDENTE' : consulta.status;
    const where = {
      id_cliente: user.id_cliente,
      ...(filtro === 'TODOS' ? {} : { status: filtro }),
      ...(user.perfil === 'SOLICITANTE' ? { id_solicitante: user.id } : {}),
    };
    const pagina = fatia(consulta.limite, consulta.pagina, 50, 100);
    const [rows, total] = await Promise.all([
      this.prisma.requisicoes_aprovacao.findMany({
        where,
        include: {
          chamados: { select: { titulo: true, prioridade: true } },
          mudancas: { select: { titulo: true, tipo_mudanca: true } },
          solicitante: { select: { id: true, nome: true } },
          aprovador: { select: { id: true, nome: true } },
        },
        orderBy: { data_solicitacao: 'desc' },
        ...pagina,
      }),
      this.prisma.requisicoes_aprovacao.count({ where }),
    ]);
    return {
      total,
      rows: rows.map(({ chamados, mudancas, solicitante, aprovador, ...aprovacao }) => ({
        ...aprovacao,
        titulo_chamado: chamados?.titulo ?? null,
        titulo_mudanca: mudancas?.titulo ?? null,
        prioridade: chamados?.prioridade ?? mudancas?.tipo_mudanca ?? null,
        solicitante: { id: solicitante.id, nome: solicitante.nome },
        aprovador: { id: aprovador.id, nome: aprovador.nome },
      })),
    };
  }

  async problemas(user: AuthUser, consulta: ConsultaLista) {
    const where = { id_cliente: user.id_cliente };
    const pagina = fatia(consulta.limite, consulta.pagina, 50, 100);
    const [rows, total] = await Promise.all([
      this.prisma.problemas.findMany({
        where,
        include: {
          usuarios: { select: { id: true, nome: true } },
          chamados_problemas: {
            include: { chamados: { select: { id: true, titulo: true, status: true } } },
          },
        },
        orderBy: { data_identificacao: 'desc' },
        ...pagina,
      }),
      this.prisma.problemas.count({ where }),
    ]);
    return {
      total,
      rows: rows.map(({ chamados_problemas, usuarios, ...problema }) => ({
        ...problema,
        tecnico: usuarios ? { id: usuarios.id, nome: usuarios.nome } : null,
        chamados: chamados_problemas.map((vinculo) => vinculo.chamados),
      })),
    };
  }

  async mudancas(user: AuthUser, consulta: ConsultaLista) {
    const where = { id_cliente: user.id_cliente };
    const pagina = fatia(consulta.limite, consulta.pagina, 50, 100);
    const [rows, total] = await Promise.all([
      this.prisma.mudancas.findMany({
        where,
        include: {
          usuarios: { select: { id: true, nome: true } },
          mudancas_chamados: {
            include: { chamados: { select: { id: true, titulo: true, status: true } } },
          },
        },
        orderBy: { data_criacao: 'desc' },
        ...pagina,
      }),
      this.prisma.mudancas.count({ where }),
    ]);
    return {
      total,
      rows: rows.map(({ mudancas_chamados, usuarios, ...mudanca }) => ({
        ...mudanca,
        solicitante: { id: usuarios.id, nome: usuarios.nome },
        chamados: mudancas_chamados.map((vinculo) => vinculo.chamados),
      })),
    };
  }
}
