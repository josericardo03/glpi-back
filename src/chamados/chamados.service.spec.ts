import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
