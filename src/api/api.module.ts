import { Module } from '@nestjs/common';
import { ApiController } from './api.controller.js';
import { ListagemService } from './listagem.service.js';
import { PainelService } from './painel.service.js';

@Module({
  controllers: [ApiController],
  providers: [ListagemService, PainelService],
})
export class ApiModule {}
