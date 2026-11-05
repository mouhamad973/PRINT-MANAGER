import { REPORT_TYPES, type ReportType, type Statistics } from '@arksen/shared-types';
import {
  reportQuerySchema,
  statisticsQuerySchema,
  type ReportQuery,
  type StatisticsQuery,
} from '@arksen/validation';
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermissions } from '../auth/decorators.js';
import {
  CurrentPrincipal,
  CurrentRequestContext,
  type Principal,
  type RequestContext,
} from '../auth/principal.js';
import { ZodPipe } from '../common/zod.js';
import { ReportsService } from './reports.service.js';

@ApiTags('Rapports et statistiques')
@ApiCookieAuth()
@Controller('tenants/:tenantId')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports/:type')
  // Chaque rapport vérifie ses propres droits (voir REPORTS dans shared-types).
  @RequirePermissions('printers:read')
  @ApiParam({ name: 'type', enum: REPORT_TYPES })
  @ApiProduces(
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
  )
  @ApiOperation({ summary: 'Exporte un rapport en PDF, Excel ou CSV' })
  async export(
    @Param('tenantId') tenantId: string,
    @Param('type') type: string,
    @Query(new ZodPipe(reportQuerySchema)) query: ReportQuery,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (!REPORT_TYPES.includes(type as ReportType)) {
      throw new NotFoundException('Rapport inconnu.');
    }
    const report = await this.reports.export(tenantId, type as ReportType, query, actor, context);
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(report.body, {
      type: report.contentType,
      disposition: `attachment; filename="${report.filename}"`,
      length: report.body.length,
    });
  }

  @Get('statistics')
  @RequirePermissions('costs:read')
  @ApiOperation({
    summary: 'Volumes, coûts et chiffre d’affaires mois par mois, rentabilité par client',
  })
  statistics(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(statisticsQuerySchema)) query: StatisticsQuery,
  ): Promise<Statistics> {
    return this.reports.statistics(tenantId, query);
  }
}
