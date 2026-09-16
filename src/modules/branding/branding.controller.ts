import { Controller, Get } from '@nestjs/common';
import { branding } from '../../common/mock-store.js';

@Controller('branding')
export class BrandingController {
  @Get()
  get() {
    return branding;
  }
}
