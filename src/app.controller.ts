import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { SupabaseService } from './supabase/supabase.service.js';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('health')
  health() {
    return this.appService.health();
  }

  @Get('supabase/ping')
  async supabasePing() {
    const { data, error } = await this.supabase.ping();
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true, table: 'departamentos', rows: data };
  }
}
