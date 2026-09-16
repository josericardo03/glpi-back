import { Controller, Get } from '@nestjs/common';
import { categories } from '../../common/mock-store.js';

@Controller('categories')
export class CategoriesController {
  @Get()
  findAll() {
    return categories;
  }
}
