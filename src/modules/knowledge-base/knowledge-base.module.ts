import { Module } from '@nestjs/common';
import { KnowledgeBaseController } from './knowledge-base.controller.js';

@Module({
  controllers: [KnowledgeBaseController],
})
export class KnowledgeBaseModule {}
