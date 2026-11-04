import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { MetersController } from './meters.controller.js';
import { MetersService } from './meters.service.js';

@Module({
  imports: [AuditModule],
  controllers: [MetersController],
  providers: [MetersService],
})
export class MetersModule {}
