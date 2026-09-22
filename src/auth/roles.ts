import { SetMetadata } from '@nestjs/common';
import type { PerfilUsuario } from '../auth/auth.types.js';

export const ROLES_KEY = 'roles';

const RANK: Record<PerfilUsuario, number> = {
  SOLICITANTE: 1,
  TECNICO: 2,
  GESTOR: 3,
  ADMIN: 4,
};

export const Roles = (...roles: PerfilUsuario[]) => SetMetadata(ROLES_KEY, roles);

export function possuiPerfil(atual: PerfilUsuario, minimo: PerfilUsuario) {
  return RANK[atual] >= RANK[minimo];
}
