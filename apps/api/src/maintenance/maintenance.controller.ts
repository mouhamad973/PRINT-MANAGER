import type { Assignee, Intervention, MaintenancePlan, Page } from '@arksen/shared-types';
import {
  interventionCreateSchema,
  interventionListQuerySchema,
  interventionUpdateSchema,
  maintenancePlanCreateSchema,
  maintenancePlanUpdateSchema,
  type InterventionCreateInput,
  type InterventionListQuery,
  type InterventionUpdateInput,
  type MaintenancePlanCreateInput,
  type MaintenancePlanUpdateInput,
} from '@arksen/validation';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators.js';
import {
  CurrentPrincipal,
  CurrentRequestContext,
  type Principal,
  type RequestContext,
} from '../auth/principal.js';
import { openApiSchema, ZodPipe } from '../common/zod.js';
import { MaintenanceService } from './maintenance.service.js';

@ApiTags('Interventions et maintenance')
@ApiCookieAuth()
@Controller('tenants/:tenantId')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get('interventions')
  @RequirePermissions('interventions:read')
  @ApiOperation({ summary: 'Interventions, actives par défaut, les plus urgentes d’abord' })
  list(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(interventionListQuerySchema)) query: InterventionListQuery,
  ): Promise<Page<Intervention>> {
    return this.maintenance.list(tenantId, query);
  }

  @Get('interventions/assignees')
  @RequirePermissions('interventions:manage')
  @ApiOperation({ summary: 'Personnes à qui confier une intervention' })
  assignees(@Param('tenantId') tenantId: string): Promise<Assignee[]> {
    return this.maintenance.assignees(tenantId);
  }

  @Post('interventions')
  @RequirePermissions('interventions:report')
  @ApiOperation({ summary: 'Signale une panne ou planifie une intervention' })
  @ApiBody({ schema: openApiSchema(interventionCreateSchema) })
  create(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(interventionCreateSchema)) input: InterventionCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<Intervention> {
    return this.maintenance.create(tenantId, input, actor, context);
  }

  @Get('interventions/:interventionId')
  @RequirePermissions('interventions:read')
  get(
    @Param('tenantId') tenantId: string,
    @Param('interventionId', ParseUUIDPipe) interventionId: string,
  ): Promise<Intervention> {
    return this.maintenance.get(tenantId, interventionId);
  }

  @Patch('interventions/:interventionId')
  @RequirePermissions('interventions:manage')
  @ApiOperation({ summary: 'Planifie, affecte, démarre, termine ou annule une intervention' })
  @ApiBody({ schema: openApiSchema(interventionUpdateSchema) })
  update(
    @Param('tenantId') tenantId: string,
    @Param('interventionId', ParseUUIDPipe) interventionId: string,
    @Body(new ZodPipe(interventionUpdateSchema)) input: InterventionUpdateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<Intervention> {
    return this.maintenance.update(tenantId, interventionId, input, actor, context);
  }

  @Get('maintenance-plans')
  @RequirePermissions('interventions:read')
  @ApiOperation({ summary: 'Plans de maintenance préventive et leur échéance' })
  @ApiQuery({ name: 'printerId', required: false })
  plans(
    @Param('tenantId') tenantId: string,
    @Query('printerId', new ParseUUIDPipe({ optional: true })) printerId?: string,
  ): Promise<MaintenancePlan[]> {
    return this.maintenance.plans(tenantId, printerId);
  }

  @Post('maintenance-plans')
  @RequirePermissions('interventions:manage')
  @ApiBody({ schema: openApiSchema(maintenancePlanCreateSchema) })
  createPlan(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(maintenancePlanCreateSchema)) input: MaintenancePlanCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<MaintenancePlan> {
    return this.maintenance.createPlan(tenantId, input, actor, context);
  }

  @Patch('maintenance-plans/:planId')
  @RequirePermissions('interventions:manage')
  @ApiBody({ schema: openApiSchema(maintenancePlanUpdateSchema) })
  updatePlan(
    @Param('tenantId') tenantId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body(new ZodPipe(maintenancePlanUpdateSchema)) input: MaintenancePlanUpdateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<MaintenancePlan> {
    return this.maintenance.updatePlan(tenantId, planId, input, actor, context);
  }
}
