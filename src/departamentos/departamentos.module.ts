import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { DepartamentosController } from './departamentos.controller.js';
import { DepartamentosService } from './departamentos.service.js';

@Module({
  imports: [AuditModule],
  controllers: [DepartamentosController],
  providers: [DepartamentosService],
})
export class DepartamentosModule {}
