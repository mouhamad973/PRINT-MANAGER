import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { MeController } from './me.controller.js';

@Module({
  imports: [AuditModule],
  controllers: [MeController],
})
export class MeModule {}
