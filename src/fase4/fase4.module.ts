import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { Fase4Service } from './fase4.service.js';
import { KbController, NotificacoesController } from './fase4.controller.js';

@Module({
  imports: [AuditModule],
  controllers: [NotificacoesController, KbController],
  providers: [Fase4Service],
})
export class Fase4Module {}
