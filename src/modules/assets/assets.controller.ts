import { Controller, Get, Param } from '@nestjs/common';
import { assets } from '../../common/mock-store.js';

@Controller('assets')
export class AssetsController {
  @Get()
  findAll() {
    return assets;
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return assets.find((item) => item.id === id);
  }
}
