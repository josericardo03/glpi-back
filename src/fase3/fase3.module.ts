import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { Fase3Controller } from './fase3.controller.js';
import { Fase3Service } from './fase3.service.js';

@Module({
  imports: [AuditModule],
  controllers: [Fase3Controller],
  providers: [Fase3Service],
})
export class Fase3Module {}
