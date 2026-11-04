import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

/**
 * Chiffrement des secrets d'équipement (communautés et mots de passe SNMP) en AES-256-GCM.
 *
 * Chaque valeur est liée à son contexte (`printer:<id>:<champ>`) par les données authentifiées :
 * un secret recopié sur une autre machine ou dans un autre champ devient indéchiffrable.
 * Format stocké : `v1.<iv>.<tag>.<chiffré>`, en base64url.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(hexKey: string) {
    this.key = Buffer.from(hexKey, 'hex');
    if (this.key.length !== 32) {
      throw new Error('La clé de chiffrement doit faire 32 octets');
    }
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), encrypted]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  decrypt(sealed: string, context: string): string {
    const [version, iv, tag, encrypted] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || encrypted === undefined) {
      throw new Error('Secret chiffré illisible');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

export const SECRET_BOX = Symbol('SECRET_BOX');
