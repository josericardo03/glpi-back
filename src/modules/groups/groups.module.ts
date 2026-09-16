import { Module } from '@nestjs/common';
import { GroupsController } from './groups.controller.js';

@Module({
  controllers: [GroupsController],
})
export class GroupsModule {}
