import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma ne charge pas .env automatiquement : en développement, on lit celui de la racine.
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (!process.env.DATABASE_URL && existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // `prisma generate` n'ouvre aucune connexion : l'URL n'est requise que pour les migrations.
    url: process.env.DATABASE_URL ?? '',
  },
});
