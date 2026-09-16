import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ApprovalsModule } from './modules/approvals/approvals.module.js';
import { AssetsModule } from './modules/assets/assets.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BrandingModule } from './modules/branding/branding.module.js';
import { CategoriesModule } from './modules/categories/categories.module.js';
import { DashboardsModule } from './modules/dashboards/dashboards.module.js';
import { DepartmentsModule } from './modules/departments/departments.module.js';
import { GroupsModule } from './modules/groups/groups.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { ProfileModule } from './modules/profile/profile.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { SlaModule } from './modules/sla/sla.module.js';
import { TicketsModule } from './modules/tickets/tickets.module.js';
import { TriageModule } from './modules/triage/triage.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SupabaseModule } from './supabase/supabase.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    PrismaModule,
    SupabaseModule,
    AuthModule,
    TicketsModule,
    TriageModule,
    DashboardsModule,
    UsersModule,
    GroupsModule,
    DepartmentsModule,
    SlaModule,
    CategoriesModule,
    ApprovalsModule,
    ReportsModule,
    KnowledgeBaseModule,
    AssetsModule,
    NotificationsModule,
    AuditModule,
    BrandingModule,
    IntegrationsModule,
    ProfileModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
