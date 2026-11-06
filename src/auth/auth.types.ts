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
  /** Sessão (dispositivo) do token de acesso, quando houver. */
  sid?: string;
};

export type JwtPayload = {
  sub: number;
  id_cliente: number;
  perfil: PerfilUsuario;
  email: string;
  /** Versão dos tokens do usuário: somar 1 no banco invalida todos os tokens emitidos antes. */
  tv: number;
  /** Id da sessão (linha em `sessoes`). */
  sid: string;
};
