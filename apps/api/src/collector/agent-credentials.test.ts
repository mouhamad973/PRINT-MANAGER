import { agentEnrollSchema } from '@arksen/validation';
import { describe, expect, it } from 'vitest';
import {
  bearerToken,
  formatEnrollmentCode,
  generateAgentToken,
  generateEnrollmentCode,
  hashSecret,
  normalizeEnrollmentCode,
} from './agent-credentials.js';

describe('identifiants des agents', () => {
  it('génère des codes base32 de 16 caractères, différents à chaque appel', () => {
    const codes = new Set(Array.from({ length: 200 }, generateEnrollmentCode));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-7]{16}$/);
  });

  it('présente le code par groupes de quatre et le relit tel qu’il est saisi', () => {
    const code = generateEnrollmentCode();
    const shown = formatEnrollmentCode(code);
    expect(shown).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
    expect(normalizeEnrollmentCode(shown.toLowerCase())).toBe(code);
    // Le schéma de l'enregistrement normalise de la même façon : l'empreinte est identique.
    const parsed = agentEnrollSchema.parse({
      code: ` ${shown.toLowerCase().replace(/-/g, ' ')} `,
      hostname: 'POSTE-01',
      version: '0.1.0',
    });
    expect(hashSecret(parsed.code)).toBe(hashSecret(code));
  });

  it('délivre des jetons de 256 bits lisibles dans l’en-tête Authorization', () => {
    const token = generateAgentToken();
    expect(token).toMatch(/^ark_[A-Za-z0-9_-]{43}$/);
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(bearerToken(`bearer ${token}`)).toBeNull();
    expect(bearerToken(token)).toBeNull();
    expect(bearerToken(`Bearer ${token}x`)).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });

  it('ne conserve qu’une empreinte SHA-256 en hexadécimal', () => {
    expect(hashSecret('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
