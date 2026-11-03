import { describe, expect, it } from 'vitest';
import { safeRedirect } from './safe-redirect';

describe('safeRedirect', () => {
  it('conserve un chemin interne avec sa requête', () => {
    expect(safeRedirect('/users?page=2')).toBe('/users?page=2');
  });

  it('refuse toute destination externe', () => {
    for (const next of [
      'https://exemple.com',
      '//exemple.com',
      '/\\exemple.com',
      'javascript:alert(1)',
    ]) {
      expect(safeRedirect(next), next).toBe('/');
    }
  });

  it('revient à l’accueil sans destination', () => {
    expect(safeRedirect(null)).toBe('/');
  });
});
