import { Controller, Get } from '@nestjs/common';
import { notifications } from '../../common/mock-store.js';

@Controller('notifications')
export class NotificationsController {
  @Get()
  findAll() {
    return notifications;
  }
}
