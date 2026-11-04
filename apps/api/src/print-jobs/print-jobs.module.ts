import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { ConsumptionModule } from '../consumption/consumption.module.js';
import { AnalysisClient } from './analysis.client.js';
import { PrintJobsController } from './print-jobs.controller.js';
import { PrintJobsService } from './print-jobs.service.js';

@Module({
  imports: [AuditModule, ConsumptionModule],
  controllers: [PrintJobsController],
  providers: [PrintJobsService, AnalysisClient],
})
export class PrintJobsModule {}
