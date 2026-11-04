import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SECRET_BOX, SecretBox } from '../common/secret-box.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrintersController } from './printers.controller.js';
import { PrintersService } from './printers.service.js';

@Module({
  imports: [AuditModule],
  controllers: [PrintersController],
  providers: [
    PrintersService,
    {
      provide: SECRET_BOX,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new SecretBox(config.CREDENTIALS_ENCRYPTION_KEY),
    },
  ],
})
export class PrintersModule {}
