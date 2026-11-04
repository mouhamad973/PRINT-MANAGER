import type {
  AgentEnrollmentCode,
  AgentSyncLog,
  CollectorAgent,
  DiscoveredDevice,
  Page,
  PrinterSnmpState,
  RejectedAgentEvent,
} from '@arksen/shared-types';
import {
  agentCreateSchema,
  agentSyncLogQuerySchema,
  agentUpdateSchema,
  discoveredDeviceUpdateSchema,
  listQuerySchema,
  type AgentCreateInput,
  type AgentSyncLogQuery,
  type AgentUpdateInput,
  type DiscoveredDeviceUpdateInput,
  type ListQuery,
} from '@arksen/validation';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators.js';
import {
  CurrentPrincipal,
  CurrentRequestContext,
  type Principal,
  type RequestContext,
} from '../auth/principal.js';
import { openApiSchema, ZodPipe } from '../common/zod.js';
import { AgentsService } from './agents.service.js';

@ApiTags('Agents de collecte')
@ApiCookieAuth()
@Controller('tenants/:tenantId')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get('agents')
  @RequirePermissions('agents:read')
  @ApiOperation({
    summary: 'Agents de collecte de l’entreprise, avec leur activité des dernières 24 heures',
  })
  list(@Param('tenantId') tenantId: string): Promise<CollectorAgent[]> {
    return this.agents.list(tenantId);
  }

  @Post('agents')
  @RequirePermissions('agents:manage')
  @ApiOperation({
    summary: 'Déclare un agent et délivre son code d’enregistrement',
    description: 'Le code, valable 24 heures et à usage unique, n’est montré qu’une fois.',
  })
  @ApiBody({ schema: openApiSchema(agentCreateSchema) })
  create(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(agentCreateSchema)) input: AgentCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<AgentEnrollmentCode> {
    return this.agents.create(tenantId, input, actor, context);
  }

  @Get('agents/sync-logs')
  @RequirePermissions('agents:read')
  @ApiOperation({
    summary: 'Journal des synchronisations reçues, de la plus récente à la plus ancienne',
  })
  syncLogs(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(agentSyncLogQuerySchema)) query: AgentSyncLogQuery,
  ): Promise<Page<AgentSyncLog>> {
    return this.agents.syncLogs(tenantId, query);
  }

  @Get('agents/rejected-events')
  @RequirePermissions('agents:read')
  @ApiOperation({ summary: 'Événements rejetés par le serveur, avec leur raison' })
  rejectedEvents(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(listQuerySchema)) query: ListQuery,
  ): Promise<Page<RejectedAgentEvent>> {
    return this.agents.rejectedEvents(tenantId, query);
  }

  @Patch('agents/:agentId')
  @RequirePermissions('agents:manage')
  @ApiOperation({ summary: 'Renomme un agent ou change son site' })
  @ApiBody({ schema: openApiSchema(agentUpdateSchema) })
  update(
    @Param('tenantId') tenantId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Body(new ZodPipe(agentUpdateSchema)) input: AgentUpdateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<CollectorAgent> {
    return this.agents.update(tenantId, agentId, input, actor, context);
  }

  @Post('agents/:agentId/enrollment-code')
  @RequirePermissions('agents:manage')
  @ApiOperation({
    summary: 'Délivre un nouveau code d’enregistrement (réinstallation, agent révoqué)',
  })
  renewCode(
    @Param('tenantId') tenantId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<AgentEnrollmentCode> {
    return this.agents.renewCode(tenantId, agentId, actor, context);
  }

  @Post('agents/:agentId/revoke')
  @RequirePermissions('agents:manage')
  @ApiOperation({ summary: 'Révoque un agent : son jeton cesse immédiatement d’être accepté' })
  revoke(
    @Param('tenantId') tenantId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<CollectorAgent> {
    return this.agents.revoke(tenantId, agentId, actor, context);
  }

  @Get('discovered-devices')
  @RequirePermissions('agents:read')
  @ApiOperation({ summary: 'Équipements trouvés par la découverte réseau des agents' })
  devices(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(listQuerySchema)) query: ListQuery,
  ): Promise<Page<DiscoveredDevice>> {
    return this.agents.discoveredDevices(tenantId, query);
  }

  @Patch('discovered-devices/:deviceId')
  @RequirePermissions('agents:manage')
  @ApiOperation({ summary: 'Rattache un équipement découvert à une machine, ou l’ignore' })
  @ApiBody({ schema: openApiSchema(discoveredDeviceUpdateSchema) })
  updateDevice(
    @Param('tenantId') tenantId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body(new ZodPipe(discoveredDeviceUpdateSchema)) input: DiscoveredDeviceUpdateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<DiscoveredDevice> {
    return this.agents.updateDevice(tenantId, deviceId, input, actor, context);
  }

  @Get('printers/:printerId/snmp-state')
  @RequirePermissions('printers:read')
  @ApiOperation({ summary: 'Dernier état SNMP collecté d’une machine : statut, alertes, niveaux' })
  async state(
    @Param('tenantId') tenantId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
  ): Promise<{ state: PrinterSnmpState | null }> {
    return { state: await this.agents.printerState(tenantId, printerId) };
  }
}
