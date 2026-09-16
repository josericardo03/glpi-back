import { Controller, Get } from '@nestjs/common';
import { integrations } from '../../common/mock-store.js';

@Controller('integrations')
export class IntegrationsController {
  @Get()
  findAll() {
    return integrations;
  }
}
