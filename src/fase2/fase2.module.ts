import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SlaService } from '../sla/sla.service.js';
import { StorageService } from '../storage/storage.service.js';
import { CatalogoWriteController } from './catalogo-write.controller.js';
import { CatalogoWriteService } from './catalogo-write.service.js';
import { ChamadosWriteController } from './chamados-write.controller.js';
import { ChamadosWriteService } from './chamados-write.service.js';

@Module({
  imports: [AuditModule],
  controllers: [ChamadosWriteController, CatalogoWriteController],
  providers: [ChamadosWriteService, CatalogoWriteService, SlaService, StorageService],
})
export class Fase2Module {}
