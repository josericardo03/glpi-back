import { Controller, Get } from '@nestjs/common';
import { users } from '../../common/mock-store.js';

@Controller('profile')
export class ProfileController {
  @Get()
  me() {
    return users[0];
  }
}
