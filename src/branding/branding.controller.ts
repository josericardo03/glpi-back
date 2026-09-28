import { Body, Controller, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.js';
import type { AuthUser } from '../auth/auth.types.js';
import { UpdateBrandingDto } from './dto/branding.dto.js';
import { BrandingService } from './branding.service.js';

@Controller()
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Put('branding')
  @Roles('ADMIN')
  atualizar(@CurrentUser() user: AuthUser, @Body() dto: UpdateBrandingDto) {
    return this.branding.atualizar(user, dto);
  }
}
