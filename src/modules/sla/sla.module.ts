import { Module } from '@nestjs/common';
import { SlaController } from './sla.controller.js';

@Module({
  controllers: [SlaController],
})
export class SlaModule {}
