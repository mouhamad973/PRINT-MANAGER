import type { UserRole } from '@arksen/shared-types';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Identité établie par le serveur à partir de la session : jamais à partir du corps de la requête. */
export interface Principal {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string | null;
  sessionId: string;
}

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export type AuthenticatedRequest = Request & { principal?: Principal };

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    if (!principal) {
      // Ne peut arriver que sur une route publique qui demanderait l'identité : erreur de code.
      throw new Error('Aucun utilisateur authentifié sur cette route');
    }
    return principal;
  },
);

export function requestContext(request: Request): RequestContext {
  return {
    ipAddress: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

export const CurrentRequestContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestContext =>
    requestContext(context.switchToHttp().getRequest<Request>()),
);
