/** Erreur renvoyée par l'API, avec un message déjà rédigé pour l'utilisateur. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

const FALLBACK_MESSAGES: Record<number, string> = {
  401: 'Votre session a expiré. Reconnectez-vous.',
  403: 'Vous n’avez pas les droits nécessaires pour cette action.',
  404: 'Élément introuvable.',
  429: 'Trop de tentatives. Patientez une minute avant de réessayer.',
  502: 'Le serveur ne répond pas. Réessayez dans un instant.',
};

async function toApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as {
    message?: string | string[];
    issues?: { path: string; message: string }[];
  } | null;
  const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
  return new ApiError(
    response.status,
    message ?? FALLBACK_MESSAGES[response.status] ?? 'Une erreur inattendue est survenue.',
    body?.issues ?? [],
  );
}

/** Appel à l'API métier via le relais `/backend`, avec le cookie de session. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/backend/api/v1${path}`, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** Appel à Better Auth (connexion, déconnexion, mot de passe). */
export async function authFetch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/backend/api/auth${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  return (await response.json().catch(() => undefined)) as T;
}

export function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const result = search.toString();
  return result ? `?${result}` : '';
}

/** Message à montrer pour une erreur d'appel : celui de l'API, sinon un texte générique. */
export function errorMessage(error: unknown, fallback = 'Enregistrement impossible.'): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** Envoi d'un formulaire multipart (fichier) : le navigateur fixe lui-même l'en-tête et ses limites. */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(`/backend/api/v1${path}`, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  return (await response.json()) as T;
}
