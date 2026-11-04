import {
  CMYK_CHANNELS,
  type CalibrationProfile,
  type CmykChannel,
  type ConsumptionSimulation,
  type FleetConsumption,
  type PrinterConsumptionDetail,
  type TonerSpec,
} from '@arksen/shared-types';
import {
  calibrationProfileSchema,
  consumptionQuerySchema,
  measurementCreateSchema,
  simulationSchema,
  tonerPriceSchema,
  tonerSpecSchema,
  type CalibrationProfileInput,
  type ConsumptionQuery,
  type MeasurementCreateInput,
  type SimulationInput,
  type TonerPriceInput,
  type TonerSpecInput,
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
  Put,
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
import { ConsumptionService } from './consumption.service.js';

const channelPipe = new ZodPipe(z.enum(CMYK_CHANNELS, 'Canal inconnu.'));

/** Toners du catalogue Arksen, gérés par la plateforme. */
@ApiTags('Consommation toner')
@ApiCookieAuth()
@Controller('printer-models/:modelId/toners')
export class CatalogTonersController {
  constructor(private readonly consumption: ConsumptionService) {}

  @Get()
  @RequirePermissions('platform:catalog:manage')
  @ApiOperation({ summary: 'Toners d’une fiche du catalogue Arksen' })
  list(@Param('modelId', ParseUUIDPipe) modelId: string): Promise<TonerSpec[]> {
    return this.consumption.listCatalogToners(modelId);
  }

  @Put(':channel')
  @RequirePermissions('platform:catalog:manage')
  @ApiOperation({ summary: 'Renseigne le toner d’un canal d’une fiche du catalogue' })
  @ApiBody({ schema: openApiSchema(tonerSpecSchema) })
  save(
    @Param('modelId', ParseUUIDPipe) modelId: string,
    @Param('channel', channelPipe) channel: CmykChannel,
    @Body(new ZodPipe(tonerSpecSchema)) input: TonerSpecInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<TonerSpec> {
    return this.consumption.saveToner(null, modelId, channel, input, actor, context);
  }

  @Delete(':channel')
  @HttpCode(204)
  @RequirePermissions('platform:catalog:manage')
  @ApiOperation({ summary: 'Retire le toner d’un canal d’une fiche du catalogue' })
  async remove(
    @Param('modelId', ParseUUIDPipe) modelId: string,
    @Param('channel', channelPipe) channel: CmykChannel,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<void> {
    await this.consumption.deleteToner(null, modelId, channel, actor, context);
  }
}

@ApiTags('Consommation toner')
@ApiCookieAuth()
@Controller('tenants/:tenantId')
export class ConsumptionController {
  constructor(private readonly consumption: ConsumptionService) {}

  @Get('printer-models/:modelId/toners')
  @RequirePermissions('printers:read')
  @ApiOperation({ summary: 'Toners d’une fiche technique, avec les prix de l’entreprise' })
  listToners(
    @Param('tenantId') tenantId: string,
    @Param('modelId', ParseUUIDPipe) modelId: string,
  ): Promise<TonerSpec[]> {
    return this.consumption.listToners(tenantId, modelId);
  }

  @Put('printer-models/:modelId/toners/:channel')
  @RequirePermissions('printer-models:manage')
  @ApiOperation({ summary: 'Renseigne le toner d’un canal d’une fiche propre à l’entreprise' })
  @ApiBody({ schema: openApiSchema(tonerSpecSchema) })
  saveToner(
    @Param('tenantId') tenantId: string,
    @Param('modelId', ParseUUIDPipe) modelId: string,
    @Param('channel', channelPipe) channel: CmykChannel,
    @Body(new ZodPipe(tonerSpecSchema)) input: TonerSpecInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<TonerSpec> {
    return this.consumption.saveToner(tenantId, modelId, channel, input, actor, context);
  }

  @Delete('printer-models/:modelId/toners/:channel')
  @HttpCode(204)
  @RequirePermissions('printer-models:manage')
  @ApiOperation({ summary: 'Retire le toner d’un canal d’une fiche propre à l’entreprise' })
  async deleteToner(
    @Param('tenantId') tenantId: string,
    @Param('modelId', ParseUUIDPipe) modelId: string,
    @Param('channel', channelPipe) channel: CmykChannel,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<void> {
    await this.consumption.deleteToner(tenantId, modelId, channel, actor, context);
  }

  @Put('toners/:tonerId/price')
  @HttpCode(204)
  @RequirePermissions('consumption:manage')
  @ApiOperation({ summary: 'Prix d’achat d’une cartouche pour l’entreprise (null le retire)' })
  @ApiBody({ schema: openApiSchema(tonerPriceSchema) })
  async setPrice(
    @Param('tenantId') tenantId: string,
    @Param('tonerId', ParseUUIDPipe) tonerId: string,
    @Body(new ZodPipe(tonerPriceSchema)) input: TonerPriceInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<void> {
    await this.consumption.setPrice(tenantId, tonerId, input.unitPrice, actor, context);
  }

  @Put('printers/:printerId/calibration')
  @RequirePermissions('consumption:manage')
  @ApiOperation({ summary: 'Aplat moyen, format, support et coefficients manuels d’une machine' })
  @ApiBody({ schema: openApiSchema(calibrationProfileSchema) })
  saveProfile(
    @Param('tenantId') tenantId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Body(new ZodPipe(calibrationProfileSchema)) input: CalibrationProfileInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<CalibrationProfile> {
    return this.consumption.saveProfile(tenantId, printerId, input, actor, context);
  }

  @Post('printers/:printerId/consumption-measurements')
  @RequirePermissions('consumption:manage')
  @ApiOperation({ summary: 'Enregistre une consommation réelle (pesée ou cartouches vidées)' })
  @ApiBody({ schema: openApiSchema(measurementCreateSchema) })
  createMeasurement(
    @Param('tenantId') tenantId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Body(new ZodPipe(measurementCreateSchema)) input: MeasurementCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<{ id: string }> {
    return this.consumption.createMeasurement(tenantId, printerId, input, actor, context);
  }

  @Delete('printers/:printerId/consumption-measurements/:measurementId')
  @HttpCode(204)
  @RequirePermissions('consumption:manage')
  @ApiOperation({ summary: 'Supprime une consommation réelle erronée' })
  async deleteMeasurement(
    @Param('tenantId') tenantId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Param('measurementId', ParseUUIDPipe) measurementId: string,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<void> {
    await this.consumption.deleteMeasurement(tenantId, printerId, measurementId, actor, context);
  }

  @Get('printers/:printerId/consumption')
  @RequirePermissions('consumption:read')
  @ApiOperation({
    summary: 'Consommation théorique et estimée, calibration et écarts d’une machine',
  })
  printerConsumption(
    @Param('tenantId') tenantId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Query(new ZodPipe(consumptionQuerySchema)) query: ConsumptionQuery,
  ): Promise<PrinterConsumptionDetail> {
    return this.consumption.printerConsumption(tenantId, printerId, query);
  }

  @Get('consumption')
  @RequirePermissions('consumption:read')
  @ApiOperation({ summary: 'Consommation toner du parc, canal par canal' })
  fleetConsumption(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(consumptionQuerySchema)) query: ConsumptionQuery,
  ): Promise<FleetConsumption> {
    return this.consumption.fleetConsumption(tenantId, query);
  }

  @Post('consumption/simulate')
  @HttpCode(200)
  @RequirePermissions('consumption:read')
  @ApiOperation({ summary: 'Consommation et coût d’un travail décrit par son aplat CMJN' })
  @ApiBody({ schema: openApiSchema(simulationSchema) })
  simulate(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(simulationSchema)) input: SimulationInput,
  ): Promise<ConsumptionSimulation> {
    return this.consumption.simulate(tenantId, input);
  }
}
