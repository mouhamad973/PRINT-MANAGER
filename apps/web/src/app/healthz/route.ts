/** Sonde du conteneur web. Elle ne dépend volontairement pas de l'API. */
export function GET(): Response {
  return Response.json({ status: 'ok' });
}
