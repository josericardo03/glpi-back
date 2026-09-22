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
    const req = context.switchToHttp().getRequest<{
      ip?: string;
      user?: AuthUser;
      headers: Record<string, string | string[] | undefined>;
    }>();
    const forwarded = req.headers['x-forwarded-for'];
    const headerIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const ip = headerIp?.split(',')[0]?.trim() || req.ip || null;
    return auditAls.run({ ip, user: req.user }, () => next.handle());
  }
}
