import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types.js';

const STATUS = new Set(['NOVO', 'EM_ATENDIMENTO', 'PENDENTE', 'RESOLVIDO', 'CONCLUIDO']);
const PRIORIDADES = new Set(['CRITICA', 'ALTA', 'MEDIA', 'BAIXA']);
const TIPOS = new Set(['INCIDENTE', 'REQUISICAO']);
const CAMPOS_ORDEM = new Set(['data_abertura', 'prioridade', 'status', 'id', 'data_resolucao']);

export const FUSO = 'America/Cuiaba';

export type ConsultaLista = {
  status?: string;
  prioridade?: string;
  tipo?: string;
  id_categoria?: string;
  id_grupo?: string;
  id_tecnico?: string;
  id_solicitante?: string;
  sla_vencido?: string;
  de?: string;
  ate?: string;
  busca?: string;
  ordenar?: string;
  limite?: string;
  pagina?: string;
  lida?: string;
  meus?: string;
};

export const includeNomes = {
  solicitante: { select: { id: true, nome: true } },
  tecnico: { select: { id: true, nome: true } },
  categoria: {
    select: {
      id: true,
      nome: true,
      categoria_pai: { select: { nome: true } },
    },
  },
  grupo: { select: { id: true, nome: true } },
} as const;

type CategoriaComPai = {
  id: number;
  nome: string;
  categoria_pai: { nome: string } | null;
};

export function comNomes<T extends { categoria: CategoriaComPai }>(row: T) {
  const { categoria, ...resto } = row;
  return {
    ...resto,
    categoria: {
      id: categoria.id,
      nome: categoria.nome,
      nome_pai: categoria.categoria_pai?.nome ?? null,
    },
  };
}

export function escopoChamado(user: AuthUser, alias = 'c') {
  const solicitante = user.perfil === 'SOLICITANTE' ? user.id : null;
  return Prisma.sql`${Prisma.raw(alias)}.id_cliente = ${user.id_cliente} AND (${solicitante}::int IS NULL OR ${Prisma.raw(alias)}.id_solicitante = ${solicitante})`;
}

export function whereChamados(user: AuthUser, consulta: ConsultaLista, fila: 'chamados' | 'triagem') {
  const partes: Prisma.Sql[] = [escopoChamado(user)];
  const status = listaStatus(consulta.status);
  if (status) {
    partes.push(Prisma.sql`c.status IN (${Prisma.join(status)})`);
  } else if (fila === 'triagem') {
    partes.push(Prisma.sql`c.status = 'NOVO'`);
  }
  if (consulta.prioridade) {
    if (!PRIORIDADES.has(consulta.prioridade)) {
      throw new BadRequestException('prioridade inválida');
    }
    partes.push(Prisma.sql`c.prioridade = ${consulta.prioridade}`);
  }
  if (consulta.tipo) {
    if (!TIPOS.has(consulta.tipo)) throw new BadRequestException('tipo inválido');
    partes.push(Prisma.sql`c.tipo = ${consulta.tipo}`);
  }
  const categoria = inteiro(consulta.id_categoria, 'id_categoria');
  if (categoria !== undefined) partes.push(Prisma.sql`c.id_categoria = ${categoria}`);
  const grupo = inteiro(consulta.id_grupo, 'id_grupo');
  if (grupo !== undefined) partes.push(Prisma.sql`c.id_grupo_responsavel = ${grupo}`);
  if (consulta.id_tecnico === 'sem') {
    partes.push(Prisma.sql`c.id_tecnico_atribuido IS NULL`);
  } else if (consulta.id_tecnico) {
    partes.push(Prisma.sql`c.id_tecnico_atribuido = ${inteiro(consulta.id_tecnico, 'id_tecnico')}`);
  }
  const solicitante = inteiro(consulta.id_solicitante, 'id_solicitante');
  if (solicitante !== undefined) partes.push(Prisma.sql`c.id_solicitante = ${solicitante}`);
  if (consulta.sla_vencido !== undefined && consulta.sla_vencido !== '') {
    if (consulta.sla_vencido !== 'true' && consulta.sla_vencido !== 'false') {
      throw new BadRequestException('sla_vencido inválido');
    }
    partes.push(Prisma.sql`c.sla_vencido = ${consulta.sla_vencido === 'true'}`);
  }
  const de = dia(consulta.de, 'de');
  const ate = dia(consulta.ate, 'ate');
  if (de && ate && de > ate) throw new BadRequestException('de não pode ser posterior a ate');
  if (de) {
    partes.push(
      Prisma.sql`c.data_abertura >= (${de}::date::timestamp AT TIME ZONE ${FUSO})`,
    );
  }
  if (ate) {
    partes.push(
      Prisma.sql`c.data_abertura < ((${ate}::date + 1)::timestamp AT TIME ZONE ${FUSO})`,
    );
  }
  const busca = consulta.busca?.trim();
  if (busca) {
    const padrao = `%${busca.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    partes.push(Prisma.sql`(
      c.titulo ILIKE ${padrao} ESCAPE '\\'
      OR c.descricao ILIKE ${padrao} ESCAPE '\\'
      OR c.id::text ILIKE ${padrao} ESCAPE '\\'
    )`);
  }
  return Prisma.join(partes, ' AND ');
}

export function ordemChamados(ordenar: string | undefined, padrao: 'asc' | 'desc') {
  const bruto = ordenar?.trim() || `data_abertura:${padrao}`;
  const [campo, dir] = bruto.split(':');
  if (!campo || !CAMPOS_ORDEM.has(campo) || (dir !== 'asc' && dir !== 'desc')) {
    throw new BadRequestException('ordenar inválido');
  }
  const sentido = dir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  if (campo === 'prioridade') {
    const peso =
      dir === 'asc'
        ? Prisma.sql`CASE c.prioridade WHEN 'BAIXA' THEN 1 WHEN 'MEDIA' THEN 2 WHEN 'ALTA' THEN 3 WHEN 'CRITICA' THEN 4 ELSE 5 END`
        : Prisma.sql`CASE c.prioridade WHEN 'CRITICA' THEN 1 WHEN 'ALTA' THEN 2 WHEN 'MEDIA' THEN 3 WHEN 'BAIXA' THEN 4 ELSE 5 END`;
    return Prisma.sql`${peso} ASC, c.id DESC`;
  }
  if (campo === 'data_abertura') return Prisma.sql`c.data_abertura ${sentido}, c.id DESC`;
  if (campo === 'data_resolucao') return Prisma.sql`c.data_resolucao ${sentido} NULLS LAST, c.id DESC`;
  if (campo === 'status') return Prisma.sql`c.status ${sentido}, c.id DESC`;
  return Prisma.sql`c.id ${sentido}`;
}

export function fatia(limite: string | undefined, pagina: string | undefined, padrao: number, teto: number) {
  const tamanho = Math.min(teto, Math.max(1, Number(limite) || padrao));
  const paginaNum = Math.max(1, Number(pagina) || 1);
  if (limite && !/^\d+$/.test(limite)) throw new BadRequestException('limite inválido');
  if (pagina && !/^\d+$/.test(pagina)) throw new BadRequestException('pagina inválida');
  return { take: tamanho, skip: (paginaNum - 1) * tamanho };
}

export function hojeCuiaba() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date());
}

export function somarDias(iso: string, dias: number) {
  const [ano, mes, diaMes] = iso.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, diaMes + dias)).toISOString().slice(0, 10);
}

export function inicioCuiaba(iso: string) {
  return new Date(`${iso}T04:00:00.000Z`);
}

export function intervaloDias(de: string, ate: string) {
  const inicio = inicioCuiaba(de);
  const fim = inicioCuiaba(somarDias(ate, 1));
  const dias =
    Math.round((inicioCuiaba(ate).getTime() - inicio.getTime()) / 86_400_000) + 1;
  const deAnterior = somarDias(de, -dias);
  const ateAnterior = somarDias(de, -1);
  return {
    inicio,
    fim,
    inicioAnterior: inicioCuiaba(deAnterior),
    fimAnterior: inicioCuiaba(somarDias(ateAnterior, 1)),
  };
}

function listaStatus(status: string | undefined) {
  if (!status?.trim()) return undefined;
  const itens = status.split(',').map((item) => item.trim()).filter(Boolean);
  if (itens.length === 0 || itens.some((item) => !STATUS.has(item))) {
    throw new BadRequestException('status inválido');
  }
  return itens;
}

function inteiro(valor: string | undefined, nome: string) {
  if (valor === undefined || valor === '') return undefined;
  if (!/^\d+$/.test(valor)) throw new BadRequestException(`${nome} inválido`);
  return Number(valor);
}

export function diaObrigatorio(valor: string, nome: string) {
  const ok = dia(valor, nome);
  if (!ok) throw new BadRequestException(`${nome} inválido`);
  return ok;
}

function dia(valor: string | undefined, nome: string) {
  if (!valor) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new BadRequestException(`${nome} inválido`);
  const [ano, mes, diaMes] = valor.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, diaMes));
  if (
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() !== mes - 1 ||
    data.getUTCDate() !== diaMes
  ) {
    throw new BadRequestException(`${nome} inválido`);
  }
  return valor;
}
