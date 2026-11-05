import type {
  Page,
  PrintedJob,
  PrintJob,
  PrintJobEstimate,
  PrintJobSummary,
} from '@arksen/shared-types';
import {
  printJobEstimateQuerySchema,
  printJobListQuerySchema,
  printJobPrintedSchema,
  printJobUpdateSchema,
  printJobUploadSchema,
  type ListQuery,
  type PrintJobEstimateQuery,
  type PrintJobPrintedInput,
  type PrintJobUpdateInput,
  type PrintJobUploadInput,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators.js';
import {
  CurrentPrincipal,
  CurrentRequestContext,
  type Principal,
  type RequestContext,
} from '../auth/principal.js';
import { openApiSchema, ZodPipe } from '../common/zod.js';
import { PrintJobsService, type UploadedPdf } from './print-jobs.service.js';

const MAX_FILE_BYTES = 50 * 1024 * 1024;

@ApiTags('Analyse PDF')
@ApiCookieAuth()
@Controller('tenants/:tenantId/print-jobs')
export class PrintJobsController {
  constructor(private readonly jobs: PrintJobsService) {}

  @Post()
  @RequirePermissions('print-jobs:manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 10 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Analyse un fichier PDF : formats et couverture CMJN page par page',
    description: 'Le fichier est analysé puis oublié : seules ses mesures sont conservées.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        printerId: { type: 'string', format: 'uuid' },
        copies: { type: 'integer', minimum: 1 },
      },
    },
  })
  create(
    @Param('tenantId') tenantId: string,
    @UploadedFile() file: UploadedPdf | undefined,
    @Body(new ZodPipe(printJobUploadSchema)) input: PrintJobUploadInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PrintJob> {
    return this.jobs.create(tenantId, file, input, actor, context);
  }

  @Get()
  @RequirePermissions('print-jobs:read')
  @ApiOperation({ summary: 'Fichiers analysés, du plus récent au plus ancien' })
  list(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(printJobListQuerySchema)) query: ListQuery,
  ): Promise<Page<PrintJobSummary>> {
    return this.jobs.list(tenantId, query);
  }

  @Get('printed')
  @RequirePermissions('print-jobs:read', 'costs:read')
  @ApiOperation({
    summary: 'Registre des impressions : travaux imprimés, coût de revient et marge',
  })
  printed(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(printJobListQuerySchema)) query: ListQuery,
  ): Promise<Page<PrintedJob>> {
    return this.jobs.printed(tenantId, query);
  }

  @Post(':jobId/printed')
  @RequirePermissions('print-jobs:manage', 'consumption:read')
  @ApiOperation({ summary: 'Enregistre le travail comme imprimé, avec son coût de revient' })
  @ApiBody({ schema: openApiSchema(printJobPrintedSchema) })
  markPrinted(
    @Param('tenantId') tenantId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body(new ZodPipe(printJobPrintedSchema)) input: PrintJobPrintedInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PrintedJob> {
    return this.jobs.markPrinted(tenantId, jobId, input, actor, context);
  }

  @Delete(':jobId/printed')
  @HttpCode(204)
  @RequirePermissions('print-jobs:manage')
  @ApiOperation({ summary: 'Retire un travail du registre des impressions' })
  async unmarkPrinted(
    @Param('tenantId') tenantId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<void> {
    await this.jobs.unmarkPrinted(tenantId, jobId, actor, context);
  }

  @Get(':jobId')
  @RequirePermissions('print-jobs:read')
  @ApiOperation({ summary: 'Analyse d’un fichier, page par page' })
  get(
    @Param('tenantId') tenantId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ): Promise<PrintJob> {
    return this.jobs.get(tenantId, jobId);
  }

  @Get(':jobId/estimate')
  @RequirePermissions('print-jobs:read', 'consumption:read')
  @ApiOperation({ summary: 'Rapport de préproduction : toner et coût du travail sur une machine' })
  estimate(
    @Param('tenantId') tenantId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Query(new ZodPipe(printJobEstimateQuerySchema)) query: PrintJobEstimateQuery,
  ): Promise<PrintJobEstimate> {
    return this.jobs.estimate(tenantId, jobId, query);
  }

  @Patch(':jobId')
  @RequirePermissions('print-jobs:manage')
  @ApiOperation({ summary: 'Renomme le travail, ou change sa machine prévue ou ses exemplaires' })
  @ApiBody({ schema: openApiSchema(printJobUpdateSchema) })
  update(
    @Param('tenantId') tenantId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body(new ZodPipe(printJobUpdateSchema)) input: PrintJobUpdateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<PrintJob> {
    return this.jobs.update(tenantId, jobId, input, actor, context);
  }

  @Delete(':jobId')
  @HttpCode(204)
  @RequirePermissions('print-jobs:manage')
  @ApiOperation({ summary: 'Supprime une analyse' })
  async remove(
    @Param('tenantId') tenantId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<void> {
    await this.jobs.remove(tenantId, jobId, actor, context);
  }
}
