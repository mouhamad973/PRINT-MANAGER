import type { Alert, AlertSummary, Page } from '@arksen/shared-types';
import {
  alertActionSchema,
  alertListQuerySchema,
  type AlertActionInput,
  type AlertListQuery,
} from '@arksen/validation';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators.js';
import {
  CurrentPrincipal,
  CurrentRequestContext,
  type Principal,
  type RequestContext,
} from '../auth/principal.js';
import { openApiSchema, ZodPipe } from '../common/zod.js';
import { AlertsService } from './alerts.service.js';

@ApiTags('Alertes')
@ApiCookieAuth()
@Controller('tenants/:tenantId/alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  @RequirePermissions('alerts:read')
  @ApiOperation({ summary: 'Alertes, actives par défaut, les critiques d’abord' })
  list(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(alertListQuerySchema)) query: AlertListQuery,
  ): Promise<Page<Alert>> {
    return this.alerts.list(tenantId, query);
  }

  @Get('summary')
  @RequirePermissions('alerts:read')
  @ApiOperation({ summary: 'Alertes actives par type, et articles de stock critiques' })
  summary(@Param('tenantId') tenantId: string): Promise<AlertSummary> {
    return this.alerts.summary(tenantId);
  }

  @Patch(':alertId')
  @RequirePermissions('alerts:manage')
  @ApiOperation({ summary: 'Prend en compte ou clôture une alerte' })
  @ApiBody({ schema: openApiSchema(alertActionSchema) })
  act(
    @Param('tenantId') tenantId: string,
    @Param('alertId', ParseUUIDPipe) alertId: string,
    @Body(new ZodPipe(alertActionSchema)) input: AlertActionInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<Alert> {
    return this.alerts.act(tenantId, alertId, input.action, actor, context);
  }
}
