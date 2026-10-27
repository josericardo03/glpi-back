import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { StorageService } from '../storage/storage.service.js';
import { ArtigosController, KbController } from './kb.controller.js';
import { KbService } from './kb.service.js';

@Module({
  imports: [AuditModule],
  controllers: [KbController, ArtigosController],
  providers: [KbService, StorageService],
})
export class KbModule {}
