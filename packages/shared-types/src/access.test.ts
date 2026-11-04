import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  PERMISSION_LABELS,
  ROLE_PERMISSIONS,
  TENANT_ROLES,
  USER_ROLES,
  hasPermission,
} from './index.js';

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

  it('laisse chaque rôle d’entreprise consulter le parc, mais réserve sa gestion', () => {
    for (const role of TENANT_ROLES) {
      expect(hasPermission(role, 'printers:read'), role).toBe(true);
      expect(hasPermission(role, 'sites:read'), role).toBe(true);
    }
    expect(TENANT_ROLES.filter((role) => hasPermission(role, 'sites:manage'))).toEqual([
      'CLIENT_ADMIN',
      'PRINT_MANAGER',
    ]);
    expect(TENANT_ROLES.filter((role) => hasPermission(role, 'printers:network:manage'))).toEqual([
      'CLIENT_ADMIN',
      'PRINT_MANAGER',
      'TECHNICIAN',
    ]);
  });

  it('laisse chaque rôle consulter les compteurs, et réserve leur saisie au terrain', () => {
    for (const role of TENANT_ROLES) {
      expect(hasPermission(role, 'meters:read'), role).toBe(true);
    }
    expect(TENANT_ROLES.filter((role) => hasPermission(role, 'meters:manage'))).toEqual([
      'CLIENT_ADMIN',
      'PRINT_MANAGER',
      'TECHNICIAN',
    ]);
  });

  it('donne un libellé à chaque permission d’entreprise', () => {
    const tenantPermissions = PERMISSIONS.filter(
      (permission) => !permission.startsWith('platform:'),
    );
    for (const permission of tenantPermissions) {
      expect(PERMISSION_LABELS[permission], permission).toBeTruthy();
    }
  });

  it('n’autorise jamais l’attribution du rôle Super Administrateur par une entreprise', () => {
    expect(TENANT_ROLES).not.toContain('SUPER_ADMIN');
  });
});
