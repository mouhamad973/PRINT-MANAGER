import { createHash, randomBytes } from 'node:crypto';

/** Alphabet base32 (RFC 4648) : sans 0, 1, 8 ni 9, donc sans confusion avec O, I ou B. */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CODE_LENGTH = 16;
const TOKEN_PREFIX = 'ark_';

/** Empreinte stockée d'un secret : SHA-256 en hexadécimal. Les secrets ont 80 bits ou plus d'entropie. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Code d'enregistrement à usage unique : 16 caractères base32 (80 bits), lu par groupes de quatre. */
export function generateEnrollmentCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += BASE32[byte % 32];
  return code;
}

/** Forme canonique d'un code saisi : majuscules, sans espace ni tiret. */
export function normalizeEnrollmentCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

export function formatEnrollmentCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

/** Jeton d'un agent enregistré : 256 bits aléatoires. */
export function generateAgentToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** Jeton lu dans l'en-tête `Authorization: Bearer ark_…`, ou `null`. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(ark_[A-Za-z0-9_-]{43})$/.exec(header?.trim() ?? '');
  return match?.[1] ?? null;
}
