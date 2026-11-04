import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AlertsController } from './alerts.controller.js';
import { AlertsService } from './alerts.service.js';

/** Alertes (Phase 8) : ouvertes et résolues par les modules qui surveillent leurs conditions. */
@Module({
  imports: [AuditModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
