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
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
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
  UpdateUsuarioAdminDto,
} from './dto/fase5.dto.js';
import { criptografarConfig, mascararConfig } from './segredo.js';

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
export class Fase5Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
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
            ...(senhaHash ? { senha_hash: senhaHash } : {}),
          },
          select: usuarioPublico,
        });
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
    const horario = await this.prisma.horarios_comerciais.findFirst({
      where: { id: dto.id_horario_comercial, id_cliente: user.id_cliente },
    });
    if (!horario) throw new NotFoundException('Horário comercial não encontrado');
    return this.prisma.$transaction(async (tx) => {
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

  async testarIntegracao(user: AuthUser, id: number) {
    const integracao = await this.prisma.integracoes.findFirst({
      where: { id, id_cliente: user.id_cliente },
    });
    if (!integracao) throw new NotFoundException('Integração não encontrada');
    const config = integracao.configuracoes as Record<string, unknown>;
    const host = typeof config.host === 'string' ? config.host : '';
    const port = Number(config.port);
    let status: 'SUCESSO' | 'FALHA' = 'FALHA';
    let dadosLog = 'Host ou porta ausentes na configuração';
    if (host && Number.isInteger(port) && port > 0 && port <= 65535) {
      try {
        await this.conectar(host, port);
        status = 'SUCESSO';
        dadosLog = `Conexão TCP com ${host}:${port} estabelecida`;
      } catch (error) {
        dadosLog = error instanceof Error ? error.message : 'Falha de conexão';
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const historico = await tx.historico_integracoes.create({
        data: {
          id_cliente: user.id_cliente,
          id_integracao: id,
          tipo_evento: 'TESTE_CONECTIVIDADE',
          status,
          dados_log: dadosLog,
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

  async auditoria(user: AuthUser, filtro: FiltroAuditoriaDto) {
    const dataCriacao: Prisma.DateTimeFilter = {};
    if (filtro.data_inicio) dataCriacao.gte = new Date(filtro.data_inicio);
    if (filtro.data_fim) {
      const fim = new Date(filtro.data_fim);
      if (/^\d{4}-\d{2}-\d{2}$/.test(filtro.data_fim)) fim.setUTCHours(23, 59, 59, 999);
      dataCriacao.lte = fim;
    }
    return this.prisma.logs_auditoria.findMany({
      where: {
        id_cliente: user.id_cliente,
        ...(filtro.id_usuario ? { id_usuario: filtro.id_usuario } : {}),
        ...(filtro.acao ? { acao: filtro.acao } : {}),
        ...(filtro.data_inicio || filtro.data_fim ? { data_criacao: dataCriacao } : {}),
      },
      orderBy: { data_criacao: 'desc' },
      take: 200,
    });
  }

  private async normalizarSenha(valor: string) {
    if (/^\$2[aby]\$\d{2}\$/.test(valor) && valor.length >= 59) return valor;
    if (valor.length < 8) {
      throw new BadRequestException('senha_hash deve ser um hash bcrypt ou uma senha de 8 caracteres');
    }
    return bcrypt.hash(valor, 12);
  }

  private segredo() {
    return this.config.get<string>('JWT_SECRET') ?? 'itsm-local';
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

  private normalizarHora(valor: string) {
    const [hora, minuto, segundo = '00'] = valor.split(':');
    return `${hora.padStart(2, '0')}:${minuto}:${segundo.padStart(2, '0')}`;
  }
}
