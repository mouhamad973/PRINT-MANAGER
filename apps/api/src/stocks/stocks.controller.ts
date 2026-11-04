import type {
  DetectedReplacement,
  Page,
  StockMovement,
  TonerReference,
  TonerReplacement,
  TonerStock,
} from '@arksen/shared-types';
import {
  listQuerySchema,
  stockCreateSchema,
  stockListQuerySchema,
  stockMovementCreateSchema,
  stockTransferSchema,
  stockUpdateSchema,
  tonerReplacementCreateSchema,
  tonerReplacementListQuerySchema,
  type ListQuery,
  type StockCreateInput,
  type StockListQuery,
  type StockMovementCreateInput,
  type StockTransferInput,
  type StockUpdateInput,
  type TonerReplacementCreateInput,
  type TonerReplacementListQuery,
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
import { ReplacementsService } from './replacements.service.js';
import { StocksService } from './stocks.service.js';

@ApiTags('Toners et stocks')
@ApiCookieAuth()
@Controller('tenants/:tenantId')
export class StocksController {
  constructor(
    private readonly stocks: StocksService,
    private readonly replacements: ReplacementsService,
  ) {}

  @Get('toner-references')
  @RequirePermissions('stocks:read')
  @ApiOperation({
    summary: 'Références de toner du parc : stock, remplacements et rendement constaté',
  })
  references(@Param('tenantId') tenantId: string): Promise<TonerReference[]> {
    return this.stocks.references(tenantId);
  }

  @Get('stocks')
  @RequirePermissions('stocks:read')
  @ApiOperation({ summary: 'Articles de stock, avec leur niveau et leur prévision de rupture' })
  list(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(stockListQuerySchema)) query: StockListQuery,
  ): Promise<Page<TonerStock>> {
    return this.stocks.list(tenantId, query);
  }

  @Post('stocks')
  @RequirePermissions('stocks:manage')
  @ApiOperation({ summary: 'Suit une référence de toner sur un site' })
  @ApiBody({ schema: openApiSchema(stockCreateSchema) })
  create(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(stockCreateSchema)) input: StockCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<TonerStock> {
    return this.stocks.create(tenantId, input, actor, context);
  }

  @Post('stocks/transfers')
  @RequirePermissions('stocks:manage')
  @ApiOperation({ summary: 'Transfère des cartouches d’un site à un autre' })
  @ApiBody({ schema: openApiSchema(stockTransferSchema) })
  transfer(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(stockTransferSchema)) input: StockTransferInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<{ from: TonerStock; to: TonerStock }> {
    return this.stocks.transfer(tenantId, input, actor, context);
  }

  @Post('stocks/evaluate-alerts')
  @HttpCode(200)
  @RequirePermissions('stocks:manage')
  @ApiOperation({ summary: 'Recalcule tout de suite les alertes de rupture prévue' })
  async evaluate(@Param('tenantId') tenantId: string): Promise<{ raised: number }> {
    return { raised: await this.stocks.evaluateForecastAlerts(tenantId) };
  }

  @Get('stocks/:stockId')
  @RequirePermissions('stocks:read')
  @ApiOperation({ summary: 'Article de stock' })
  get(
    @Param('tenantId') tenantId: string,
    @Param('stockId', ParseUUIDPipe) stockId: string,
  ): Promise<TonerStock> {
    return this.stocks.get(tenantId, stockId);
  }

  @Patch('stocks/:stockId')
  @RequirePermissions('stocks:manage')
  @ApiOperation({ summary: 'Règle le seuil minimum et le délai de réapprovisionnement' })
  @ApiBody({ schema: openApiSchema(stockUpdateSchema) })
  update(
    @Param('tenantId') tenantId: string,
    @Param('stockId', ParseUUIDPipe) stockId: string,
    @Body(new ZodPipe(stockUpdateSchema)) input: StockUpdateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<TonerStock> {
    return this.stocks.update(tenantId, stockId, input, actor, context);
  }

  @Get('stocks/:stockId/movements')
  @RequirePermissions('stocks:read')
  @ApiOperation({ summary: 'Registre des mouvements d’un article, du plus récent au plus ancien' })
  movements(
    @Param('tenantId') tenantId: string,
    @Param('stockId', ParseUUIDPipe) stockId: string,
    @Query(new ZodPipe(listQuerySchema)) query: ListQuery,
  ): Promise<Page<StockMovement>> {
    return this.stocks.movements(tenantId, stockId, query);
  }

  @Post('stocks/:stockId/movements')
  @RequirePermissions('stocks:manage')
  @ApiOperation({ summary: 'Réception, sortie ou inventaire d’un article' })
  @ApiBody({ schema: openApiSchema(stockMovementCreateSchema) })
  createMovement(
    @Param('tenantId') tenantId: string,
    @Param('stockId', ParseUUIDPipe) stockId: string,
    @Body(new ZodPipe(stockMovementCreateSchema)) input: StockMovementCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<TonerStock> {
    return this.stocks.createMovement(tenantId, stockId, input, actor, context);
  }

  @Get('toner-replacements')
  @RequirePermissions('stocks:read')
  @ApiOperation({ summary: 'Remplacements de toner, avec le rendement réel de chaque cartouche' })
  replacementList(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(tonerReplacementListQuerySchema)) query: TonerReplacementListQuery,
  ): Promise<Page<TonerReplacement>> {
    return this.replacements.list(tenantId, query);
  }

  @Get('toner-replacements/detected')
  @RequirePermissions('stocks:read')
  @ApiOperation({ summary: 'Remontées de niveau SNMP sans remplacement enregistré' })
  detected(@Param('tenantId') tenantId: string): Promise<DetectedReplacement[]> {
    return this.replacements.detected(tenantId);
  }

  @Post('toner-replacements')
  @RequirePermissions('toner-replacements:manage')
  @ApiOperation({ summary: 'Enregistre un remplacement de toner, pris ou non dans un stock' })
  @ApiBody({ schema: openApiSchema(tonerReplacementCreateSchema) })
  replace(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(tonerReplacementCreateSchema)) input: TonerReplacementCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<TonerReplacement> {
    return this.replacements.create(tenantId, input, actor, context);
  }

  @Delete('toner-replacements/:replacementId')
  @HttpCode(204)
  @RequirePermissions('toner-replacements:manage')
  @ApiOperation({ summary: 'Annule un remplacement : la cartouche revient dans son stock' })
  async cancel(
    @Param('tenantId') tenantId: string,
    @Param('replacementId', ParseUUIDPipe) replacementId: string,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<void> {
    await this.replacements.cancel(tenantId, replacementId, actor, context);
  }
}
