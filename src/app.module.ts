import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin/admin.module.js';
import { ApiModule } from './api/api.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AtivosModule } from './ativos/ativos.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BrandingModule } from './branding/branding.module.js';
import { CatalogoModule } from './catalogo/catalogo.module.js';
import { CategoriasModule } from './categorias/categorias.module.js';
import { ChamadosModule } from './chamados/chamados.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DepartamentosModule } from './departamentos/departamentos.module.js';
import { GruposModule } from './grupos/grupos.module.js';
import { KbModule } from './kb/kb.module.js';
import { NotificacoesModule } from './notificacoes/notificacoes.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { UsuariosModule } from './usuarios/usuarios.module.js';

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
    ChamadosModule,
    CatalogoModule,
    UsuariosModule,
    DepartamentosModule,
    CategoriasModule,
    GruposModule,
    AtivosModule,
    KbModule,
    NotificacoesModule,
    BrandingModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
