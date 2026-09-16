import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { TicketStatus } from '../../common/types.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { TicketsService } from './tickets.service.js';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  findAll(@Query('status') status?: TicketStatus) {
    return this.ticketsService.findAll(status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ticketsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTicketDto) {
    return this.ticketsService.create(dto);
  }
}
