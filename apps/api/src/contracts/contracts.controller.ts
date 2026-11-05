import type { Contract, Invoice, Page } from '@arksen/shared-types';
import {
  contractCreateSchema,
  contractPrintersSchema,
  contractUpdateSchema,
  invoiceCreateSchema,
  invoiceListQuerySchema,
  listQuerySchema,
  type ContractCreateInput,
  type ContractPrintersInput,
  type ContractUpdateInput,
  type InvoiceCreateInput,
  type InvoiceListQuery,
  type ListQuery,
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
import { ContractsService } from './contracts.service.js';

@ApiTags('Contrats')
@ApiCookieAuth()
@Controller('tenants/:tenantId')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get('contracts')
  @RequirePermissions('contracts:read')
  list(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(listQuerySchema)) query: ListQuery,
  ): Promise<Page<Contract>> {
    return this.contracts.list(tenantId, query);
  }

  @Post('contracts')
  @RequirePermissions('contracts:manage')
  @ApiBody({ schema: openApiSchema(contractCreateSchema) })
  create(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(contractCreateSchema)) input: ContractCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<Contract> {
    return this.contracts.create(tenantId, input, actor, context);
  }

  @Get('contracts/:contractId')
  @RequirePermissions('contracts:read')
  get(
    @Param('tenantId') tenantId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ): Promise<Contract> {
    return this.contracts.get(tenantId, contractId);
  }

  @Patch('contracts/:contractId')
  @RequirePermissions('contracts:manage')
  @ApiBody({ schema: openApiSchema(contractUpdateSchema) })
  update(
    @Param('tenantId') tenantId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body(new ZodPipe(contractUpdateSchema)) input: ContractUpdateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<Contract> {
    return this.contracts.update(tenantId, contractId, input, actor, context);
  }

  @Put('contracts/:contractId/printers')
  @RequirePermissions('contracts:manage')
  @ApiOperation({ summary: 'Remplace la liste des machines couvertes par le contrat' })
  @ApiBody({ schema: openApiSchema(contractPrintersSchema) })
  setPrinters(
    @Param('tenantId') tenantId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body(new ZodPipe(contractPrintersSchema)) input: ContractPrintersInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<Contract> {
    return this.contracts.setPrinters(tenantId, contractId, input, actor, context);
  }

  @Post('contracts/:contractId/invoices')
  @RequirePermissions('contracts:manage')
  @ApiOperation({ summary: 'Établit un relevé de facturation brouillon pour une période' })
  @ApiBody({ schema: openApiSchema(invoiceCreateSchema) })
  createInvoice(
    @Param('tenantId') tenantId: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body(new ZodPipe(invoiceCreateSchema)) input: InvoiceCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<Invoice> {
    return this.contracts.createInvoice(tenantId, contractId, input, actor, context);
  }

  @Get('invoices')
  @RequirePermissions('contracts:read')
  invoices(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(invoiceListQuerySchema)) query: InvoiceListQuery,
  ): Promise<Page<Invoice>> {
    return this.contracts.invoices(tenantId, query);
  }

  @Get('invoices/:invoiceId')
  @RequirePermissions('contracts:read')
  invoice(
    @Param('tenantId') tenantId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
  ): Promise<Invoice> {
    return this.contracts.invoice(tenantId, invoiceId);
  }

  @Post('invoices/:invoiceId/issue')
  @HttpCode(200)
  @RequirePermissions('contracts:manage')
  @ApiOperation({ summary: 'Émet le relevé : numéro attribué, contenu figé' })
  issue(
    @Param('tenantId') tenantId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<Invoice> {
    return this.contracts.issue(tenantId, invoiceId, actor, context);
  }

  @Delete('invoices/:invoiceId')
  @HttpCode(204)
  @RequirePermissions('contracts:manage')
  @ApiOperation({ summary: 'Annule un relevé émis, ou supprime un brouillon' })
  async cancel(
    @Param('tenantId') tenantId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<void> {
    await this.contracts.cancel(tenantId, invoiceId, actor, context);
  }
}
