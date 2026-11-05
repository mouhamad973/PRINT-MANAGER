import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ConsumptionModule } from '../consumption/consumption.module.js';
import { PaperController } from './paper.controller.js';
import { PaperService } from './paper.service.js';

/** Papier (Phase 9) : types, stocks par site et registre des mouvements. */
@Module({
  imports: [AuditModule, AlertsModule, ConsumptionModule],
  controllers: [PaperController],
  providers: [PaperService],
  exports: [PaperService],
})
export class PaperModule {}
