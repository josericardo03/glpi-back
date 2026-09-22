import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApiModule } from './api/api.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { Fase2Module } from './fase2/fase2.module.js';
import { Fase3Module } from './fase3/fase3.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenantsModule } from './tenants/tenants.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      expandVariables: true,
    }),
    PrismaModule,
    DatabaseModule,
    AuthModule,
    AuditModule,
    TenantsModule,
    ApiModule,
    Fase2Module,
    Fase3Module,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
