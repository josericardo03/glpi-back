import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthUser } from '../auth/auth.types.js';

export type AuditStore = {
  ip: string | null;
  user?: AuthUser;
};

export const auditAls = new AsyncLocalStorage<AuditStore>();
