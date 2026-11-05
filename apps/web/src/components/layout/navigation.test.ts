import type { CurrentUser, UserRole } from '@arksen/shared-types';
import { ROLE_PERMISSIONS } from '@arksen/shared-types';
import { describe, expect, it } from 'vitest';
import { NAVIGATION, navigationFor } from './navigation';

const items = NAVIGATION.flatMap((group) => group.items);

function current(role: UserRole, withTenant = true): CurrentUser {
  return {
    user: { id: 'u', name: 'U', email: 'u@test', role },
    tenant: withTenant ? { id: 't', name: 'T', slug: 't', status: 'ACTIVE' } : null,
    permissions: [...ROLE_PERMISSIONS[role]],
  };
}

function labels(user: CurrentUser): string[] {
  return navigationFor(user).flatMap((group) => group.items.map((item) => item.label));
}

describe('NAVIGATION', () => {
  it('ne présente jamais un module non livré comme disponible', () => {
    for (const item of items) {
      expect(Boolean(item.href) !== Boolean(item.phase), item.label).toBe(true);
    }
  });

  it('couvre les 20 modules du cahier des charges, les 3 pages du socle, les fiches techniques et les agents de collecte', () => {
    expect(items).toHaveLength(25);
    expect(new Set(items.map((item) => item.label)).size).toBe(items.length);
  });
});

describe('navigationFor', () => {
  it('montre la gestion des entreprises au seul Super Administrateur', () => {
    expect(labels(current('SUPER_ADMIN', false))).toContain('Entreprises clientes');
    expect(labels(current('CLIENT_ADMIN'))).not.toContain('Entreprises clientes');
  });

  it('masque les utilisateurs d’entreprise pour un compte de plateforme', () => {
    expect(labels(current('SUPER_ADMIN', false))).not.toContain('Utilisateurs et permissions');
  });

  it('masque les modules livrés que le rôle ne peut pas ouvrir', () => {
    const technician = labels(current('TECHNICIAN'));
    expect(technician).not.toContain('Utilisateurs et permissions');
    expect(technician).not.toContain('Journal d’audit');
    expect(technician).toContain('État de la plateforme');
  });

  it('ouvre les rapports à tous les rôles, et l’administration système à la seule plateforme', () => {
    expect(labels(current('USER'))).toContain('Rapports');
    expect(labels(current('SUPER_ADMIN', false))).toContain('Administration système');
    expect(labels(current('CLIENT_ADMIN'))).not.toContain('Administration système');
  });

  it('livre tous les modules : plus aucun n’est annoncé pour une phase à venir', () => {
    expect(items.filter((item) => item.phase !== undefined)).toEqual([]);
  });

  it('ouvre le parc à tous les rôles d’entreprise et à la plateforme', () => {
    for (const role of ['CLIENT_ADMIN', 'TECHNICIAN', 'USER'] as const) {
      expect(labels(current(role))).toEqual(
        expect.arrayContaining([
          'Tableau de bord',
          'Sites',
          'Machines',
          'Fiches techniques',
          'Compteurs',
        ]),
      );
    }
    expect(labels(current('SUPER_ADMIN', false))).toContain('Machines');
  });
});
