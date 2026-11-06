import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SlaService } from '../sla/sla.service.js';
import { StorageService } from '../storage/storage.service.js';
import { ChamadosController } from './chamados.controller.js';
import { EntradaEmailController } from './entrada-email.controller.js';
import { EntradaEmailService } from './entrada-email.service.js';
import { ChamadosService } from './chamados.service.js';

@Module({
  imports: [AuditModule],
  controllers: [ChamadosController, EntradaEmailController],
  providers: [ChamadosService, EntradaEmailService, SlaService, StorageService],
})
export class ChamadosModule {}
