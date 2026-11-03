import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const fetchMock = vi.fn();

function context(...path: string[]) {
  return { params: Promise.resolve({ path }) };
}

describe('relais vers l’API', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('API_INTERNAL_URL', 'http://api.test:4000');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('transmet le chemin et la chaîne de requête à l’adresse lue à l’exécution', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await GET(
      new Request('http://web.test/backend/api/v1/system/info?a=1'),
      context('api', 'v1', 'system', 'info'),
    );

    const target = fetchMock.mock.calls[0]?.[0] as URL;
    expect(target.href).toBe('http://api.test:4000/api/v1/system/info?a=1');
  });

  it('conserve le statut 503 et le rapport de l’API', async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"error"}', { status: 503 }));

    const response = await GET(new Request('http://web.test/backend/health'), context('health'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'error' });
  });

  it('répond 502 si l’API est injoignable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const response = await GET(new Request('http://web.test/backend/health'), context('health'));

    expect(response.status).toBe(502);
  });

  it('ne laisse pas un chemin sortir de l’API par encodage', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await GET(new Request('http://web.test/backend/x'), context('..', '..', 'etc'));

    const target = fetchMock.mock.calls[0]?.[0] as URL;
    expect(target.origin).toBe('http://api.test:4000');
  });
});
