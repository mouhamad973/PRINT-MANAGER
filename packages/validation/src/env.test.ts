import { describe, expect, it } from 'vitest';
import { apiEnvSchema, parseEnv, workersEnvSchema } from './env.js';

const validApiEnv = {
  DEPLOYMENT_MODE: 'cloud',
  DATABASE_APP_URL: 'postgresql://arksen_app:secret@localhost:15432/arksen',
  DATABASE_SYSTEM_URL: 'postgresql://arksen_system:secret@localhost:15432/arksen',
  REDIS_URL: 'redis://:secret@localhost:16379',
  ANALYTICS_URL: 'http://localhost:8000',
  PUBLIC_WEB_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  CREDENTIALS_ENCRYPTION_KEY: 'ab'.repeat(32),
};

describe('parseEnv', () => {
  it('accepte un environnement valide et applique les valeurs par défaut', () => {
    const env = parseEnv(apiEnvSchema, validApiEnv);
    expect(env.API_PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('convertit le port en nombre', () => {
    expect(parseEnv(apiEnvSchema, { ...validApiEnv, API_PORT: '4100' }).API_PORT).toBe(4100);
  });

  it('refuse un mode de déploiement inconnu', () => {
    expect(() => parseEnv(apiEnvSchema, { ...validApiEnv, DEPLOYMENT_MODE: 'hybride' })).toThrow(
      /DEPLOYMENT_MODE/,
    );
  });

  it('refuse une URL de base qui n’est pas PostgreSQL', () => {
    expect(() =>
      parseEnv(apiEnvSchema, { ...validApiEnv, DATABASE_APP_URL: 'mysql://localhost/arksen' }),
    ).toThrow(/DATABASE_APP_URL/);
  });

  it('refuse un secret d’authentification trop court', () => {
    expect(() => parseEnv(apiEnvSchema, { ...validApiEnv, BETTER_AUTH_SECRET: 'court' })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it('traite les variables vides du premier administrateur comme absentes', () => {
    const env = parseEnv(apiEnvSchema, {
      ...validApiEnv,
      SUPER_ADMIN_EMAIL: '',
      SUPER_ADMIN_PASSWORD: '',
    });
    expect(env.SUPER_ADMIN_EMAIL).toBeUndefined();
  });

  it('exige le mot de passe du premier administrateur avec son adresse', () => {
    expect(() =>
      parseEnv(apiEnvSchema, { ...validApiEnv, SUPER_ADMIN_EMAIL: 'admin@arksen.test' }),
    ).toThrow(/SUPER_ADMIN_PASSWORD/);
  });

  it('ne reproduit jamais la valeur d’une variable invalide dans l’erreur', () => {
    const attempt = () =>
      parseEnv(workersEnvSchema, { REDIS_URL: 'http://:motdepasse-secret@localhost' });
    expect(attempt).toThrow(/REDIS_URL/);
    expect(attempt).not.toThrow(/motdepasse-secret/);
  });
});
