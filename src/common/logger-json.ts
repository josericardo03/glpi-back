import { LoggerService } from '@nestjs/common';

type Nivel = 'error' | 'warn' | 'log' | 'debug' | 'verbose';

/**
 * Logger de uma linha JSON por evento (stdout), fácil de ingerir em Loki, ELK, CloudWatch...
 * Se a mensagem for um objeto, os campos dele entram direto na linha (ex.: o log de acesso).
 */
export class LoggerJson implements LoggerService {
  private escrever(nivel: Nivel, mensagem: unknown, contexto?: string, extra?: Record<string, unknown>) {
    const base: Record<string, unknown> = { ts: new Date().toISOString(), nivel, ...(contexto ? { contexto } : {}) };
    if (mensagem !== null && typeof mensagem === 'object' && !(mensagem instanceof Error)) Object.assign(base, mensagem);
    else base.mensagem = mensagem instanceof Error ? mensagem.message : String(mensagem);
    if (mensagem instanceof Error) base.pilha = mensagem.stack;
    Object.assign(base, extra);
    (nivel === 'error' ? process.stderr : process.stdout).write(`${JSON.stringify(base)}\n`);
  }

  /** O Nest passa o contexto como último argumento (e a pilha antes dele, nos erros). */
  private separar(parametros: unknown[]) {
    const contexto = typeof parametros[parametros.length - 1] === 'string' ? (parametros.pop() as string) : undefined;
    return { contexto, restante: parametros };
  }

  log(mensagem: unknown, ...p: unknown[]) {
    this.escrever('log', mensagem, this.separar(p).contexto);
  }

  warn(mensagem: unknown, ...p: unknown[]) {
    this.escrever('warn', mensagem, this.separar(p).contexto);
  }

  error(mensagem: unknown, ...p: unknown[]) {
    const { contexto, restante } = this.separar(p);
    this.escrever('error', mensagem, contexto, restante.length ? { pilha: String(restante[0]) } : undefined);
  }

  debug(mensagem: unknown, ...p: unknown[]) {
    if (process.env.LOG_LEVEL === 'debug') this.escrever('debug', mensagem, this.separar(p).contexto);
  }

  verbose(mensagem: unknown, ...p: unknown[]) {
    if (process.env.LOG_LEVEL === 'debug') this.escrever('verbose', mensagem, this.separar(p).contexto);
  }
}
