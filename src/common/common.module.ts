import { Global, Module } from '@nestjs/common';
import { LimitadorService } from './limitador.service.js';
import { MetricasController } from './metricas.controller.js';
import { MetricasService } from './metricas.service.js';

@Global()
@Module({
  controllers: [MetricasController],
  providers: [LimitadorService, MetricasService],
  exports: [LimitadorService, MetricasService],
})
export class CommonModule {}
