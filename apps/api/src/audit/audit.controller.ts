import type { AuditLogEntry, Page } from '@arksen/shared-types';
import { listQuerySchema, type ListQuery } from '@arksen/validation';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.js';
import { AuditService } from './audit.service.js';

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

  @Get('tenants/:tenantId/audit-logs')
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Journal d’audit d’une entreprise' })
  listForTenant(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(listQuerySchema)) query: ListQuery,
  ): Promise<Page<AuditLogEntry>> {
    return this.audit.listForTenant(tenantId, query);
  }
}
