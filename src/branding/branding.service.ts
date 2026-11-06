import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateBrandingDto } from './dto/branding.dto.js';
import { PREFIXO_LOGO, caminhoLogo, validarLogo } from './logo.js';

/**
 * Se o logotipo salvo deixou de apontar para o arquivo guardado pelo sistema (vazio ou uma URL externa),
 * o arquivo antigo é apagado: não fica imagem esquecida no banco nem servida por engano.
 */
export async function limparLogoSeExterno(tx: Prisma.TransactionClient, idCliente: number, logoUrl: string | null) {
  if (logoUrl?.startsWith(PREFIXO_LOGO)) return;
  await tx.logos_branding.deleteMany({ where: { id_cliente: idCliente } });
}

@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async atualizar(user: AuthUser, dto: UpdateBrandingDto) {
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
      await limparLogoSeExterno(tx, user.id_cliente, row.logo_url);
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'UPSERT_BRANDING',
        tabela_afetada: 'configuracoes_branding',
        registro_id: row.id,
        valor_anterior: anterior ? { nome_portal: anterior.nome_portal } : null,
        valor_novo: { nome_portal: row.nome_portal },
      });
      return row;
    });
  }

  /**
   * Guarda a imagem e devolve o caminho a gravar em `logo_url`. Quem publica a identidade visual continua
   * sendo o "Publicar" do painel: só ele muda o `logo_url` que os usuários enxergam.
   */
  async enviarLogo(user: AuthUser, arquivo: { buffer?: Buffer; size?: number } | undefined) {
    const { tipo, conteudo } = validarLogo(arquivo);
    const agora = new Date();
    const bytes = new Uint8Array(conteudo);
    await this.prisma.$transaction(async (tx) => {
      await tx.logos_branding.upsert({
        where: { id_cliente: user.id_cliente },
        create: { id_cliente: user.id_cliente, tipo_mime: tipo, conteudo: bytes, tamanho_bytes: conteudo.length, data_atualizacao: agora },
        update: { tipo_mime: tipo, conteudo: bytes, tamanho_bytes: conteudo.length, data_atualizacao: agora },
      });
      await this.audit.record(tx, {
        id_cliente: user.id_cliente,
        acao: 'UPLOAD_BRANDING_LOGO',
        tabela_afetada: 'logos_branding',
        registro_id: user.id_cliente,
        valor_anterior: null,
        valor_novo: { tipo_mime: tipo, tamanho_bytes: conteudo.length },
      });
    });
    return { logo_url: caminhoLogo(user.id_cliente, agora.getTime()), tipo_mime: tipo, tamanho_bytes: conteudo.length };
  }

  async obterLogo(idCliente: number) {
    const logo = await this.prisma.logos_branding.findUnique({ where: { id_cliente: idCliente } });
    if (!logo) throw new NotFoundException('Logotipo não encontrado');
    return logo;
  }
}
