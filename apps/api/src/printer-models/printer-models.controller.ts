import type { Page, PrinterModel } from '@arksen/shared-types';
import {
  printerModelCreateSchema,
  printerModelListQuerySchema,
  printerModelUpdateSchema,
  type PrinterModelCreateInput,
  type PrinterModelListQuery,
  type PrinterModelUpdateInput,
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
import { PrinterModelsService } from './printer-models.service.js';

/** Catalogue Arksen, géré par la plateforme et partagé par toutes les entreprises. */
@ApiTags('Fiches techniques')
@ApiCookieAuth()
@Controller('printer-models')
export class CatalogController {
  constructor(private readonly models: PrinterModelsService) {}

  @Get()
  @RequirePermissions('platform:catalog:manage')
  @ApiOperation({ summary: 'Catalogue Arksen des fiches techniques' })
  list(
    @Query(new ZodPipe(printerModelListQuerySchema)) query: PrinterModelListQuery,
  ): Promise<Page<PrinterModel>> {
    return this.models.listCatalog(query);
  }

  @Post()
  @RequirePermissions('platform:catalog:manage')
  @ApiOperation({ summary: 'Ajoute une fiche au catalogue Arksen' })
  @ApiBody({ schema: openApiSchema(printerModelCreateSchema) })
  create(
    @Body(new ZodPipe(printerModelCreateSchema)) input: PrinterModelCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PrinterModel> {
    return this.models.createInCatalog(input, actor, context);
  }

  @Patch(':modelId')
  @RequirePermissions('platform:catalog:manage')
  @ApiOperation({ summary: 'Modifie une fiche du catalogue Arksen' })
  @ApiBody({ schema: openApiSchema(printerModelUpdateSchema) })
  update(
    @Param('modelId', ParseUUIDPipe) modelId: string,
    @Body(new ZodPipe(printerModelUpdateSchema)) input: PrinterModelUpdateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PrinterModel> {
    return this.models.updateInCatalog(modelId, input, actor, context);
  }

  @Delete(':modelId')
  @HttpCode(204)
  @RequirePermissions('platform:catalog:manage')
  @ApiOperation({ summary: 'Supprime une fiche inutilisée du catalogue Arksen' })
  async remove(
    @Param('modelId', ParseUUIDPipe) modelId: string,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<void> {
    await this.models.removeFromCatalog(modelId, actor, context);
  }
}

/** Fiches visibles par une entreprise : le catalogue Arksen et les siennes. */
@ApiTags('Fiches techniques')
@ApiCookieAuth()
@Controller('tenants/:tenantId/printer-models')
export class TenantPrinterModelsController {
  constructor(private readonly models: PrinterModelsService) {}

  @Get()
  @RequirePermissions('printers:read')
  @ApiOperation({ summary: 'Catalogue Arksen et fiches propres à l’entreprise' })
  list(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(printerModelListQuerySchema)) query: PrinterModelListQuery,
  ): Promise<Page<PrinterModel>> {
    return this.models.listForTenant(tenantId, query);
  }

  @Post()
  @RequirePermissions('printer-models:manage')
  @ApiOperation({ summary: 'Crée une fiche propre à l’entreprise' })
  @ApiBody({ schema: openApiSchema(printerModelCreateSchema) })
  create(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(printerModelCreateSchema)) input: PrinterModelCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PrinterModel> {
    return this.models.createForTenant(tenantId, input, actor, context);
  }

  @Get(':modelId')
  @RequirePermissions('printers:read')
  @ApiOperation({ summary: 'Fiche technique' })
  get(
    @Param('tenantId') tenantId: string,
    @Param('modelId', ParseUUIDPipe) modelId: string,
  ): Promise<PrinterModel> {
    return this.models.getForTenant(tenantId, modelId);
  }

  @Patch(':modelId')
  @RequirePermissions('printer-models:manage')
  @ApiOperation({ summary: 'Modifie une fiche propre à l’entreprise' })
  @ApiBody({ schema: openApiSchema(printerModelUpdateSchema) })
  update(
    @Param('tenantId') tenantId: string,
    @Param('modelId', ParseUUIDPipe) modelId: string,
    @Body(new ZodPipe(printerModelUpdateSchema)) input: PrinterModelUpdateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PrinterModel> {
    return this.models.updateForTenant(tenantId, modelId, input, actor, context);
  }

  @Delete(':modelId')
  @HttpCode(204)
  @RequirePermissions('printer-models:manage')
  @ApiOperation({ summary: 'Supprime une fiche inutilisée de l’entreprise' })
  async remove(
    @Param('tenantId') tenantId: string,
    @Param('modelId', ParseUUIDPipe) modelId: string,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<void> {
    await this.models.removeForTenant(tenantId, modelId, actor, context);
  }
}
