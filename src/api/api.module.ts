import { Module } from '@nestjs/common';
import { ApiController } from './api.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  controllers: [ApiController],
  providers: [AuthService],
})
export class ApiModule {}
