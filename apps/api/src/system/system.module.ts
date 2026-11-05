import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AdminController } from './admin.controller.js';
import { RetentionScheduler } from './retention.scheduler.js';
import { RetentionService } from './retention.service.js';
import { SystemController } from './system.controller.js';

@Module({
  imports: [AuditModule],
  controllers: [SystemController, AdminController],
  providers: [RetentionService, RetentionScheduler],
})
export class SystemModule {}
