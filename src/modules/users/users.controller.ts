import { Controller, Get } from '@nestjs/common';
import { users } from '../../common/mock-store.js';

@Controller('users')
export class UsersController {
  @Get()
  findAll() {
    return users;
  }
}
