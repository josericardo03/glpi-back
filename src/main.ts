import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';

const logger = new Logger('Bootstrap');

process.on('unhandledRejection', (reason) => {
  logger.error(reason instanceof Error ? (reason.stack ?? reason.message) : String(reason));
});

process.on('uncaughtException', (error) => {
  // Após uma exceção não tratada o processo está em estado indefinido: registra e encerra
  // para o orquestrador (Docker `restart`) subir uma instância limpa.
  logger.error(error.stack ?? error.message);
  process.exit(1);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  // O nginx do docker-compose acrescenta o IP real ao X-Forwarded-For. Confiar só em proxies de rede
  // privada faz `req.ip` ignorar entradas forjadas pelo cliente. Ajuste com TRUST_PROXY se preciso.
  app.getHttpAdapter().getInstance().set('trust proxy', process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');
  app.use(compression());
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? true,
    exposedHeaders: ['X-Total-Count'],
  });
  app.getHttpAdapter().getInstance().use((_: Request, res: Response, next: NextFunction) => {
    res.setTimeout(60_000);
    // Impede o navegador de reinterpretar o tipo dos anexos baixados.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((error: unknown) => {
  logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
