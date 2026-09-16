import { Controller, Get, Param } from '@nestjs/common';
import { articles } from '../../common/mock-store.js';

@Controller('knowledge-base')
export class KnowledgeBaseController {
  @Get()
  findAll() {
    return articles.filter((item) => item.published);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return articles.find((item) => item.id === id);
  }
}
