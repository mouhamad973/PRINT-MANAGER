import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, TENANT_ROLES, USER_ROLES, hasPermission } from './index.js';

const platformPermissions = PERMISSIONS.filter((permission) => permission.startsWith('platform:'));

describe('matrice des permissions', () => {
  it('définit les permissions de chacun des six rôles', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...USER_ROLES].sort());
  });

  it('donne toutes les permissions au Super Administrateur', () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission('SUPER_ADMIN', permission)).toBe(true);
    }
  });

  it('réserve les permissions de plateforme au Super Administrateur', () => {
    for (const role of TENANT_ROLES) {
      for (const permission of platformPermissions) {
        expect(hasPermission(role, permission), `${role} / ${permission}`).toBe(false);
      }
    }
  });

  it('réserve la gestion des utilisateurs à l’administrateur client', () => {
    const managers = TENANT_ROLES.filter((role) => hasPermission(role, 'users:manage'));
    expect(managers).toEqual(['CLIENT_ADMIN']);
  });

  it('laisse chaque rôle d’entreprise consulter sa propre entreprise', () => {
    for (const role of TENANT_ROLES) {
      expect(hasPermission(role, 'tenant:read')).toBe(true);
    }
  });

  it('n’autorise jamais l’attribution du rôle Super Administrateur par une entreprise', () => {
    expect(TENANT_ROLES).not.toContain('SUPER_ADMIN');
  });
});
