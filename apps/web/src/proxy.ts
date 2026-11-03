import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIES = ['arksen.session_token', '__Secure-arksen.session_token'];

/**
 * Redirige vers la connexion quand aucun cookie de session n'est présent.
 * Ce n'est qu'un confort de navigation : la session est réellement vérifiée par l'API,
 * à chaque requête.
 */
export function proxy(request: NextRequest): NextResponse {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) {
    return NextResponse.next();
  }
  const login = new URL('/login', request.url);
  const target = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (target !== '/') {
    login.searchParams.set('next', target);
  }
  return NextResponse.redirect(login);
}

export const config = {
  // Tout sauf la connexion, le relais API, les sondes et les fichiers statiques.
  matcher: ['/((?!login|backend|healthz|_next/|favicon.ico).*)'],
};
