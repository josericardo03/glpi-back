import { Controller, Get } from '@nestjs/common';
import { slaRules } from '../../common/mock-store.js';

@Controller('sla-rules')
export class SlaController {
  @Get()
  findAll() {
    return slaRules;
  }
}
