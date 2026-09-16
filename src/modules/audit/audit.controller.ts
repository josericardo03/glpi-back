import { Controller, Get } from '@nestjs/common';
import { auditLogs } from '../../common/mock-store.js';

@Controller('audit-logs')
export class AuditController {
  @Get()
  findAll() {
    return auditLogs;
  }
}
