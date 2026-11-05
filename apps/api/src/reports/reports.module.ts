import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { ConsumptionModule } from '../consumption/consumption.module.js';
import { CostsModule } from '../costs/costs.module.js';
import { MaintenanceModule } from '../maintenance/maintenance.module.js';
import { PaperModule } from '../paper/paper.module.js';
import { StocksModule } from '../stocks/stocks.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** Rapports PDF, Excel et CSV, et statistiques avancées (Phase 10). */
@Module({
  imports: [
    AuditModule,
    ConsumptionModule,
    CostsModule,
    StocksModule,
    PaperModule,
    MaintenanceModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
