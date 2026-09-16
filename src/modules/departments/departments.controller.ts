import { Controller, Get } from '@nestjs/common';
import { departments } from '../../common/mock-store.js';

@Controller('departments')
export class DepartmentsController {
  @Get()
  findAll() {
    return departments;
  }
}
