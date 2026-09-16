import { Controller, Get } from '@nestjs/common';
import { DashboardsService } from './dashboards.service.js';

@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly dashboardsService: DashboardsService) {}

  @Get('manager')
  manager() {
    return this.dashboardsService.manager();
  }

  @Get('technician')
  technician() {
    return this.dashboardsService.technician();
  }
}
