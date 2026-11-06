import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller.js';

describe('AuthController.refresh', () => {
  it('sem cookie limpa o cookie e lança 401, sem devolver o objeto res (evita JSON circular)', async () => {
    const auth = { refresh: vi.fn() };
    const controller = new AuthController(auth as never);
    const req = { headers: { 'x-requested-with': 'XMLHttpRequest', cookie: '' }, secure: false } as unknown as Request;
    const res = { clearCookie: vi.fn(), status: vi.fn(), json: vi.fn() } as unknown as Response;

    await expect(controller.refresh(req, res)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(res.clearCookie).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(auth.refresh).not.toHaveBeenCalled();
  });
});
