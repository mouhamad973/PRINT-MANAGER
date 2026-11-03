import { hasPermission, type Permission } from '@arksen/shared-types';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, PUBLIC_KEY } from './decorators.js';
import type { AuthenticatedRequest } from './principal.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Garde global, exécuté après l'authentification.
 *
 * 1. Périmètre : sur toute route portant `:tenantId`, un utilisateur d'entreprise n'accède
 *    qu'à la sienne. L'identifiant de l'URL n'est jamais cru tel quel : il est comparé à celui
 *    de la session. Une autre entreprise répond 404, pour ne pas révéler son existence.
 * 2. Permissions : le rôle doit détenir toutes celles déclarées par `@RequirePermissions()`.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = request.principal;
    if (!principal) {
      throw new ForbiddenException();
    }

    const tenantId = request.params?.tenantId;
    if (typeof tenantId === 'string') {
      const inScope = principal.role === 'SUPER_ADMIN' || principal.tenantId === tenantId;
      if (!UUID_PATTERN.test(tenantId) || !inScope) {
        throw new NotFoundException('Entreprise introuvable.');
      }
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets) ?? [];
    const missing = required.filter((permission) => !hasPermission(principal.role, permission));
    if (missing.length > 0) {
      throw new ForbiddenException('Vous n’avez pas les droits nécessaires pour cette action.');
    }
    return true;
  }
}
