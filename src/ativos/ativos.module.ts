import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AtivosController } from './ativos.controller.js';
import { AtivosService } from './ativos.service.js';
import { MapasService } from './mapas.service.js';

@Module({
  imports: [AuditModule],
  controllers: [AtivosController],
  providers: [AtivosService, MapasService],
})
export class AtivosModule {}
