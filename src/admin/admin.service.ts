import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import net from 'node:net';
import { inicioCuiaba, somarDias } from '../api/chamado-consulta.js';
import type { AuthUser } from '../auth/auth.types.js';
import { exigirSenhaForte } from '../auth/senha.js';
import { AuditService } from '../audit/audit.service.js';
import { EmailService } from '../integracoes/email.service.js';
import { destinoPermitido } from '../integracoes/rede.js';
import { WebhookService } from '../integracoes/webhook.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BrandingAdminDto,
  CreateClienteDto,
  CreateDepartamentoAdminDto,
  CreateFeriadoDto,
  CreateGrupoAdminDto,
  CreateHorarioDto,
  CreateIntegracaoDto,
  CreateIntervaloDto,
  CreatePoliticaDto,
  CreateUsuarioAdminDto,
  FiltroAuditoriaDto,
  UpdateFeriadoDto,
  UpdateHorarioDto,
  UpdateIntegracaoDto,
  UpdatePoliticaDto,
  UpdateUsuarioAdminDto,
} from './dto/admin.dto.js';
import { criptografarConfig, descriptografarConfig, mascararConfig, segredosDeIntegracao } from './segredo.js';

const usuarioPublico = {
  id: true,
  id_cliente: true,
  nome: true,
  email: true,
  cargo: true,
  perfil: true,
  status: true,
  id_departamento: true,
  data_cadastro: true,
} as const;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly webhook: WebhookService,
  ) {}

  async criarCliente(user: AuthUser, dto: CreateClienteDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.clientes.create({
          data: {
            razao_social: dto.razao_social.trim(),
            nome_fantasia: dto.nome_fantasia.trim(),
            cnpj: dto.cnpj.trim(),
            status: dto.status ?? 'ATIVO',
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_CLIENT',
          tabela_afetada: 'clientes',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: {
            id: row.id,
            razao_social: row.razao_social,
            nome_fantasia: row.nome_fantasia,
            cnpj: row.cnpj,
            status: row.status,
          },
        });
        return row;
      });
    } catch (error) {
      throw this.traduzir(error, 'CNPJ já cadastrado');
    }
  }

  async criarDepartamento(user: AuthUser, dto: CreateDepartamentoAdminDto) {
    if (dto.id_departamento_pai) await this.exigeDepartamento(user.id_cliente, dto.id_departamento_pai);
    if (dto.id_responsavel) await this.exigeUsuario(user.id_cliente, dto.id_responsavel);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.departamentos.create({
          data: {
            id_cliente: user.id_cliente,
            codigo_sigla: dto.codigo_sigla.trim().toUpperCase(),
            nome: dto.nome.trim(),
            id_departamento_pai: dto.id_departamento_pai,
            id_responsavel: dto.id_responsavel,
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_DEPARTMENT',
          tabela_afetada: 'departamentos',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: { codigo_sigla: row.codigo_sigla, nome: row.nome },
        });
        return row;
      });
    } catch (error) {
      throw this.traduzir(error, 'Sigla já usada neste tenant');
    }
  }

  async criarUsuario(user: AuthUser, dto: CreateUsuarioAdminDto) {
    if (dto.id_departamento) await this.exigeDepartamento(user.id_cliente, dto.id_departamento);
    const senhaHash = await this.normalizarSenha(dto.senha_hash);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.usuarios.create({
          data: {
            id_cliente: user.id_cliente,
            nome: dto.nome.trim(),
            email: dto.email.trim().toLowerCase(),
            senha_hash: senhaHash,
            id_departamento: dto.id_departamento,
            cargo: dto.cargo.trim(),
            perfil: dto.perfil,
            status: dto.status ?? 'ATIVO',
          },
          select: usuarioPublico,
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_USER',
          tabela_afetada: 'usuarios',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: {
            id: row.id,
            nome: row.nome,
            email: row.email,
            cargo: row.cargo,
            perfil: row.perfil,
            status: row.status,
            id_departamento: row.id_departamento,
          },
        });
        return row;
      });
    } catch (error) {
      throw this.traduzir(error, 'E-mail já cadastrado neste tenant');
    }
  }

  async atualizarUsuario(user: AuthUser, id: number, dto: UpdateUsuarioAdminDto) {
    const atual = await this.prisma.usuarios.findFirst({
      where: { id, id_cliente: user.id_cliente },
      select: usuarioPublico,
    });
    if (!atual) throw new NotFoundException('Usuário não encontrado');
    if (id === user.id && ((dto.status && dto.status !== 'ATIVO') || (dto.perfil && dto.perfil !== atual.perfil))) {
      throw new BadRequestException('Você não pode desativar a própria conta nem alterar o próprio perfil');
    }
    if (dto.id_departamento) await this.exigeDepartamento(user.id_cliente, dto.id_departamento);
    const senhaHash = dto.senha_hash ? await this.normalizarSenha(dto.senha_hash) : undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.usuarios.update({
          where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
          data: {
            nome: dto.nome?.trim(),
            email: dto.email?.trim().toLowerCase(),
            cargo: dto.cargo?.trim(),
            perfil: dto.perfil,
            status: dto.status,
            id_departamento: dto.id_departamento,
            // Nova senha ou desativação: sobe a versão e encerra as sessões do usuário na hora.
            ...(senhaHash ? { senha_hash: senhaHash, senha_alterada_em: new Date() } : {}),
            ...(senhaHash || (dto.status && dto.status !== 'ATIVO') ? { token_versao: { increment: 1 } } : {}),
          },
          select: usuarioPublico,
        });
        if (senhaHash || (dto.status && dto.status !== 'ATIVO')) {
          await tx.sessoes.updateMany({ where: { id_cliente: user.id_cliente, id_usuario: id, revogado_em: null }, data: { revogado_em: new Date() } });
        }
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'UPDATE_USER',
          tabela_afetada: 'usuarios',
          registro_id: id,
          valor_anterior: {
            perfil: atual.perfil,
            status: atual.status,
            id_departamento: atual.id_departamento,
            cargo: atual.cargo,
          },
          valor_novo: {
            perfil: row.perfil,
            status: row.status,
            id_departamento: row.id_departamento,
            cargo: row.cargo,
          },
        });
        return row;
      });
    } catch (error) {
      throw this.traduzir(error, 'E-mail já cadastrado neste tenant');
    }
  }

  /** Destrava quem perdeu o aparelho e os códigos de recuperação: desliga o MFA e encerra as sessões dele. */
  async resetarMfa(user: AuthUser, id: number) {
    const atual = await this.prisma.usuarios.findFirst({ where: { id, id_cliente: user.id_cliente }, select: { id: true, mfa_ativo: true } });
    if (!atual) throw new NotFoundException('Usuário não encontrado');
    await this.prisma.$transaction(async (tx) => {
      await tx.usuarios.update({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
        data: { mfa_ativo: false, mfa_segredo: null, mfa_ultimo_passo: null, mfa_codigos_hash: [], token_versao: { increment: 1 } },
      });
      await tx.sessoes.updateMany({ where: { id_cliente: user.id_cliente, id_usuario: id, revogado_em: null }, data: { revogado_em: new Date() } });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'MFA_RESET',
        tabela_afetada: 'usuarios',
        registro_id: id,
        valor_anterior: { mfa_ativo: atual.mfa_ativo },
        valor_novo: { mfa_ativo: false },
      });
    });
    return { resetado: true };
  }

  async criarGrupo(user: AuthUser, dto: CreateGrupoAdminDto) {
    const membros = dto.membros ?? [];
    const ids = membros.map((membro) => membro.id_usuario);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Membro repetido no mesmo grupo');
    }
    for (const idUsuario of ids) await this.exigeUsuario(user.id_cliente, idUsuario);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const grupo = await tx.grupos_suporte.create({
          data: {
            id_cliente: user.id_cliente,
            nome: dto.nome.trim(),
            descricao: dto.descricao?.trim(),
          },
        });
        const gravados = [];
        for (const membro of membros) {
          gravados.push(
            await tx.membros_grupos.create({
              data: {
                id_cliente: user.id_cliente,
                id_grupo: grupo.id,
                id_usuario: membro.id_usuario,
                cargo_especialidade: membro.cargo_especialidade?.trim(),
                carga_trabalho_max: membro.carga_trabalho_max ?? 100,
              },
            }),
          );
        }
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_SUPPORT_GROUP',
          tabela_afetada: 'grupos_suporte',
          registro_id: grupo.id,
          valor_anterior: null,
          valor_novo: {
            nome: grupo.nome,
            membros: gravados.map((item) => ({
              id_usuario: item.id_usuario,
              carga_trabalho_max: item.carga_trabalho_max,
            })),
          },
        });
        return { ...grupo, membros: gravados };
      });
    } catch (error) {
      throw this.traduzir(error, 'Já existe um grupo com esse nome');
    }
  }

  async criarHorario(user: AuthUser, dto: CreateHorarioDto) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.horarios_comerciais.create({
        data: {
          id_cliente: user.id_cliente,
          nome: dto.nome.trim(),
          fuso_horario: dto.fuso_horario?.trim() || 'America/Cuiaba',
          status: dto.status ?? 'ATIVO',
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'CREATE_BUSINESS_HOURS',
        tabela_afetada: 'horarios_comerciais',
        registro_id: row.id,
        valor_anterior: null,
        valor_novo: { nome: row.nome, fuso_horario: row.fuso_horario },
      });
      return row;
    });
  }

  async criarIntervalo(user: AuthUser, idHorario: number, dto: CreateIntervaloDto) {
    const horario = await this.prisma.horarios_comerciais.findFirst({
      where: { id: idHorario, id_cliente: user.id_cliente },
    });
    if (!horario) throw new NotFoundException('Horário comercial não encontrado');
    const inicio = this.normalizarHora(dto.hora_inicio);
    const fim = this.normalizarHora(dto.hora_fim);
    if (fim <= inicio) {
      throw new BadRequestException('hora_fim deve ser posterior a hora_inicio');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          {
            id: number;
            id_cliente: number;
            id_horario_comercial: number;
            dia_semana: number;
            hora_inicio: string;
            hora_fim: string;
          }[]
        >`
          INSERT INTO intervalos_horarios (id_cliente, id_horario_comercial, dia_semana, hora_inicio, hora_fim)
          VALUES (${user.id_cliente}, ${idHorario}, ${dto.dia_semana}, ${inicio}::time, ${fim}::time)
          RETURNING id, id_cliente, id_horario_comercial, dia_semana, hora_inicio::text, hora_fim::text
        `;
        const row = rows[0];
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_INTERVAL',
          tabela_afetada: 'intervalos_horarios',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: {
            id_horario_comercial: idHorario,
            dia_semana: dto.dia_semana,
            hora_inicio: inicio,
            hora_fim: fim,
          },
        });
        return row;
      });
    } catch (error) {
      throw this.traduzir(error, 'Intervalo inválido');
    }
  }

  async criarFeriado(user: AuthUser, dto: CreateFeriadoDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.feriados.create({
          data: {
            id_cliente: user.id_cliente,
            nome: dto.nome.trim(),
            dia: dto.dia,
            mes: dto.mes,
            ano: dto.ano ?? null,
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_HOLIDAY',
          tabela_afetada: 'feriados',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: { nome: row.nome, dia: row.dia, mes: row.mes, ano: row.ano },
        });
        return row;
      });
    } catch (error) {
      throw this.traduzir(error, 'Feriado já cadastrado nesta data');
    }
  }

  async criarPolitica(user: AuthUser, dto: CreatePoliticaDto) {
    this.exigeTemposCoerentes(dto.tempo_resposta_min, dto.tempo_resolucao_min);
    const horario = await this.prisma.horarios_comerciais.findFirst({
      where: { id: dto.id_horario_comercial, id_cliente: user.id_cliente },
    });
    if (!horario) throw new NotFoundException('Horário comercial não encontrado');
    if ((dto.status ?? 'ATIVO') === 'ATIVO') {
      const existente = await this.prisma.politicas_sla.findFirst({
        where: {
          id_cliente: user.id_cliente,
          prioridade_alvo: dto.prioridade_alvo,
          tipo_chamado_alvo: dto.tipo_chamado_alvo,
          status: 'ATIVO',
        },
      });
      if (existente) {
        throw new ConflictException('Já existe política de SLA ativa para esta prioridade e tipo');
      }
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
      const row = await tx.politicas_sla.create({
        data: {
          id_cliente: user.id_cliente,
          nome: dto.nome.trim(),
          prioridade_alvo: dto.prioridade_alvo,
          tipo_chamado_alvo: dto.tipo_chamado_alvo,
          tempo_resposta_min: dto.tempo_resposta_min,
          tempo_resolucao_min: dto.tempo_resolucao_min,
          id_horario_comercial: dto.id_horario_comercial,
          status: dto.status ?? 'ATIVO',
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'CREATE_SLA_POLICY',
        tabela_afetada: 'politicas_sla',
        registro_id: row.id,
        valor_anterior: null,
        valor_novo: {
          nome: row.nome,
          prioridade_alvo: row.prioridade_alvo,
          tipo_chamado_alvo: row.tipo_chamado_alvo,
          tempo_resposta_min: row.tempo_resposta_min,
          tempo_resolucao_min: row.tempo_resolucao_min,
          id_horario_comercial: row.id_horario_comercial,
        },
      });
      return row;
    });
    } catch (error) {
      throw this.traduzir(error, 'Já existe política de SLA ativa para esta prioridade e tipo');
    }
  }

  async branding(user: AuthUser, dto: BrandingAdminDto) {
    const anterior = await this.prisma.configuracoes_branding.findFirst({
      where: { id_cliente: user.id_cliente },
    });
    const row = await this.prisma.$transaction(async (tx) => {
      const salvo = anterior
        ? await tx.configuracoes_branding.update({
            where: { id_cliente_id: { id_cliente: user.id_cliente, id: anterior.id } },
            data: dto,
          })
        : await tx.configuracoes_branding.create({
            data: { id_cliente: user.id_cliente, ...dto },
          });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'UPSERT_BRANDING',
        tabela_afetada: 'configuracoes_branding',
        registro_id: salvo.id,
        valor_anterior: anterior
          ? {
              logo_url: anterior.logo_url,
              cor_primaria: anterior.cor_primaria,
              cor_secundaria: anterior.cor_secundaria,
              cor_fundo: anterior.cor_fundo,
              nome_portal: anterior.nome_portal,
            }
          : null,
        valor_novo: {
          logo_url: salvo.logo_url,
          cor_primaria: salvo.cor_primaria,
          cor_secundaria: salvo.cor_secundaria,
          cor_fundo: salvo.cor_fundo,
          nome_portal: salvo.nome_portal,
        },
      });
      return salvo;
    });
    return { criado: !anterior, row };
  }

  async criarIntegracao(user: AuthUser, dto: CreateIntegracaoDto) {
    if (Array.isArray(dto.configuracoes)) {
      throw new BadRequestException('configuracoes deve ser um objeto');
    }
    this.validarConfiguracao(dto.tipo, dto.configuracoes);
    await this.exigeSmtpAtivoUnico(user.id_cliente, dto.tipo, dto.status ?? 'ATIVO');
    const cifrado = criptografarConfig(dto.configuracoes, this.segredo());
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const criado = await tx.integracoes.create({
          data: {
            id_cliente: user.id_cliente,
            nome: dto.nome.trim(),
            tipo: dto.tipo,
            configuracoes: cifrado as Prisma.InputJsonValue,
            status: dto.status ?? 'ATIVO',
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_INTEGRATION',
          tabela_afetada: 'integracoes',
          registro_id: criado.id,
          valor_anterior: null,
          valor_novo: {
            nome: criado.nome,
            tipo: criado.tipo,
            configuracoes: mascararConfig(cifrado) as Prisma.InputJsonValue,
          },
        });
        return criado;
      });
      return {
        ...row,
        configuracoes: mascararConfig(row.configuracoes as Record<string, unknown>),
      };
    } catch (error) {
      throw this.traduzir(error, 'Já existe uma integração com esse nome');
    }
  }

  /** Cada tipo é testado do seu jeito: SMTP autentica e envia um e-mail de teste; webhook recebe um evento. */
  async testarIntegracao(user: AuthUser, id: number) {
    const integracao = await this.prisma.integracoes.findFirst({
      where: { id, id_cliente: user.id_cliente },
    });
    if (!integracao) throw new NotFoundException('Integração não encontrada');
    const config = (integracao.configuracoes ?? {}) as Record<string, unknown>;
    let status: 'SUCESSO' | 'FALHA' = 'FALHA';
    let dadosLog = 'Configuração incompleta';

    if (integracao.tipo === 'SMTP') {
      const verificacao = await this.email.verificar(user.id_cliente, id);
      if (!verificacao.ok) {
        dadosLog = verificacao.erro;
      } else {
        const envio = await this.email.enviar(user.id_cliente, user.email, 'Teste de e-mail do portal ITSM', 'Se você recebeu esta mensagem, o envio de e-mails está funcionando.', {
          idIntegracao: id,
          ignorarPreferencia: true,
        });
        status = envio.ok ? 'SUCESSO' : 'FALHA';
        dadosLog = envio.ok ? `Autenticação SMTP ok. E-mail de teste enviado para ${user.email}` : envio.erro;
      }
    } else if (integracao.tipo === 'WEBHOOK') {
      const entrega = await this.webhook.testar(user.id_cliente, id);
      status = entrega.ok ? 'SUCESSO' : 'FALHA';
      dadosLog = entrega.ok ? `Evento de teste entregue (HTTP ${entrega.status})` : entrega.erro;
    } else {
      const host = typeof config.host === 'string' ? config.host : '';
      const port = Number(config.port);
      if (host && Number.isInteger(port) && port > 0 && port <= 65535) {
        const destino = await destinoPermitido(host);
        if (!destino.ok) {
          dadosLog = destino.motivo;
        } else {
          try {
            await this.conectar(host, port);
            status = 'SUCESSO';
            dadosLog = `Conexão TCP com ${host}:${port} estabelecida`;
          } catch (error) {
            dadosLog = error instanceof Error ? error.message : 'Falha de conexão';
          }
        }
      } else {
        dadosLog = 'Host ou porta ausentes na configuração';
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const historico = await tx.historico_integracoes.create({
        data: {
          id_cliente: user.id_cliente,
          id_integracao: id,
          tipo_evento: 'TESTE_CONECTIVIDADE',
          status,
          dados_log: dadosLog.slice(0, 1000),
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'EXECUTE_INTEGRATION',
        tabela_afetada: 'historico_integracoes',
        registro_id: historico.id,
        valor_anterior: null,
        valor_novo: {
          tipo_evento: historico.tipo_evento,
          status: historico.status,
          dados_log: historico.dados_log,
        },
      });
      return historico;
    });
  }

  /**
   * Altera nome, status ou configuração. Campos secretos enviados como "[criptografado]" (o que a API
   * devolve na leitura) ou vazios mantêm o valor já gravado.
   */
  async atualizarIntegracao(user: AuthUser, id: number, dto: UpdateIntegracaoDto) {
    const atual = await this.prisma.integracoes.findFirst({ where: { id, id_cliente: user.id_cliente } });
    if (!atual) throw new NotFoundException('Integração não encontrada');
    await this.exigeSmtpAtivoUnico(user.id_cliente, atual.tipo, dto.status ?? atual.status, id);
    let configuracoes: Prisma.InputJsonValue | undefined;
    if (dto.configuracoes) {
      if (Array.isArray(dto.configuracoes)) throw new BadRequestException('configuracoes deve ser um objeto');
      const anterior = (atual.configuracoes ?? {}) as Record<string, unknown>;
      const novos = { ...dto.configuracoes };
      for (const [nome, valor] of Object.entries(novos)) {
        if (valor === '[criptografado]' || valor === '') {
          if (nome in anterior) novos[nome] = anterior[nome];
          else delete novos[nome];
        }
      }
      this.validarConfiguracao(atual.tipo, novos);
      configuracoes = criptografarConfig(novos, this.segredo()) as Prisma.InputJsonValue;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.integracoes.update({
          where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
          data: { nome: dto.nome?.trim(), status: dto.status, ...(configuracoes ? { configuracoes } : {}) },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'UPDATE_INTEGRATION',
          tabela_afetada: 'integracoes',
          registro_id: id,
          valor_anterior: { nome: atual.nome, status: atual.status },
          valor_novo: { nome: row.nome, status: row.status, configuracoes: mascararConfig((row.configuracoes ?? {}) as Record<string, unknown>) as Prisma.InputJsonValue },
        });
        return { ...row, configuracoes: mascararConfig((row.configuracoes ?? {}) as Record<string, unknown>) };
      });
    } catch (error) {
      throw this.traduzir(error, 'Já existe uma integração com esse nome');
    }
  }

  /** O envio de e-mails usa a integração SMTP ativa: ter duas ativas deixaria o remetente ambíguo. */
  private async exigeSmtpAtivoUnico(idCliente: number, tipo: string, status: string, ignorarId?: number) {
    if (tipo !== 'SMTP' || status !== 'ATIVO') return;
    const outra = await this.prisma.integracoes.findFirst({
      where: { id_cliente: idCliente, tipo: 'SMTP', status: 'ATIVO', ...(ignorarId ? { NOT: { id: ignorarId } } : {}) },
    });
    if (outra) throw new ConflictException(`Já existe uma integração SMTP ativa ("${outra.nome}"). Desative-a antes de ativar outra.`);
  }

  /** Cada tipo exige os campos que o conector usa; o erro aparece ao salvar, não só ao primeiro envio. */
  private validarConfiguracao(tipo: string, cfg: Record<string, unknown>) {
    if (tipo === 'SMTP') {
      const port = Number(cfg.port ?? 587);
      if (typeof cfg.host !== 'string' || !cfg.host.trim()) throw new BadRequestException('SMTP: informe o host');
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new BadRequestException('SMTP: porta inválida');
      if (cfg.from !== undefined && !/^[^\s@<>]+@[^\s@<>]+$|^[^<>]*<[^\s@<>]+@[^\s@<>]+>$/.test(String(cfg.from))) {
        throw new BadRequestException('SMTP: remetente inválido (use nome@dominio ou "Nome <nome@dominio>")');
      }
    } else if (tipo === 'EMAIL_ENTRADA') {
      if (typeof cfg.token !== 'string' || cfg.token.length < 16) {
        throw new BadRequestException('E-mail de entrada: o token deve ter pelo menos 16 caracteres');
      }
      if (!Number.isInteger(Number(cfg.id_categoria))) {
        throw new BadRequestException('E-mail de entrada: informe a categoria padrão (id_categoria)');
      }
    } else if (tipo === 'WEBHOOK') {
      let url: URL;
      try {
        url = new URL(String(cfg.url ?? ''));
      } catch {
        throw new BadRequestException('Webhook: informe uma URL válida');
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BadRequestException('Webhook: a URL deve ser http ou https');
      if (cfg.eventos !== undefined && (!Array.isArray(cfg.eventos) || cfg.eventos.some((e) => typeof e !== 'string'))) {
        throw new BadRequestException('Webhook: eventos deve ser uma lista de textos');
      }
    }
  }

  async auditoria(user: AuthUser, filtro: FiltroAuditoriaDto) {
    // Datas sem hora valem o dia inteiro no fuso de Cuiabá, o mesmo usado nos relatórios.
    const apenasDia = /^\d{4}-\d{2}-\d{2}$/;
    const dataCriacao: Prisma.DateTimeFilter = {};
    if (filtro.data_inicio) {
      dataCriacao.gte = apenasDia.test(filtro.data_inicio)
        ? inicioCuiaba(filtro.data_inicio)
        : new Date(filtro.data_inicio);
    }
    if (filtro.data_fim) {
      dataCriacao.lte = apenasDia.test(filtro.data_fim)
        ? new Date(inicioCuiaba(somarDias(filtro.data_fim, 1)).getTime() - 1)
        : new Date(filtro.data_fim);
    }
    const limite = Math.min(200, filtro.limite ?? 100);
    const pagina = Math.max(1, filtro.pagina ?? 1);
    return this.prisma.logs_auditoria.findMany({
      where: {
        id_cliente: user.id_cliente,
        ...(filtro.id_usuario ? { id_usuario: filtro.id_usuario } : {}),
        ...(filtro.acao ? { acao: filtro.acao } : {}),
        ...(filtro.data_inicio || filtro.data_fim ? { data_criacao: dataCriacao } : {}),
      },
      orderBy: [{ data_criacao: 'desc' }, { id: 'desc' }],
      skip: (pagina - 1) * limite,
      take: limite,
    });
  }

  async listarHorarios(user: AuthUser) {
    const rows = await this.prisma.horarios_comerciais.findMany({
      where: { id_cliente: user.id_cliente },
      include: { intervalos_horarios: { orderBy: [{ dia_semana: 'asc' }, { hora_inicio: 'asc' }] } },
      orderBy: { nome: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      nome: row.nome,
      fuso_horario: row.fuso_horario,
      status: row.status,
      intervalos: row.intervalos_horarios.map((intervalo) => ({
        id: intervalo.id,
        dia_semana: intervalo.dia_semana,
        hora_inicio: this.formatarHora(intervalo.hora_inicio),
        hora_fim: this.formatarHora(intervalo.hora_fim),
      })),
    }));
  }

  async atualizarHorario(user: AuthUser, id: number, dto: UpdateHorarioDto) {
    const atual = await this.prisma.horarios_comerciais.findFirst({
      where: { id, id_cliente: user.id_cliente },
    });
    if (!atual) throw new NotFoundException('Horário comercial não encontrado');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.horarios_comerciais.update({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
        data: {
          nome: dto.nome?.trim(),
          fuso_horario: dto.fuso_horario?.trim(),
          status: dto.status,
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'UPDATE_BUSINESS_HOURS',
        tabela_afetada: 'horarios_comerciais',
        registro_id: id,
        valor_anterior: { nome: atual.nome, fuso_horario: atual.fuso_horario, status: atual.status },
        valor_novo: { nome: row.nome, fuso_horario: row.fuso_horario, status: row.status },
      });
      return row;
    });
  }

  async removerHorario(user: AuthUser, id: number) {
    const atual = await this.prisma.horarios_comerciais.findFirst({
      where: { id, id_cliente: user.id_cliente },
    });
    if (!atual) throw new NotFoundException('Horário comercial não encontrado');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.horarios_comerciais.delete({
          where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'DELETE_BUSINESS_HOURS',
          tabela_afetada: 'horarios_comerciais',
          registro_id: id,
          valor_anterior: { nome: atual.nome, fuso_horario: atual.fuso_horario },
          valor_novo: null,
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('Horário usado por uma política de SLA');
      }
      throw error;
    }
    return { removido: true, id };
  }

  async atualizarIntervalo(user: AuthUser, idHorario: number, idIntervalo: number, dto: CreateIntervaloDto) {
    const existe = await this.prisma.intervalos_horarios.findFirst({
      where: { id: idIntervalo, id_horario_comercial: idHorario, id_cliente: user.id_cliente },
    });
    if (!existe) throw new NotFoundException('Intervalo não encontrado');
    const inicio = this.normalizarHora(dto.hora_inicio);
    const fim = this.normalizarHora(dto.hora_fim);
    if (fim <= inicio) throw new BadRequestException('hora_fim deve ser posterior a hora_inicio');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { id: number; dia_semana: number; hora_inicio: string; hora_fim: string }[]
        >`
          UPDATE intervalos_horarios
          SET dia_semana = ${dto.dia_semana}, hora_inicio = ${inicio}::time, hora_fim = ${fim}::time
          WHERE id_cliente = ${user.id_cliente} AND id = ${idIntervalo} AND id_horario_comercial = ${idHorario}
          RETURNING id, dia_semana, hora_inicio::text, hora_fim::text
        `;
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'UPDATE_INTERVAL',
          tabela_afetada: 'intervalos_horarios',
          registro_id: idIntervalo,
          valor_anterior: {
            dia_semana: existe.dia_semana,
            hora_inicio: this.formatarHora(existe.hora_inicio),
            hora_fim: this.formatarHora(existe.hora_fim),
          },
          valor_novo: { dia_semana: dto.dia_semana, hora_inicio: inicio, hora_fim: fim },
        });
        return rows[0];
      });
    } catch (error) {
      throw this.traduzir(error, 'Intervalo inválido');
    }
  }

  async removerIntervalo(user: AuthUser, idHorario: number, idIntervalo: number) {
    const row = await this.prisma.intervalos_horarios.findFirst({
      where: { id: idIntervalo, id_horario_comercial: idHorario, id_cliente: user.id_cliente },
    });
    if (!row) throw new NotFoundException('Intervalo não encontrado');
    await this.prisma.$transaction(async (tx) => {
      await tx.intervalos_horarios.delete({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id: idIntervalo } },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'DELETE_INTERVAL',
        tabela_afetada: 'intervalos_horarios',
        registro_id: idIntervalo,
        valor_anterior: {
          id_horario_comercial: idHorario,
          dia_semana: row.dia_semana,
          hora_inicio: this.formatarHora(row.hora_inicio),
          hora_fim: this.formatarHora(row.hora_fim),
        },
        valor_novo: null,
      });
    });
    return { removido: true, id: idIntervalo };
  }

  async listarFeriados(user: AuthUser) {
    return this.prisma.feriados.findMany({
      where: { id_cliente: user.id_cliente },
      orderBy: [{ mes: 'asc' }, { dia: 'asc' }, { ano: 'asc' }],
    });
  }

  async atualizarFeriado(user: AuthUser, id: number, dto: UpdateFeriadoDto) {
    const atual = await this.prisma.feriados.findFirst({
      where: { id, id_cliente: user.id_cliente },
    });
    if (!atual) throw new NotFoundException('Feriado não encontrado');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.feriados.update({
          where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
          data: {
            nome: dto.nome?.trim(),
            dia: dto.dia,
            mes: dto.mes,
            ...(dto.ano !== undefined ? { ano: dto.ano } : {}),
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'UPDATE_HOLIDAY',
          tabela_afetada: 'feriados',
          registro_id: id,
          valor_anterior: { nome: atual.nome, dia: atual.dia, mes: atual.mes, ano: atual.ano },
          valor_novo: { nome: row.nome, dia: row.dia, mes: row.mes, ano: row.ano },
        });
        return row;
      });
    } catch (error) {
      throw this.traduzir(error, 'Feriado já cadastrado nesta data');
    }
  }

  async removerFeriado(user: AuthUser, id: number) {
    const atual = await this.prisma.feriados.findFirst({
      where: { id, id_cliente: user.id_cliente },
    });
    if (!atual) throw new NotFoundException('Feriado não encontrado');
    await this.prisma.$transaction(async (tx) => {
      await tx.feriados.delete({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'DELETE_HOLIDAY',
        tabela_afetada: 'feriados',
        registro_id: id,
        valor_anterior: { nome: atual.nome, dia: atual.dia, mes: atual.mes, ano: atual.ano },
        valor_novo: null,
      });
    });
    return { removido: true, id };
  }

  async atualizarPolitica(user: AuthUser, id: number, dto: UpdatePoliticaDto) {
    const atual = await this.prisma.politicas_sla.findFirst({
      where: { id, id_cliente: user.id_cliente },
    });
    if (!atual) throw new NotFoundException('Política de SLA não encontrada');
    if (dto.id_horario_comercial) {
      const horario = await this.prisma.horarios_comerciais.findFirst({
        where: { id: dto.id_horario_comercial, id_cliente: user.id_cliente },
      });
      if (!horario) throw new NotFoundException('Horário comercial não encontrado');
    }
    this.exigeTemposCoerentes(
      dto.tempo_resposta_min ?? atual.tempo_resposta_min,
      dto.tempo_resolucao_min ?? atual.tempo_resolucao_min,
    );
    const status = dto.status ?? atual.status;
    const prioridade = dto.prioridade_alvo ?? atual.prioridade_alvo;
    const tipo = dto.tipo_chamado_alvo ?? atual.tipo_chamado_alvo;
    if (status === 'ATIVO') {
      const outra = await this.prisma.politicas_sla.findFirst({
        where: {
          id_cliente: user.id_cliente,
          prioridade_alvo: prioridade,
          tipo_chamado_alvo: tipo,
          status: 'ATIVO',
          NOT: { id },
        },
      });
      if (outra) {
        throw new ConflictException('Já existe política de SLA ativa para esta prioridade e tipo');
      }
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.politicas_sla.update({
          where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
          data: {
            nome: dto.nome?.trim(),
            prioridade_alvo: dto.prioridade_alvo,
            tipo_chamado_alvo: dto.tipo_chamado_alvo,
            tempo_resposta_min: dto.tempo_resposta_min,
            tempo_resolucao_min: dto.tempo_resolucao_min,
            id_horario_comercial: dto.id_horario_comercial,
            status: dto.status,
          },
        });
        const resumo = (p: typeof atual) => ({
          nome: p.nome,
          prioridade_alvo: p.prioridade_alvo,
          tipo_chamado_alvo: p.tipo_chamado_alvo,
          tempo_resposta_min: p.tempo_resposta_min,
          tempo_resolucao_min: p.tempo_resolucao_min,
          id_horario_comercial: p.id_horario_comercial,
          status: p.status,
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'UPDATE_SLA_POLICY',
          tabela_afetada: 'politicas_sla',
          registro_id: id,
          valor_anterior: resumo(atual),
          valor_novo: resumo(row),
        });
        return row;
      });
    } catch (error) {
      throw this.traduzir(error, 'Já existe política de SLA ativa para esta prioridade e tipo');
    }
  }

  private exigeTemposCoerentes(respostaMin: number, resolucaoMin: number) {
    if (respostaMin >= resolucaoMin) {
      throw new BadRequestException('O tempo de resposta deve ser menor que o tempo de solução');
    }
  }

  private async normalizarSenha(valor: string) {
    if (/^\$2[aby]\$\d{2}\$/.test(valor) && valor.length >= 59) return valor;
    exigirSenhaForte(valor);
    return bcrypt.hash(valor, 12);
  }

  /** Chave de gravação: o segredo próprio das integrações, ou o JWT_SECRET enquanto ele não existir. */
  private segredo() {
    return this.segredosLeitura()[0] ?? 'itsm-local';
  }

  private segredosLeitura() {
    return segredosDeIntegracao({
      INTEGRACOES_SECRET: this.config.get<string>('INTEGRACOES_SECRET'),
      JWT_SECRET: this.config.get<string>('JWT_SECRET'),
    });
  }

  /** Configuração em claro, só para conectores internos. Não exposta por nenhuma rota. */
  async configuracaoEmClaro(idCliente: number, idIntegracao: number) {
    const integracao = await this.prisma.integracoes.findFirst({
      where: { id: idIntegracao, id_cliente: idCliente },
    });
    if (!integracao) throw new NotFoundException('Integração não encontrada');
    return descriptografarConfig((integracao.configuracoes ?? {}) as Record<string, unknown>, this.segredosLeitura());
  }

  private conectar(host: string, port: number) {
    return new Promise<void>((resolve, reject) => {
      const socket = net.connect({ host, port, timeout: 3000 });
      const fim = (erro?: Error) => {
        socket.destroy();
        if (erro) reject(erro);
        else resolve();
      };
      socket.once('connect', () => fim());
      socket.once('timeout', () => fim(new Error(`Tempo esgotado ao conectar em ${host}:${port}`)));
      socket.once('error', (erro) => fim(erro));
    });
  }

  private async exigeUsuario(idCliente: number, id: number) {
    const row = await this.prisma.usuarios.findFirst({ where: { id, id_cliente: idCliente } });
    if (!row) throw new NotFoundException('Usuário não encontrado');
  }

  private async exigeDepartamento(idCliente: number, id: number) {
    const row = await this.prisma.departamentos.findFirst({ where: { id, id_cliente: idCliente } });
    if (!row) throw new NotFoundException('Departamento não encontrado');
  }

  private texto(error: unknown): string {
    if (!error || typeof error !== 'object') return '';
    const atual = error as { message?: string; meta?: { message?: string }; cause?: unknown };
    return `${atual.message ?? ''} ${atual.meta?.message ?? ''} ${this.texto(atual.cause)}`;
  }

  private traduzir(error: unknown, mensagemConflito: string): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(mensagemConflito);
    }
    const texto = this.texto(error);
    if (texto.includes('Sobreposição')) {
      return new BadRequestException('Sobreposição de horário no mesmo dia');
    }
    if (texto.includes('23505') || texto.includes('Unique constraint')) {
      return new ConflictException(mensagemConflito);
    }
    if (texto.includes('ck_ih_horas')) {
      return new BadRequestException('hora_fim deve ser posterior a hora_inicio');
    }
    return error;
  }

  private formatarHora(valor: Date) {
    const hora = String(valor.getUTCHours()).padStart(2, '0');
    const minuto = String(valor.getUTCMinutes()).padStart(2, '0');
    const segundo = String(valor.getUTCSeconds()).padStart(2, '0');
    return `${hora}:${minuto}:${segundo}`;
  }

  private normalizarHora(valor: string) {
    const [hora, minuto, segundo = '00'] = valor.split(':');
    return `${hora.padStart(2, '0')}:${minuto}:${segundo.padStart(2, '0')}`;
  }
}
