import type { CostReport, PrinterCostSettings } from '@arksen/shared-types';
import {
  periodQuerySchema,
  printerCostSettingsSchema,
  type PeriodQuery,
  type PrinterCostSettingsInput,
} from '@arksen/validation';
import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators.js';
import {
  CurrentPrincipal,
  CurrentRequestContext,
  type Principal,
  type RequestContext,
} from '../auth/principal.js';
import { openApiSchema, ZodPipe } from '../common/zod.js';
import { CostsService } from './costs.service.js';

@ApiTags('Coûts d’impression')
@ApiCookieAuth()
@Controller('tenants/:tenantId')
export class CostsController {
  constructor(private readonly costs: CostsService) {}

  @Get('costs')
  @RequirePermissions('costs:read')
  @ApiOperation({ summary: 'Coûts d’impression et coût copie de chaque machine sur une période' })
  report(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(periodQuerySchema)) query: PeriodQuery,
  ): Promise<CostReport> {
    return this.costs.report(tenantId, query);
  }

  @Get('printers/:printerId/cost-settings')
  @RequirePermissions('costs:read')
  settings(
    @Param('tenantId') tenantId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
  ): Promise<PrinterCostSettings> {
    return this.costs.settings(tenantId, printerId);
  }

  @Put('printers/:printerId/cost-settings')
  @RequirePermissions('costs:manage')
  @ApiOperation({ summary: 'Règle le papier, le recto verso et les coûts fixes d’une machine' })
  @ApiBody({ schema: openApiSchema(printerCostSettingsSchema) })
  save(
    @Param('tenantId') tenantId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Body(new ZodPipe(printerCostSettingsSchema)) input: PrinterCostSettingsInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PrinterCostSettings> {
    return this.costs.saveSettings(tenantId, printerId, input, actor, context);
  }
}
