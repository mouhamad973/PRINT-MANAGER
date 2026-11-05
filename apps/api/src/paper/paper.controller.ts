import type { Page, PaperMovement, PaperStock, PaperType } from '@arksen/shared-types';
import {
  listQuerySchema,
  paperStockCreateSchema,
  paperStockListQuerySchema,
  paperTypeCreateSchema,
  paperTypeUpdateSchema,
  stockMovementCreateSchema,
  stockTransferSchema,
  stockUpdateSchema,
  type ListQuery,
  type PaperStockCreateInput,
  type PaperStockListQuery,
  type PaperTypeCreateInput,
  type PaperTypeUpdateInput,
  type StockMovementCreateInput,
  type StockTransferInput,
  type StockUpdateInput,
} from '@arksen/validation';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators.js';
import {
  CurrentPrincipal,
  CurrentRequestContext,
  type Principal,
  type RequestContext,
} from '../auth/principal.js';
import { openApiSchema, ZodPipe } from '../common/zod.js';
import { PaperService } from './paper.service.js';

@ApiTags('Papier')
@ApiCookieAuth()
@Controller('tenants/:tenantId')
export class PaperController {
  constructor(private readonly paper: PaperService) {}

  @Get('paper-types')
  @RequirePermissions('stocks:read')
  @ApiOperation({ summary: 'Papiers de l’entreprise : format, grammage, prix, stock' })
  types(@Param('tenantId') tenantId: string): Promise<PaperType[]> {
    return this.paper.types(tenantId);
  }

  @Post('paper-types')
  @RequirePermissions('stocks:manage')
  @ApiBody({ schema: openApiSchema(paperTypeCreateSchema) })
  createType(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(paperTypeCreateSchema)) input: PaperTypeCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PaperType> {
    return this.paper.createType(tenantId, input, actor, context);
  }

  @Patch('paper-types/:typeId')
  @RequirePermissions('stocks:manage')
  @ApiBody({ schema: openApiSchema(paperTypeUpdateSchema) })
  updateType(
    @Param('tenantId') tenantId: string,
    @Param('typeId', ParseUUIDPipe) typeId: string,
    @Body(new ZodPipe(paperTypeUpdateSchema)) input: PaperTypeUpdateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PaperType> {
    return this.paper.updateType(tenantId, typeId, input, actor, context);
  }

  @Get('paper-stocks')
  @RequirePermissions('stocks:read')
  @ApiOperation({ summary: 'Stocks de papier par site, en rames, avec leur prévision' })
  stocks(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(paperStockListQuerySchema)) query: PaperStockListQuery,
  ): Promise<Page<PaperStock>> {
    return this.paper.stocks(tenantId, query);
  }

  @Post('paper-stocks')
  @RequirePermissions('stocks:manage')
  @ApiBody({ schema: openApiSchema(paperStockCreateSchema) })
  createStock(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(paperStockCreateSchema)) input: PaperStockCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PaperStock> {
    return this.paper.createStock(tenantId, input, actor, context);
  }

  @Post('paper-stocks/transfers')
  @RequirePermissions('stocks:manage')
  @ApiBody({ schema: openApiSchema(stockTransferSchema) })
  transfer(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(stockTransferSchema)) input: StockTransferInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<{ from: PaperStock; to: PaperStock }> {
    return this.paper.transfer(tenantId, input, actor, context);
  }

  @Get('paper-stocks/:stockId')
  @RequirePermissions('stocks:read')
  stock(
    @Param('tenantId') tenantId: string,
    @Param('stockId', ParseUUIDPipe) stockId: string,
  ): Promise<PaperStock> {
    return this.paper.stock(tenantId, stockId);
  }

  @Patch('paper-stocks/:stockId')
  @RequirePermissions('stocks:manage')
  @ApiBody({ schema: openApiSchema(stockUpdateSchema) })
  updateStock(
    @Param('tenantId') tenantId: string,
    @Param('stockId', ParseUUIDPipe) stockId: string,
    @Body(new ZodPipe(stockUpdateSchema)) input: StockUpdateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PaperStock> {
    return this.paper.updateStock(tenantId, stockId, input, actor, context);
  }

  @Get('paper-stocks/:stockId/movements')
  @RequirePermissions('stocks:read')
  movements(
    @Param('tenantId') tenantId: string,
    @Param('stockId', ParseUUIDPipe) stockId: string,
    @Query(new ZodPipe(listQuerySchema)) query: ListQuery,
  ): Promise<Page<PaperMovement>> {
    return this.paper.movements(tenantId, stockId, query);
  }

  @Post('paper-stocks/:stockId/movements')
  @RequirePermissions('stocks:manage')
  @ApiOperation({ summary: 'Réception, sortie ou inventaire de papier, en rames' })
  @ApiBody({ schema: openApiSchema(stockMovementCreateSchema) })
  createMovement(
    @Param('tenantId') tenantId: string,
    @Param('stockId', ParseUUIDPipe) stockId: string,
    @Body(new ZodPipe(stockMovementCreateSchema)) input: StockMovementCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PaperStock> {
    return this.paper.createMovement(tenantId, stockId, input, actor, context);
  }
}
