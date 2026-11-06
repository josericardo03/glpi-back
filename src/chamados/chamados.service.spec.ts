import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { ChamadosService } from './chamados.service.js';

const solicitante: AuthUser = {
  id: 7,
  id_cliente: 1,
  email: 's@x.com',
  nome: 'Solicitante',
  perfil: 'SOLICITANTE',
  cargo: 'Analista',
  status: 'ATIVO',
};
const tecnico: AuthUser = { ...solicitante, id: 9, perfil: 'TECNICO' };

describe('ChamadosService: anexos de notas internas', () => {
  const prisma = {
    chamados: { findFirst: vi.fn() },
    anexos_chamados: { findFirst: vi.fn() },
    comentarios_chamados: { findFirst: vi.fn() },
  };
  let service: ChamadosService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.chamados.findFirst.mockResolvedValue({ id: 10, id_cliente: 1, id_solicitante: 7 });
    service = new ChamadosService(prisma as never, {} as never, {} as never, {} as never);
  });

  it('o solicitante não baixa anexo de comentário INTERNO', async () => {
    prisma.anexos_chamados.findFirst.mockResolvedValue({ id: 5, id_comentario: 3, conteudo: Buffer.from('x') });
    prisma.comentarios_chamados.findFirst.mockResolvedValue({ tipo_visibilidade: 'INTERNO' });
    await expect(service.baixar(solicitante, 10, 5)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('o solicitante baixa anexo de comentário PUBLICO', async () => {
    const anexo = { id: 5, id_comentario: 3, conteudo: Buffer.from('x') };
    prisma.anexos_chamados.findFirst.mockResolvedValue(anexo);
    prisma.comentarios_chamados.findFirst.mockResolvedValue({ tipo_visibilidade: 'PUBLICO' });
    await expect(service.baixar(solicitante, 10, 5)).resolves.toBe(anexo);
  });

  it('o técnico baixa anexo de nota interna sem consultar a visibilidade', async () => {
    const anexo = { id: 5, id_comentario: 3, conteudo: Buffer.from('x') };
    prisma.anexos_chamados.findFirst.mockResolvedValue(anexo);
    await expect(service.baixar(tecnico, 10, 5)).resolves.toBe(anexo);
    expect(prisma.comentarios_chamados.findFirst).not.toHaveBeenCalled();
  });

  it('o solicitante não anexa arquivo a uma nota interna', async () => {
    prisma.comentarios_chamados.findFirst.mockResolvedValue({ id: 3, tipo_visibilidade: 'INTERNO' });
    const arquivo = { buffer: Buffer.from('x'), originalname: 'a.txt', mimetype: 'text/plain', size: 1 };
    await expect(service.anexar(solicitante, 10, arquivo, 3)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ChamadosService: ciclo de vida e concorrência', () => {
  const resolvido = {
    id: 10,
    id_cliente: 1,
    id_solicitante: 7,
    status: 'RESOLVIDO',
    resolucao: 'Reiniciado',
    data_abertura: new Date('2026-01-01T10:00:00Z'),
    data_resolucao: new Date('2026-01-02T10:00:00Z'),
    data_previsao_resolucao: null,
    data_previsao_resposta: null,
    sla_vencido: false,
  };
  const tx = {
    chamados: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    historico_status_chamados: { create: vi.fn() },
  };
  const prisma = {
    chamados: { findFirst: vi.fn() },
    historico_status_chamados: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { record: vi.fn() };
  let service: ChamadosService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.chamados.findFirst.mockResolvedValue(resolvido);
    prisma.historico_status_chamados.findFirst.mockResolvedValue(null);
    service = new ChamadosService(prisma as never, {} as never, audit as never, {} as never);
  });

  it('o solicitante não muda o status de um chamado que não está resolvido', async () => {
    prisma.chamados.findFirst.mockResolvedValue({ ...resolvido, status: 'NOVO' });
    await expect(service.mudarStatus(solicitante, 10, { status_novo: 'CONCLUIDO' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('o solicitante não pausa nem resolve, mesmo no próprio chamado', async () => {
    await expect(
      service.mudarStatus(solicitante, 10, { status_novo: 'PENDENTE', motivo_pausa: 'AGUARDANDO_TERCEIRO' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('o solicitante reabre um chamado resolvido: limpa a resolução e audita a reabertura', async () => {
    tx.chamados.updateMany.mockResolvedValue({ count: 1 });
    tx.chamados.findUniqueOrThrow.mockResolvedValue({ ...resolvido, status: 'EM_ATENDIMENTO', data_resolucao: null });
    const r = await service.mudarStatus(solicitante, 10, { status_novo: 'EM_ATENDIMENTO' });
    expect(r.status_novo).toBe('EM_ATENDIMENTO');
    const chamada = tx.chamados.updateMany.mock.calls[0]![0];
    expect(chamada.where.status).toBe('RESOLVIDO');
    expect(chamada.data).toMatchObject({ status: 'EM_ATENDIMENTO', resolucao: null, data_resolucao: null });
    expect(audit.record.mock.calls[0]![1]).toMatchObject({ acao: 'REOPEN_CHAMADO' });
  });

  it('o solicitante confirma a conclusão de um chamado resolvido', async () => {
    tx.chamados.updateMany.mockResolvedValue({ count: 1 });
    tx.chamados.findUniqueOrThrow.mockResolvedValue({ ...resolvido, status: 'CONCLUIDO' });
    const r = await service.mudarStatus(solicitante, 10, { status_novo: 'CONCLUIDO' });
    expect(r.status_novo).toBe('CONCLUIDO');
  });

  it('transições simultâneas: quem chega depois recebe conflito', async () => {
    tx.chamados.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.mudarStatus(tecnico, 10, { status_novo: 'CONCLUIDO' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.historico_status_chamados.create).not.toHaveBeenCalled();
  });
});
