import { PASSWORD_MIN_LENGTH } from '@arksen/validation';
import { describe, expect, it } from 'vitest';
import { generatePassword } from './password';

describe('generatePassword', () => {
  it('respecte la longueur minimale imposée par l’API', () => {
    expect(generatePassword().length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
  });

  it('n’utilise aucun caractère ambigu', () => {
    expect(generatePassword(200)).not.toMatch(/[0O1lI]/);
  });

  it('produit des valeurs différentes', () => {
    expect(new Set(Array.from({ length: 20 }, () => generatePassword())).size).toBe(20);
  });
});
