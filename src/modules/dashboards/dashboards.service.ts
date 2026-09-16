import { Injectable } from '@nestjs/common';
import { tickets } from '../../common/mock-store.js';

@Injectable()
export class DashboardsService {
  manager() {
    return {
      openTickets: tickets.filter((t) => t.status !== 'CLOSED').length,
      inTriage: tickets.filter((t) => t.status === 'TRIAGE').length,
      slaAtRisk: 1,
      byPriority: [
        { priority: 'CRITICAL', count: 0 },
        { priority: 'HIGH', count: 1 },
        { priority: 'MEDIUM', count: 0 },
        { priority: 'LOW', count: 0 },
      ],
    };
  }

  technician() {
    return {
      assignedToMe: tickets.filter((t) => t.assigneeId === 'u-2').length,
      waitingUser: 0,
      resolvedToday: 0,
      queue: tickets.filter((t) => t.assigneeId === 'u-2'),
    };
  }
}
