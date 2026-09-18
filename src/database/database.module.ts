import { Module } from '@nestjs/common';
import { SchemaBootstrapService } from './schema-bootstrap.service.js';

@Module({
  providers: [SchemaBootstrapService],
})
export class DatabaseModule {}
