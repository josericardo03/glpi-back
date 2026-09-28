import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AtivosController } from './ativos.controller.js';
import { AtivosService } from './ativos.service.js';

@Module({
  imports: [AuditModule],
  controllers: [AtivosController],
  providers: [AtivosService],
})
export class AtivosModule {}
