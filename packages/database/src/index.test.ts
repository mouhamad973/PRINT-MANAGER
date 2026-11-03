import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPrismaClient } from './index.js';

const migrationsDir = resolve(import.meta.dirname, '../prisma/migrations');

describe('createPrismaClient', () => {
  it('crée un client sans ouvrir de connexion', () => {
    const client = createPrismaClient('postgresql://user:pass@127.0.0.1:1/none');
    expect(client.systemSetting).toBeDefined();
  });
});

describe('migrations', () => {
  it('crée la table system_settings dans la migration initiale', () => {
    const [first] = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(first).toBeDefined();
    const sql = readFileSync(resolve(migrationsDir, first!, 'migration.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE "system_settings"');
  });
});
