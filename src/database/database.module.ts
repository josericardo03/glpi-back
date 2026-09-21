import { Module } from '@nestjs/common';
import { SchemaBootstrapService } from './schema-bootstrap.service.js';
import { SeedService } from './seed.service.js';

@Module({
  providers: [SchemaBootstrapService, SeedService],
})
export class DatabaseModule {}
