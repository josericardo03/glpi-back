import { Controller, Get } from '@nestjs/common';
import { tickets } from '../../common/mock-store.js';

@Controller('reports')
export class ReportsController {
  @Get('tickets')
  tickets() {
    return {
      total: tickets.length,
      series: [{ label: 'Abertos', value: tickets.length }],
    };
  }

  @Get('productivity')
  productivity() {
    return {
      technicians: [{ name: 'Carlos Técnico', resolved: 0, assigned: 1 }],
    };
  }

  @Get('sla-compliance')
  slaCompliance() {
    return {
      compliancePercent: 92,
      breached: 0,
      withinSla: tickets.length,
    };
  }
}
