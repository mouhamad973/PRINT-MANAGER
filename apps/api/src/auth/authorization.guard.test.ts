import 'reflect-metadata';
import type { Permission, UserRole } from '@arksen/shared-types';
import { ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AuthorizationGuard } from './authorization.guard.js';
import { PERMISSIONS_KEY, PUBLIC_KEY } from './decorators.js';
import type { Principal } from './principal.js';

const TENANT_A = '0190f0a0-0000-7000-8000-00000000000a';
const TENANT_B = '0190f0a0-0000-7000-8000-00000000000b';

function principal(role: UserRole, tenantId: string | null = TENANT_A): Principal {
  return { userId: 'u1', email: 'u@test', name: 'U', role, tenantId, sessionId: 's1' };
}

function context(options: {
  principal?: Principal;
  params?: Record<string, string>;
  permissions?: Permission[];
  isPublic?: boolean;
}): ExecutionContext {
  const handler = () => undefined;
  if (options.permissions) Reflect.defineMetadata(PERMISSIONS_KEY, options.permissions, handler);
  if (options.isPublic) Reflect.defineMetadata(PUBLIC_KEY, true, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ principal: options.principal, params: options.params ?? {} }),
    }),
  } as unknown as ExecutionContext;
}

const guard = new AuthorizationGuard(new Reflector());

describe('AuthorizationGuard', () => {
  it('laisse passer une route publique sans identité', () => {
    expect(guard.canActivate(context({ isPublic: true }))).toBe(true);
  });

  it('autorise un utilisateur sur sa propre entreprise', () => {
    const ctx = context({
      principal: principal('CLIENT_ADMIN'),
      params: { tenantId: TENANT_A },
      permissions: ['users:manage'],
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('répond 404 sur une autre entreprise, même avec les bonnes permissions', () => {
    const ctx = context({
      principal: principal('CLIENT_ADMIN'),
      params: { tenantId: TENANT_B },
      permissions: ['users:read'],
    });
    expect(() => guard.canActivate(ctx)).toThrow(NotFoundException);
  });

  it('répond 404 sur un identifiant d’entreprise mal formé', () => {
    const ctx = context({
      principal: principal('SUPER_ADMIN', null),
      params: { tenantId: '1 OR 1=1' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(NotFoundException);
  });

  it('laisse le Super Administrateur accéder à toute entreprise', () => {
    const ctx = context({
      principal: principal('SUPER_ADMIN', null),
      params: { tenantId: TENANT_B },
      permissions: ['users:manage'],
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('répond 403 quand le rôle n’a pas la permission', () => {
    const ctx = context({
      principal: principal('TECHNICIAN'),
      params: { tenantId: TENANT_A },
      permissions: ['users:read'],
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('réserve les permissions de plateforme au Super Administrateur', () => {
    const ctx = context({
      principal: principal('CLIENT_ADMIN'),
      permissions: ['platform:tenants:manage'],
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('refuse une route protégée sans identité établie', () => {
    expect(() => guard.canActivate(context({}))).toThrow(ForbiddenException);
  });
});
