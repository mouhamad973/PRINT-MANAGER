import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CatalogTonersController, ConsumptionController } from './consumption.controller.js';
import { ConsumptionService } from './consumption.service.js';
import { EngineClient } from './engine.client.js';

@Module({
  imports: [AuditModule],
  controllers: [CatalogTonersController, ConsumptionController],
  providers: [ConsumptionService, EngineClient],
  exports: [ConsumptionService],
})
export class ConsumptionModule {}
