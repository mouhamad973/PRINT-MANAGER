import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { ConsumptionModule } from './consumption/consumption.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { MeModule } from './me/me.module.js';
import { MetersModule } from './meters/meters.module.js';
import { AlertsModule } from './alerts/alerts.module.js';
import { CollectorModule } from './collector/collector.module.js';
import { PrintJobsModule } from './print-jobs/print-jobs.module.js';
import { StocksModule } from './stocks/stocks.module.js';
import { ContractsModule } from './contracts/contracts.module.js';
import { CostsModule } from './costs/costs.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { PaperModule } from './paper/paper.module.js';
import { PrinterModelsModule } from './printer-models/printer-models.module.js';
import { PrintersModule } from './printers/printers.module.js';
import { RedisModule } from './redis/redis.module.js';
import { SitesModule } from './sites/sites.module.js';
import { SystemModule } from './system/system.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    AuditModule,
    AuthModule,
    HealthModule,
    SystemModule,
    MeModule,
    TenantsModule,
    UsersModule,
    SitesModule,
    PrinterModelsModule,
    PrintersModule,
    DashboardModule,
    MetersModule,
    ConsumptionModule,
    PrintJobsModule,
    CollectorModule,
    AlertsModule,
    StocksModule,
    PaperModule,
    CostsModule,
    ContractsModule,
    MaintenanceModule,
  ],
})
export class AppModule {}
