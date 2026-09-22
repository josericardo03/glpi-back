import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SlaService } from '../sla/sla.service.js';
import { StorageService, type ArquivoUpload } from '../storage/storage.service.js';
import {
  AtivoChamadoDto,
  ComentarioDto,
  CreateChamadoDto,
  PausaDto,
  StatusChamadoDto,
  WorklogDto,
} from './dto/fase2.dto.js';

const TRANSICOES: Record<string, string[]> = {
  NOVO: ['EM_ATENDIMENTO', 'PENDENTE'],
  EM_ATENDIMENTO: ['PENDENTE', 'RESOLVIDO'],
  PENDENTE: ['EM_ATENDIMENTO'],
  RESOLVIDO: ['CONCLUIDO'],
  CONCLUIDO: [],
};

@Injectable()
export class ChamadosWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sla: SlaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async abrir(user: AuthUser, dto: CreateChamadoDto) {
    const categoria = await this.prisma.categorias_chamados.findFirst({
      where: { id: dto.id_categoria, id_cliente: user.id_cliente, status: 'ATIVO' },
    });
    if (!categoria) throw new NotFoundException('Categoria não encontrada');

    if (dto.id_ativo_afetado) {
      const ativo = await this.prisma.ativos_cmdb.findFirst({
        where: { id: dto.id_ativo_afetado, id_cliente: user.id_cliente },
      });
      if (!ativo) throw new NotFoundException('Ativo não encontrado');
    }

    const previsao = await this.sla.prever(user.id_cliente, dto.prioridade, dto.tipo);

    const criado = await this.prisma.$transaction(async (tx) => {
      const chamado = await tx.chamados.create({
        data: {
          id_cliente: user.id_cliente,
          id_solicitante: user.id,
          id_categoria: dto.id_categoria,
          id_politica_sla: previsao.id_politica_sla,
          titulo: dto.titulo.trim(),
          descricao: dto.descricao.trim(),
          tipo: dto.tipo,
          origem: dto.origem ?? 'PORTAL',
          prioridade: dto.prioridade,
          status: 'NOVO',
          data_previsao_resolucao: previsao.data_previsao_resolucao,
        },
      });
      if (dto.id_ativo_afetado) {
        await tx.chamados_ativos.create({
          data: {
            id_cliente: user.id_cliente,
            id_chamado: chamado.id,
            id_ativo: dto.id_ativo_afetado,
          },
        });
      }
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'CREATE_CHAMADO',
        tabela_afetada: 'chamados',
        registro_id: chamado.id,
        valor_anterior: null,
        valor_novo: {
          titulo: chamado.titulo,
          status: chamado.status,
          id_categoria: chamado.id_categoria,
          prioridade: chamado.prioridade,
        },
      });
      return chamado;
    });

    return {
      id: criado.id,
      id_cliente: criado.id_cliente,
      titulo: criado.titulo,
      status: criado.status,
      data_abertura: criado.data_abertura,
      data_previsao_resolucao: criado.data_previsao_resolucao,
      sla_vencido: criado.sla_vencido,
    };
  }

  async mudarStatus(user: AuthUser, id: number, dto: StatusChamadoDto) {
    const chamado = await this.obter(user, id);
    if (dto.status_novo === 'PENDENTE') {
      if (!dto.motivo_pausa) {
        throw new BadRequestException('motivo_pausa é obrigatório para PENDENTE');
      }
      return this.pausar(user, id, { motivo_pausa: dto.motivo_pausa });
    }
    if (chamado.status === 'PENDENTE' && dto.status_novo === 'EM_ATENDIMENTO') {
      return this.retomar(user, id);
    }
    this.assertTransicao(chamado.status, dto.status_novo);
    const agora = new Date();
    const dataResolucao = dto.data_resolucao ? new Date(dto.data_resolucao) : agora;
    const dataFechamento = dto.data_fechamento ? new Date(dto.data_fechamento) : agora;

    if (dto.status_novo === 'RESOLVIDO') {
      if (!dto.resolucao) throw new BadRequestException('resolucao é obrigatória');
      if (dataResolucao < chamado.data_abertura) {
        throw new BadRequestException('data_resolucao não pode ser anterior à abertura');
      }
    }
    if (dto.status_novo === 'CONCLUIDO') {
      if (!chamado.data_resolucao) {
        throw new BadRequestException('Fechamento exige resolução técnica prévia');
      }
      if (dataFechamento < chamado.data_resolucao) {
        throw new BadRequestException('data_fechamento não pode ser anterior à resolução');
      }
    }

    const tempo = await this.tempoNoStatus(chamado);
    const atualizado = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.chamados.update({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
        data: {
          status: dto.status_novo,
          ...(dto.status_novo === 'RESOLVIDO'
            ? { resolucao: dto.resolucao, data_resolucao: dataResolucao }
            : {}),
          ...(dto.status_novo === 'CONCLUIDO' ? { data_fechamento: dataFechamento } : {}),
        },
      });
      await tx.historico_status_chamados.create({
        data: {
          id_cliente: user.id_cliente,
          id_chamado: id,
          status_anterior: chamado.status,
          status_novo: dto.status_novo,
          id_usuario_alterou: user.id,
          tempo_no_status_seg: tempo,
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'UPDATE_STATUS',
        tabela_afetada: 'chamados',
        registro_id: id,
        valor_anterior: { status: chamado.status },
        valor_novo: {
          status: dto.status_novo,
          resolucao: dto.resolucao ?? null,
        },
      });
      return saved;
    });

    return {
      id: atualizado.id,
      status_anterior: chamado.status,
      status_novo: atualizado.status,
      data_resolucao: atualizado.data_resolucao,
      tempo_no_status_seg: tempo,
      mensagem: 'Status atualizado e registrado no histórico com sucesso.',
    };
  }

  async comentar(user: AuthUser, id: number, dto: ComentarioDto) {
    const chamado = await this.obter(user, id);
    const visibilidade = dto.tipo_visibilidade ?? 'PUBLICO';
    if (visibilidade === 'INTERNO' && user.perfil === 'SOLICITANTE') {
      throw new ForbiddenException('Nota interna restrita à equipe técnica');
    }
    const comentario = await this.prisma.$transaction(async (tx) => {
      const row = await tx.comentarios_chamados.create({
        data: {
          id_cliente: user.id_cliente,
          id_chamado: chamado.id,
          id_autor: user.id,
          mensagem: dto.mensagem.trim(),
          tipo_visibilidade: visibilidade,
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'ADD_COMENTARIO',
        tabela_afetada: 'comentarios_chamados',
        registro_id: row.id,
        valor_anterior: null,
        valor_novo: { id_chamado: id, tipo_visibilidade: visibilidade },
      });
      return row;
    });
    return comentario;
  }

  async pausar(user: AuthUser, id: number, dto: PausaDto) {
    const chamado = await this.obter(user, id, false);
    if (!['NOVO', 'EM_ATENDIMENTO'].includes(chamado.status)) {
      throw new BadRequestException('Só é possível pausar chamado novo ou em atendimento');
    }
    const aberta = await this.pausaAberta(user.id_cliente, id);
    if (aberta) throw new ConflictException('Já existe uma pausa de SLA em aberto');

    const tempo = await this.tempoNoStatus(chamado);
    return this.prisma.$transaction(async (tx) => {
      await tx.chamados.update({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
        data: { status: 'PENDENTE' },
      });
      const historico = await tx.historico_status_chamados.create({
        data: {
          id_cliente: user.id_cliente,
          id_chamado: id,
          status_anterior: chamado.status,
          status_novo: 'PENDENTE',
          id_usuario_alterou: user.id,
          tempo_no_status_seg: tempo,
        },
      });
      const pausa = await tx.pausas_sla.create({
        data: {
          id_cliente: user.id_cliente,
          id_chamado: id,
          id_historico_origem: historico.id,
          motivo_pausa: dto.motivo_pausa,
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'PAUSE_SLA',
        tabela_afetada: 'pausas_sla',
        registro_id: pausa.id,
        valor_anterior: { status: chamado.status },
        valor_novo: { status: 'PENDENTE', motivo_pausa: dto.motivo_pausa },
      });
      return {
        id: chamado.id,
        status_anterior: chamado.status,
        status_novo: 'PENDENTE',
        id_pausa: pausa.id,
        motivo_pausa: dto.motivo_pausa,
        tempo_no_status_seg: tempo,
        mensagem: 'SLA congelado.',
      };
    });
  }

  async retomar(user: AuthUser, id: number) {
    const chamado = await this.obter(user, id, false);
    const pausa = await this.pausaAberta(user.id_cliente, id);
    if (!pausa || chamado.status !== 'PENDENTE') {
      throw new BadRequestException('Não há pausa de SLA em aberto');
    }
    const agora = new Date();
    const segundos = Math.max(0, Math.floor((agora.getTime() - pausa.data_pausa.getTime()) / 1000));
    const novaPrevisao = await this.sla.adiarPrevisao(
      user.id_cliente,
      chamado.id_politica_sla,
      chamado.data_previsao_resolucao,
      pausa.data_pausa,
      agora,
    );
    const tempo = await this.tempoNoStatus(chamado);

    return this.prisma.$transaction(async (tx) => {
      await tx.pausas_sla.update({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id: pausa.id } },
        data: { data_retomada: agora, tempo_pausado_seg: segundos },
      });
      await tx.chamados.update({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
        data: {
          status: 'EM_ATENDIMENTO',
          tempo_acumulado_pausa_s: { increment: segundos },
          data_previsao_resolucao: novaPrevisao,
        },
      });
      await tx.historico_status_chamados.create({
        data: {
          id_cliente: user.id_cliente,
          id_chamado: id,
          status_anterior: 'PENDENTE',
          status_novo: 'EM_ATENDIMENTO',
          id_usuario_alterou: user.id,
          tempo_no_status_seg: tempo,
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'RESUME_SLA',
        tabela_afetada: 'chamados',
        registro_id: id,
        valor_anterior: {
          status: 'PENDENTE',
          data_previsao_resolucao: chamado.data_previsao_resolucao?.toISOString() ?? null,
        },
        valor_novo: {
          status: 'EM_ATENDIMENTO',
          tempo_pausado_seg: segundos,
          data_previsao_resolucao: novaPrevisao?.toISOString() ?? null,
        },
      });
      return {
        id,
        status_anterior: 'PENDENTE',
        status_novo: 'EM_ATENDIMENTO',
        tempo_pausado_seg: segundos,
        data_previsao_resolucao: novaPrevisao,
        tempo_no_status_seg: tempo,
        mensagem: 'SLA retomado e previsão recalculada.',
      };
    });
  }

  async worklog(user: AuthUser, id: number, dto: WorklogDto) {
    await this.obter(user, id, false);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.worklogs.create({
        data: {
          id_cliente: user.id_cliente,
          id_chamado: id,
          id_tecnico: user.id,
          descricao_atividade: dto.descricao_atividade.trim(),
          tempo_trabalhado_min: dto.tempo_trabalhado_min,
          data_execucao: new Date(dto.data_execucao),
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'ADD_WORKLOG',
        tabela_afetada: 'worklogs',
        registro_id: created.id,
        valor_anterior: null,
        valor_novo: {
          tempo_trabalhado_min: dto.tempo_trabalhado_min,
          id_tecnico: user.id,
        },
      });
      return created;
    });
    return row;
  }

  async anexar(
    user: AuthUser,
    id: number,
    file: ArquivoUpload,
    idComentario?: number,
  ) {
    await this.obter(user, id);
    if (idComentario) {
      const comentario = await this.prisma.comentarios_chamados.findFirst({
        where: { id: idComentario, id_cliente: user.id_cliente, id_chamado: id },
      });
      if (!comentario) throw new NotFoundException('Comentário não encontrado neste chamado');
    }
    const salvo = this.storage.validar(user.id_cliente, id, file);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const anexo = await tx.anexos_chamados.create({
          data: {
            id_cliente: user.id_cliente,
            id_chamado: id,
            id_comentario: idComentario,
            nome_arquivo: salvo.nome_arquivo,
            caminho_storage: salvo.caminho_storage,
            tipo_mime: salvo.tipo_mime,
            tamanho_bytes: salvo.tamanho_bytes,
            conteudo: new Uint8Array(salvo.conteudo),
          },
          select: {
            id: true,
            id_cliente: true,
            id_chamado: true,
            id_comentario: true,
            nome_arquivo: true,
            caminho_storage: true,
            tipo_mime: true,
            tamanho_bytes: true,
            data_upload: true,
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'ADD_ANEXO',
          tabela_afetada: 'anexos_chamados',
          registro_id: anexo.id,
          valor_anterior: null,
          valor_novo: {
            nome_arquivo: salvo.nome_arquivo,
            tamanho_bytes: salvo.tamanho_bytes,
          },
        });
        return { ...anexo, tamanho_bytes: Number(anexo.tamanho_bytes) };
      });
    } catch (error) {
      throw this.traduzir(error);
    }
  }

  async baixar(user: AuthUser, id: number, anexoId: number) {
    await this.obter(user, id);
    const anexo = await this.prisma.anexos_chamados.findFirst({
      where: { id: anexoId, id_cliente: user.id_cliente, id_chamado: id },
    });
    if (!anexo?.conteudo) throw new NotFoundException('Anexo não encontrado');
    return anexo;
  }

  async vincularAtivo(user: AuthUser, id: number, dto: AtivoChamadoDto) {
    await this.obter(user, id, false);
    const ativo = await this.prisma.ativos_cmdb.findFirst({
      where: { id: dto.id_ativo, id_cliente: user.id_cliente },
    });
    if (!ativo) throw new NotFoundException('Ativo não encontrado');
    try {
      const link = await this.prisma.chamados_ativos.create({
        data: {
          id_cliente: user.id_cliente,
          id_chamado: id,
          id_ativo: dto.id_ativo,
        },
      });
      await this.audit.record(this.prisma, {
        id_cliente: user.id_cliente,
        acao: 'LINK_ATIVO',
        tabela_afetada: 'chamados_ativos',
        registro_id: id,
        valor_anterior: null,
        valor_novo: { id_ativo: dto.id_ativo },
      });
      return link;
    } catch (error) {
      throw this.traduzir(error);
    }
  }

  private async obter(user: AuthUser, id: number, restringeSolicitante = true) {
    const chamado = await this.prisma.chamados.findFirst({
      where: { id, id_cliente: user.id_cliente },
    });
    if (!chamado) throw new NotFoundException('Chamado não encontrado');
    if (
      restringeSolicitante &&
      user.perfil === 'SOLICITANTE' &&
      chamado.id_solicitante !== user.id
    ) {
      throw new ForbiddenException('Chamado de outro solicitante');
    }
    return chamado;
  }

  private assertTransicao(atual: string, proximo: string) {
    if (atual === proximo) throw new BadRequestException('O chamado já está neste status');
    if (!TRANSICOES[atual]?.includes(proximo)) {
      throw new BadRequestException(`Transição ${atual} -> ${proximo} não é permitida`);
    }
  }

  private async pausaAberta(idCliente: number, idChamado: number) {
    return this.prisma.pausas_sla.findFirst({
      where: { id_cliente: idCliente, id_chamado: idChamado, data_retomada: null },
    });
  }

  private async tempoNoStatus(chamado: { id: number; id_cliente: number; data_abertura: Date }) {
    const ultimo = await this.prisma.historico_status_chamados.findFirst({
      where: { id_cliente: chamado.id_cliente, id_chamado: chamado.id },
      orderBy: { data_alteracao: 'desc' },
    });
    const base = ultimo?.data_alteracao ?? chamado.data_abertura;
    return Math.max(0, Math.floor((Date.now() - base.getTime()) / 1000));
  }

  private traduzir(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('Registro duplicado');
    }
    return error;
  }
}
