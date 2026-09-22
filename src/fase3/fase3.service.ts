import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateArtigoDto,
  CreateAtivoDto,
  CreateCategoriaDto,
  CreateCategoriaKbDto,
  CreateDepartamentoDto,
  CreateGrupoDto,
  CreateUsuarioDto,
  FeedbackArtigoDto,
  MarcarNotificacaoDto,
  MembroGrupoDto,
  UpdateBrandingDto,
  UpdateUsuarioDto,
} from './dto/fase3.dto.js';

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
export class Fase3Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async criarUsuario(user: AuthUser, dto: CreateUsuarioDto) {
    if (dto.id_departamento) await this.exigeDepartamento(user.id_cliente, dto.id_departamento);
    const senhaHash = await bcrypt.hash(dto.password, 12);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const criado = await tx.usuarios.create({
          data: {
            id_cliente: user.id_cliente,
            nome: dto.nome.trim(),
            email: dto.email.trim().toLowerCase(),
            senha_hash: senhaHash,
            cargo: dto.cargo.trim(),
            perfil: dto.perfil,
            status: dto.status ?? 'ATIVO',
            id_departamento: dto.id_departamento,
          },
          select: usuarioPublico,
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_USUARIO',
          tabela_afetada: 'usuarios',
          registro_id: criado.id,
          valor_anterior: null,
          valor_novo: { email: criado.email, perfil: criado.perfil },
        });
        return criado;
      });
    } catch (error) {
      throw this.traduzir(error, 'E-mail já cadastrado neste tenant');
    }
  }

  async atualizarUsuario(user: AuthUser, id: number, dto: UpdateUsuarioDto) {
    const atual = await this.prisma.usuarios.findFirst({
      where: { id, id_cliente: user.id_cliente },
      select: usuarioPublico,
    });
    if (!atual) throw new NotFoundException('Usuário não encontrado');
    if (dto.id_departamento) await this.exigeDepartamento(user.id_cliente, dto.id_departamento);
    const senhaHash = dto.password ? await bcrypt.hash(dto.password, 12) : undefined;
    const salvo = await this.prisma.$transaction(async (tx) => {
      const row = await tx.usuarios.update({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
        data: {
          nome: dto.nome?.trim(),
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
        acao: 'UPDATE_USUARIO',
        tabela_afetada: 'usuarios',
        registro_id: id,
        valor_anterior: { perfil: atual.perfil, status: atual.status },
        valor_novo: { perfil: row.perfil, status: row.status },
      });
      return row;
    });
    return salvo;
  }

  async criarDepartamento(user: AuthUser, dto: CreateDepartamentoDto) {
    if (dto.id_responsavel) await this.exigeUsuario(user.id_cliente, dto.id_responsavel);
    if (dto.id_departamento_pai) await this.exigeDepartamento(user.id_cliente, dto.id_departamento_pai);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.departamentos.create({
          data: {
            id_cliente: user.id_cliente,
            codigo_sigla: dto.codigo_sigla.trim().toUpperCase(),
            nome: dto.nome.trim(),
            id_responsavel: dto.id_responsavel,
            id_departamento_pai: dto.id_departamento_pai,
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_DEPARTAMENTO',
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

  async criarCategoria(user: AuthUser, dto: CreateCategoriaDto) {
    if (dto.id_categoria_pai) {
      const pai = await this.prisma.categorias_chamados.findFirst({
        where: { id: dto.id_categoria_pai, id_cliente: user.id_cliente },
      });
      if (!pai) throw new NotFoundException('Categoria pai não encontrada');
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.categorias_chamados.create({
        data: {
          id_cliente: user.id_cliente,
          nome: dto.nome.trim(),
          tipo_aplicacao: dto.tipo_aplicacao ?? 'AMBOS',
          status: dto.status ?? 'ATIVO',
          id_categoria_pai: dto.id_categoria_pai,
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'CREATE_CATEGORIA',
        tabela_afetada: 'categorias_chamados',
        registro_id: row.id,
        valor_anterior: null,
        valor_novo: { nome: row.nome, tipo_aplicacao: row.tipo_aplicacao },
      });
      return row;
    });
  }

  async criarGrupo(user: AuthUser, dto: CreateGrupoDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.grupos_suporte.create({
          data: {
            id_cliente: user.id_cliente,
            nome: dto.nome.trim(),
            descricao: dto.descricao?.trim(),
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_GRUPO',
          tabela_afetada: 'grupos_suporte',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: { nome: row.nome },
        });
        return row;
      });
    } catch (error) {
      throw this.traduzir(error, 'Já existe um grupo com esse nome');
    }
  }

  async adicionarMembro(user: AuthUser, idGrupo: number, dto: MembroGrupoDto) {
    const grupo = await this.prisma.grupos_suporte.findFirst({
      where: { id: idGrupo, id_cliente: user.id_cliente },
    });
    if (!grupo) throw new NotFoundException('Grupo não encontrado');
    await this.exigeUsuario(user.id_cliente, dto.id_usuario);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.membros_grupos.create({
          data: {
            id_cliente: user.id_cliente,
            id_grupo: idGrupo,
            id_usuario: dto.id_usuario,
            cargo_especialidade: dto.cargo_especialidade?.trim(),
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'ADD_MEMBRO_GRUPO',
          tabela_afetada: 'membros_grupos',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: { id_grupo: idGrupo, id_usuario: dto.id_usuario },
        });
        return row;
      });
    } catch (error) {
      throw this.traduzir(error, 'Usuário já pertence a este grupo');
    }
  }

  async criarAtivo(user: AuthUser, dto: CreateAtivoDto) {
    if (dto.id_usuario_atribuido) await this.exigeUsuario(user.id_cliente, dto.id_usuario_atribuido);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.ativos_cmdb.create({
          data: {
            id_cliente: user.id_cliente,
            codigo_patrimonio: dto.codigo_patrimonio.trim(),
            nome: dto.nome.trim(),
            tipo_ativo: dto.tipo_ativo,
            status: dto.status ?? 'ATIVO',
            id_usuario_atribuido: dto.id_usuario_atribuido,
            data_aquisicao: dto.data_aquisicao ? new Date(dto.data_aquisicao) : undefined,
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_ATIVO',
          tabela_afetada: 'ativos_cmdb',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: { codigo_patrimonio: row.codigo_patrimonio, nome: row.nome },
        });
        return row;
      });
    } catch (error) {
      throw this.traduzir(error, 'Patrimônio já cadastrado neste tenant');
    }
  }

  async criarCategoriaKb(user: AuthUser, dto: CreateCategoriaKbDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.categorias_artigos_kb.create({
          data: {
            id_cliente: user.id_cliente,
            nome: dto.nome.trim(),
            descricao: dto.descricao?.trim(),
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'CREATE_CATEGORIA_KB',
          tabela_afetada: 'categorias_artigos_kb',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: { nome: row.nome },
        });
        return row;
      });
    } catch (error) {
      throw this.traduzir(error, 'Categoria de conhecimento já existe');
    }
  }

  async criarArtigo(user: AuthUser, dto: CreateArtigoDto) {
    const categoria = await this.prisma.categorias_artigos_kb.findFirst({
      where: { id: dto.id_categoria, id_cliente: user.id_cliente },
    });
    if (!categoria) throw new NotFoundException('Categoria de conhecimento não encontrada');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.artigos_kb.create({
        data: {
          id_cliente: user.id_cliente,
          id_categoria: dto.id_categoria,
          id_autor: user.id,
          titulo: dto.titulo.trim(),
          conteudo: dto.conteudo.trim(),
          status: dto.status ?? 'RASCUNHO',
        },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'CREATE_ARTIGO',
        tabela_afetada: 'artigos_kb',
        registro_id: row.id,
        valor_anterior: null,
        valor_novo: { titulo: row.titulo, status: row.status },
      });
      return row;
    });
  }

  async feedbackArtigo(user: AuthUser, idArtigo: number, dto: FeedbackArtigoDto) {
    const artigo = await this.prisma.artigos_kb.findFirst({
      where: { id: idArtigo, id_cliente: user.id_cliente, status: 'PUBLICADO' },
    });
    if (!artigo) throw new NotFoundException('Artigo publicado não encontrado');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.feedbacks_artigos_kb.create({
          data: {
            id_cliente: user.id_cliente,
            id_artigo: idArtigo,
            id_usuario: user.id,
            util: dto.util,
            comentario: dto.comentario?.trim(),
          },
        });
        await this.audit.record(tx, {
          id_cliente: user.id_cliente,
          acao: 'FEEDBACK_ARTIGO',
          tabela_afetada: 'feedbacks_artigos_kb',
          registro_id: row.id,
          valor_anterior: null,
          valor_novo: { id_artigo: idArtigo, util: dto.util },
        });
        return row;
      });
    } catch (error) {
      throw this.traduzir(error, 'Você já avaliou este artigo');
    }
  }

  async atualizarBranding(user: AuthUser, dto: UpdateBrandingDto) {
    const anterior = await this.prisma.configuracoes_branding.findFirst({
      where: { id_cliente: user.id_cliente },
    });
    return this.prisma.$transaction(async (tx) => {
      const row = anterior
        ? await tx.configuracoes_branding.update({
            where: { id_cliente_id: { id_cliente: user.id_cliente, id: anterior.id } },
            data: dto,
          })
        : await tx.configuracoes_branding.create({
            data: { id_cliente: user.id_cliente, ...dto },
          });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'UPDATE_BRANDING',
        tabela_afetada: 'configuracoes_branding',
        registro_id: row.id,
        valor_anterior: anterior ? { nome_portal: anterior.nome_portal } : null,
        valor_novo: { nome_portal: row.nome_portal },
      });
      return row;
    });
  }

  async marcarNotificacao(user: AuthUser, id: number, dto: MarcarNotificacaoDto) {
    const atual = await this.prisma.notificacoes.findFirst({
      where: { id, id_cliente: user.id_cliente, id_usuario: user.id },
    });
    if (!atual) throw new NotFoundException('Notificação não encontrada');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.notificacoes.update({
        where: { id_cliente_id: { id_cliente: user.id_cliente, id } },
        data: { lida: dto.lida },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'UPDATE_NOTIFICACAO',
        tabela_afetada: 'notificacoes',
        registro_id: id,
        valor_anterior: { lida: atual.lida },
        valor_novo: { lida: row.lida },
      });
      return row;
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

  private traduzir(error: unknown, mensagem: string) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(mensagem);
    }
    return error;
  }
}
