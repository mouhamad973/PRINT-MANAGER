import type { AuditLogEntry, Page } from '@arksen/shared-types';
import {
  auditExportQuerySchema,
  listQuerySchema,
  type AuditExportQuery,
  type ListQuery,
} from '@arksen/validation';
import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermissions } from '../auth/decorators.js';
import {
  CurrentPrincipal,
  CurrentRequestContext,
  type Principal,
  type RequestContext,
} from '../auth/principal.js';
import { ZodPipe } from '../common/zod.js';
import { AuditService } from './audit.service.js';

function csvFile(response: Response, body: Buffer, name: string, query: AuditExportQuery) {
  response.setHeader('Cache-Control', 'no-store');
  return new StreamableFile(body, {
    type: 'text/csv; charset=utf-8',
    disposition: `attachment; filename="arksen-${name}-${query.from}_${query.to}.csv"`,
  });
}

@ApiTags('Audit')
@ApiCookieAuth()
@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('audit-logs')
  @RequirePermissions('platform:audit:read')
  @ApiOperation({ summary: 'Journal d’audit de toute la plateforme' })
  listPlatform(
    @Query(new ZodPipe(listQuerySchema)) query: ListQuery,
  ): Promise<Page<AuditLogEntry>> {
    return this.audit.listPlatform(query);
  }

  @Get('audit-logs/export')
  @RequirePermissions('platform:audit:read')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Exporte en CSV le journal d’audit de la plateforme sur une période' })
  async exportPlatform(
    @Query(new ZodPipe(auditExportQuerySchema)) query: AuditExportQuery,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const body = await this.audit.exportPlatform(query);
    await this.audit.record({
      action: 'audit.exported',
      actorUserId: actor.userId,
      actorEmail: actor.email,
      metadata: { scope: 'platform', from: query.from, to: query.to },
      ...context,
    });
    return csvFile(response, body, 'journal-plateforme', query);
  }

  @Get('tenants/:tenantId/audit-logs')
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Journal d’audit d’une entreprise' })
  listForTenant(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(listQuerySchema)) query: ListQuery,
  ): Promise<Page<AuditLogEntry>> {
    return this.audit.listForTenant(tenantId, query);
  }

  @Get('tenants/:tenantId/audit-logs/export')
  @RequirePermissions('audit:read')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Exporte en CSV le journal d’audit d’une entreprise sur une période' })
  async exportForTenant(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(auditExportQuerySchema)) query: AuditExportQuery,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const body = await this.audit.exportForTenant(tenantId, query);
    await this.audit.record({
      action: 'audit.exported',
      tenantId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      metadata: { scope: 'tenant', from: query.from, to: query.to },
      ...context,
    });
    return csvFile(response, body, 'journal', query);
  }
}
