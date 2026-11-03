import type { Page, UserAccount } from '@arksen/shared-types';
import {
  listQuerySchema,
  passwordResetSchema,
  userCreateSchema,
  userUpdateSchema,
  type ListQuery,
  type UserCreateInput,
  type UserUpdateInput,
} from '@arksen/validation';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators.js';
import {
  CurrentPrincipal,
  CurrentRequestContext,
  type Principal,
  type RequestContext,
} from '../auth/principal.js';
import { openApiSchema, ZodPipe } from '../common/zod.js';
import { UsersService } from './users.service.js';

@ApiTags('Utilisateurs')
@ApiCookieAuth()
@Controller('tenants/:tenantId/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'Utilisateurs de l’entreprise' })
  list(
    @Param('tenantId') tenantId: string,
    @Query(new ZodPipe(listQuerySchema)) query: ListQuery,
  ): Promise<Page<UserAccount>> {
    return this.users.list(tenantId, query);
  }

  @Post()
  @RequirePermissions('users:manage')
  @ApiOperation({ summary: 'Crée un utilisateur avec un mot de passe provisoire' })
  @ApiBody({ schema: openApiSchema(userCreateSchema) })
  create(
    @Param('tenantId') tenantId: string,
    @Body(new ZodPipe(userCreateSchema)) input: UserCreateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<UserAccount> {
    return this.users.create(tenantId, input, actor, context);
  }

  @Get(':userId')
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'Fiche d’un utilisateur' })
  get(@Param('tenantId') tenantId: string, @Param('userId') userId: string): Promise<UserAccount> {
    return this.users.get(tenantId, userId);
  }

  @Patch(':userId')
  @RequirePermissions('users:manage')
  @ApiOperation({ summary: 'Modifie le nom, le rôle ou le statut d’un utilisateur' })
  @ApiBody({ schema: openApiSchema(userUpdateSchema) })
  update(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body(new ZodPipe(userUpdateSchema)) input: UserUpdateInput,
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<UserAccount> {
    return this.users.update(tenantId, userId, input, actor, context);
  }

  @Post(':userId/reset-password')
  @HttpCode(204)
  @RequirePermissions('users:manage')
  @ApiOperation({ summary: 'Définit un nouveau mot de passe provisoire et ferme les sessions' })
  @ApiBody({ schema: openApiSchema(passwordResetSchema) })
  async resetPassword(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Body(new ZodPipe(passwordResetSchema)) input: { password: string },
    @CurrentPrincipal() actor: Principal,
    @CurrentRequestContext() context: RequestContext,
  ): Promise<void> {
    await this.users.resetPassword(tenantId, userId, input.password, actor, context);
  }
}
