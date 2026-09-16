import { Controller, Get } from '@nestjs/common';
import { TriageService } from './triage.service.js';

@Controller('triage')
export class TriageController {
  constructor(private readonly triageService: TriageService) {}

  @Get('queue')
  queue() {
    return this.triageService.queue();
  }
}
