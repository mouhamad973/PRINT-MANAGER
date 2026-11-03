// Sans caractères ambigus (0/O, 1/l/I) : le mot de passe provisoire est souvent dicté ou recopié.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Mot de passe provisoire aléatoire, tiré par le générateur cryptographique du navigateur. */
export function generatePassword(length = 16): string {
  const limit = 256 - (256 % ALPHABET.length);
  const result: string[] = [];
  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      // Rejet des octets au-delà du dernier multiple complet : pas de biais de distribution.
      if (byte < limit && result.length < length) {
        result.push(ALPHABET[byte % ALPHABET.length]!);
      }
    }
  }
  return result.join('');
}
