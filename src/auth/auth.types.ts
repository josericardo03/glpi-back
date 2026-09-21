export type PerfilUsuario =
  | 'ADMIN'
  | 'GESTOR'
  | 'TECNICO'
  | 'SOLICITANTE';

export type AuthUser = {
  id: number;
  id_cliente: number;
  email: string;
  nome: string;
  perfil: PerfilUsuario;
  cargo: string;
  status: string;
};

export type JwtPayload = {
  sub: number;
  id_cliente: number;
  perfil: PerfilUsuario;
  email: string;
};
