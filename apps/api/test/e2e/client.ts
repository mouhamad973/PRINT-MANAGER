import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootEnv = resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

export const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3000';

/** Variable obligatoire pour les tests : sans elle, ils échouent au lieu d'être ignorés. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} doit être défini (voir .env) pour les tests de bout en bout`);
  }
  return value;
}

export interface Reply<T = unknown> {
  status: number;
  body: T;
}

let nextAddress = 1;

/**
 * Navigateur minimal : passe par le relais du frontend, comme un vrai utilisateur,
 * et conserve le cookie de session entre les requêtes.
 */
export class Client {
  private cookie: string | null = null;

  /**
   * Chaque client simule un poste distinct (adresse de documentation RFC 5737) :
   * la limitation des connexions, par adresse IP, ne mélange pas les scénarios.
   */
  constructor(readonly ipAddress = `198.51.100.${nextAddress++}`) {}

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<Reply<T>> {
    const response = await fetch(`${WEB_URL}/backend${path}`, {
      method,
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        Origin: WEB_URL,
        'X-Forwarded-For': this.ipAddress,
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const session = response.headers
      .getSetCookie()
      .find((cookie) => cookie.includes('session_token='));
    if (session) {
      this.cookie = session.split(';')[0]!;
    }
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
  }

  get<T = unknown>(path: string) {
    return this.request<T>('GET', path);
  }

  post<T = unknown>(path: string, body: unknown) {
    return this.request<T>('POST', path, body);
  }

  patch<T = unknown>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, body);
  }

  /** Envoi d'un fichier en multipart, comme un formulaire du navigateur. */
  async upload<T = unknown>(
    path: string,
    file: { name: string; data: Buffer; type: string },
    fields: Record<string, string> = {},
  ): Promise<Reply<T>> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append('file', new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
    const response = await fetch(`${WEB_URL}/backend${path}`, {
      method: 'POST',
      headers: {
        Origin: WEB_URL,
        'X-Forwarded-For': this.ipAddress,
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: form,
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
  }

  /** Téléchargement d'un fichier : corps brut et en-têtes. */
  async download(path: string): Promise<{ status: number; headers: Headers; data: Buffer }> {
    const response = await fetch(`${WEB_URL}/backend${path}`, {
      headers: {
        Origin: WEB_URL,
        'X-Forwarded-For': this.ipAddress,
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
    });
    return {
      status: response.status,
      headers: response.headers,
      data: Buffer.from(await response.arrayBuffer()),
    };
  }

  async signIn(email: string, password: string): Promise<Reply> {
    return this.post('/api/auth/sign-in/email', { email, password });
  }
}
