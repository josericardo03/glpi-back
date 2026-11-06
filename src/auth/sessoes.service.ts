import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** O refresh token renova a sessão por 14 dias de inatividade, até no máximo 30 dias desde o login. */
const INATIVIDADE_MS = 14 * 24 * 3600_000;
const MAXIMO_MS = 30 * 24 * 3600_000;
/** Duas abas podem renovar ao mesmo tempo; o token antigo ainda vale por este tempo. */
const TOLERANCIA_MS = 15_000;

export const hashDoToken = (token: string) => createHash('sha256').update(token).digest('hex');
const novoToken = () => randomBytes(48).toString('base64url');

export type Contexto = { ip?: string | null; agente?: string | null };

@Injectable()
export class SessoesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessoesService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.VITEST === 'true') return;
    this.timer = setInterval(() => void this.limpar().catch((e: unknown) => this.logger.warn(String(e))), 6 * 3600_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async criar(idCliente: number, idUsuario: number, ctx: Contexto) {
    const token = novoToken();
    const sessao = await this.prisma.sessoes.create({
      data: {
        id_cliente: idCliente,
        id_usuario: idUsuario,
        token_hash: hashDoToken(token),
        expira_em: new Date(Date.now() + INATIVIDADE_MS),
        endereco_ip: ctx.ip?.slice(0, 64) ?? null,
        agente: ctx.agente?.slice(0, 255) ?? null,
      },
    });
    return { id: sessao.id, token };
  }

  /**
   * Troca o refresh token por um novo (rotação). Apresentar um token já trocado, fora da tolerância,
   * indica roubo ou reuso: a sessão inteira é revogada.
   */
  async rotacionar(token: string, ctx: Contexto) {
    const hash = hashDoToken(token);
    const agora = new Date();
    const atual = await this.prisma.sessoes.findUnique({ where: { token_hash: hash } });

    if (!atual) {
      const anterior = await this.prisma.sessoes.findFirst({ where: { token_hash_anterior: hash, revogado_em: null } });
      if (!anterior) throw new UnauthorizedException('Sessão inválida');
      if (agora.getTime() - anterior.ultimo_uso.getTime() <= TOLERANCIA_MS) {
        // Corrida entre abas: a outra já renovou e o navegador já tem o cookie novo. Só emite o acesso.
        return { sessao: anterior, token: null };
      }
      await this.prisma.sessoes.update({ where: { id: anterior.id }, data: { revogado_em: agora } });
      throw new UnauthorizedException('Sessão inválida');
    }
    if (atual.revogado_em || atual.expira_em <= agora || atual.criado_em.getTime() + MAXIMO_MS <= agora.getTime()) {
      throw new UnauthorizedException('Sessão expirada');
    }

    const proximo = novoToken();
    const limite = atual.criado_em.getTime() + MAXIMO_MS;
    const trocada = await this.prisma.sessoes.updateMany({
      where: { id: atual.id, token_hash: hash, revogado_em: null },
      data: {
        token_hash: hashDoToken(proximo),
        token_hash_anterior: hash,
        ultimo_uso: agora,
        expira_em: new Date(Math.min(agora.getTime() + INATIVIDADE_MS, limite)),
        endereco_ip: ctx.ip?.slice(0, 64) ?? atual.endereco_ip,
        agente: ctx.agente?.slice(0, 255) ?? atual.agente,
      },
    });
    if (trocada.count === 0) throw new UnauthorizedException('Sessão inválida');
    return { sessao: atual, token: proximo };
  }

  async ativa(id: string, idCliente: number, idUsuario: number) {
    const sessao = await this.prisma.sessoes.findFirst({
      where: { id, id_cliente: idCliente, id_usuario: idUsuario, revogado_em: null, expira_em: { gt: new Date() } },
      select: { id: true },
    });
    return !!sessao;
  }

  revogar(id: string, idCliente: number, idUsuario: number) {
    return this.prisma.sessoes.updateMany({
      where: { id, id_cliente: idCliente, id_usuario: idUsuario, revogado_em: null },
      data: { revogado_em: new Date() },
    });
  }

  /** Revoga todas as sessões do usuário, menos (opcionalmente) a informada. */
  revogarTodas(idCliente: number, idUsuario: number, exceto?: string) {
    return this.prisma.sessoes.updateMany({
      where: { id_cliente: idCliente, id_usuario: idUsuario, revogado_em: null, ...(exceto ? { NOT: { id: exceto } } : {}) },
      data: { revogado_em: new Date() },
    });
  }

  listar(idCliente: number, idUsuario: number) {
    return this.prisma.sessoes.findMany({
      where: { id_cliente: idCliente, id_usuario: idUsuario, revogado_em: null, expira_em: { gt: new Date() } },
      orderBy: { ultimo_uso: 'desc' },
      select: { id: true, criado_em: true, ultimo_uso: true, endereco_ip: true, agente: true },
    });
  }

  /** Limpeza periódica: sessões vencidas ou revogadas há mais de 30 dias e tokens de recuperação antigos. */
  async limpar() {
    const corte = new Date(Date.now() - 30 * 24 * 3600_000);
    await this.prisma.sessoes.deleteMany({ where: { OR: [{ expira_em: { lt: corte } }, { revogado_em: { lt: corte } }] } });
    await this.prisma.tokens_recuperacao.deleteMany({ where: { expira_em: { lt: corte } } });
  }
}
