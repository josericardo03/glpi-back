import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator.js';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** Prontidão: confere o banco. Use no healthcheck do balanceador / readiness. */
  @Public()
  @Get('health')
  health() {
    return this.appService.health();
  }

  /** Vivacidade: só diz que o processo responde, sem tocar no banco (um banco fora não deve reiniciar a API). */
  @Public()
  @Get('health/live')
  live() {
    return { status: 'ok' };
  }
}
