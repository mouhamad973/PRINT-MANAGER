import type { Page, Tenant } from '@arksen/shared-types';
import {
  tenantCreateSchema,
  tenantListQuerySchema,
  tenantUpdateSchema,
  type TenantCreateInput,
  type TenantListQuery,
  type TenantUpdateInput,
} from '@arksen/validation';
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators.js';
import {
  CurrentPrincipal,
  CurrentRequestContext,
  type Principal,
  type RequestContext,
} from '../auth/principal.js';
import { openApiSchema, ZodPipe } from '../common/zod.js';
import { TenantsService } from './tenants.service.js';

@ApiTags('Entreprises clientes')
@ApiCookieAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  @RequirePermissions('platform:tenants:manage')
  @ApiOperation({ summary: 'Liste des entreprises clientes' })
  list(@Query(new ZodPipe(tenantListQuerySchema)) query: TenantListQuery): Promise<Page<Tenant>> {
    return this.tenants.list(query);
  }

  @Post()
  @RequirePermissions('platform:tenants:manage')
  @ApiOperation({ summary: 'Crée une entreprise cliente' })
  @ApiBody({ schema: openApiSchema(tenantCreateSchema) })
  create(
    @Body(new ZodPipe(tenantCreateSchema)) input: TenantCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<Tenant> {
    return this.tenants.create(input, actor, context);
  }

  @Get(':tenantId')
  @RequirePermissions('tenant:read')
  @ApiOperation({ summary: 'Fiche d’une entreprise' })
  get(@Param('tenantId') tenantId: string): Promise<Tenant> {
    return this.tenants.get(tenantId);
  }

  @Patch(':tenantId')
  @RequirePermissions('platform:tenants:manage')
  @ApiOperation({ summary: 'Modifie, suspend ou réactive une entreprise' })
  @ApiBody({ schema: openApiSchema(tenantUpdateSchema) })
  update(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(tenantUpdateSchema)) input: TenantUpdateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<Tenant> {
    return this.tenants.update(tenantId, input, actor, context);
  }
}
