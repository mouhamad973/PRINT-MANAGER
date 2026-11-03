import type { PrismaClient } from '@arksen/database';
import { USER_ROLES, type UserRole } from '@arksen/shared-types';
import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { PRISMA_SYSTEM } from '../database/database.module.js';
import { AUTH, type Auth } from './auth.js';
import { PUBLIC_KEY } from './decorators.js';
import type { AuthenticatedRequest } from './principal.js';

/**
 * Garde global : toute route exige une session valide, sauf celles marquées `@Public()`.
 * Le compte et son entreprise sont revérifiés à chaque requête : une désactivation
 * prend effet immédiatement, sans attendre l'expiration de la session.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(PRISMA_SYSTEM) private readonly systemPrisma: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const result = await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!result) {
      throw new UnauthorizedException('Session absente ou expirée.');
    }

    const user = await this.systemPrisma.user.findUnique({
      where: { id: result.user.id },
      select: { status: true, role: true, tenantId: true, tenant: { select: { status: true } } },
    });
    if (!user || user.status !== 'ACTIVE' || (user.tenant && user.tenant.status !== 'ACTIVE')) {
      throw new ForbiddenException('Ce compte est désactivé.');
    }
    if (!USER_ROLES.includes(user.role as UserRole)) {
      throw new ForbiddenException('Rôle inconnu.');
    }

    request.principal = {
      userId: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: user.role,
      tenantId: user.tenantId,
      sessionId: result.session.id,
    };
    return true;
  }
}
