import type { PrismaClient } from '@arksen/database';
import { ROLE_PERMISSIONS, type CurrentUser } from '@arksen/shared-types';
import { profileUpdateSchema } from '@arksen/validation';
import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../audit/audit.service.js';
import {
  CurrentPrincipal,
  CurrentRequestContext,
  type Principal,
  type RequestContext,
} from '../auth/principal.js';
import { openApiSchema, ZodPipe } from '../common/zod.js';
import { PRISMA_SYSTEM } from '../database/database.module.js';

@ApiTags('Profil')
@ApiCookieAuth()
@Controller('me')
export class MeController {
  constructor(
    @Inject(PRISMA_SYSTEM) private readonly systemPrisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Utilisateur connecté, son entreprise et ses permissions' })
  async get(@CurrentPrincipal() principal: Principal): Promise<CurrentUser> {
    const tenant = principal.tenantId
      ? await this.systemPrisma.tenant.findUnique({
          where: { id: principal.tenantId },
          select: { id: true, name: true, slug: true, status: true },
        })
      : null;
    return {
      user: {
        id: principal.userId,
        name: principal.name,
        email: principal.email,
        role: principal.role,
      },
      tenant,
      permissions: [...ROLE_PERMISSIONS[principal.role]],
    };
  }

  /** Le profil ne modifie que le nom : le rôle et l'entreprise relèvent d'un administrateur. */
  @Patch()
  @ApiOperation({ summary: 'Modifie le nom de l’utilisateur connecté' })
  @ApiBody({ schema: openApiSchema(profileUpdateSchema) })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodPipe(profileUpdateSchema)) input: { name: string },
    @CurrentRequestContext() context: RequestContext,
  ): Promise<CurrentUser> {
    await this.systemPrisma.user.update({
      where: { id: principal.userId },
      data: { name: input.name },
    });
    await this.audit.record({
      action: 'profile.updated',
      tenantId: principal.tenantId,
      actorUserId: principal.userId,
      actorEmail: principal.email,
      targetType: 'user',
      targetId: principal.userId,
      ...context,
    });
    return this.get({ ...principal, name: input.name });
  }
}
