import { Injectable, NotFoundException } from '@nestjs/common';
import {
  followups,
  now,
  tickets,
  users,
} from '../../common/mock-store.js';
import type { TicketPriority, TicketStatus } from '../../common/types.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';

@Injectable()
export class TicketsService {
  findAll(status?: TicketStatus) {
    return status
      ? tickets.filter((ticket) => ticket.status === status)
      : tickets;
  }

  findOne(id: string) {
    const ticket = tickets.find((item) => item.id === id || String(item.number) === id);
    if (!ticket) {
      throw new NotFoundException('Ticket não encontrado');
    }

    return {
      ...ticket,
      requester: users.find((user) => user.id === ticket.requesterId),
      assignee: users.find((user) => user.id === ticket.assigneeId),
      followups: followups.filter((item) => item.ticketId === ticket.id),
    };
  }

  create(dto: CreateTicketDto) {
    const ticket = {
      id: `t-${Date.now()}`,
      number: tickets.length + 11,
      title: dto.title,
      description: dto.description,
      status: 'NEW' as TicketStatus,
      priority: (dto.priority as TicketPriority) ?? 'MEDIUM',
      requesterId: 'u-3',
      assigneeId: null as string | null,
      departmentId: 'd-1',
      categoryId: dto.categoryId ?? null,
      slaRuleId: 'sla-2',
      assetId: dto.assetId ?? null,
      createdAt: now(),
      updatedAt: now(),
    };
    tickets.push(ticket);
    return ticket;
  }
}
