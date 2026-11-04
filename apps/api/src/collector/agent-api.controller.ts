import type { AgentConfiguration, AgentEnrollment, AgentEventsResult } from '@arksen/shared-types';
import {
  agentEnrollSchema,
  agentEventsBatchSchema,
  type AgentEnrollInput,
  type AgentEventsBatchInput,
} from '@arksen/validation';
import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/decorators.js';
import { openApiSchema, ZodPipe } from '../common/zod.js';
import { AgentGuard, CurrentAgent, type AgentPrincipal } from './agent.guard.js';
import { AgentSyncService } from './agent-sync.service.js';

/**
 * Routes de l'agent Windows. Elles n'utilisent pas de session : l'agent s'authentifie par son
 * jeton (`Authorization: Bearer ark_…`), sauf pour s'enregistrer avec son code à usage unique.
 */
@ApiTags('Protocole des agents')
@Public()
@Controller('agent/v1')
export class AgentApiController {
  constructor(private readonly sync: AgentSyncService) {}

  @Post('enroll')
  @HttpCode(201)
  @ApiOperation({ summary: 'Échange un code d’enregistrement contre le jeton de l’agent' })
  @ApiBody({ schema: openApiSchema(agentEnrollSchema) })
  enroll(
    @Body(new ZodPipe(agentEnrollSchema)) input: AgentEnrollInput,
    @Req() request: Request,
  ): Promise<AgentEnrollment> {
    return this.sync.enroll(input, request.ip ?? null);
  }

  @Get('config')
  @UseGuards(AgentGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Machines à interroger et leur configuration SNMP' })
  config(@CurrentAgent() agent: AgentPrincipal): Promise<AgentConfiguration> {
    return this.sync.configuration(agent);
  }

  @Post('events')
  @HttpCode(200)
  @UseGuards(AgentGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reçoit un lot de l’outbox de l’agent et acquitte chaque événement',
    description:
      'Idempotent : un événement déjà reçu est acquitté « duplicate » sans être retraité. Un événement rejeté l’est définitivement, avec sa raison.',
  })
  @ApiBody({ schema: openApiSchema(agentEventsBatchSchema) })
  events(
    @CurrentAgent() agent: AgentPrincipal,
    @Body(new ZodPipe(agentEventsBatchSchema)) batch: AgentEventsBatchInput,
  ): Promise<AgentEventsResult> {
    return this.sync.ingest(agent, batch);
  }
}
