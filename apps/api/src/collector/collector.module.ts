import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SECRET_BOX, SecretBox } from '../common/secret-box.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { AgentApiController } from './agent-api.controller.js';
import { AgentGuard } from './agent.guard.js';
import { AgentSyncService } from './agent-sync.service.js';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';

/** Collecte SNMP (Phase 7) : administration des agents et protocole de synchronisation. */
@Module({
  imports: [AuditModule],
  controllers: [AgentsController, AgentApiController],
  providers: [
    AgentsService,
    AgentSyncService,
    AgentGuard,
    {
      provide: SECRET_BOX,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new SecretBox(config.CREDENTIALS_ENCRYPTION_KEY),
    },
  ],
})
export class CollectorModule {}
