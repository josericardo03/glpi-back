import { timingSafeEqual } from 'node:crypto';
import { Injectable, NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { descriptografarConfig, segredosDeIntegracao } from '../admin/segredo.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChamadosService } from './chamados.service.js';

export type EntradaEmail = { de: string; assunto: string; texto: string };

const PRIORIDADES = new Set(['CRITICA', 'ALTA', 'MEDIA', 'BAIXA']);

const iguais = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Abre chamados (ou comenta em um existente) a partir de e-mails recebidos. Quem lê a caixa de entrada
 * (um gateway de e-mail, Power Automate, Zapier...) chama POST /entrada/email com o token da integração
 * do tipo EMAIL_ENTRADA. O remetente precisa ser um usuário ativo do cliente dono da integração.
 */
@Injectable()
export class EntradaEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly chamados: ChamadosService,
  ) {}

  private segredos() {
    return segredosDeIntegracao({
      INTEGRACOES_SECRET: this.config.get<string>('INTEGRACOES_SECRET'),
      JWT_SECRET: this.config.get<string>('JWT_SECRET'),
    });
  }

  /** Integração ativa cujo token confere. A comparação é em tempo constante. */
  private async autenticar(token: string | undefined) {
    if (!token || token.length < 16) throw new UnauthorizedException('Token inválido');
    const integracoes = await this.prisma.integracoes.findMany({ where: { tipo: 'EMAIL_ENTRADA', status: 'ATIVO' } });
    let achada: { integracao: (typeof integracoes)[number]; cfg: Record<string, unknown> } | undefined;
    for (const integracao of integracoes) {
      const cfg = descriptografarConfig((integracao.configuracoes ?? {}) as Record<string, unknown>, this.segredos());
      if (typeof cfg.token === 'string' && iguais(cfg.token, token)) achada = { integracao, cfg };
    }
    if (!achada) throw new UnauthorizedException('Token inválido');
    return achada;
  }

  async receber(token: string | undefined, entrada: EntradaEmail) {
    const { integracao, cfg } = await this.autenticar(token);
    const idCliente = integracao.id_cliente;
    const remetente = await this.prisma.usuarios.findFirst({
      where: { id_cliente: idCliente, email: entrada.de.trim().toLowerCase(), status: 'ATIVO' },
    });
    if (!remetente) throw new NotFoundException('Remetente não cadastrado neste cliente');
    const usuario: AuthUser = {
      id: remetente.id,
      id_cliente: idCliente,
      email: remetente.email,
      nome: remetente.nome,
      perfil: remetente.perfil as AuthUser['perfil'],
      cargo: remetente.cargo,
      status: remetente.status,
    };

    const assunto = entrada.assunto.trim() || '(sem assunto)';
    const texto = entrada.texto.trim() || assunto;

    // "Re: [#123] ..." ou "#123": é uma resposta a um chamado que já existe.
    const referencia = /#(\d{1,9})\b/.exec(assunto);
    if (referencia) {
      const id = Number(referencia[1]);
      const existente = await this.prisma.chamados.findFirst({ where: { id, id_cliente: idCliente } });
      if (existente && (usuario.perfil !== 'SOLICITANTE' || existente.id_solicitante === usuario.id)) {
        const comentario = await this.chamados.comentar(usuario, id, { mensagem: texto.slice(0, 5000) });
        return { acao: 'COMENTARIO', id_chamado: id, id_comentario: comentario.id };
      }
    }

    const idCategoria = Number(cfg.id_categoria);
    if (!Number.isInteger(idCategoria)) throw new UnprocessableEntityException('A integração não tem categoria padrão configurada');
    const prioridade = PRIORIDADES.has(String(cfg.prioridade)) ? String(cfg.prioridade) : 'MEDIA';
    const tipo = cfg.tipo === 'REQUISICAO' ? 'REQUISICAO' : 'INCIDENTE';
    const criado = await this.chamados.abrir(usuario, {
      titulo: assunto.slice(0, 255),
      descricao: texto.slice(0, 10000),
      id_categoria: idCategoria,
      tipo,
      origem: 'EMAIL',
      prioridade: prioridade as 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA',
    });
    return { acao: 'CHAMADO', id_chamado: criado.id };
  }
}
