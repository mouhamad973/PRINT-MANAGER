import type { PrismaClient } from '@arksen/database';
import {
  createParamDecorator,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { PRISMA_SYSTEM } from '../database/database.module.js';
import { bearerToken, hashSecret } from './agent-credentials.js';

/** Agent authentifié par son jeton : son entreprise et son site viennent du serveur, jamais de la requête. */
export interface AgentPrincipal {
  id: string;
  tenantId: string;
  siteId: string | null;
  name: string;
}

export type AgentRequest = Request & { agent?: AgentPrincipal };

/** Délai sous lequel la présence d'un agent n'est pas réécrite en base à chaque requête. */
const SEEN_REFRESH_MS = 60_000;

/**
 * Garde des routes de l'agent. Le jeton est comparé par son empreinte ; l'agent et son entreprise
 * sont revérifiés à chaque requête : une révocation prend effet immédiatement.
 */
@Injectable()
export class AgentGuard implements CanActivate {
  constructor(@Inject(PRISMA_SYSTEM) private readonly systemPrisma: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AgentRequest>();
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Jeton d’agent absent ou mal formé.');
    }
    const agent = await this.systemPrisma.collectorAgent.findUnique({
      where: { tokenHash: hashSecret(token) },
      select: {
        id: true,
        tenantId: true,
        siteId: true,
        name: true,
        status: true,
        lastSeenAt: true,
        version: true,
        hostname: true,
        lastIp: true,
        tenant: { select: { status: true } },
      },
    });
    if (!agent || agent.status !== 'ACTIVE') {
      throw new UnauthorizedException('Agent inconnu ou révoqué : enregistrez-le de nouveau.');
    }
    if (agent.tenant.status !== 'ACTIVE') {
      throw new ForbiddenException('L’entreprise de cet agent est suspendue.');
    }

    const version = header(request, 'x-agent-version', 40);
    const hostname = header(request, 'x-agent-hostname', 255);
    const ip = request.ip ?? null;
    const stale = !agent.lastSeenAt || Date.now() - agent.lastSeenAt.getTime() > SEEN_REFRESH_MS;
    if (
      stale ||
      (version && version !== agent.version) ||
      (hostname && hostname !== agent.hostname) ||
      ip !== agent.lastIp
    ) {
      await this.systemPrisma.collectorAgent.update({
        where: { id: agent.id },
        data: {
          lastSeenAt: new Date(),
          lastIp: ip,
          ...(version ? { version } : {}),
          ...(hostname ? { hostname } : {}),
        },
      });
    }

    request.agent = {
      id: agent.id,
      tenantId: agent.tenantId,
      siteId: agent.siteId,
      name: agent.name,
    };
    return true;
  }
}

function header(request: Request, name: string, max: number): string | null {
  const value = request.headers[name];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

export const CurrentAgent = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AgentPrincipal => {
    const agent = context.switchToHttp().getRequest<AgentRequest>().agent;
    if (!agent) {
      throw new Error('Aucun agent authentifié sur cette route');
    }
    return agent;
  },
);
