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
  logger.error(error.stack ?? error.message);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.use(compression());
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? true,
    exposedHeaders: ['X-Total-Count'],
  });
  app.getHttpAdapter().getInstance().use((_: Request, res: Response, next: NextFunction) => {
    res.setTimeout(60_000);
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
