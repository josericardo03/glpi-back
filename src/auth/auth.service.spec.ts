import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { AuthService } from './auth.service.js';
import { SessoesService } from './sessoes.service.js';
import { AuditService } from '../audit/audit.service.js';
import { LimitadorService } from '../common/limitador.service.js';
import { EmailService } from '../integracoes/email.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { cifrarTexto } from '../admin/segredo.js';
import { codigoDoPasso, gerarSegredo, passoAtual } from './totp.js';

const CHAVE = 'x'.repeat(32);

describe('AuthService', () => {
  const prisma = {
    usuarios: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    clientes: { findUnique: vi.fn() },
    sessoes: { findUnique: vi.fn() },
    tokens_recuperacao: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  };
  const jwt = { signAsync: vi.fn().mockResolvedValue('jwt-token') };
  const audit = { record: vi.fn() };
  const sessoes = {
    criar: vi.fn(),
    revogar: vi.fn(),
    revogarTodas: vi.fn(),
    rotacionar: vi.fn(),
    ativa: vi.fn(),
  };
  const email = { enviar: vi.fn().mockResolvedValue({ ok: true, enviado: false }) };
  const ctx = { ip: '203.0.113.5', agente: 'vitest' };

  let service: AuthService;

  beforeEach(async () => {
    vi.clearAllMocks();
    sessoes.criar.mockResolvedValue({ id: 'sessao-1', token: 'refresh-1' });
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        LimitadorService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: AuditService, useValue: audit },
        { provide: SessoesService, useValue: sessoes },
        { provide: EmailService, useValue: email },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'JWT_EXPIRES_IN' ? '15m' : key === 'JWT_SECRET' ? CHAVE : undefined),
            getOrThrow: () => CHAVE,
          },
        },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  const linha = async (idCliente: number, senha: string, extra: Record<string, unknown> = {}) => ({
    id: idCliente * 10,
    id_cliente: idCliente,
    email: 'a@b.com',
    nome: 'Ana',
    cargo: 'Analista',
    perfil: 'SOLICITANTE',
    status: 'ATIVO',
    senha_hash: await bcrypt.hash(senha, 4),
    token_versao: 0,
    mfa_ativo: false,
    mfa_segredo: null,
    mfa_ultimo_passo: null,
    mfa_codigos_hash: [] as string[],
    clientes: { id: idCliente, razao_social: `R${idCliente}`, nome_fantasia: `Cliente ${idCliente}`, status: 'ATIVO' },
    ...extra,
  });

  it('rejeita credenciais inexistentes sem revelar o motivo', async () => {
    prisma.usuarios.findMany.mockResolvedValue([]);
    await expect(service.login({ email: 'a@b.com', password: 'senha12345' }, ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('exige id_cliente quando o e-mail existe em mais de um tenant', async () => {
    prisma.usuarios.findMany.mockResolvedValue([{ senha_hash: '$2b$10$abcdefghijklmnopqrstuv' }, { senha_hash: '$2b$10$abcdefghijklmnopqrstuv' }]);
    await expect(service.login({ email: 'a@b.com', password: 'senha12345' }, ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('e-mail em mais de um cliente', () => {
    it('entra direto quando a senha confere em um só cliente', async () => {
      prisma.usuarios.findMany.mockResolvedValue([await linha(1, 'senha12345'), await linha(2, 'outra-senha')]);
      prisma.usuarios.update.mockResolvedValue({});
      const r = await service.login({ email: 'a@b.com', password: 'senha12345' }, ctx);
      expect(r.user.id_cliente).toBe(1);
    });

    it('devolve 409 com os clientes cuja senha confere, para o usuário escolher', async () => {
      prisma.usuarios.findMany.mockResolvedValue([await linha(1, 'senha12345'), await linha(2, 'senha12345')]);
      const erro = await service.login({ email: 'a@b.com', password: 'senha12345' }, ctx).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ConflictException);
      expect((erro as ConflictException).getResponse()).toMatchObject({
        clientes: [{ id: 1, nome: 'Cliente 1' }, { id: 2, nome: 'Cliente 2' }],
      });
    });

    it('não revela os clientes quando a senha está errada', async () => {
      prisma.usuarios.findMany.mockResolvedValue([await linha(1, 'senha12345'), await linha(2, 'senha12345')]);
      await expect(service.login({ email: 'a@b.com', password: 'errada-errada' }, ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('sessão e auditoria no login', () => {
    it('cria a sessão, emite o token com versão e sessão e audita o LOGIN', async () => {
      prisma.usuarios.findMany.mockResolvedValue([await linha(1, 'senha12345')]);
      prisma.usuarios.update.mockResolvedValue({});
      const r = await service.login({ email: 'a@b.com', password: 'senha12345' }, ctx);
      expect(r.refresh_token).toBe('refresh-1');
      expect(r.expires_in).toBe(900);
      expect(jwt.signAsync.mock.calls[0]![0]).toMatchObject({ sub: 10, tv: 0, sid: 'sessao-1' });
      expect(audit.record.mock.calls.map((c) => c[1].acao)).toContain('LOGIN');
    });

    it('senha errada de usuário existente audita LOGIN_FALHA com o IP', async () => {
      prisma.usuarios.findMany.mockResolvedValue([await linha(1, 'senha12345')]);
      await expect(service.login({ email: 'a@b.com', password: 'errada-errada' }, ctx)).rejects.toBeInstanceOf(UnauthorizedException);
      const falha = audit.record.mock.calls.find((c) => c[1].acao === 'LOGIN_FALHA');
      expect(falha?.[1]).toMatchObject({ id_usuario: 10, valor_novo: { motivo: 'senha incorreta', ip: '203.0.113.5' } });
    });

    it('limita tentativas por e-mail', async () => {
      prisma.usuarios.findMany.mockResolvedValue([]);
      for (let i = 0; i < 15; i += 1) {
        await service.login({ email: 'forca@bruta.com', password: 'senha12345' }, { ip: `10.0.0.${i}` }).catch(() => undefined);
      }
      await expect(service.login({ email: 'forca@bruta.com', password: 'senha12345' }, { ip: '10.9.9.9' })).rejects.toMatchObject({ status: 429 });
    });
  });

  describe('verificação em duas etapas', () => {
    const segredo = gerarSegredo();
    const comMfa = async (extra: Record<string, unknown> = {}) =>
      linha(1, 'senha12345', { mfa_ativo: true, mfa_segredo: cifrarTexto(segredo, CHAVE), ...extra });

    it('senha correta sem código pede o segundo fator (e não cria sessão)', async () => {
      prisma.usuarios.findMany.mockResolvedValue([await comMfa()]);
      const erro = await service.login({ email: 'a@b.com', password: 'senha12345' }, ctx).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(UnauthorizedException);
      expect((erro as UnauthorizedException).getResponse()).toMatchObject({ mfa_obrigatorio: true });
      expect(sessoes.criar).not.toHaveBeenCalled();
    });

    it('senha errada não chega a pedir o código (não revela que há MFA)', async () => {
      prisma.usuarios.findMany.mockResolvedValue([await comMfa()]);
      const erro = await service.login({ email: 'a@b.com', password: 'errada-errada' }, ctx).catch((e: unknown) => e);
      expect((erro as UnauthorizedException).getResponse()).not.toMatchObject({ mfa_obrigatorio: true });
    });

    it('aceita o código do aplicativo e grava o passo usado', async () => {
      prisma.usuarios.findMany.mockResolvedValue([await comMfa()]);
      prisma.usuarios.updateMany.mockResolvedValue({ count: 1 });
      prisma.usuarios.update.mockResolvedValue({});
      const codigo = codigoDoPasso(segredo, passoAtual());
      const r = await service.login({ email: 'a@b.com', password: 'senha12345', codigo_mfa: codigo }, ctx);
      expect(r.access_token).toBe('jwt-token');
      expect(prisma.usuarios.updateMany).toHaveBeenCalled();
    });

    it('o mesmo código usado duas vezes é recusado', async () => {
      prisma.usuarios.findMany.mockResolvedValue([await comMfa()]);
      prisma.usuarios.updateMany.mockResolvedValue({ count: 0 });
      const codigo = codigoDoPasso(segredo, passoAtual());
      await expect(service.login({ email: 'a@b.com', password: 'senha12345', codigo_mfa: codigo }, ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('código errado é recusado e auditado', async () => {
      prisma.usuarios.findMany.mockResolvedValue([await comMfa()]);
      await expect(service.login({ email: 'a@b.com', password: 'senha12345', codigo_mfa: '000000' }, ctx)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(audit.record.mock.calls.some((c) => c[1].acao === 'LOGIN_FALHA')).toBe(true);
    });

    it('código de recuperação vale uma vez', async () => {
      const { createHash } = await import('node:crypto');
      const hash = createHash('sha256').update('abcde12345').digest('hex');
      prisma.usuarios.findMany.mockResolvedValue([await comMfa({ mfa_codigos_hash: [hash] })]);
      prisma.usuarios.updateMany.mockResolvedValue({ count: 1 });
      prisma.usuarios.update.mockResolvedValue({});
      const r = await service.login({ email: 'a@b.com', password: 'senha12345', codigo_mfa: 'ABCDE-12345' }, ctx);
      expect(r.access_token).toBe('jwt-token');
      expect(prisma.usuarios.updateMany.mock.calls[0]![0].data.mfa_codigos_hash).toEqual([]);
    });
  });

  describe('validatePayload', () => {
    const payload = { sub: 10, id_cliente: 1, perfil: 'SOLICITANTE' as const, email: 'a@b.com', tv: 0, sid: 'sessao-1' };

    it('aceita token com versão e sessão em dia', async () => {
      prisma.usuarios.findUnique.mockResolvedValue(await linha(1, 'x'));
      sessoes.ativa.mockResolvedValue(true);
      await expect(service.validatePayload(payload)).resolves.toMatchObject({ id: 10, sid: 'sessao-1' });
    });

    it('recusa token de versão antiga (senha trocada, sair de tudo)', async () => {
      prisma.usuarios.findUnique.mockResolvedValue(await linha(1, 'x', { token_versao: 3 }));
      sessoes.ativa.mockResolvedValue(true);
      await expect(service.validatePayload(payload)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('recusa token de sessão revogada', async () => {
      prisma.usuarios.findUnique.mockResolvedValue(await linha(1, 'x'));
      sessoes.ativa.mockResolvedValue(false);
      await expect(service.validatePayload(payload)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('recusa token sem sessão (formato antigo)', async () => {
      await expect(service.validatePayload({ ...payload, sid: '' })).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('recusa usuário desativado', async () => {
      prisma.usuarios.findUnique.mockResolvedValue(await linha(1, 'x', { status: 'DESATIVADO' }));
      await expect(service.validatePayload(payload)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('troca de senha', () => {
    const user = { id: 10, id_cliente: 1, email: 'a@b.com', nome: 'Ana', perfil: 'SOLICITANTE' as const, cargo: 'x', status: 'ATIVO', sid: 'sessao-1' };

    it('com a senha atual errada é 403', async () => {
      prisma.usuarios.findUnique.mockResolvedValue(await linha(1, 'senha12345'));
      await expect(service.trocarSenha(user, 'errada-errada', 'NovaSenha123', ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('recusa senha fraca ou igual à atual', async () => {
      prisma.usuarios.findUnique.mockResolvedValue(await linha(1, 'senha12345'));
      await expect(service.trocarSenha(user, 'senha12345', 'curta1', ctx)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.trocarSenha(user, 'senha12345', 'somente-letras', ctx)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.trocarSenha(user, 'senha12345', 'senha12345', ctx)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('troca, soma a versão do token e encerra as outras sessões', async () => {
      prisma.usuarios.findUnique.mockResolvedValue(await linha(1, 'senha12345'));
      prisma.usuarios.update.mockResolvedValue(await linha(1, 'x', { token_versao: 1 }));
      const r = await service.trocarSenha(user, 'senha12345', 'NovaSenha123', ctx);
      expect(r.access_token).toBe('jwt-token');
      expect(prisma.usuarios.update.mock.calls[0]![0].data.token_versao).toEqual({ increment: 1 });
      expect(sessoes.revogarTodas).toHaveBeenCalledWith(1, 10, 'sessao-1');
      expect(audit.record.mock.calls.map((c) => c[1].acao)).toContain('PASSWORD_CHANGE');
    });
  });

  describe('recuperação de senha', () => {
    it('responde igual quando o e-mail não existe (sem revelar contas)', async () => {
      prisma.usuarios.findMany.mockResolvedValue([]);
      const r = await service.esqueciSenha('ninguem@x.com', undefined, ctx);
      expect(r.mensagem).toMatch(/Se o e-mail estiver cadastrado/);
      expect(email.enviar).not.toHaveBeenCalled();
    });

    it('para conta existente grava o hash do token e envia o e-mail', async () => {
      prisma.usuarios.findMany.mockResolvedValue([await linha(1, 'x')]);
      prisma.tokens_recuperacao.updateMany.mockResolvedValue({ count: 0 });
      prisma.tokens_recuperacao.create.mockResolvedValue({});
      const r = await service.esqueciSenha('a@b.com', undefined, { ip: '198.51.100.9' });
      expect(r.mensagem).toMatch(/Se o e-mail estiver cadastrado/);
      const gravado = prisma.tokens_recuperacao.create.mock.calls[0]![0].data;
      expect(gravado.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(email.enviar).toHaveBeenCalledOnce();
      // o e-mail leva o token, nunca o hash
      expect(email.enviar.mock.calls[0]![3]).not.toContain(gravado.token_hash);
    });

    it('token usado, vencido ou desconhecido é recusado', async () => {
      prisma.tokens_recuperacao.findUnique.mockResolvedValue(null);
      await expect(service.redefinirSenha('t'.repeat(40), 'NovaSenha123', ctx)).rejects.toBeInstanceOf(BadRequestException);
      prisma.tokens_recuperacao.findUnique.mockResolvedValue({ id: 1, id_cliente: 1, id_usuario: 10, usado_em: new Date(), expira_em: new Date(Date.now() + 1000) });
      await expect(service.redefinirSenha('t'.repeat(40), 'NovaSenha123', ctx)).rejects.toBeInstanceOf(BadRequestException);
      prisma.tokens_recuperacao.findUnique.mockResolvedValue({ id: 1, id_cliente: 1, id_usuario: 10, usado_em: null, expira_em: new Date(Date.now() - 1000) });
      await expect(service.redefinirSenha('t'.repeat(40), 'NovaSenha123', ctx)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('token válido redefine a senha, encerra todas as sessões e só vale uma vez', async () => {
      prisma.tokens_recuperacao.findUnique.mockResolvedValue({ id: 1, id_cliente: 1, id_usuario: 10, usado_em: null, expira_em: new Date(Date.now() + 60_000) });
      prisma.tokens_recuperacao.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.usuarios.update.mockResolvedValue({});
      await expect(service.redefinirSenha('t'.repeat(40), 'NovaSenha123', ctx)).resolves.toEqual({ redefinida: true });
      expect(sessoes.revogarTodas).toHaveBeenCalledWith(1, 10);
      prisma.tokens_recuperacao.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.redefinirSenha('t'.repeat(40), 'OutraSenha123', ctx)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
