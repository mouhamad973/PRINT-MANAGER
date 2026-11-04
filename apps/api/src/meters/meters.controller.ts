import type {
  FleetMeterAnomaly,
  FleetVolumes,
  MeterImportResult,
  MeterReading,
  Page,
  PrinterVolumes,
} from '@arksen/shared-types';
import {
  meterImportSchema,
  meterReadingCreateSchema,
  meterReadingListQuerySchema,
  volumeQuerySchema,
  type MeterImportInput,
  type MeterReadingCreateInput,
  type MeterReadingListQuery,
  type VolumeQuery,
} from '@arksen/validation';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../auth/decorators.js';
import {
  CurrentPrincipal,
  CurrentRequestContext,
  type Principal,
  type RequestContext,
} from '../auth/principal.js';
import { openApiSchema, ZodPipe } from '../common/zod.js';
import { MetersService } from './meters.service.js';

const anomalyQuerySchema = z.object({
  siteId: z.preprocess((value) => (value === '' ? undefined : value), z.uuid().optional()),
  printerId: z.preprocess((value) => (value === '' ? undefined : value), z.uuid().optional()),
});

@ApiTags('Compteurs')
@ApiCookieAuth()
@Controller('tenants/:tenantId')
export class MetersController {
  constructor(private readonly meters: MetersService) {}

  @Get('printers/:printerId/meter-readings')
  @RequirePermissions('meters:read')
  @ApiOperation({ summary: 'Historique des relevés, avec le volume et les anomalies de chacun' })
  listReadings(
    @Param('tenantId') tenantId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Query(new ZodPipe(meterReadingListQuerySchema)) query: MeterReadingListQuery,
  ): Promise<Page<MeterReading>> {
    return this.meters.listReadings(tenantId, printerId, query);
  }

  @Post('printers/:printerId/meter-readings')
  @RequirePermissions('meters:manage')
  @ApiOperation({ summary: 'Enregistre un relevé de compteurs' })
  @ApiBody({ schema: openApiSchema(meterReadingCreateSchema) })
  createReading(
    @Param('tenantId') tenantId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Body(new ZodPipe(meterReadingCreateSchema)) input: MeterReadingCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<MeterReading> {
    return this.meters.createReading(tenantId, printerId, input, actor, context);
  }

  @Delete('printers/:printerId/meter-readings/:readingId')
  @HttpCode(204)
  @RequirePermissions('meters:manage')
  @ApiOperation({ summary: 'Supprime un relevé erroné' })
  async deleteReading(
    @Param('tenantId') tenantId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Param('readingId', ParseUUIDPipe) readingId: string,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<void> {
    await this.meters.deleteReading(tenantId, printerId, readingId, actor, context);
  }

  @Get('printers/:printerId/volumes')
  @RequirePermissions('meters:read')
  @ApiOperation({ summary: 'Volumes d’une machine, par jour ou par mois' })
  printerVolumes(
    @Param('tenantId') tenantId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Query(new ZodPipe(volumeQuerySchema)) query: VolumeQuery,
  ): Promise<PrinterVolumes> {
    return this.meters.printerVolumes(tenantId, printerId, query);
  }

  @Post('meter-readings/import')
  @RequirePermissions('meters:manage')
  @ApiOperation({
    summary: 'Importe des relevés repérés par numéro de série',
    description: 'Idempotent : un relevé déjà présent (même machine, même instant) est ignoré.',
  })
  @ApiBody({ schema: openApiSchema(meterImportSchema) })
  importReadings(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(meterImportSchema)) input: MeterImportInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<MeterImportResult> {
    return this.meters.importReadings(tenantId, input, actor, context);
  }

  @Get('volumes')
  @RequirePermissions('meters:read')
  @ApiOperation({ summary: 'Volumes du parc, comparés à une période de référence' })
  fleetVolumes(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(volumeQuerySchema)) query: VolumeQuery,
  ): Promise<FleetVolumes> {
    return this.meters.fleetVolumes(tenantId, query);
  }

  @Get('meter-anomalies')
  @RequirePermissions('meters:read')
  @ApiOperation({ summary: 'Anomalies de compteurs du parc' })
  anomalies(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(anomalyQuerySchema)) query: z.infer<typeof anomalyQuerySchema>,
  ): Promise<FleetMeterAnomaly[]> {
    return this.meters.anomalies(tenantId, query);
  }
}
