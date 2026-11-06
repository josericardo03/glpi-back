import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthUser } from '../auth/auth.types.js';
import { auditAls } from './audit.context.js';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ ip?: string; user?: AuthUser }>();
    // `req.ip` já considera o X-Forwarded-For apenas dos proxies confiáveis (`trust proxy` em main.ts).
    // Ler o cabeçalho direto deixaria o cliente forjar o IP gravado na auditoria.
    return auditAls.run({ ip: req.ip ?? null, user: req.user }, () => next.handle());
  }
}
