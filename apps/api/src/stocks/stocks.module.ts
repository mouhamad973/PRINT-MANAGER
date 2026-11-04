import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ConsumptionModule } from '../consumption/consumption.module.js';
import { ForecastScheduler } from './forecast.scheduler.js';
import { ReplacementsService } from './replacements.service.js';
import { StocksController } from './stocks.controller.js';
import { StocksService } from './stocks.service.js';

/** Toners et stocks (Phase 8) : articles, registre, transferts, remplacements, prévisions. */
@Module({
  imports: [AuditModule, AlertsModule, ConsumptionModule],
  controllers: [StocksController],
  providers: [StocksService, ReplacementsService, ForecastScheduler],
})
export class StocksModule {}
