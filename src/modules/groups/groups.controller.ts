import { Controller, Get } from '@nestjs/common';
import { groups } from '../../common/mock-store.js';

@Controller('groups')
export class GroupsController {
  @Get()
  findAll() {
    return groups;
  }
}
