import type { Page, Printer, PrinterDetail } from '@arksen/shared-types';
import {
  printerConnectionSchema,
  printerCreateSchema,
  printerListQuerySchema,
  printerUpdateSchema,
  type PrinterConnectionInput,
  type PrinterCreateInput,
  type PrinterListQuery,
  type PrinterUpdateInput,
} from '@arksen/validation';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import { PrintersService } from './printers.service.js';

@ApiTags('Parc machines')
@ApiCookieAuth()
@Controller('tenants/:tenantId/printers')
export class PrintersController {
  constructor(private readonly printers: PrintersService) {}

  @Get()
  @RequirePermissions('printers:read')
  @ApiOperation({
    summary: 'Machines de l’entreprise. Les machines retirées sont exclues par défaut.',
  })
  list(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(printerListQuerySchema)) query: PrinterListQuery,
  ): Promise<Page<Printer>> {
    return this.printers.list(tenantId, query);
  }

  @Post()
  @RequirePermissions('printers:manage')
  @ApiOperation({ summary: 'Ajoute une machine au parc' })
  @ApiBody({ schema: openApiSchema(printerCreateSchema) })
  create(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(printerCreateSchema)) input: PrinterCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PrinterDetail> {
    return this.printers.create(tenantId, input, actor, context);
  }

  @Get(':printerId')
  @RequirePermissions('printers:read')
  @ApiOperation({ summary: 'Fiche d’une machine. Les secrets SNMP n’y figurent jamais.' })
  get(
    @Param('tenantId') tenantId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
  ): Promise<PrinterDetail> {
    return this.printers.get(tenantId, printerId);
  }

  @Patch(':printerId')
  @RequirePermissions('printers:manage')
  @ApiOperation({ summary: 'Modifie une machine ou son statut' })
  @ApiBody({ schema: openApiSchema(printerUpdateSchema) })
  update(
    @Param('tenantId') tenantId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Body(new ZodPipe(printerUpdateSchema)) input: PrinterUpdateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PrinterDetail> {
    return this.printers.update(tenantId, printerId, input, actor, context);
  }

  @Put(':printerId/connection')
  @RequirePermissions('printers:network:manage')
  @ApiOperation({
    summary: 'Enregistre la configuration réseau et SNMP',
    description:
      'Secrets en écriture seule : absent, conservé ; null, effacé ; renseigné, chiffré et remplacé.',
  })
  @ApiBody({ schema: openApiSchema(printerConnectionSchema) })
  setConnection(
    @Param('tenantId') tenantId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Body(new ZodPipe(printerConnectionSchema)) input: PrinterConnectionInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PrinterDetail> {
    return this.printers.setConnection(tenantId, printerId, input, actor, context);
  }

  @Delete(':printerId/connection')
  @RequirePermissions('printers:network:manage')
  @ApiOperation({ summary: 'Supprime la configuration réseau et ses secrets' })
  clearConnection(
    @Param('tenantId') tenantId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PrinterDetail> {
    return this.printers.clearConnection(tenantId, printerId, actor, context);
  }
}
