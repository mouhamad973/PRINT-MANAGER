import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { ConsumptionModule } from '../consumption/consumption.module.js';
import { CostsController } from './costs.controller.js';
import { CostsService } from './costs.service.js';

/** Coûts d'impression et coût copie (Phase 9). */
@Module({
  imports: [AuditModule, ConsumptionModule],
  controllers: [CostsController],
  providers: [CostsService],
  exports: [CostsService],
})
export class CostsModule {}
