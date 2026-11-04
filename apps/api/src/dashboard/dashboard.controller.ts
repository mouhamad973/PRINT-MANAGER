import type { FleetDashboard } from '@arksen/shared-types';
import { fleetDashboardQuerySchema, type FleetDashboardQuery } from '@arksen/validation';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.js';
import { DashboardService } from './dashboard.service.js';

@ApiTags('Tableau de bord')
@ApiCookieAuth()
@Controller('tenants/:tenantId/fleet-dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermissions('printers:read')
  @ApiOperation({ summary: 'Indicateurs du parc, filtrables par site et par type couleur' })
  get(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(fleetDashboardQuerySchema)) query: FleetDashboardQuery,
  ): Promise<FleetDashboard> {
    return this.dashboard.get(tenantId, query);
  }
}
