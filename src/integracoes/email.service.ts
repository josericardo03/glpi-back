import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { descriptografarConfig, segredosDeIntegracao } from '../admin/segredo.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { destinoPermitido } from './rede.js';

export type ConfigSmtp = {
  idIntegracao: number;
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  enviarNotificacoes: boolean;
};

export type ResultadoEnvio = { ok: true } | { ok: false; erro: string };

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Configuração SMTP ativa do cliente (a integração do tipo SMTP), com a senha já descriptografada. */
  async configuracao(idCliente: number, idIntegracao?: number): Promise<ConfigSmtp | null> {
    const integracao = await this.prisma.integracoes.findFirst({
      where: { id_cliente: idCliente, tipo: 'SMTP', ...(idIntegracao ? { id: idIntegracao } : { status: 'ATIVO' }) },
      orderBy: { id: 'asc' },
    });
    if (!integracao) return null;
    const bruta = (integracao.configuracoes ?? {}) as Record<string, unknown>;
    const cfg = descriptografarConfig(bruta, this.segredos());
    const host = String(cfg.host ?? '').trim();
    const port = Number(cfg.port ?? 587);
    if (!host || !Number.isInteger(port)) return null;
    const user = cfg.user ? String(cfg.user) : cfg.usuario ? String(cfg.usuario) : undefined;
    const pass = cfg.password ? String(cfg.password) : cfg.senha ? String(cfg.senha) : undefined;
    return {
      idIntegracao: integracao.id,
      host,
      port,
      secure: cfg.secure === true || cfg.secure === 'true' || port === 465,
      user,
      pass,
      from: String(cfg.from ?? cfg.remetente ?? user ?? `itsm@${host}`),
      enviarNotificacoes: cfg.enviar_notificacoes !== false && cfg.enviar_notificacoes !== 'false',
    };
  }

  private segredos() {
    return segredosDeIntegracao({
      INTEGRACOES_SECRET: this.config.get<string>('INTEGRACOES_SECRET'),
      JWT_SECRET: this.config.get<string>('JWT_SECRET'),
    });
  }

  private transporte(cfg: ConfigSmtp) {
    return nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? '' } : undefined,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 15000,
    });
  }

  /** Confere conexão e credenciais sem enviar nada. */
  async verificar(idCliente: number, idIntegracao: number): Promise<ResultadoEnvio> {
    const cfg = await this.configuracao(idCliente, idIntegracao);
    if (!cfg) return { ok: false, erro: 'Configuração SMTP incompleta (informe host e porta)' };
    const destino = await destinoPermitido(cfg.host, { permitirRedeInterna: true });
    if (!destino.ok) return { ok: false, erro: destino.motivo };
    try {
      await this.transporte(cfg).verify();
      return { ok: true };
    } catch (erro) {
      return { ok: false, erro: erro instanceof Error ? erro.message : 'Falha de conexão SMTP' };
    }
  }

  /** Envia um e-mail pela integração SMTP ativa. Sem SMTP configurado, não faz nada (ok: true). */
  async enviar(
    idCliente: number,
    para: string,
    assunto: string,
    texto: string,
    opcoes: { link?: string; idIntegracao?: number; ignorarPreferencia?: boolean } = {},
  ): Promise<ResultadoEnvio & { enviado?: boolean }> {
    const cfg = await this.configuracao(idCliente, opcoes.idIntegracao);
    if (!cfg) return { ok: true, enviado: false };
    if (!cfg.enviarNotificacoes && !opcoes.ignorarPreferencia) return { ok: true, enviado: false };
    const destino = await destinoPermitido(cfg.host, { permitirRedeInterna: true });
    if (!destino.ok) {
      await this.registrar(idCliente, cfg.idIntegracao, 'FALHA', destino.motivo);
      return { ok: false, erro: destino.motivo };
    }
    const rodape = opcoes.link ? `\n\nAbrir no portal: ${opcoes.link}` : '';
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a">${escapeHtml(texto).replace(/\n/g, '<br>')}${
      opcoes.link ? `<p><a href="${escapeHtml(opcoes.link)}">Abrir no portal</a></p>` : ''
    }</div>`;
    try {
      await this.transporte(cfg).sendMail({ from: cfg.from, to: para, subject: assunto, text: `${texto}${rodape}`, html });
      await this.registrar(idCliente, cfg.idIntegracao, 'SUCESSO', `Enviado a ${para}: ${assunto}`);
      return { ok: true, enviado: true };
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : 'Falha no envio';
      this.logger.warn(`Falha ao enviar e-mail (${assunto}): ${mensagem}`);
      await this.registrar(idCliente, cfg.idIntegracao, 'FALHA', `Falha ao enviar a ${para}: ${mensagem}`);
      return { ok: false, erro: mensagem };
    }
  }

  async enviarParaUsuario(idCliente: number, idUsuario: number, assunto: string, texto: string, link?: string) {
    const usuario = await this.prisma.usuarios.findFirst({
      where: { id: idUsuario, id_cliente: idCliente, status: 'ATIVO' },
      select: { email: true },
    });
    if (!usuario) return { ok: true as const, enviado: false };
    return this.enviar(idCliente, usuario.email, assunto, texto, { link });
  }

  private async registrar(idCliente: number, idIntegracao: number, status: 'SUCESSO' | 'FALHA', dados: string) {
    try {
      await this.prisma.historico_integracoes.create({
        data: { id_cliente: idCliente, id_integracao: idIntegracao, tipo_evento: 'ENVIO_EMAIL', status, dados_log: dados.slice(0, 1000) },
      });
    } catch (erro) {
      this.logger.warn(`Não foi possível registrar o envio: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }
}
