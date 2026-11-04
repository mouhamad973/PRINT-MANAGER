import { describe, expect, it } from 'vitest';
import {
  printerConnectionSchema,
  printerCreateSchema,
  printerListQuerySchema,
  printerModelCreateSchema,
  printerModelUpdateSchema,
  siteCreateSchema,
  siteUpdateSchema,
} from './fleet.js';

const SITE_ID = '0196f1c2-7a5b-7c3d-8e9f-0a1b2c3d4e5f';
const MODEL_ID = '0196f1c2-7a5b-7c3d-8e9f-0a1b2c3d4e60';

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

describe('sites', () => {
  it('normalise les champs facultatifs vides en null', () => {
    const site = siteCreateSchema.parse({ name: '  Siège  ', city: '', contactEmail: ' ' });
    expect(site).toMatchObject({ name: 'Siège', city: null, contactEmail: null, code: null });
  });

  it('refuse une modification vide', () => {
    expect(siteUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe('fiches techniques', () => {
  it('applique les valeurs par défaut et convertit les nombres saisis', () => {
    const model = printerModelCreateSchema.parse({
      manufacturer: 'Fabricant',
      name: 'Modèle 1',
      colorMode: 'COLOR',
      speedMonoPpm: '45',
      speedColorPpm: '',
    });
    expect(model).toMatchObject({
      technology: 'LASER',
      maxFormat: 'A4',
      duplex: true,
      speedMonoPpm: 45,
      speedColorPpm: null,
    });
  });

  it('refuse une vitesse couleur sur un modèle noir et blanc', () => {
    const result = printerModelCreateSchema.safeParse({
      manufacturer: 'Fabricant',
      name: 'Modèle NB',
      colorMode: 'MONOCHROME',
      speedColorPpm: 30,
    });
    expect(messages(result)).toContain('Un modèle noir et blanc n’a pas de vitesse couleur.');
  });

  it('ne réapplique pas les valeurs par défaut lors d’une modification', () => {
    expect(printerModelUpdateSchema.parse({ name: 'Nouveau nom' })).toEqual({
      name: 'Nouveau nom',
    });
  });
});

describe('machines', () => {
  it('met la machine en service par défaut et accepte une date d’installation', () => {
    const printer = printerCreateSchema.parse({
      siteId: SITE_ID,
      modelId: MODEL_ID,
      name: 'Accueil RDC',
      serialNumber: ' SN-001 ',
      installedAt: '2026-01-15',
    });
    expect(printer).toMatchObject({
      status: 'ACTIVE',
      serialNumber: 'SN-001',
      installedAt: '2026-01-15',
    });
  });

  it('refuse un site qui n’est pas un identifiant', () => {
    const result = printerCreateSchema.safeParse({
      siteId: 'siege',
      modelId: MODEL_ID,
      name: 'Accueil',
      serialNumber: 'SN',
    });
    expect(messages(result)).toContain('Choisissez un site.');
  });

  it('ignore les filtres vides de la liste', () => {
    expect(printerListQuerySchema.parse({ siteId: '', status: '' })).toMatchObject({
      siteId: undefined,
      status: undefined,
      page: 1,
    });
  });
});

describe('configuration réseau', () => {
  it('accepte IPv4, IPv6 et normalise l’adresse MAC', () => {
    expect(
      printerConnectionSchema.parse({
        ipAddress: '192.168.1.20',
        snmpVersion: 'V2C',
        macAddress: '001b44113ab7',
      }),
    ).toMatchObject({ ipAddress: '192.168.1.20', macAddress: '00:1B:44:11:3A:B7', snmpPort: 161 });
    expect(
      printerConnectionSchema.safeParse({ ipAddress: 'fe80::1', snmpVersion: 'V2C' }).success,
    ).toBe(true);
  });

  it('refuse une adresse invalide et exige une adresse ou un nom d’hôte', () => {
    expect(
      messages(printerConnectionSchema.safeParse({ ipAddress: '300.1.1.1', snmpVersion: 'V2C' })),
    ).toContain('Saisissez une adresse IPv4 ou IPv6 valide.');
    expect(messages(printerConnectionSchema.safeParse({ snmpVersion: 'V2C' }))).toContain(
      'Saisissez une adresse IP ou un nom d’hôte.',
    );
  });

  it('distingue un secret absent (conservé), nul (effacé) et renseigné (remplacé)', () => {
    const base = { hostname: 'imprimante-01.local', snmpVersion: 'V2C' as const };
    expect(printerConnectionSchema.parse(base).snmpCommunity).toBeUndefined();
    expect(
      printerConnectionSchema.parse({ ...base, snmpCommunity: null }).snmpCommunity,
    ).toBeNull();
    expect(printerConnectionSchema.parse({ ...base, snmpCommunity: 'lecture' }).snmpCommunity).toBe(
      'lecture',
    );
  });

  it('exige l’utilisateur, le niveau et les protocoles en SNMPv3', () => {
    const result = printerConnectionSchema.safeParse({
      ipAddress: '10.0.0.5',
      snmpVersion: 'V3',
      snmpSecurityLevel: 'AUTH_PRIV',
    });
    expect(messages(result)).toEqual(
      expect.arrayContaining([
        'SNMPv3 exige un nom d’utilisateur.',
        'Choisissez un protocole d’authentification.',
        'Choisissez un protocole de chiffrement.',
      ]),
    );
  });

  it('impose 8 caractères aux mots de passe SNMPv3', () => {
    const result = printerConnectionSchema.safeParse({
      ipAddress: '10.0.0.5',
      snmpVersion: 'V3',
      snmpUsername: 'collecteur',
      snmpSecurityLevel: 'AUTH_NO_PRIV',
      snmpAuthProtocol: 'SHA256',
      snmpAuthPassword: 'court',
    });
    expect(messages(result)).toContain('Mot de passe d’authentification : 8 caractères minimum.');
  });
});
