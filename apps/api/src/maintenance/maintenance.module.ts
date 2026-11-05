import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceScheduler } from './maintenance.scheduler.js';
import { MaintenanceService } from './maintenance.service.js';

/** Interventions techniques et maintenance préventive (Phase 9). */
@Module({
  imports: [AuditModule, AlertsModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService, MaintenanceScheduler],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
