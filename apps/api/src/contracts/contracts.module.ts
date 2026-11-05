import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { ConsumptionModule } from '../consumption/consumption.module.js';
import { CostsModule } from '../costs/costs.module.js';
import { ContractsController } from './contracts.controller.js';
import { ContractsService } from './contracts.service.js';

/** Contrats clients au coût copie et relevés de facturation (Phase 9). */
@Module({
  imports: [AuditModule, ConsumptionModule, CostsModule],
  controllers: [ContractsController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
