import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { ArtigosController, KbController } from './kb.controller.js';
import { KbService } from './kb.service.js';

@Module({
  imports: [AuditModule],
  controllers: [KbController, ArtigosController],
  providers: [KbService],
})
export class KbModule {}
