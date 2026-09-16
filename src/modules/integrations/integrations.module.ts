import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller.js';

@Module({
  controllers: [IntegrationsController],
})
export class IntegrationsModule {}
