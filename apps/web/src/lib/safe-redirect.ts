/**
 * N'accepte comme destination après connexion qu'un chemin interne.
 * `//exemple.com` ou `https://...` renverraient l'utilisateur vers un site tiers.
 */
export function safeRedirect(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/';
  }
  return next;
}
