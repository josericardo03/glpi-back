import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service.js';
import { EventosService } from './eventos.service.js';
import { WebhookService } from './webhook.service.js';

/** Global: qualquer módulo de negócio pode emitir eventos (notificação, e-mail, webhook) sem importar nada. */
@Global()
@Module({
  providers: [EmailService, WebhookService, EventosService],
  exports: [EmailService, WebhookService, EventosService],
})
export class IntegracoesModule {}
