import { Injectable } from '@nestjs/common';
import { tickets } from '../../common/mock-store.js';

@Injectable()
export class TriageService {
  queue() {
    return tickets.filter(
      (ticket) => ticket.status === 'NEW' || ticket.status === 'TRIAGE',
    );
  }
}
