import { Module } from '@nestjs/common';
import { SlaService } from '../sla/sla.service.js';
import { ApiController } from './api.controller.js';

@Module({
  controllers: [ApiController],
  providers: [SlaService],
})
export class ApiModule {}
