import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { GruposController } from './grupos.controller.js';
import { GruposService } from './grupos.service.js';

@Module({
  imports: [AuditModule],
  controllers: [GruposController],
  providers: [GruposService],
})
export class GruposModule {}
