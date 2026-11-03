/**
 * Relais vers l'API : le navigateur reste sur la même origine, et l'adresse de l'API
 * est lue à l'exécution, donc une même image sert en Cloud comme en On-Premise.
 */
export const dynamic = 'force-dynamic';

// En-têtes propres à une connexion, à ne pas retransmettre.
const HOP_BY_HOP_HEADERS = [
  'connection',
  'content-encoding',
  'content-length',
  'host',
  'keep-alive',
  'transfer-encoding',
];

function withoutHopByHop(headers: Headers): Headers {
  const filtered = new Headers(headers);
  for (const name of HOP_BY_HOP_HEADERS) {
    filtered.delete(name);
  }
  return filtered;
}

async function relay(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params;
  const baseUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
  const target = new URL(path.map(encodeURIComponent).join('/'), `${baseUrl}/`);
  target.search = new URL(request.url).search;

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: withoutHopByHop(request.headers),
      body: request.body,
      duplex: 'half',
      cache: 'no-store',
      redirect: 'manual',
    } as RequestInit);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: withoutHopByHop(upstream.headers),
    });
  } catch {
    return Response.json({ error: 'API injoignable' }, { status: 502 });
  }
}

export { relay as GET, relay as POST, relay as PUT, relay as PATCH, relay as DELETE };
