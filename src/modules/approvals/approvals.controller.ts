import { Controller, Get } from '@nestjs/common';
import { approvals } from '../../common/mock-store.js';

@Controller('approvals')
export class ApprovalsController {
  @Get('pending')
  pending() {
    return approvals.filter((item) => item.status === 'PENDING');
  }
}
