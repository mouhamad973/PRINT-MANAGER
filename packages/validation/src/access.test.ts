import { describe, expect, it } from 'vitest';
import {
  changePasswordSchema,
  listQuerySchema,
  tenantCreateSchema,
  tenantUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
} from './access.js';

const validUser = {
  name: 'Awa Diallo',
  email: '  Awa.Diallo@Exemple.SN ',
  role: 'TECHNICIAN',
  password: 'un-mot-de-passe-long',
};

describe('userCreateSchema', () => {
  it('normalise l’adresse e-mail', () => {
    expect(userCreateSchema.parse(validUser).email).toBe('awa.diallo@exemple.sn');
  });

  it('refuse un mot de passe de moins de 12 caractères', () => {
    expect(userCreateSchema.safeParse({ ...validUser, password: 'court' }).success).toBe(false);
  });

  it('refuse l’attribution du rôle Super Administrateur', () => {
    expect(userCreateSchema.safeParse({ ...validUser, role: 'SUPER_ADMIN' }).success).toBe(false);
  });
});

describe('userUpdateSchema', () => {
  it('refuse une modification vide', () => {
    expect(userUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('accepte une désactivation seule', () => {
    expect(userUpdateSchema.parse({ status: 'DISABLED' })).toEqual({ status: 'DISABLED' });
  });
});

describe('tenantCreateSchema', () => {
  it('transforme les champs facultatifs vides en null', () => {
    const tenant = tenantCreateSchema.parse({
      name: 'Imprimerie du Port',
      slug: 'imprimerie-du-port',
      contactEmail: '',
      city: '  ',
    });
    expect(tenant.contactEmail).toBeNull();
    expect(tenant.city).toBeNull();
  });

  it('refuse un identifiant contenant des majuscules ou des espaces', () => {
    for (const slug of ['Imprimerie', 'imprimerie du port', '-debut', 'fin-']) {
      expect(tenantCreateSchema.safeParse({ name: 'Nom', slug }).success, slug).toBe(false);
    }
  });

  it('refuse une adresse de contact invalide', () => {
    expect(
      tenantCreateSchema.safeParse({ name: 'Nom', slug: 'nom', contactEmail: 'pas-un-mail' })
        .success,
    ).toBe(false);
  });
});

describe('tenantUpdateSchema', () => {
  it('n’autorise pas la modification de l’identifiant', () => {
    expect(tenantUpdateSchema.parse({ slug: 'autre', name: 'Nom' })).toEqual({ name: 'Nom' });
  });
});

describe('changePasswordSchema', () => {
  const base = {
    currentPassword: 'ancien-mot-de-passe',
    newPassword: 'nouveau-mot-de-passe',
    confirmPassword: 'nouveau-mot-de-passe',
  };

  it('exige une confirmation identique', () => {
    const result = changePasswordSchema.safeParse({ ...base, confirmPassword: 'autre-chose-123' });
    expect(result.success).toBe(false);
  });

  it('exige un nouveau mot de passe différent de l’actuel', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: base.newPassword,
      newPassword: base.newPassword,
      confirmPassword: base.newPassword,
    });
    expect(result.success).toBe(false);
  });
});

describe('listQuerySchema', () => {
  it('applique la pagination par défaut et borne la taille de page', () => {
    expect(listQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25, search: undefined });
    expect(listQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });
});
