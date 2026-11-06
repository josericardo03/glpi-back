import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from './email.service.js';
import { WebhookService } from './webhook.service.js';

export type ChamadoEvento = {
  id: number;
  id_cliente: number;
  titulo: string;
  prioridade: string;
  status?: string;
  id_solicitante: number;
  id_tecnico_atribuido: number | null;
};

const ROTULO_STATUS: Record<string, string> = {
  NOVO: 'Novo',
  EM_ATENDIMENTO: 'Em atendimento',
  PENDENTE: 'Pendente',
  RESOLVIDO: 'Resolvido',
  CONCLUIDO: 'Concluído',
};

const trecho = (texto: string, max = 200) => {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length > max ? `${limpo.slice(0, max - 1)}…` : limpo;
};

/**
 * Ponto único dos eventos do negócio: cada um vira notificações no portal, e-mail (pela integração SMTP)
 * e webhook. Tudo é feito depois da operação principal e nunca lança erro: uma falha de notificação
 * não pode desfazer nem atrasar a ação do usuário.
 */
@Injectable()
export class EventosService {
  private readonly logger = new Logger(EventosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly webhook: WebhookService,
    private readonly config: ConfigService,
  ) {}

  private link(caminho: string) {
    const base = (this.config.get<string>('APP_URL') ?? '').replace(/\/+$/, '');
    return base ? `${base}${caminho}` : undefined;
  }

  /** Notificação no portal + e-mail para cada destinatário distinto. */
  async notificar(idCliente: number, destinatarios: Array<number | null | undefined>, titulo: string, mensagem: string, caminho?: string) {
    const ids = [...new Set(destinatarios.filter((d): d is number => typeof d === 'number'))];
    if (!ids.length) return;
    try {
      await this.prisma.notificacoes.createMany({
        data: ids.map((idUsuario) => ({ id_cliente: idCliente, id_usuario: idUsuario, titulo: titulo.slice(0, 150), mensagem })),
      });
    } catch (erro) {
      this.logger.warn(`Notificação não gravada: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
    const link = caminho ? this.link(caminho) : undefined;
    for (const idUsuario of ids) {
      this.email.enviarParaUsuario(idCliente, idUsuario, titulo, mensagem, link).catch((erro: unknown) => {
        this.logger.warn(`E-mail não enviado: ${erro instanceof Error ? erro.message : String(erro)}`);
      });
    }
  }

  private async seguro(nome: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (erro) {
      this.logger.warn(`Evento ${nome} falhou: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  private async gestores(idCliente: number) {
    const rows = await this.prisma.usuarios.findMany({
      where: { id_cliente: idCliente, status: 'ATIVO', perfil: { in: ['GESTOR', 'ADMIN'] } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private dadosChamado(c: ChamadoEvento) {
    return { id: c.id, titulo: c.titulo, prioridade: c.prioridade, status: c.status, id_solicitante: c.id_solicitante, id_tecnico_atribuido: c.id_tecnico_atribuido };
  }

  chamadoAberto(c: ChamadoEvento, autorId: number) {
    return this.seguro('chamado.criado', async () => {
      void this.webhook.emitir(c.id_cliente, 'chamado.criado', this.dadosChamado(c));
      if (c.prioridade === 'CRITICA' || c.prioridade === 'ALTA') {
        const gestores = (await this.gestores(c.id_cliente)).filter((id) => id !== autorId);
        const rotulo = c.prioridade === 'CRITICA' ? 'crítico' : 'de alta prioridade';
        await this.notificar(c.id_cliente, gestores, `Novo chamado ${rotulo} #${c.id}`, `${c.titulo}`, `/chamados/${c.id}`);
      }
    });
  }

  chamadoAtribuido(c: ChamadoEvento, autorId: number) {
    return this.seguro('chamado.atribuido', async () => {
      void this.webhook.emitir(c.id_cliente, 'chamado.atribuido', this.dadosChamado(c));
      if (c.id_tecnico_atribuido && c.id_tecnico_atribuido !== autorId) {
        await this.notificar(c.id_cliente, [c.id_tecnico_atribuido], `Chamado #${c.id} atribuído a você`, c.titulo, `/chamados/${c.id}`);
      }
    });
  }

  comentario(c: ChamadoEvento, autorId: number, autorNome: string, interno: boolean, mensagem: string) {
    return this.seguro('chamado.comentado', async () => {
      void this.webhook.emitir(c.id_cliente, 'chamado.comentado', { ...this.dadosChamado(c), interno, autor: autorNome });
      const destinatarios = interno ? [c.id_tecnico_atribuido] : [c.id_solicitante, c.id_tecnico_atribuido];
      await this.notificar(
        c.id_cliente,
        destinatarios.filter((id) => id !== autorId),
        interno ? `Nota interna no chamado #${c.id}` : `Novo comentário no chamado #${c.id}`,
        `${autorNome}: ${trecho(mensagem)}`,
        `/chamados/${c.id}`,
      );
    });
  }

  statusAlterado(c: ChamadoEvento, anterior: string, novo: string, autorId: number, motivoPausa?: string) {
    return this.seguro('chamado.status', async () => {
      void this.webhook.emitir(c.id_cliente, 'chamado.status_alterado', { ...this.dadosChamado(c), status: novo, status_anterior: anterior });
      const caminho = `/chamados/${c.id}`;
      const reabertura = anterior === 'RESOLVIDO' && novo === 'EM_ATENDIMENTO';
      if (reabertura) {
        await this.notificar(c.id_cliente, [c.id_tecnico_atribuido].filter((id) => id !== autorId), `Chamado #${c.id} reaberto`, `O solicitante reabriu o chamado: ${c.titulo}`, caminho);
        return;
      }
      if (novo === 'CONCLUIDO') {
        await this.notificar(c.id_cliente, [c.id_tecnico_atribuido].filter((id) => id !== autorId), `Chamado #${c.id} concluído`, `O solicitante confirmou a solução: ${c.titulo}`, caminho);
        return;
      }
      const paraSolicitante = c.id_solicitante !== autorId;
      if (!paraSolicitante) return;
      if (novo === 'RESOLVIDO') {
        await this.notificar(c.id_cliente, [c.id_solicitante], `Chamado #${c.id} resolvido`, `${c.titulo}. Confirme se o problema foi solucionado ou reabra o chamado.`, caminho);
      } else if (novo === 'PENDENTE' && motivoPausa === 'AGUARDANDO_SOLICITANTE') {
        await this.notificar(c.id_cliente, [c.id_solicitante], `Chamado #${c.id} aguarda uma resposta sua`, `${c.titulo}. A equipe precisa de uma informação sua para continuar.`, caminho);
      } else if (novo === 'EM_ATENDIMENTO') {
        await this.notificar(c.id_cliente, [c.id_solicitante], `Chamado #${c.id} atualizado: ${ROTULO_STATUS[novo]}`, `${c.titulo}. O status do chamado foi atualizado para ${ROTULO_STATUS[novo]?.toLowerCase()}.`, caminho);
      }
    });
  }

  aprovacaoSolicitada(a: { id: number; id_cliente: number; id_aprovador: number; id_solicitante: number; id_chamado: number | null; id_mudanca: number | null; descricao: string }, solicitanteNome: string) {
    return this.seguro('aprovacao.solicitada', async () => {
      void this.webhook.emitir(a.id_cliente, 'aprovacao.solicitada', { id: a.id, id_chamado: a.id_chamado, id_mudanca: a.id_mudanca, id_aprovador: a.id_aprovador });
      const alvo = a.id_chamado ? `chamado #${a.id_chamado}` : `mudança #${a.id_mudanca}`;
      await this.notificar(a.id_cliente, [a.id_aprovador], `Aprovação pendente: ${alvo}`, `${solicitanteNome} pede sua aprovação. ${trecho(a.descricao)}`, '/aprovacoes');
    });
  }

  aprovacaoDecidida(a: { id: number; id_cliente: number; id_solicitante: number; id_chamado: number | null; id_mudanca: number | null }, status: string, aprovadorNome: string) {
    return this.seguro('aprovacao.decidida', async () => {
      void this.webhook.emitir(a.id_cliente, 'aprovacao.decidida', { id: a.id, status, id_chamado: a.id_chamado, id_mudanca: a.id_mudanca });
      const alvo = a.id_chamado ? `chamado #${a.id_chamado}` : `mudança #${a.id_mudanca}`;
      const resultado = status === 'APROVADO' ? 'aprovada' : 'rejeitada';
      await this.notificar(a.id_cliente, [a.id_solicitante], `Aprovação ${resultado}: ${alvo}`, `${aprovadorNome} ${resultado === 'aprovada' ? 'aprovou' : 'rejeitou'} a sua solicitação.`, a.id_chamado ? `/chamados/${a.id_chamado}` : '/aprovacoes');
    });
  }

  /** Alerta de SLA: vai para o técnico do chamado ou, sem técnico, para os gestores. */
  slaAlerta(c: ChamadoEvento, tipo: 'PERTO' | 'VENCIDO') {
    return this.seguro(`sla.${tipo}`, async () => {
      void this.webhook.emitir(c.id_cliente, tipo === 'VENCIDO' ? 'sla.vencido' : 'sla.perto_de_vencer', this.dadosChamado(c));
      const destinatarios = c.id_tecnico_atribuido ? [c.id_tecnico_atribuido] : await this.gestores(c.id_cliente);
      const titulo = tipo === 'VENCIDO' ? `SLA vencido no chamado #${c.id}` : `SLA perto de vencer no chamado #${c.id}`;
      const mensagem = tipo === 'VENCIDO' ? `${c.titulo}. O prazo do SLA venceu: priorize este chamado (urgente).` : `${c.titulo}. O prazo do SLA está acabando.`;
      await this.notificar(c.id_cliente, destinatarios, titulo, mensagem, `/chamados/${c.id}`);
    });
  }
}
