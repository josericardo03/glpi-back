import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { Fase5Controller } from './fase5.controller.js';
import { Fase5Service } from './fase5.service.js';

@Module({
  imports: [AuditModule],
  controllers: [Fase5Controller],
  providers: [Fase5Service],
})
export class Fase5Module {}
