import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { cifrarTexto, decifrarTexto, segredosDeIntegracao } from '../admin/segredo.js';
import { AuditService } from '../audit/audit.service.js';
import { LimitadorService } from '../common/limitador.service.js';
import { EmailService } from '../integracoes/email.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import type { AuthUser, JwtPayload, PerfilUsuario } from './auth.types.js';
import { exigirSenhaForte } from './senha.js';
import { type Contexto, SessoesService } from './sessoes.service.js';
import { gerarSegredo, urlOtpauth, verificarCodigo } from './totp.js';

const BCRYPT_DUMMY =
  '$2b$10$2bFbWHtMwmUBC7P/u5VmrOoDag7CgAGO6wlPnZHaWQ477F/QlBuOa';

const JWT_ISSUER = 'glpi-back';
const JWT_AUDIENCE = 'itsm-portal';
const RECUPERACAO_VALIDADE_MS = 3600_000;
const CODIGOS_RECUPERACAO = 8;

const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');

/** Código de recuperação no formato `abcd-efgh`: o hash é de `abcdefgh`, então hífen e caixa não importam. */
const normalizarCodigo = (codigo: string) => codigo.replace(/[^a-z0-9]/gi, '').toLowerCase();

type UsuarioComCliente = NonNullable<Awaited<ReturnType<AuthService['carregarUsuario']>>>;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly expiresIn: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly sessoes: SessoesService,
    private readonly limitador: LimitadorService,
    private readonly email: EmailService,
  ) {
    // O token de acesso é curto; quem mantém a pessoa conectada é o refresh token (cookie httpOnly).
    this.expiresIn = this.config.get<string>('JWT_EXPIRES_IN') ?? '15m';
    const secret = this.config.get<string>('JWT_SECRET') ?? '';
    if (secret.length < 32) {
      this.logger.warn(
        'JWT_SECRET tem menos de 32 caracteres. Defina um segredo forte em produção.',
      );
    }
  }

  /* ------------------------------------------------------------------ login */

  async login(dto: LoginDto, ctx: Contexto) {
    const email = dto.email.trim().toLowerCase();
    const mensagemLimite = 'Muitas tentativas de login. Aguarde um minuto.';
    // Só as tentativas que erram contam: muitos usuários atrás do mesmo IP (rede da empresa) entrando
    // de manhã não se bloqueiam, mas quem chuta senhas é barrado por IP e por e-mail.
    const chaveIp = `login:ip:${ctx.ip ?? 'desconhecido'}`;
    const chaveEmail = `login:email:${email}`;
    this.limitador.checar(chaveIp, 30, mensagemLimite);
    this.limitador.checar(chaveEmail, 15, mensagemLimite);
    const falhou = () => {
      this.limitador.falhar(chaveIp, 60_000);
      this.limitador.falhar(chaveEmail, 60_000);
    };

    const candidatos = await this.prisma.usuarios.findMany({
      where: {
        email,
        ...(dto.id_cliente !== undefined ? { id_cliente: dto.id_cliente } : {}),
      },
      include: { clientes: true },
      take: 10,
    });

    const ativo = (c: (typeof candidatos)[number]) => c.status === 'ATIVO' && c.clientes.status === 'ATIVO';
    let usuario: (typeof candidatos)[number] | undefined;

    if (dto.id_cliente === undefined && candidatos.length > 1) {
      // O e-mail existe em mais de um cliente. A senha é conferida em cada um e só os clientes
      // em que ela confere são revelados, então não há como descobrir clientes sem saber a senha.
      const aceitos: typeof candidatos = [];
      for (const candidato of candidatos) {
        if (ativo(candidato) && (await this.verificarSenha(dto.password, candidato.senha_hash))) {
          aceitos.push(candidato);
        }
      }
      if (aceitos.length === 0) {
        falhou();
        throw new UnauthorizedException('Credenciais inválidas');
      }
      if (aceitos.length > 1) {
        throw new ConflictException({
          statusCode: 409,
          message: 'Este e-mail pertence a mais de um cliente. Informe o cliente.',
          clientes: aceitos.map(({ clientes }) => ({ id: clientes.id, nome: clientes.nome_fantasia })),
        });
      }
      usuario = aceitos[0];
    } else {
      usuario = candidatos[0];
      const senhaOk = await this.verificarSenha(dto.password, usuario?.senha_hash ?? BCRYPT_DUMMY);
      if (!usuario || !senhaOk || !ativo(usuario)) {
        falhou();
        await this.registrarFalha(usuario, senhaOk ? 'conta inativa' : 'senha incorreta', ctx);
        throw new UnauthorizedException('Credenciais inválidas');
      }
    }

    if (!usuario) throw new UnauthorizedException('Credenciais inválidas');
    if (usuario.mfa_ativo) {
      try {
        await this.exigirSegundoFator(usuario, dto.codigo_mfa, ctx);
      } catch (erro) {
        // Pedir o código (primeira etapa) não é falha; digitar um código errado é.
        if (dto.codigo_mfa) falhou();
        throw erro;
      }
    }

    const perfil = this.assertPerfil(usuario.perfil);
    const sessao = await this.sessoes.criar(usuario.id_cliente, usuario.id, ctx);
    await this.prisma.usuarios.update({
      where: { id_cliente_id: { id_cliente: usuario.id_cliente, id: usuario.id } },
      data: { ultimo_login: new Date() },
    });
    await this.registrar(usuario.id_cliente, usuario.id, 'LOGIN', { sessao: sessao.id, mfa: usuario.mfa_ativo });
    this.limitador.limpar(chaveEmail);

    const access_token = await this.emitirAcesso(usuario, perfil, sessao.id);
    const user = this.toAuthUser(usuario, perfil, sessao.id);
    return {
      access_token,
      refresh_token: sessao.token,
      token_type: 'Bearer' as const,
      expires_in: this.expiresInToSeconds(this.expiresIn),
      user: { ...this.toMe(user, usuario.clientes), mfa_ativo: usuario.mfa_ativo },
    };
  }

  private async exigirSegundoFator(usuario: UsuarioComCliente, codigo: string | undefined, ctx: Contexto) {
    if (!codigo) {
      throw new UnauthorizedException({ statusCode: 401, message: 'Informe o código de verificação em duas etapas', mfa_obrigatorio: true });
    }
    this.limitador.exigir(`mfa:${usuario.id_cliente}:${usuario.id}`, 6, 5 * 60_000, 'Muitas tentativas de código. Aguarde alguns minutos.');
    if (!(await this.conferirSegundoFator(usuario, codigo))) {
      await this.registrarFalha(usuario, 'código de verificação inválido', ctx);
      throw new UnauthorizedException({ statusCode: 401, message: 'Código de verificação inválido', mfa_obrigatorio: true });
    }
  }

  /** Aceita o código do aplicativo (uso único por passo de 30 s) ou um código de recuperação (uso único). */
  private async conferirSegundoFator(usuario: { id: number; id_cliente: number; mfa_segredo: string | null; mfa_ultimo_passo: bigint | null; mfa_codigos_hash: string[] }, codigo: string) {
    const where = { id_cliente: usuario.id_cliente, id: usuario.id };
    if (usuario.mfa_segredo && /^\d{3}\s?\d{3}$/.test(codigo.trim())) {
      const segredo = decifrarTexto(usuario.mfa_segredo, this.segredos());
      const passo = verificarCodigo(segredo, codigo, usuario.mfa_ultimo_passo);
      if (passo === null) return false;
      // Gravar o passo só se ainda for maior que o último: duas requisições com o mesmo código não passam juntas.
      const gravado = await this.prisma.usuarios.updateMany({
        where: { ...where, OR: [{ mfa_ultimo_passo: null }, { mfa_ultimo_passo: { lt: BigInt(passo) } }] },
        data: { mfa_ultimo_passo: BigInt(passo) },
      });
      return gravado.count === 1;
    }
    const hash = sha256(normalizarCodigo(codigo));
    if (!usuario.mfa_codigos_hash.includes(hash)) return false;
    const consumido = await this.prisma.usuarios.updateMany({
      where: { ...where, mfa_codigos_hash: { has: hash } },
      data: { mfa_codigos_hash: usuario.mfa_codigos_hash.filter((h) => h !== hash) },
    });
    return consumido.count === 1;
  }

  /* ---------------------------------------------------------------- sessões */

  async validatePayload(payload: JwtPayload): Promise<AuthUser> {
    if (!payload?.sub || !payload.id_cliente || !payload.sid) {
      throw new UnauthorizedException();
    }

    const usuario = await this.carregarUsuario(payload.id_cliente, payload.sub);

    if (
      !usuario ||
      usuario.status !== 'ATIVO' ||
      usuario.clientes.status !== 'ATIVO'
    ) {
      throw new UnauthorizedException();
    }

    if (usuario.email.toLowerCase() !== payload.email.toLowerCase()) {
      throw new UnauthorizedException();
    }
    // Troca de senha, "sair de todos os dispositivos" e redefinição somam 1: tokens antigos caem na hora.
    if (usuario.token_versao !== (payload.tv ?? 0)) {
      throw new UnauthorizedException();
    }
    if (!(await this.sessoes.ativa(payload.sid, usuario.id_cliente, usuario.id))) {
      throw new UnauthorizedException();
    }

    return this.toAuthUser(usuario, this.assertPerfil(usuario.perfil), payload.sid);
  }

  carregarUsuario(idCliente: number, id: number) {
    return this.prisma.usuarios.findUnique({
      where: { id_cliente_id: { id_cliente: idCliente, id } },
      include: { clientes: true },
    });
  }

  /** Troca o refresh token (cookie) por um novo par de tokens. */
  async refresh(refreshToken: string, ctx: Contexto) {
    this.limitador.exigir(`refresh:ip:${ctx.ip ?? 'desconhecido'}`, 120, 60_000);
    const { sessao, token } = await this.sessoes.rotacionar(refreshToken, ctx);
    const usuario = await this.carregarUsuario(sessao.id_cliente, sessao.id_usuario);
    if (!usuario || usuario.status !== 'ATIVO' || usuario.clientes.status !== 'ATIVO') {
      await this.sessoes.revogar(sessao.id, sessao.id_cliente, sessao.id_usuario);
      throw new UnauthorizedException('Sessão inválida');
    }
    const perfil = this.assertPerfil(usuario.perfil);
    const user = this.toAuthUser(usuario, perfil, sessao.id);
    return {
      access_token: await this.emitirAcesso(usuario, perfil, sessao.id),
      refresh_token: token,
      token_type: 'Bearer' as const,
      expires_in: this.expiresInToSeconds(this.expiresIn),
      user: { ...this.toMe(user, usuario.clientes), mfa_ativo: usuario.mfa_ativo },
    };
  }

  /** Encerra a sessão do refresh token informado (funciona mesmo com o token de acesso já vencido). */
  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return { encerrada: false };
    const sessao = await this.prisma.sessoes.findUnique({ where: { token_hash: sha256(refreshToken) } });
    if (!sessao) return { encerrada: false };
    await this.sessoes.revogar(sessao.id, sessao.id_cliente, sessao.id_usuario);
    await this.registrar(sessao.id_cliente, sessao.id_usuario, 'LOGOUT', { sessao: sessao.id });
    return { encerrada: true };
  }

  async logoutTodos(user: AuthUser) {
    await this.prisma.usuarios.update({
      where: { id_cliente_id: { id_cliente: user.id_cliente, id: user.id } },
      data: { token_versao: { increment: 1 } },
    });
    await this.sessoes.revogarTodas(user.id_cliente, user.id);
    await this.registrar(user.id_cliente, user.id, 'LOGOUT_TODOS', {});
    return { encerradas: true };
  }

  async listarSessoes(user: AuthUser) {
    const lista = await this.sessoes.listar(user.id_cliente, user.id);
    return lista.map((s) => ({ ...s, atual: s.id === user.sid }));
  }

  async revogarSessao(user: AuthUser, id: string) {
    const r = await this.sessoes.revogar(id, user.id_cliente, user.id);
    if (r.count === 0) throw new NotFoundException('Sessão não encontrada');
    await this.registrar(user.id_cliente, user.id, 'SESSION_REVOKE', { sessao: id });
    return { revogada: true };
  }

  async me(user: AuthUser) {
    const cliente = await this.prisma.clientes.findUnique({
      where: { id: user.id_cliente },
    });
    if (!cliente) {
      throw new ForbiddenException('Tenant indisponível');
    }
    const dados = await this.prisma.usuarios.findUnique({
      where: { id_cliente_id: { id_cliente: user.id_cliente, id: user.id } },
      select: { mfa_ativo: true },
    });
    return { ...this.toMe(user, cliente), mfa_ativo: dados?.mfa_ativo ?? false };
  }

  /* ------------------------------------------------------------------ senha */

  /** Troca a senha do próprio usuário. Encerra as outras sessões e mantém esta, com tokens novos. */
  async trocarSenha(user: AuthUser, senhaAtual: string, novaSenha: string, ctx: Contexto) {
    this.limitador.exigir(`senha:${user.id_cliente}:${user.id}`, 8, 10 * 60_000, 'Muitas tentativas. Aguarde alguns minutos.');
    const usuario = await this.carregarUsuario(user.id_cliente, user.id);
    if (!usuario || !(await this.verificarSenha(senhaAtual, usuario.senha_hash))) {
      throw new ForbiddenException('Senha atual incorreta');
    }
    exigirSenhaForte(novaSenha);
    if (novaSenha === senhaAtual) throw new BadRequestException('A nova senha deve ser diferente da atual');

    const atualizado = await this.prisma.usuarios.update({
      where: { id_cliente_id: { id_cliente: user.id_cliente, id: user.id } },
      data: { senha_hash: await bcrypt.hash(novaSenha, 12), senha_alterada_em: new Date(), token_versao: { increment: 1 } },
      include: { clientes: true },
    });
    await this.sessoes.revogarTodas(user.id_cliente, user.id, user.sid);
    await this.registrar(user.id_cliente, user.id, 'PASSWORD_CHANGE', { ip: ctx.ip ?? null });
    const perfil = this.assertPerfil(atualizado.perfil);
    return { access_token: await this.emitirAcesso(atualizado, perfil, user.sid ?? ''), expires_in: this.expiresInToSeconds(this.expiresIn) };
  }

  /**
   * Envia o link de redefinição por e-mail. A resposta é sempre a mesma, exista ou não a conta, para não
   * revelar quais e-mails estão cadastrados.
   */
  async esqueciSenha(emailInformado: string, idCliente: number | undefined, ctx: Contexto) {
    const email = emailInformado.trim().toLowerCase();
    this.limitador.exigir(`esqueci:ip:${ctx.ip ?? 'desconhecido'}`, 10, 15 * 60_000);
    this.limitador.exigir(`esqueci:email:${email}`, 3, 3600_000);
    const resposta = { mensagem: 'Se o e-mail estiver cadastrado, enviamos as instruções para redefinir a senha.' };

    const usuarios = await this.prisma.usuarios.findMany({
      where: { email, status: 'ATIVO', clientes: { status: 'ATIVO' }, ...(idCliente !== undefined ? { id_cliente: idCliente } : {}) },
      include: { clientes: true },
      take: 5,
    });
    const base = (this.config.get<string>('APP_URL') ?? '').replace(/\/+$/, '');
    for (const usuario of usuarios) {
      const token = randomBytes(32).toString('base64url');
      await this.prisma.tokens_recuperacao.updateMany({
        where: { id_cliente: usuario.id_cliente, id_usuario: usuario.id, usado_em: null },
        data: { usado_em: new Date() },
      });
      await this.prisma.tokens_recuperacao.create({
        data: {
          id_cliente: usuario.id_cliente,
          id_usuario: usuario.id,
          token_hash: sha256(token),
          expira_em: new Date(Date.now() + RECUPERACAO_VALIDADE_MS),
        },
      });
      await this.registrar(usuario.id_cliente, usuario.id, 'PASSWORD_RESET_REQUEST', { ip: ctx.ip ?? null });
      const link = base ? `${base}/redefinir-senha?token=${token}` : undefined;
      const texto =
        `Olá, ${usuario.nome}.\n\nRecebemos um pedido para redefinir a senha da sua conta no portal ITSM (${usuario.clientes.nome_fantasia}).` +
        `\nO link vale por 1 hora e só pode ser usado uma vez.${link ? '' : `\n\nCódigo de redefinição: ${token}`}` +
        '\n\nSe não foi você, ignore este e-mail: a sua senha continua a mesma.';
      this.email
        .enviar(usuario.id_cliente, usuario.email, 'Redefinição de senha', texto, { link, ignorarPreferencia: true })
        .then((r) => {
          if (r.ok && r.enviado === false) this.logger.warn(`Recuperação de senha: o cliente ${usuario.id_cliente} não tem SMTP ativo; e-mail não enviado.`);
        })
        .catch((erro: unknown) => this.logger.warn(`Falha ao enviar recuperação de senha: ${erro instanceof Error ? erro.message : String(erro)}`));
    }
    return resposta;
  }

  async redefinirSenha(token: string, novaSenha: string, ctx: Contexto) {
    this.limitador.exigir(`redefinir:ip:${ctx.ip ?? 'desconhecido'}`, 10, 15 * 60_000);
    exigirSenhaForte(novaSenha);
    const registro = await this.prisma.tokens_recuperacao.findUnique({ where: { token_hash: sha256(token) } });
    if (!registro || registro.usado_em || registro.expira_em <= new Date()) {
      throw new BadRequestException('Link inválido ou expirado. Peça uma nova redefinição.');
    }
    const senha_hash = await bcrypt.hash(novaSenha, 12);
    // Marcar como usado primeiro (condicionado): dois cliques no mesmo link não passam juntos.
    const usado = await this.prisma.tokens_recuperacao.updateMany({
      where: { id_cliente: registro.id_cliente, id: registro.id, usado_em: null },
      data: { usado_em: new Date() },
    });
    if (usado.count === 0) throw new BadRequestException('Link inválido ou expirado. Peça uma nova redefinição.');
    await this.prisma.usuarios.update({
      where: { id_cliente_id: { id_cliente: registro.id_cliente, id: registro.id_usuario } },
      data: { senha_hash, senha_alterada_em: new Date(), token_versao: { increment: 1 } },
    });
    await this.sessoes.revogarTodas(registro.id_cliente, registro.id_usuario);
    await this.registrar(registro.id_cliente, registro.id_usuario, 'PASSWORD_RESET', { ip: ctx.ip ?? null });
    return { redefinida: true };
  }

  /* -------------------------------------------------------------------- MFA */

  /** Gera o segredo e a URL para o aplicativo autenticador. O MFA só passa a valer após `ativarMfa`. */
  async configurarMfa(user: AuthUser) {
    const usuario = await this.carregarUsuario(user.id_cliente, user.id);
    if (!usuario) throw new UnauthorizedException();
    if (usuario.mfa_ativo) throw new ConflictException('A verificação em duas etapas já está ativa');
    const segredo = gerarSegredo();
    await this.prisma.usuarios.update({
      where: { id_cliente_id: { id_cliente: user.id_cliente, id: user.id } },
      data: { mfa_segredo: cifrarTexto(segredo, this.segredos()[0] ?? 'itsm-local') },
    });
    return { segredo, otpauth_url: urlOtpauth(segredo, usuario.email, usuario.clientes.nome_fantasia || 'Portal ITSM') };
  }

  async ativarMfa(user: AuthUser, codigo: string) {
    const usuario = await this.carregarUsuario(user.id_cliente, user.id);
    if (!usuario?.mfa_segredo) throw new BadRequestException('Gere o segredo antes de ativar');
    if (usuario.mfa_ativo) throw new ConflictException('A verificação em duas etapas já está ativa');
    this.limitador.exigir(`mfa-ativar:${user.id_cliente}:${user.id}`, 8, 10 * 60_000);
    const passo = verificarCodigo(decifrarTexto(usuario.mfa_segredo, this.segredos()), codigo);
    if (passo === null) throw new BadRequestException('Código inválido. Confira o horário do celular e tente de novo.');
    const codigos = Array.from({ length: CODIGOS_RECUPERACAO }, () => {
      const bruto = randomBytes(5).toString('hex');
      return `${bruto.slice(0, 5)}-${bruto.slice(5)}`;
    });
    await this.prisma.usuarios.update({
      where: { id_cliente_id: { id_cliente: user.id_cliente, id: user.id } },
      data: { mfa_ativo: true, mfa_ultimo_passo: BigInt(passo), mfa_codigos_hash: codigos.map((c) => sha256(normalizarCodigo(c))) },
    });
    await this.registrar(user.id_cliente, user.id, 'MFA_ENABLE', {});
    return { codigos_recuperacao: codigos };
  }

  async desativarMfa(user: AuthUser, senha: string, codigo: string) {
    const usuario = await this.carregarUsuario(user.id_cliente, user.id);
    if (!usuario) throw new UnauthorizedException();
    if (!usuario.mfa_ativo) throw new BadRequestException('A verificação em duas etapas não está ativa');
    this.limitador.exigir(`mfa-desativar:${user.id_cliente}:${user.id}`, 6, 10 * 60_000);
    if (!(await this.verificarSenha(senha, usuario.senha_hash))) throw new ForbiddenException('Senha incorreta');
    if (!(await this.conferirSegundoFator(usuario, codigo))) throw new BadRequestException('Código inválido');
    await this.limparMfa(user.id_cliente, user.id);
    await this.registrar(user.id_cliente, user.id, 'MFA_DISABLE', {});
    return { desativada: true };
  }

  /** Usado pelo administrador para destravar quem perdeu o aparelho e os códigos de recuperação. */
  limparMfa(idCliente: number, id: number) {
    return this.prisma.usuarios.update({
      where: { id_cliente_id: { id_cliente: idCliente, id } },
      data: { mfa_ativo: false, mfa_segredo: null, mfa_ultimo_passo: null, mfa_codigos_hash: [], token_versao: { increment: 1 } },
    });
  }

  /* -------------------------------------------------------------- utilitários */

  private segredos() {
    return segredosDeIntegracao({
      INTEGRACOES_SECRET: this.config.get<string>('INTEGRACOES_SECRET'),
      JWT_SECRET: this.config.get<string>('JWT_SECRET'),
    });
  }

  private emitirAcesso(usuario: { id: number; id_cliente: number; email: string; token_versao: number }, perfil: PerfilUsuario, sid: string) {
    const payload: JwtPayload = {
      sub: usuario.id,
      id_cliente: usuario.id_cliente,
      perfil,
      email: usuario.email,
      tv: usuario.token_versao,
      sid,
    };
    return this.jwt.signAsync(payload, {
      expiresIn: this.expiresIn as `${number}h`,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  }

  /** Falha de login com usuário identificado entra na auditoria; sem usuário não há a quem atribuir. */
  private async registrarFalha(usuario: { id: number; id_cliente: number } | undefined, motivo: string, ctx: Contexto) {
    if (!usuario) return;
    await this.registrar(usuario.id_cliente, usuario.id, 'LOGIN_FALHA', { motivo, ip: ctx.ip ?? null });
  }

  /** Auditoria de eventos de segurança. Nunca derruba a operação principal. */
  private async registrar(idCliente: number, idUsuario: number, acao: string, dados: Record<string, string | number | boolean | null>) {
    try {
      await this.audit.record(this.prisma, {
        id_cliente: idCliente,
        id_usuario: idUsuario,
        acao,
        tabela_afetada: 'usuarios',
        registro_id: idUsuario,
        valor_anterior: null,
        valor_novo: dados,
      });
    } catch (erro) {
      this.logger.warn(`Auditoria de ${acao} não gravada: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  private async verificarSenha(plain: string, stored: string) {
    if (/^\$2[aby]\$/.test(stored)) {
      return bcrypt.compare(plain, stored);
    }
    await bcrypt.compare(plain, BCRYPT_DUMMY);
    return false;
  }

  private assertPerfil(perfil: string): PerfilUsuario {
    const allowed: PerfilUsuario[] = [
      'ADMIN',
      'GESTOR',
      'TECNICO',
      'SOLICITANTE',
    ];
    if (!allowed.includes(perfil as PerfilUsuario)) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    return perfil as PerfilUsuario;
  }

  private toAuthUser(
    usuario: {
      id: number;
      id_cliente: number;
      email: string;
      nome: string;
      perfil: string;
      cargo: string;
      status: string;
    },
    perfil: PerfilUsuario,
    sid?: string,
  ): AuthUser {
    return {
      id: usuario.id,
      id_cliente: usuario.id_cliente,
      email: usuario.email,
      nome: usuario.nome,
      perfil,
      cargo: usuario.cargo,
      status: usuario.status,
      sid,
    };
  }

  private toMe(
    user: AuthUser,
    cliente: {
      id: number;
      razao_social: string;
      nome_fantasia: string;
      status: string;
    },
  ) {
    const { sid: _sid, ...publico } = user;
    return {
      ...publico,
      tenant: {
        id: cliente.id,
        razao_social: cliente.razao_social,
        nome_fantasia: cliente.nome_fantasia,
        status: cliente.status,
      },
    };
  }

  private expiresInToSeconds(value: string): number {
    const match = /^(\d+)([smhd])$/.exec(value.trim());
    if (!match) {
      return 15 * 60;
    }
    const n = Number(match[1]);
    const unit = match[2];
    const map = { s: 1, m: 60, h: 3600, d: 86400 } as const;
    return n * map[unit as keyof typeof map];
  }
}

export { JWT_AUDIENCE, JWT_ISSUER };
