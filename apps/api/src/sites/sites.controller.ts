import type { Page, Site } from '@arksen/shared-types';
import {
  listQuerySchema,
  siteCreateSchema,
  siteUpdateSchema,
  type ListQuery,
  type SiteCreateInput,
  type SiteUpdateInput,
} from '@arksen/validation';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators.js';
import {
  CurrentPrincipal,
  CurrentRequestContext,
  type Principal,
  type RequestContext,
} from '../auth/principal.js';
import { openApiSchema, ZodPipe } from '../common/zod.js';
import { SitesService } from './sites.service.js';

@ApiTags('Sites')
@ApiCookieAuth()
@Controller('tenants/:tenantId/sites')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  @RequirePermissions('sites:read')
  @ApiOperation({ summary: 'Sites de l’entreprise, avec leur nombre de machines' })
  list(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(listQuerySchema)) query: ListQuery,
  ): Promise<Page<Site>> {
    return this.sites.list(tenantId, query);
  }

  @Post()
  @RequirePermissions('sites:manage')
  @ApiOperation({ summary: 'Crée un site' })
  @ApiBody({ schema: openApiSchema(siteCreateSchema) })
  create(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(siteCreateSchema)) input: SiteCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<Site> {
    return this.sites.create(tenantId, input, actor, context);
  }

  @Get(':siteId')
  @RequirePermissions('sites:read')
  @ApiOperation({ summary: 'Fiche d’un site' })
  get(
    @Param('tenantId') tenantId: string,
    @Param('siteId', ParseUUIDPipe) siteId: string,
  ): Promise<Site> {
    return this.sites.get(tenantId, siteId);
  }

  @Patch(':siteId')
  @RequirePermissions('sites:manage')
  @ApiOperation({ summary: 'Modifie un site' })
  @ApiBody({ schema: openApiSchema(siteUpdateSchema) })
  update(
    @Param('tenantId') tenantId: string,
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Body(new ZodPipe(siteUpdateSchema)) input: SiteUpdateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<Site> {
    return this.sites.update(tenantId, siteId, input, actor, context);
  }

  @Delete(':siteId')
  @HttpCode(204)
  @RequirePermissions('sites:manage')
  @ApiOperation({ summary: 'Supprime un site vide' })
  async remove(
    @Param('tenantId') tenantId: string,
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<void> {
    await this.sites.remove(tenantId, siteId, actor, context);
  }
}
