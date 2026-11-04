import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CatalogController, TenantPrinterModelsController } from './printer-models.controller.js';
import { PrinterModelsService } from './printer-models.service.js';

@Module({
  imports: [AuditModule],
  controllers: [CatalogController, TenantPrinterModelsController],
  providers: [PrinterModelsService],
})
export class PrinterModelsModule {}
