import { describe, expect, it } from 'vitest';
import { SecretBox } from './secret-box.js';

const box = new SecretBox('ab'.repeat(32));

describe('SecretBox', () => {
  it('chiffre puis déchiffre une valeur dans son contexte', () => {
    const sealed = box.encrypt('communauté-lecture', 'printer:1:snmpCommunity');
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain('communauté');
    expect(box.decrypt(sealed, 'printer:1:snmpCommunity')).toBe('communauté-lecture');
  });

  it('produit un chiffré différent à chaque fois', () => {
    expect(box.encrypt('public', 'ctx')).not.toBe(box.encrypt('public', 'ctx'));
  });

  it('refuse un secret recopié sur une autre machine', () => {
    const sealed = box.encrypt('secret', 'printer:1:snmpCommunity');
    expect(() => box.decrypt(sealed, 'printer:2:snmpCommunity')).toThrow();
  });

  it('refuse un chiffré altéré ou une autre clé', () => {
    const sealed = box.encrypt('secret', 'ctx');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('altéré').toString('base64url');
    expect(() => box.decrypt(parts.join('.'), 'ctx')).toThrow();
    expect(() => new SecretBox('cd'.repeat(32)).decrypt(sealed, 'ctx')).toThrow();
  });

  it('exige une clé de 32 octets', () => {
    expect(() => new SecretBox('abcd')).toThrow('32 octets');
  });
});
